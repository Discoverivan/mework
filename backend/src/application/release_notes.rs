use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{Client, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

use crate::application::logging::HttpRequestBuilderExt;

const RELEASES_URL: &str = "https://api.github.com/repos/Discoverivan/mework/releases";
const MAX_NOTE_BYTES: usize = 128 * 1024;
const MAX_CATALOG_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONTENT_CACHE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Default)]
pub struct ReleaseNotesRequestState(pub Mutex<()>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallState {
    installed_version: String,
    pending_from_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesState {
    pub current_version: String,
    pub pending_from_version: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNote {
    pub version: String,
    pub markdown: String,
    pub language: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseNotesConfig {
    cache_ttl_seconds: u64,
    prefetch_release_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Clone, Deserialize, Serialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedCatalog {
    fetched_at_seconds: u64,
    releases: Vec<GithubRelease>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedContent {
    requested_language: String,
    fetched_at_seconds: u64,
    note: ReleaseNote,
}

fn config() -> ReleaseNotesConfig {
    serde_json::from_str(include_str!("../../release-notes-config.json"))
        .expect("valid release notes configuration")
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "failed to locate app data".to_owned())
}

fn install_state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("release-notes-state.json"))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path, max_bytes: usize) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > max_bytes {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    use std::io::Write;

    let bytes = serde_json::to_vec(value).map_err(|_| "failed to encode release notes state")?;
    let parent = path
        .parent()
        .ok_or("failed to locate release notes directory")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "failed to prepare release notes state")?;
    temporary
        .write_all(&bytes)
        .map_err(|_| "failed to save release notes state")?;
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|_| "failed to save release notes state".to_owned())
}

fn current_install_state(path: &Path, current_version: &str) -> Result<InstallState, String> {
    // A damaged local state file must not permanently block release notes.
    // With no reliable previous version, treat it like the first launch.
    let mut stored = read_json::<InstallState>(path, 1024).unwrap_or_else(|| InstallState {
        installed_version: current_version.to_owned(),
        pending_from_version: None,
    });
    if stored.installed_version != current_version {
        let upgrading =
            Version::parse(current_version).ok() > Version::parse(&stored.installed_version).ok();
        if upgrading && stored.pending_from_version.is_none() {
            stored.pending_from_version = Some(stored.installed_version.clone());
        } else if !upgrading {
            stored.pending_from_version = None;
        }
        stored.installed_version = current_version.to_owned();
    }
    write_json(path, &stored)?;
    Ok(stored)
}

pub async fn state<R: Runtime>(
    app: &AppHandle<R>,
    request_state: &ReleaseNotesRequestState,
) -> Result<ReleaseNotesState, String> {
    let _guard = request_state.0.lock().await;
    let current_version = app.package_info().version.to_string();
    let stored = current_install_state(&install_state_path(app)?, &current_version)?;
    Ok(ReleaseNotesState {
        current_version,
        pending_from_version: stored.pending_from_version,
    })
}

pub async fn mark_seen<R: Runtime>(
    app: &AppHandle<R>,
    request_state: &ReleaseNotesRequestState,
) -> Result<(), String> {
    let _guard = request_state.0.lock().await;
    let path = install_state_path(app)?;
    let mut stored = current_install_state(&path, &app.package_info().version.to_string())?;
    stored.pending_from_version = None;
    write_json(&path, &stored)
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "failed to create release notes client".to_owned())
}

