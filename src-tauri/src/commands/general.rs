use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::general::{
    self, AppLanguage, GeneralSettingsDto, NotificationTestKind, ThemePreference,
};
use crate::os::notifications::{self, NotificationPermission};

#[tauri::command]
pub async fn general_settings(
    app: AppHandle,
    state: State<'_, SqlitePool>,
) -> Result<GeneralSettingsDto, String> {
    general::dto(&state, &app).await
}

#[tauri::command]
pub async fn general_settings_save(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    notifications_enabled: bool,
    review_notifications_enabled: bool,
    authored_notifications_enabled: bool,
) -> Result<GeneralSettingsDto, String> {
    general::save_notification_preferences(
        &state,
        notifications_enabled,
        review_notifications_enabled,
        authored_notifications_enabled,
    )
    .await?;
    general::dto(&state, &app).await
}

#[tauri::command]
pub async fn general_appearance_save(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    language: AppLanguage,
    theme_preference: ThemePreference,
) -> Result<GeneralSettingsDto, String> {
    general::save_appearance_preferences(&state, language, theme_preference).await?;
    general::dto(&state, &app).await
}

#[tauri::command]
pub async fn notification_test(
    app: AppHandle,
    notification_kind: NotificationTestKind,
) -> Result<(), String> {
    general::send_test_notification(&app, notification_kind).await
}

#[tauri::command]
pub async fn notification_request_permission(
    app: AppHandle,
) -> Result<NotificationPermission, String> {
    notifications::request_permission(&app).await
}

#[tauri::command]
pub fn notification_open_settings() -> Result<(), String> {
    general::open_notification_settings()
}
