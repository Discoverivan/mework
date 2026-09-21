use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

use crate::infrastructure::db::repositories;
#[cfg(not(target_os = "macos"))]
use crate::os::notifications::NotificationAdapter;
use crate::os::notifications::{self, NotificationPermission};

const GENERAL_SETTINGS_KEY: &str = "general.settings";
const GENERAL_SETTINGS_SCHEMA_VERSION: i64 = 3;

const fn enabled_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppLanguage {
    #[default]
    English,
    Russian,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub notifications_enabled: bool,
    #[serde(default = "enabled_by_default")]
    pub review_notifications_enabled: bool,
    #[serde(default = "enabled_by_default")]
    pub authored_notifications_enabled: bool,
    #[serde(default)]
    pub language: AppLanguage,
    #[serde(default)]
    pub theme_preference: ThemePreference,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            review_notifications_enabled: true,
            authored_notifications_enabled: true,
            language: AppLanguage::English,
            theme_preference: ThemePreference::System,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettingsDto {
    pub notifications_enabled: bool,
    pub review_notifications_enabled: bool,
    pub authored_notifications_enabled: bool,
    pub language: AppLanguage,
    pub theme_preference: ThemePreference,
    pub notification_permission: NotificationPermission,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_check_error: Option<String>,
}

pub async fn load(pool: &SqlitePool) -> Result<GeneralSettings, String> {
    let value = repositories::get_setting(pool, GENERAL_SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load general settings".to_owned())?;
    Ok(value
        .and_then(|raw| serde_json::from_str::<GeneralSettings>(&raw).ok())
        .unwrap_or_default())
}

pub async fn save(pool: &SqlitePool, settings: GeneralSettings) -> Result<(), String> {
    let value = serde_json::to_string(&settings)
        .map_err(|_| "failed to serialize general settings".to_owned())?;
    repositories::upsert_setting(
        pool,
        GENERAL_SETTINGS_KEY,
        &value,
        GENERAL_SETTINGS_SCHEMA_VERSION,
    )
    .await
    .map_err(|_| "failed to save general settings".to_owned())
}

pub async fn dto(pool: &SqlitePool) -> Result<GeneralSettingsDto, String> {
    let settings = load(pool).await?;
    let (notification_permission, permission_check_error) = match notifications::permission_status()
    {
        Ok(permission) => (permission, None),
        Err(error) => (NotificationPermission::NotDetermined, Some(error)),
    };
    Ok(GeneralSettingsDto {
        notifications_enabled: settings.notifications_enabled,
        review_notifications_enabled: settings.review_notifications_enabled,
        authored_notifications_enabled: settings.authored_notifications_enabled,
        language: settings.language,
        theme_preference: settings.theme_preference,
        notification_permission,
        permission_check_error,
    })
}

pub async fn review_notifications_enabled(pool: &SqlitePool) -> Result<bool, String> {
    let settings = load(pool).await?;
    Ok(settings.notifications_enabled && settings.review_notifications_enabled)
}

pub async fn authored_notifications_enabled(pool: &SqlitePool) -> Result<bool, String> {
    let settings = load(pool).await?;
    Ok(settings.notifications_enabled && settings.authored_notifications_enabled)
}

pub fn send_test_notification<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    match notifications::permission_status()? {
        NotificationPermission::Granted => {}
        NotificationPermission::Denied | NotificationPermission::NotDetermined => {
            return Err(
                "notifications are not permitted; open macOS notification settings".to_owned(),
            )
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = app;
        notifications::send_test_notification()
    }

    #[cfg(not(target_os = "macos"))]
    {
        let adapter = notifications::NativeNotificationAdapter::new(app.clone());
        adapter.notify(
            "mework notification test",
            "Notifications are enabled and working.",
            "general-test",
        )
    }
}

pub fn open_notification_settings() -> Result<(), String> {
    notifications::open_notification_settings()
}

#[cfg(test)]
mod tests {
    use super::{AppLanguage, GeneralSettings, ThemePreference};

    #[test]
    fn general_preferences_have_expected_defaults() {
        let settings = GeneralSettings::default();
        assert!(settings.notifications_enabled);
        assert!(settings.review_notifications_enabled);
        assert!(settings.authored_notifications_enabled);
        assert_eq!(settings.language, AppLanguage::English);
        assert_eq!(settings.theme_preference, ThemePreference::System);
    }
}
