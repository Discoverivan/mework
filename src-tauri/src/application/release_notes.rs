use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{Client, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

const RELEASES_URL: &str = "https://api.github.com/repos/Discoverivan/mework/releases";
const MAX_NOTE_BYTES: usize = 128 * 1024;
const MAX_CATALOG_BYTES: usize = 8 * 1024 * 1024;

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
    let bytes = serde_json::to_vec(value).map_err(|_| "failed to encode release notes state")?;
    std::fs::write(path, bytes).map_err(|_| "failed to save release notes state".to_owned())
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
            .send()
            .await
            .map_err(|_| "failed to fetch GitHub releases")?;
        if !response.status().is_success() {
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

async fn note_for_release(
    app_data: &Path,
    client: &Client,
    release: &GithubRelease,
    version: &Version,
    language: &str,
) -> Result<ReleaseNote, String> {
    let language = requested_language(language);
    let path = app_data.join("release-notes-content.json");
    let mut cached = read_json::<Vec<CachedContent>>(&path, 2 * 1024 * 1024).unwrap_or_default();
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
        .send()
        .await
        .map_err(|_| "failed to download release notes")?;
    if !response.status().is_success() {
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
    let _guard = request_state.0.lock().await;
    let app_data = app_data_dir(app)?;
    let client = http_client()?;
    let installed_version = app.package_info().version.to_string();
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
    let _guard = request_state.0.lock().await;
    let requested = Version::parse(version).map_err(|_| "invalid release version")?;
    let app_data = app_data_dir(app)?;
    let client = http_client()?;
    let selected = releases_through(
        catalog(&app_data, &client, None).await?,
        &app.package_info().version.to_string(),
    )?;
    let (_, release) = selected
        .into_iter()
        .find(|(candidate, _)| *candidate == requested)
        .ok_or("release is unavailable")?;
    note_for_release(&app_data, &client, &release, &requested, language).await
}

#[cfg(test)]
mod tests {
    use super::current_install_state;

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
