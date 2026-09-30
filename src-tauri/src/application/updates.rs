use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

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

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateCheckStatus {
    #[default]
    Idle,
    Checking,
    Current,
    Available,
    Error,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAvailabilitySnapshot {
    pub available_version: Option<String>,
    pub last_checked_at: Option<u64>,
    pub status: UpdateCheckStatus,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckTicket {
    pub check_id: u64,
    pub snapshot: UpdateAvailabilitySnapshot,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckCompletion {
    pub accepted: bool,
    pub snapshot: UpdateAvailabilitySnapshot,
}

#[derive(Default)]
struct UpdateAvailabilityInner {
    generation: u64,
    revision: u64,
    snapshot: UpdateAvailabilitySnapshot,
}

#[derive(Clone, Default)]
pub struct UpdateAvailabilityState(Arc<Mutex<UpdateAvailabilityInner>>);

impl UpdateAvailabilityState {
    pub fn snapshot(&self) -> UpdateAvailabilitySnapshot {
        self.0
            .lock()
            .map(|state| state.snapshot.clone())
            .unwrap_or_default()
    }

    pub fn current_version(&self) -> Option<String> {
        self.snapshot().available_version
    }

    pub fn begin_check(&self) -> UpdateCheckTicket {
        match self.0.lock() {
            Ok(mut state) => {
                state.generation = state.generation.wrapping_add(1);
                state.revision = state.revision.wrapping_add(1);
                state.snapshot.revision = state.revision;
                state.snapshot.status = UpdateCheckStatus::Checking;
                UpdateCheckTicket {
                    check_id: state.generation,
                    snapshot: state.snapshot.clone(),
                }
            }
            Err(_) => UpdateCheckTicket {
                check_id: 0,
                snapshot: UpdateAvailabilitySnapshot::default(),
            },
        }
    }

    pub fn finish_check(
        &self,
        check_id: u64,
        result: Result<Option<String>, ()>,
    ) -> UpdateCheckCompletion {
        self.finish_check_at(check_id, result, current_time_ms())
    }

    fn finish_check_at(
        &self,
        check_id: u64,
        result: Result<Option<String>, ()>,
        checked_at: u64,
    ) -> UpdateCheckCompletion {
        match self.0.lock() {
            Ok(mut state) => {
                let accepted = state.generation == check_id;
                if accepted {
                    state.revision = state.revision.wrapping_add(1);
                    state.snapshot.revision = state.revision;
                    state.snapshot.last_checked_at = Some(checked_at);
                    match result {
                        Ok(version) => {
                            state.snapshot.status = if version.is_some() {
                                UpdateCheckStatus::Available
                            } else {
                                UpdateCheckStatus::Current
                            };
                            state.snapshot.available_version = version;
                        }
                        Err(()) => state.snapshot.status = UpdateCheckStatus::Error,
                    }
                }
                UpdateCheckCompletion {
                    accepted,
                    snapshot: state.snapshot.clone(),
                }
            }
            Err(_) => UpdateCheckCompletion {
                accepted: false,
                snapshot: UpdateAvailabilitySnapshot::default(),
            },
        }
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
        let ticket = state.begin_check();
        if app
            .emit("update_availability_changed", ticket.snapshot.clone())
            .is_err()
        {
            eprintln!("Failed to publish update check status");
        }
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
        let completion = state.finish_check(ticket.check_id, result);
        if completion.accepted
            && app
                .emit("update_availability_changed", completion.snapshot)
                .is_err()
        {
            eprintln!("Failed to publish update availability state");
        }
        tokio::time::sleep(next_update_check_delay(retry_after_failure)).await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        next_update_check_delay, UpdateAvailabilityState, UpdateCheckStatus, UPDATE_CHECK_INTERVAL,
        UPDATE_CHECK_RETRY_INTERVAL,
    };

    #[test]
    fn records_startup_check_status_version_and_timestamp() {
        let state = UpdateAvailabilityState::default();

        let stale_check = state.begin_check();
        let latest_check = state.begin_check();
        assert_eq!(latest_check.snapshot.status, UpdateCheckStatus::Checking);

        let stale_completion =
            state.finish_check_at(stale_check.check_id, Ok(Some("0.1.0".to_owned())), 1234);
        assert!(!stale_completion.accepted);
        assert_eq!(
            stale_completion.snapshot.status,
            UpdateCheckStatus::Checking
        );
        assert_eq!(stale_completion.snapshot.last_checked_at, None);
        assert_eq!(
            stale_completion.snapshot.revision,
            latest_check.snapshot.revision
        );

        let completion =
            state.finish_check_at(latest_check.check_id, Ok(Some("0.2.0".to_owned())), 5678);
        assert!(completion.accepted);
        assert_eq!(
            completion.snapshot.available_version,
            Some("0.2.0".to_owned())
        );
        assert_eq!(completion.snapshot.last_checked_at, Some(5678));
        assert_eq!(completion.snapshot.status, UpdateCheckStatus::Available);
        assert!(completion.snapshot.revision > latest_check.snapshot.revision);
        assert_eq!(state.current_version(), Some("0.2.0".to_owned()));
    }

    #[test]
    fn retries_failed_checks_after_an_hour_but_keeps_successful_checks_daily() {
        assert_eq!(UPDATE_CHECK_INTERVAL, Duration::from_secs(24 * 60 * 60));
        assert_eq!(UPDATE_CHECK_RETRY_INTERVAL, Duration::from_secs(60 * 60));
        assert_eq!(next_update_check_delay(true), UPDATE_CHECK_RETRY_INTERVAL);
        assert_eq!(next_update_check_delay(false), UPDATE_CHECK_INTERVAL);
    }
}
