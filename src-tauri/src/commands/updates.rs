use tauri::{AppHandle, Emitter, State};

use crate::application::release_notes::{
    self, ReleaseNote, ReleaseNotesRequestState, ReleaseNotesState,
};
use crate::application::updates::{
    UpdateAvailabilitySnapshot, UpdateAvailabilityState, UpdateCheckCompletion, UpdateCheckSource,
    UpdateCheckTicket,
};

#[tauri::command]
pub fn background_update_state(
    state: State<'_, UpdateAvailabilityState>,
) -> UpdateAvailabilitySnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn background_update_version(state: State<'_, UpdateAvailabilityState>) -> Option<String> {
    state.current_version()
}

#[tauri::command]
pub fn begin_update_check(
    app: AppHandle,
    state: State<'_, UpdateAvailabilityState>,
) -> UpdateCheckTicket {
    let ticket = state.begin_check(UpdateCheckSource::Manual);
    if app
        .emit("update_availability_changed", ticket.snapshot.clone())
        .is_err()
    {
        eprintln!("Failed to publish manual update check status");
    }
    ticket
}

#[tauri::command]
pub fn record_update_check_result(
    app: AppHandle,
    state: State<'_, UpdateAvailabilityState>,
    check_id: u64,
    available_version: Option<String>,
    succeeded: bool,
) -> UpdateCheckCompletion {
    let result = if succeeded {
        Ok(available_version)
    } else {
        Err(())
    };
    let completion = state.finish_check(check_id, result);
    if completion.accepted
        && app
            .emit("update_availability_changed", completion.snapshot.clone())
            .is_err()
    {
        eprintln!("Failed to publish manual update result");
    }
    completion
}

#[tauri::command]
pub async fn release_notes_state(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
) -> Result<ReleaseNotesState, String> {
    release_notes::state(&app, &request_state).await
}

#[tauri::command]
pub async fn mark_release_notes_seen(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
) -> Result<(), String> {
    release_notes::mark_seen(&app, &request_state).await
}

#[tauri::command]
pub async fn list_update_release_notes_versions(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
) -> Result<Vec<String>, String> {
    release_notes::list_update_versions(&app, &request_state).await
}

#[tauri::command]
pub async fn list_release_notes_versions(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
) -> Result<Vec<String>, String> {
    release_notes::list_versions(&app, &request_state).await
}

#[tauri::command]
pub async fn load_available_update_release_notes(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
    target_version: String,
    language: String,
) -> Result<Vec<ReleaseNote>, String> {
    release_notes::load_available_update_notes(&app, &request_state, &target_version, &language)
        .await
}

#[tauri::command]
pub async fn load_release_note_version(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
    version: String,
    language: String,
) -> Result<ReleaseNote, String> {
    release_notes::load_version(&app, &request_state, &version, &language).await
}
