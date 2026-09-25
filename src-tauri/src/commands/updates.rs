use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::updates::{self, ReleaseNotesState, UpdateAvailabilityState};

#[tauri::command]
pub fn background_update_version(state: State<'_, UpdateAvailabilityState>) -> Option<String> {
    state.current_version()
}

#[tauri::command]
pub async fn release_notes_state(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<ReleaseNotesState, String> {
    updates::release_notes_state(&app, &pool).await
}

#[tauri::command]
pub async fn mark_release_notes_seen(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    updates::mark_release_notes_seen(&app, &pool).await
}