async fn read_limited(
    mut response: reqwest::Response,
    limit: usize,
    error: &'static str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| error)? {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err(error.to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn fetch_catalog(client: &Client) -> Result<Vec<GithubRelease>, String> {
    let mut all = Vec::new();
    let mut remaining_bytes = MAX_CATALOG_BYTES;
    for page in 1..=10 {
        let response = client
            .get(RELEASES_URL)
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .header("User-Agent", "mework-release-notes")
            .header("Accept", "application/vnd.github+json")
            .send_logged(
                "application.release_notes",
                "fetch_catalog",
                crate::application::logging::HttpBodyPolicy::Omit,
            )
            .await
            .map_err(|_| "failed to fetch GitHub releases")?;
        if !response.status().is_success() {
            crate::application::logging::log_http_error_body(
                response,
                "application.release_notes",
                "fetch_catalog",
                true,
            )
            .await;
            return Err("GitHub releases are unavailable".to_owned());
        }
        if response
            .content_length()
            .is_some_and(|length| length > remaining_bytes as u64)
        {
            return Err("GitHub releases response is too large".to_owned());
        }
        let bytes = read_limited(
            response,
            remaining_bytes,
            "GitHub releases response is too large or could not be read",
        )
        .await?;
        remaining_bytes -= bytes.len();
        let batch: Vec<GithubRelease> =
            serde_json::from_slice(&bytes).map_err(|_| "invalid GitHub releases response")?;
        let length = batch.len();
        all.extend(batch);
        if length < 100 {
            return Ok(all);
        }
    }
    Err("GitHub releases list is too long".to_owned())
}

async fn catalog(
    app_data: &Path,
    client: &Client,
    required_version: Option<&str>,
) -> Result<Vec<GithubRelease>, String> {
    let path = app_data.join("release-notes-catalog.json");
    let cached = read_json::<CachedCatalog>(&path, MAX_CATALOG_BYTES);
    if let Some(cache) = cached.as_ref() {
        let includes_required = required_version.is_none_or(|version| {
            cache
                .releases
                .iter()
                .any(|release| release.tag_name == format!("mework-v{version}"))
        });
        if includes_required
            && now_seconds().saturating_sub(cache.fetched_at_seconds) < config().cache_ttl_seconds
        {
            return Ok(cache.releases.clone());
        }
    }
    match fetch_catalog(client).await {
        Ok(releases) => {
            let snapshot = CachedCatalog {
                fetched_at_seconds: now_seconds(),
                releases: releases.clone(),
            };
            let _ = write_json(&path, &snapshot);
            Ok(releases)
        }
        Err(error) => cached.map(|cache| cache.releases).ok_or(error),
    }
}

fn releases_through(
    releases: Vec<GithubRelease>,
    current_version: &str,
) -> Result<Vec<(Version, GithubRelease)>, String> {
    let current = Version::parse(current_version).map_err(|_| "invalid installed version")?;
    let mut selected: Vec<_> = releases
        .into_iter()
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.strip_prefix("mework-v")?).ok()?;
            (version <= current).then_some((version, release))
        })
        .collect();
    selected.sort_by(|(left, _), (right, _)| right.cmp(left));
    Ok(selected)
}

fn requested_language(value: &str) -> &'static str {
    if value == "ru" {
        "ru"
    } else {
        "en"
    }
}

fn releases_between(
    releases: Vec<GithubRelease>,
    current_version: &str,
    target_version: &str,
) -> Result<Vec<(Version, GithubRelease)>, String> {
    let current = Version::parse(current_version).map_err(|_| "invalid installed version")?;
    Ok(releases_through(releases, target_version)?
        .into_iter()
        .filter(|(version, _)| *version > current)
        .collect())
}

pub async fn load_available_update_notes<R: Runtime>(
    app: &AppHandle<R>,
    request_state: &ReleaseNotesRequestState,
    target_version: &str,
    language: &str,
) -> Result<Vec<ReleaseNote>, String> {
    let _guard = request_state.0.lock().await;
    let current_version = app.package_info().version.to_string();
    let target = Version::parse(target_version).map_err(|_| "invalid release version")?;
    let app_data = app_data_dir(app)?;
    let client = http_client()?;
    let selected = releases_between(
        catalog(&app_data, &client, Some(target_version)).await?,
        &current_version,
        target_version,
    )?;
    if selected.first().map(|(version, _)| version) != Some(&target) {
        return Err("release notes are unavailable".to_owned());
    }
    let mut notes = Vec::with_capacity(selected.len());
    for (version, release) in selected {
        notes.push(note_for_release(&app_data, &client, &release, &version, language).await?);
    }
    Ok(notes)
}

