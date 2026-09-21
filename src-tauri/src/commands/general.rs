use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::general::{
    self, AppLanguage, GeneralSettings, GeneralSettingsDto, ThemePreference,
};

#[tauri::command]
pub async fn general_settings(state: State<'_, SqlitePool>) -> Result<GeneralSettingsDto, String> {
    general::dto(&state).await
}

#[tauri::command]
pub async fn general_settings_save(
    state: State<'_, SqlitePool>,
    notifications_enabled: bool,
    review_notifications_enabled: bool,
    authored_notifications_enabled: bool,
    language: AppLanguage,
    theme_preference: ThemePreference,
) -> Result<GeneralSettingsDto, String> {
    general::save(
        &state,
        GeneralSettings {
            notifications_enabled,
            review_notifications_enabled,
            authored_notifications_enabled,
            language,
            theme_preference,
        },
    )
    .await?;
    general::dto(&state).await
}

#[tauri::command]
pub async fn general_appearance_save(
    state: State<'_, SqlitePool>,
    language: AppLanguage,
    theme_preference: ThemePreference,
) -> Result<GeneralSettingsDto, String> {
    let mut settings = general::load(&state).await?;
    settings.language = language;
    settings.theme_preference = theme_preference;
    general::save(&state, settings).await?;
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
