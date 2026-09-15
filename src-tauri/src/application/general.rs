use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

use crate::infrastructure::db::repositories;
use crate::os::notifications::{self, NotificationAdapter, NotificationPermission};

const GENERAL_SETTINGS_KEY: &str = "general.settings";
const GENERAL_SETTINGS_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub notifications_enabled: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettingsDto {
    pub notifications_enabled: bool,
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
        notification_permission,
        permission_check_error,
    })
}

pub async fn notifications_enabled(pool: &SqlitePool) -> Result<bool, String> {
    Ok(load(pool).await?.notifications_enabled)
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

    let adapter = notifications::NativeNotificationAdapter::new(app.clone());
    adapter.notify(
        "mework notification test",
        "Notifications are enabled and working.",
        "general-test",
    )
}

pub fn open_notification_settings() -> Result<(), String> {
    notifications::open_notification_settings()
}

#[cfg(test)]
mod tests {
    use super::GeneralSettings;

    #[test]
    fn notifications_are_enabled_by_default() {
        assert!(GeneralSettings::default().notifications_enabled);
    }
}
