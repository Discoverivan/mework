//! Rust owns Git, authentication and the cache. Agents only see exported blobs.
use super::developer_review::PullRequestReviewRequest;
use crate::{
    domain::models::{IntegrationHealthStatus, IntegrationKind},
    infrastructure::{
        credentials::keyring::{
            integration_credential_store, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
        },
        data_integrations::bitbucket_dc::client::BitbucketDcClient,
        db::repositories,
    },
};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FILES: usize = 50_000;
type CacheLocks = Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>;
static CACHE_LOCKS: OnceLock<CacheLocks> = OnceLock::new();

pub(super) struct Snapshot {
    directory: tempfile::TempDir,
    pub head: String,
    pub target: String,
    pub base: String,
    /// Virtual path -> exported regular file. Symlinks and submodules are never followed.
    pub files: HashMap<String, PathBuf>,
    pub omitted: Vec<String>,
}

impl Snapshot {
    pub fn root(&self) -> &Path {
        self.directory.path()
    }
}

pub(super) async fn prepare(
    pool: &SqlitePool,
    request: &PullRequestReviewRequest,
    diff: &str,
    cache_root: &Path,
) -> Result<Snapshot, String> {
    let integration = repositories::list_integrations(pool)
        .await
        .map_err(|_| "review_source_database")?
        .into_iter()
        .find(|i| {
            i.id == request.integration_id
                && i.kind == IntegrationKind::Bitbucket
                && i.enabled
                && i.health_status == IntegrationHealthStatus::Working
        })
        .ok_or("review_source_integration_unavailable")?;
    let service = if cfg!(debug_assertions) {
        DEV_KEYRING_SERVICE
    } else {
        PRODUCTION_KEYRING_SERVICE
    };
    let secret = integration_credential_store(service)
        .load(&integration.credential_ref)
        .map_err(|_| "review_source_missing_credential")?;
    if secret.trim().is_empty() {
        return Err("review_source_missing_credential".into());
    }
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .danger_accept_invalid_certs(integration.allow_insecure_tls)
        .build()
        .map_err(|_| "review_source_transport")?;
    let client =
        BitbucketDcClient::with_bearer_token_and_client(&integration.base_url, &secret, http)
            .map_err(|_| "review_source_transport")?;
    let id = request
        .pull_request_id
        .parse()
        .map_err(|_| "review_source_invalid_pr")?;
    let before = client
        .get_pull_request(&request.project_key, &request.repository_slug, id)
        .await
        .map_err(|_| "review_source_metadata_failed")?;
    if !before.open || before.from_ref.latest_commit != request.latest_commit {
        return Err("review_source_changed".into());
    }
    // Tie the already captured canonical provider diff to this pair of commits.
    let current_diff = client
        .pull_request_diff(&request.project_key, &request.repository_slug, id)
        .await
        .map_err(|_| "review_source_diff_failed")?;
    if current_diff != diff {
        return Err("review_source_changed".into());
    }
    let head = before
        .from_ref
        .latest_commit
        .as_deref()
        .ok_or("review_source_missing_commit")?;
    let target = before
        .to_ref
        .latest_commit
        .as_deref()
        .ok_or("review_source_missing_commit")?;
    if !valid_commit(head) || !valid_commit(target) {
        return Err("review_source_invalid_commit".into());
    }
    let repository = client
        .get_repository(&request.project_key, &request.repository_slug)
        .await
        .map_err(|_| "review_source_repository_failed")?;
    let origin =
        reqwest::Url::parse(&integration.base_url).map_err(|_| "review_source_invalid_origin")?;
    let clone_url = repository
        .links
        .and_then(|l| l.clone)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|l| {
            let mut url = reqwest::Url::parse(&l.href).ok()?;
            if url.password().is_some() {
                return None;
            }
            url.set_username("").ok()?;
            Some(url)
        })
        .find(|u| {
            matches!(u.scheme(), "https" | "http")
                && u.origin() == origin.origin()
                && u.username().is_empty()
                && u.password().is_none()
                && u.query().is_none()
                && u.fragment().is_none()
        })
        .ok_or("review_source_clone_url_unavailable")?;
    let key: String = Sha256::digest(format!("{}\0{}\0{}", integration.id, origin, repository.id))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let cache = cache_root.join(key);
    let snapshot = export_remote(
        &cache,
        clone_url.as_str(),
        &secret,
        integration.allow_insecure_tls,
        head,
        target,
    )?;
    let after = client
        .get_pull_request(&request.project_key, &request.repository_slug, id)
        .await
        .map_err(|_| "review_source_metadata_failed")?;
    if !after.open
        || before.from_ref.latest_commit != after.from_ref.latest_commit
        || before.to_ref.latest_commit != after.to_ref.latest_commit
    {
        return Err("review_source_changed".into());
    }
    super::logging::info(
        "developer_review",
        "source_snapshot_prepared",
        serde_json::json!({"files": snapshot.files.len(), "omittedFiles": snapshot.omitted.len(), "head": snapshot.head, "target": snapshot.target, "base": snapshot.base}),
    );
    Ok(snapshot)
}