fn fresh_cached_note(app_data: &Path, version: &str, language: &str) -> Option<ReleaseNote> {
    read_json::<Vec<CachedContent>>(
        &app_data.join("release-notes-content.json"),
        MAX_CONTENT_CACHE_BYTES,
    )?
    .into_iter()
    .find(|entry| {
        entry.note.version == version
            && entry.requested_language == requested_language(language)
            && now_seconds().saturating_sub(entry.fetched_at_seconds) < config().cache_ttl_seconds
    })
    .map(|entry| entry.note)
}

async fn prefetch_recent(
    app_data: &Path,
    client: &Client,
    current_version: &str,
    request_state: &ReleaseNotesRequestState,
    count: usize,
) -> Result<(), String> {
    if count == 0 {
        return Ok(());
    }
    let selected = {
        let _guard = request_state.0.lock().await;
        releases_through(
            catalog(app_data, client, Some(current_version)).await?,
            current_version,
        )?
    };
    for (version, release) in selected.into_iter().take(count) {
        for language in ["en", "ru"] {
            // Release the lock between notes so foreground requests can take their turn.
            let _guard = request_state.0.lock().await;
            let _ = note_for_release(app_data, client, &release, &version, language).await;
        }
    }
    Ok(())
}

pub async fn run_background_prefetch<R: Runtime>(app: AppHandle<R>) {
    let settings = config();
    if settings.prefetch_release_count == 0 {
        return;
    }
    let Ok(app_data) = app_data_dir(&app) else {
        return;
    };
    let Ok(client) = http_client() else { return };
    let current_version = app.package_info().version.to_string();
    let request_state = app.state::<ReleaseNotesRequestState>();
    loop {
        let _ = prefetch_recent(
            &app_data,
            &client,
            &current_version,
            &request_state,
            settings.prefetch_release_count,
        )
        .await;
        tokio::time::sleep(Duration::from_secs(settings.cache_ttl_seconds.max(60))).await;
    }
}

async fn note_for_release(
    app_data: &Path,
    client: &Client,
    release: &GithubRelease,
    version: &Version,
    language: &str,
) -> Result<ReleaseNote, String> {
    let language = requested_language(language);
    let path = app_data.join("release-notes-content.json");
    let mut cached =
        read_json::<Vec<CachedContent>>(&path, MAX_CONTENT_CACHE_BYTES).unwrap_or_default();
    let old = cached
        .iter()
        .find(|entry| {
            entry.note.version == version.to_string() && entry.requested_language == language
        })
        .cloned();
    if let Some(entry) = old.as_ref() {
        if now_seconds().saturating_sub(entry.fetched_at_seconds) < config().cache_ttl_seconds {
            return Ok(entry.note.clone());
        }
    }
    let preferred = format!("release-notes.{language}.md");
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == preferred)
        .or_else(|| {
            release
                .assets
                .iter()
                .find(|asset| asset.name == "release-notes.en.md")
        });
    let fetched = if let Some(asset) = asset {
        download_asset(client, &asset.browser_download_url)
            .await
            .map(|markdown| ReleaseNote {
                version: version.to_string(),
                markdown,
                language: if asset.name == preferred {
                    language
                } else {
                    "en"
                }
                .to_owned(),
            })
    } else {
        Ok(ReleaseNote {
            version: version.to_string(),
            markdown: release.body.clone().unwrap_or_default(),
            language: "en".to_owned(),
        })
    };
    match fetched {
        Ok(note) if !note.markdown.trim().is_empty() => {
            cached.retain(|entry| {
                !(entry.note.version == note.version && entry.requested_language == language)
            });
            cached.push(CachedContent {
                requested_language: language.to_owned(),
                fetched_at_seconds: now_seconds(),
                note: note.clone(),
            });
            let capacity = config()
                .prefetch_release_count
                .saturating_mul(2)
                .saturating_add(4);
            cached.drain(..cached.len().saturating_sub(capacity));
            // Bound the aggregate file as well as the individual downloaded assets.
            while serde_json::to_vec(&cached)
                .is_ok_and(|bytes| bytes.len() > MAX_CONTENT_CACHE_BYTES)
            {
                cached.remove(0);
            }
            let _ = write_json(&path, &cached);
            Ok(note)
        }
        _ => old
            .map(|entry| entry.note)
            .ok_or_else(|| "release notes are unavailable".to_owned()),
    }
}

