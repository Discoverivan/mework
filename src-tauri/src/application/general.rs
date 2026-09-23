use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

use crate::infrastructure::db::repositories;
use crate::os::notifications::{
    self, NativeNotificationAdapter, NotificationAdapter, NotificationPermission,
};

const GENERAL_SETTINGS_KEY: &str = "general.settings";
const GENERAL_SETTINGS_SCHEMA_VERSION: i64 = 3;
static GENERAL_SETTINGS_WRITE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn general_settings_write_lock() -> &'static tokio::sync::Mutex<()> {
    GENERAL_SETTINGS_WRITE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationTestKind {
    Review,
    Authored,
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
    value.map_or_else(
        || Ok(GeneralSettings::default()),
        |raw| {
            serde_json::from_str::<GeneralSettings>(&raw)
                .map_err(|_| "failed to deserialize general settings".to_owned())
        },
    )
}

async fn save(pool: &SqlitePool, settings: &GeneralSettings) -> Result<(), String> {
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

async fn update(pool: &SqlitePool, apply: impl FnOnce(&mut GeneralSettings)) -> Result<(), String> {
    {
        let _guard = general_settings_write_lock().lock().await;
        let mut settings = load(pool).await?;
        apply(&mut settings);
        save(pool, &settings).await?;
    }
    Ok(())
}

pub async fn save_notification_preferences(
    pool: &SqlitePool,
    notifications_enabled: bool,
    review_notifications_enabled: bool,
    authored_notifications_enabled: bool,
) -> Result<(), String> {
    update(pool, |settings| {
        settings.notifications_enabled = notifications_enabled;
        settings.review_notifications_enabled = review_notifications_enabled;
        settings.authored_notifications_enabled = authored_notifications_enabled;
    })
    .await
}

pub async fn save_appearance_preferences(
    pool: &SqlitePool,
    language: AppLanguage,
    theme_preference: ThemePreference,
) -> Result<(), String> {
    update(pool, |settings| {
        settings.language = language;
        settings.theme_preference = theme_preference;
    })
    .await
}

pub async fn dto<R: Runtime>(
    pool: &SqlitePool,
    app: &AppHandle<R>,
) -> Result<GeneralSettingsDto, String> {
    let settings = load(pool).await?;
    let (notification_permission, permission_check_error) =
        match notifications::permission_status(app).await {
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

pub async fn notifications_enabled(pool: &SqlitePool) -> Result<bool, String> {
    Ok(load(pool).await?.notifications_enabled)
}

pub async fn send_test_notification<R: Runtime>(
    app: &AppHandle<R>,
    notification_kind: NotificationTestKind,
) -> Result<(), String> {
    let permission = notifications::permission_status(app).await?;
    let permission = if permission == NotificationPermission::NotDetermined {
        notifications::request_permission(app).await?
    } else {
        permission
    };
    match permission {
        NotificationPermission::Granted => {}
        NotificationPermission::Denied | NotificationPermission::NotDetermined => {
            return Err(
                "notifications are not permitted; open macOS notification settings".to_owned(),
            )
        }
    }

    let (title, body, identifier) = match notification_kind {
        NotificationTestKind::Review => (
            "New pull request for review",
            "EXAMPLE/sample-repository #42 — Example review request",
            "general-review-test",
        ),
        NotificationTestKind::Authored => (
            "Changes requested on your pull request",
            "EXAMPLE/sample-repository #42 — Example authored pull request",
            "general-authored-test",
        ),
    };

    let adapter = NativeNotificationAdapter::new(app.clone());
    tokio::task::spawn_blocking(move || adapter.notify(title, body, identifier))
        .await
        .map_err(|_| "failed to dispatch native notification".to_owned())?
}

pub fn open_notification_settings() -> Result<(), String> {
    notifications::open_notification_settings()
}

#[cfg(test)]
mod tests {
    use super::{
        load, save_appearance_preferences, save_notification_preferences, AppLanguage,
        GeneralSettings, ThemePreference,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn general_preferences_have_expected_defaults() {
        let settings = GeneralSettings::default();
        assert!(settings.notifications_enabled);
        assert!(settings.review_notifications_enabled);
        assert!(settings.authored_notifications_enabled);
        assert_eq!(settings.language, AppLanguage::English);
        assert_eq!(settings.theme_preference, ThemePreference::System);
    }

    #[tokio::test]
    async fn notification_patch_preserves_appearance_preferences() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                schema_version INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        save_appearance_preferences(&pool, AppLanguage::Russian, ThemePreference::Dark)
            .await
            .unwrap();
        save_notification_preferences(&pool, false, false, true)
            .await
            .unwrap();

        let settings = load(&pool).await.unwrap();
        assert_eq!(settings.language, AppLanguage::Russian);
        assert_eq!(settings.theme_preference, ThemePreference::Dark);
        assert!(!settings.notifications_enabled);
        assert!(!settings.review_notifications_enabled);
        assert!(settings.authored_notifications_enabled);
    }
}