fn valid_commit(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|c| c.is_ascii_hexdigit())
}

fn safe_source_path(path: &Path) -> bool {
    path.to_str().is_some()
        && !path.to_string_lossy().contains([':', '\\'])
        && path.components().all(|component| {
            let Component::Normal(name) = component else {
                return false;
            };
            let name = name.to_string_lossy();
            let stem = name
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            !name.eq_ignore_ascii_case(".git")
                && !name.ends_with(['.', ' '])
                && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
}

fn git(cache: &Path) -> Command {
    let mut command = Command::new("git");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    // No user hooks, credential helpers, filters, URL rewrites, tracing or interactive login.
    for (key, _) in std::env::vars_os().filter(|(k, _)| k.to_string_lossy().starts_with("GIT_")) {
        command.env_remove(key);
    }
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .args([
            "-c",
            "gc.auto=0",
            "-c",
            "maintenance.auto=false",
            "-c",
            "credential.helper=",
            "-c",
            "core.hooksPath=",
            "-c",
            "http.followRedirects=false",
            "-c",
            "protocol.file.allow=never",
            "-c",
            "protocol.ext.allow=never",
        ])
        .arg("--git-dir")
        .arg(cache)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn run(mut command: Command, output: Option<&Path>) -> Result<Vec<u8>, String> {
    let capture = tempfile::tempfile().map_err(|_| "review_source_prepare_failed")?;
    let destination = match output {
        Some(path) => fs::File::create(path).map_err(|_| "review_source_prepare_failed")?,
        None => capture
            .try_clone()
            .map_err(|_| "review_source_prepare_failed")?,
    };
    command.stdout(destination);
    let mut child = command
        .spawn()
        .map_err(|_| "review_source_git_unavailable")?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "review_source_git_failed")? {
            break status;
        }
        let too_large = match output {
            Some(path) => fs::metadata(path).is_ok_and(|m| m.len() > MAX_ARCHIVE_BYTES),
            None => capture.metadata().is_ok_and(|m| m.len() > 1024 * 1024),
        };
        if started.elapsed() > Duration::from_secs(180) || too_large {
            super::ai_providers::cli::kill_process_group(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err("review_source_git_limit".into());
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    if !status.success() {
        return Err("review_source_git_failed".into());
    }
    if output.is_some() {
        return Ok(Vec::new());
    }
    use std::io::{Seek, SeekFrom};
    let mut capture = capture;
    capture
        .seek(SeekFrom::Start(0))
        .map_err(|_| "review_source_git_failed")?;
    let mut bytes = Vec::new();
    capture
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "review_source_git_failed")?;
    if bytes.len() > 1024 * 1024 {
        return Err("review_source_git_limit".into());
    }
    Ok(bytes)
}

fn export_remote(
    cache: &Path,
    url: &str,
    secret: &str,
    insecure: bool,
    head: &str,
    target: &str,
) -> Result<Snapshot, String> {
    let lock = CACHE_LOCKS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "review_source_cache_lock")?
        .entry(cache.to_owned())
        .or_default()
        .clone();
    let _guard = lock.lock().map_err(|_| "review_source_cache_lock")?;
    fs::create_dir_all(cache).map_err(|_| "review_source_prepare_failed")?;
    if !cache.join("HEAD").exists() {
        let mut init = git(cache);
        init.args(["init", "--bare", "--template="]);
        run(init, None)?;
    }
    let mut fetch = git(cache);
    // The token is transient child environment, never argv, .git/config, prompts or logs.
    fetch
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "http.extraHeader")
        .env(
            "GIT_CONFIG_VALUE_0",
            format!("Authorization: Bearer {secret}"),
        )
        .env("GIT_CONFIG_KEY_1", "http.sslVerify")
        .env(
            "GIT_CONFIG_VALUE_1",
            if insecure { "false" } else { "true" },
        )
        .args([
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            "--",
            url,
            head,
            target,
        ]);
    run(fetch, None)?;
    for (name, commit) in [("refs/mework/head", head), ("refs/mework/target", target)] {
        let mut retain = git(cache);
        retain.args(["update-ref", name, commit]);
        run(retain, None)?;
    }
    export(cache, head, target)
}

fn export(cache: &Path, head: &str, target: &str) -> Result<Snapshot, String> {
    // Archive must represent the tree, including files marked export-ignore,
    // and preserve blob contents rather than applying export-subst.
    fs::create_dir_all(cache.join("info")).map_err(|_| "review_source_prepare_failed")?;
    fs::write(
        cache.join("info/attributes"),
        "* -export-ignore -export-subst\n",
    )
    .map_err(|_| "review_source_prepare_failed")?;
    let mut merge_base = git(cache);
    merge_base.args(["merge-base", head, target]);
    let base = String::from_utf8(run(merge_base, None)?)
        .map_err(|_| "review_source_git_failed")?
        .trim()
        .to_owned();
    if !valid_commit(&base) {
        return Err("review_source_invalid_commit".into());
    }
    let directory = tempfile::Builder::new()
        .prefix("mework-source-")
        .tempdir()
        .map_err(|_| "review_source_prepare_failed")?;
    let mut snapshot = Snapshot {
        directory,
        head: head.into(),
        target: target.into(),
        base: base.clone(),
        files: HashMap::new(),
        omitted: Vec::new(),
    };
    for (prefix, commit) in [("head", head), ("base", base.as_str())] {
        let archive = tempfile::NamedTempFile::new().map_err(|_| "review_source_prepare_failed")?;
        let mut command = git(cache);
        command.args(["archive", "--format=tar", commit]);
        run(command, Some(archive.path()))?;
        if archive
            .as_file()
            .metadata()
            .map_err(|_| "review_source_prepare_failed")?
            .len()
            > MAX_ARCHIVE_BYTES
        {
            return Err("review_source_git_limit".into());
        }
        let mut archive = tar::Archive::new(
            fs::File::open(archive.path()).map_err(|_| "review_source_prepare_failed")?,
        );
        let mut total = 0u64;
        for entry in archive
            .entries()
            .map_err(|_| "review_source_archive_failed")?
        {
            let mut entry = entry.map_err(|_| "review_source_archive_failed")?;
            let relative = entry
                .path()
                .map_err(|_| "review_source_archive_failed")?
                .into_owned();
            if !safe_source_path(&relative) {
                return Err("review_source_unsafe_path".into());
            }
            if entry.header().entry_type().is_dir() {
                continue;
            }
            let name = format!("{prefix}/{}", relative.to_string_lossy().replace('\\', "/"));
            if !entry.header().entry_type().is_file() {
                snapshot.omitted.push(name);
                continue;
            }
            total = total.saturating_add(entry.size());
            if total > MAX_ARCHIVE_BYTES || snapshot.files.len() >= MAX_FILES {
                return Err("review_source_git_limit".into());
            }
            let path = snapshot.root().join(prefix).join(&relative);
            fs::create_dir_all(path.parent().ok_or("review_source_unsafe_path")?)
                .map_err(|_| "review_source_prepare_failed")?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| "review_source_prepare_failed")?;
            std::io::copy(&mut entry, &mut file).map_err(|_| "review_source_prepare_failed")?;
            snapshot.files.insert(name, path);
        }
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_pinned_sources_and_reviews_in_one_live_session() {
        let repository = tempfile::tempdir().unwrap();
        let execute = |args: &[&str]| {
            let output = Command::new("git")
                .arg("-C")
                .arg(repository.path())
                .args([
                    "-c",
                    "core.hooksPath=",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "user.name=Example Author",
                    "-c",
                    "user.email=author@example.invalid",
                ])
                .args(args)
                .output()
                .unwrap();
            assert!(output.status.success(), "synthetic Git operation failed");
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        };
        execute(&["init", "--template=", "--initial-branch=main"]);
        fs::write(
            repository.path().join(".gitattributes"),
            "contract.txt export-ignore\n",
        )
        .unwrap();
        fs::write(repository.path().join("contract.txt"), "amber-42\n").unwrap();
        fs::write(repository.path().join("example.txt"), "before\n").unwrap();
        execute(&["add", "."]);
        execute(&["commit", "-m", "Synthetic base"]);
        let base = execute(&["rev-parse", "HEAD"]);
        fs::write(
            repository.path().join("example.txt"),
            "synthetic record\n".repeat(48000),
        )
        .unwrap();
        execute(&["add", "."]);
        execute(&["commit", "-m", "Synthetic change"]);
        let head = execute(&["rev-parse", "HEAD"]);
        let snapshot = export(&repository.path().join(".git"), &head, &base).unwrap();
        assert_eq!(snapshot.base, base);
        assert_eq!(
            fs::read_to_string(&snapshot.files["head/contract.txt"]).unwrap(),
            "amber-42\n"
        );
        assert_eq!(
            fs::read_to_string(&snapshot.files["base/example.txt"]).unwrap(),
            "before\n"
        );
        assert!(!snapshot.root().join(".git").exists());
        // Opt-in real CLI smoke: exercises the actual installed protocol and model,
        // including a diff larger than one material read and an unchanged file.
        if let Ok(model) = std::env::var("MEWORK_REVIEW_SESSION_SMOKE_MODEL") {
            let settings = super::super::ai::AiSettings {
                provider: Some(super::super::ai::AiProviderId::CodexCli),
                model,
                reasoning: super::super::ai::AiReasoning::High,
                ..Default::default()
            };
            let diff = execute(&["diff", &base, &head]);
            let root = tempfile::tempdir().unwrap();
            let (bytes, usage) = super::super::review_session::run(&settings, root.path(), super::super::review_session::Input {
                manifest: &serde_json::json!({"title":"Synthetic change"}), diff: &diff, source: Some(&snapshot),
                rules: "Synthetic protocol verification: ONCE at the very start, intentionally issue exactly three identical mework_read calls for review/index.json with offset=null and limit=100, in one JavaScript loop. This tests recovery from the invalid-offset loop seen in production. After that fault injection, including if the turn is interrupted, never repeat the invalid requests: follow the original task and return the specified JSON.",
                task: Some("Read all changes and head/contract.txt. Return the exact contract marker in marker."),
                schema: r#"{"type":"object","additionalProperties":false,"required":["marker"],"properties":{"marker":{"type":"string"}}}"#,
                usage_pool: None,
            }).unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["marker"],
                "amber-42"
            );
            assert!(usage.is_some());
        }
    }
}