async fn download_asset(client: &Client, raw_url: &str) -> Result<String, String> {
    let url = Url::parse(raw_url).map_err(|_| "invalid release notes asset URL")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/Discoverivan/mework/releases/download/")
    {
        return Err("invalid release notes asset URL".to_owned());
    }
    let response = client
        .get(url)
        .header("User-Agent", "mework-release-notes")
        .send_logged(
            "application.release_notes",
            "download_asset",
            crate::application::logging::HttpBodyPolicy::Omit,
        )
        .await
        .map_err(|_| "failed to download release notes")?;
    if !response.status().is_success() {
        crate::application::logging::log_http_error_body(
            response,
            "application.release_notes",
            "download_asset",
            true,
        )
        .await;
        return Err("release notes asset is unavailable".to_owned());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_NOTE_BYTES as u64)
    {
        return Err("release notes asset is too large".to_owned());
    }
    let bytes = read_limited(
        response,
        MAX_NOTE_BYTES,
        "release notes asset is too large or could not be read",
    )
    .await?;
    String::from_utf8(bytes).map_err(|_| "release notes asset is not UTF-8".to_owned())
}

pub async fn list_update_versions<R: Runtime>(
    app: &AppHandle<R>,
    request_state: &ReleaseNotesRequestState,
) -> Result<Vec<String>, String> {
    let _guard = request_state.0.lock().await;
    let current_version = app.package_info().version.to_string();
    let stored = current_install_state(&install_state_path(app)?, &current_version)?;
    let Some(from_version) = stored.pending_from_version else {
        return Ok(Vec::new());
    };
    let previous = Version::parse(&from_version).map_err(|_| "invalid previous version")?;
    let app_data = app_data_dir(app)?;
    let client = http_client()?;
    let selected = releases_through(
        catalog(&app_data, &client, Some(&current_version)).await?,
        &current_version,
    )?;
    let versions: Vec<_> = selected
        .into_iter()
        .filter(|(version, _)| *version > previous)
        .map(|(version, _)| version.to_string())
        .collect();
    if versions.is_empty() {
        return Err("release notes are unavailable".to_owned());
    }
    Ok(versions)
}

pub async fn list_versions<R: Runtime>(
    app: &AppHandle<R>,
    request_state: &ReleaseNotesRequestState,
) -> Result<Vec<String>, String> {
    let app_data = app_data_dir(app)?;
    let installed_version = app.package_info().version.to_string();
    if let Some(cached) = read_json::<CachedCatalog>(
        &app_data.join("release-notes-catalog.json"),
        MAX_CATALOG_BYTES,
    ) {
        if now_seconds().saturating_sub(cached.fetched_at_seconds) < config().cache_ttl_seconds
            && cached
                .releases
                .iter()
                .any(|release| release.tag_name == format!("mework-v{installed_version}"))
        {
            return Ok(releases_through(cached.releases, &installed_version)?
                .into_iter()
                .map(|(version, _)| version.to_string())
                .collect());
        }
    }
    let _guard = request_state.0.lock().await;
    let client = http_client()?;
    let selected = releases_through(
        catalog(&app_data, &client, Some(&installed_version)).await?,
        &installed_version,
    )?;
    Ok(selected
        .into_iter()
        .map(|(version, _)| version.to_string())
        .collect())
}

