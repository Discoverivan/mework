use tauri::{AppHandle, State};

use crate::application::release_notes::{
    self, ReleaseNote, ReleaseNotesRequestState, ReleaseNotesState,
};
use crate::application::updates::UpdateAvailabilityState;

#[tauri::command]
pub fn background_update_version(state: State<'_, UpdateAvailabilityState>) -> Option<String> {
    state.current_version()
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
pub async fn load_release_note_version(
    app: AppHandle,
    request_state: State<'_, ReleaseNotesRequestState>,
    version: String,
    language: String,
) -> Result<ReleaseNote, String> {
    release_notes::load_version(&app, &request_state, &version, &language).await
}
