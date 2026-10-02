use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::application::{
    dev_overlay::DevMockMode,
    general::{
        self, AiResponseLanguage, AppLanguage, ButtonStyle, GeneralSettingsDto,
        NotificationTestKind, ThemePreference,
    },
};
use crate::os::notifications::{self, NotificationPermission};

#[tauri::command]
pub async fn general_settings(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    mock_mode: State<'_, DevMockMode>,
    system_language: AppLanguage,
) -> Result<GeneralSettingsDto, String> {
    general::initialize_if_missing_with_extra_functions(
        &state,
        system_language,
        mock_mode.is_enabled(),
    )
    .await?;
    general::dto(&state, &app).await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn general_settings_save(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    notifications_enabled: bool,
    review_notifications_enabled: bool,
    authored_notifications_enabled: bool,
    task_tracker_notifications_enabled: bool,
    ai_response_language: AiResponseLanguage,
    extra_functions_enabled: bool,
) -> Result<GeneralSettingsDto, String> {
    general::save_general_preferences(
        &state,
        notifications_enabled,
        review_notifications_enabled,
        authored_notifications_enabled,
        task_tracker_notifications_enabled,
        ai_response_language,
        extra_functions_enabled,
    )
    .await?;
    general::dto(&state, &app).await
}

#[tauri::command]
pub async fn ai_review_attempts_save(
    state: State<'_, SqlitePool>,
    attempts: u8,
) -> Result<u8, String> {
    general::save_ai_review_attempts(&state, attempts).await?;
    Ok(attempts)
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
pub async fn general_button_style_save(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    button_style: ButtonStyle,
) -> Result<GeneralSettingsDto, String> {
    general::save_button_style(&state, button_style).await?;
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

#[tauri::command]
pub fn application_open_logs_directory(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Application data directory is unavailable".to_owned())?;
    let logs_dir = crate::application::logging::ensure_logs_dir(&app_data_dir)
        .map_err(|_| "Application log directory is unavailable".to_owned())?;
    app.opener()
        .open_path(logs_dir.to_string_lossy().into_owned(), None::<String>)
        .map_err(|_| "Application log directory could not be opened".to_owned())
}