pub async fn load_version<R: Runtime>(
    app: &AppHandle<R>,
    request_state: &ReleaseNotesRequestState,
    version: &str,
    language: &str,
) -> Result<ReleaseNote, String> {
    let requested = Version::parse(version).map_err(|_| "invalid release version")?;
    let app_data = app_data_dir(app)?;
    let current_version = app.package_info().version.to_string();
    if requested > Version::parse(&current_version).map_err(|_| "invalid installed version")? {
        return Err("release is unavailable".to_owned());
    }
    if let Some(note) = fresh_cached_note(&app_data, &requested.to_string(), language) {
        return Ok(note);
    }
    let _guard = request_state.0.lock().await;
    let client = http_client()?;
    let selected = releases_through(catalog(&app_data, &client, None).await?, &current_version)?;
    let (_, release) = selected
        .into_iter()
        .find(|(candidate, _)| *candidate == requested)
        .ok_or("release is unavailable")?;
    note_for_release(&app_data, &client, &release, &requested, language).await
}

#[cfg(test)]
mod tests {
    use super::current_install_state;

    #[tokio::test]
    async fn prefetches_recent_notes_in_both_languages_and_reuses_the_disk_cache() {
        let directory = tempfile::tempdir().unwrap();
        let releases: Vec<_> = ["0.1.0", "0.3.0", "0.2.0"]
            .into_iter()
            .map(|version| super::GithubRelease {
                tag_name: format!("mework-v{version}"),
                body: Some(format!("## Fixed\n\n- Example fix for {version}.")),
                assets: Vec::new(),
            })
            .collect();
        let upcoming = super::releases_between(releases.clone(), "0.1.0", "0.3.0").unwrap();
        assert_eq!(
            upcoming
                .iter()
                .map(|(version, _)| version.to_string())
                .collect::<Vec<_>>(),
            ["0.3.0", "0.2.0"]
        );
        super::write_json(
            &directory.path().join("release-notes-catalog.json"),
            &super::CachedCatalog {
                fetched_at_seconds: super::now_seconds(),
                releases: releases.clone(),
            },
        )
        .unwrap();
        super::prefetch_recent(
            directory.path(),
            &super::http_client().unwrap(),
            "0.3.0",
            &super::ReleaseNotesRequestState::default(),
            2,
        )
        .await
        .unwrap();

        let cached: Vec<super::CachedContent> = super::read_json(
            &directory.path().join("release-notes-content.json"),
            super::MAX_CONTENT_CACHE_BYTES,
        )
        .unwrap();
        assert_eq!(cached.len(), 4);
        assert!(cached
            .iter()
            .all(|entry| ["0.3.0", "0.2.0"].contains(&entry.note.version.as_str())));
        // Reopening uses only the persisted cache; no source body is needed anymore.
        let release = super::GithubRelease {
            body: None,
            ..releases[1].clone()
        };
        let note = super::note_for_release(
            directory.path(),
            &super::http_client().unwrap(),
            &release,
            &semver::Version::parse("0.3.0").unwrap(),
            "ru",
        )
        .await
        .unwrap();
        assert_eq!(note.markdown, "## Fixed\n\n- Example fix for 0.3.0.");
        assert_eq!(
            super::fresh_cached_note(directory.path(), "0.3.0", "en")
                .unwrap()
                .version,
            "0.3.0"
        );
    }

    #[test]
    fn keeps_the_first_unread_version_across_multiple_updates() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let path = directory.path().join("release-notes-state.json");

        assert!(current_install_state(&path, "0.2.1")
            .unwrap()
            .pending_from_version
            .is_none());
        assert_eq!(
            current_install_state(&path, "0.2.2")
                .unwrap()
                .pending_from_version
                .as_deref(),
            Some("0.2.1")
        );
        assert_eq!(
            current_install_state(&path, "0.2.3")
                .unwrap()
                .pending_from_version
                .as_deref(),
            Some("0.2.1")
        );
    }

    #[test]
    fn recovers_from_damaged_local_state() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let path = directory.path().join("release-notes-state.json");
        std::fs::write(&path, "{unfinished").unwrap();

        let state = current_install_state(&path, "0.2.3").unwrap();
        assert_eq!(state.installed_version, "0.2.3");
        assert!(state.pending_from_version.is_none());
    }
}
