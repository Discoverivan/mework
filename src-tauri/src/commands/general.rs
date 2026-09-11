use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::general::{self, GeneralSettings, GeneralSettingsDto};

#[tauri::command]
pub async fn general_settings(state: State<'_, SqlitePool>) -> Result<GeneralSettingsDto, String> {
    general::dto(&state).await
}

#[tauri::command]
pub async fn general_settings_save(
    state: State<'_, SqlitePool>,
    notifications_enabled: bool,
) -> Result<GeneralSettingsDto, String> {
    general::save(
        &state,
        GeneralSettings {
            notifications_enabled,
        },
    )
    .await?;
    general::dto(&state).await
}

#[tauri::command]
pub fn notification_test(app: AppHandle) -> Result<(), String> {
    general::send_test_notification(&app)
}

#[tauri::command]
pub fn notification_open_settings() -> Result<(), String> {
    general::open_notification_settings()
}
