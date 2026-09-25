use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

use crate::infrastructure::db::repositories;

const RELEASE_NOTES_SEEN_KEY: &str = "release_notes.last_seen_version";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesState {
    pub current_version: String,
    pub last_seen_version: String,
}

pub async fn release_notes_state<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
) -> Result<ReleaseNotesState, String> {
    let current_version = app.package_info().version.to_string();
    sqlx::query(
        "INSERT INTO settings (key, value_json, schema_version, created_at, updated_at)
         VALUES (?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO NOTHING",
    )
    .bind(RELEASE_NOTES_SEEN_KEY)
    .bind(serde_json::to_string(&current_version).map_err(|_| "failed to encode version")?)
    .execute(pool)
    .await
    .map_err(|_| "failed to initialize release notes state")?;
    let stored = repositories::get_setting(pool, RELEASE_NOTES_SEEN_KEY)
        .await
        .map_err(|_| "failed to load release notes state")?
        .ok_or("release notes state is missing")?;
    let last_seen_version =
        serde_json::from_str(&stored).map_err(|_| "invalid release notes state")?;
    Ok(ReleaseNotesState {
        current_version,
        last_seen_version,
    })
}

pub async fn mark_release_notes_seen<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
) -> Result<(), String> {
    let current_version = serde_json::to_string(&app.package_info().version.to_string())
        .map_err(|_| "failed to encode version")?;
    repositories::upsert_setting(pool, RELEASE_NOTES_SEEN_KEY, &current_version, 1)
        .await
        .map_err(|_| "failed to save release notes state".to_owned())
}

pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
pub const UPDATE_CHECK_RETRY_INTERVAL: Duration = Duration::from_secs(60 * 60);
pub const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

fn next_update_check_delay(failed: bool) -> Duration {
    if failed {
        UPDATE_CHECK_RETRY_INTERVAL
    } else {
        UPDATE_CHECK_INTERVAL
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdateAvailabilityChange {
    Unchanged,
    Changed(Option<String>),
}

#[derive(Clone, Default)]
pub struct UpdateAvailabilityState(Arc<Mutex<Option<String>>>);

impl UpdateAvailabilityState {
    pub fn current_version(&self) -> Option<String> {
        self.0.lock().ok().and_then(|version| version.clone())
    }

    pub fn apply_check_result(
        &self,
        result: Result<Option<String>, ()>,
    ) -> UpdateAvailabilityChange {
        let Ok(version) = result else {
            return UpdateAvailabilityChange::Unchanged;
        };
        let Ok(mut current_version) = self.0.lock() else {
            return UpdateAvailabilityChange::Unchanged;
        };
        if *current_version == version {
            return UpdateAvailabilityChange::Unchanged;
        }
        *current_version = version.clone();
        UpdateAvailabilityChange::Changed(version)
    }
}

#[cfg(desktop)]
pub async fn run_background_update_checks<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: UpdateAvailabilityState,
) {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    loop {
        let result = match app.updater_builder().timeout(UPDATE_CHECK_TIMEOUT).build() {
            Ok(updater) => updater
                .check()
                .await
                .map(|update| update.map(|update| update.version))
                .map_err(|_| ()),
            Err(_) => Err(()),
        };
        let retry_after_failure = result.is_err();
        if retry_after_failure {
            eprintln!("Background update check failed; preserving the last known availability");
        }
        if let UpdateAvailabilityChange::Changed(version) = state.apply_check_result(result) {
            if app.emit("update_availability_changed", version).is_err() {
                eprintln!("Failed to publish update availability state");
            }
        }
        tokio::time::sleep(next_update_check_delay(retry_after_failure)).await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{UpdateAvailabilityChange, UpdateAvailabilityState, UPDATE_CHECK_INTERVAL};

    #[test]
    fn publishes_only_availability_changes_on_the_daily_schedule() {
        let state = UpdateAvailabilityState::default();

        assert_eq!(UPDATE_CHECK_INTERVAL, Duration::from_secs(24 * 60 * 60));
        assert_eq!(
            state.apply_check_result(Ok(Some("0.2.0".to_owned()))),
            UpdateAvailabilityChange::Changed(Some("0.2.0".to_owned())),
        );
        assert_eq!(
            state.apply_check_result(Ok(Some("0.2.0".to_owned()))),
            UpdateAvailabilityChange::Unchanged,
        );
        assert_eq!(state.current_version(), Some("0.2.0".to_owned()));
        assert_eq!(
            state.apply_check_result(Ok(None)),
            UpdateAvailabilityChange::Changed(None),
        );
    }

    #[test]
    fn retries_failed_checks_after_an_hour_but_keeps_successful_checks_daily() {
        use super::{next_update_check_delay, UPDATE_CHECK_RETRY_INTERVAL};

        assert_eq!(next_update_check_delay(true), Duration::from_secs(60 * 60),);
        assert_eq!(UPDATE_CHECK_RETRY_INTERVAL, Duration::from_secs(60 * 60),);
        assert_eq!(
            next_update_check_delay(false),
            Duration::from_secs(24 * 60 * 60),
        );
    }
}
