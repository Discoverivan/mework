use serde::Serialize;
#[cfg(not(target_os = "macos"))]
use tauri::plugin::PermissionState;
use tauri::{AppHandle, Emitter, Runtime};

#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub fn setup() {
    macos::setup();
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationPermission {
    Granted,
    Denied,
    NotDetermined,
}

pub async fn permission_status<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<NotificationPermission, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::permission_status().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let state = app
            .notification()
            .permission_state()
            .map_err(|_| "failed to read notification permission".to_owned())?;
        Ok(match state {
            PermissionState::Granted => NotificationPermission::Granted,
            PermissionState::Denied => NotificationPermission::Denied,
            PermissionState::Prompt | PermissionState::PromptWithRationale => {
                NotificationPermission::NotDetermined
            }
        })
    }
}

pub async fn request_permission<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<NotificationPermission, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::request_permission().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        permission_status(app).await
    }
}

#[cfg(target_os = "macos")]
pub fn open_notification_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.Notifications-Settings")
        .status()
        .map_err(|_| "failed to open macOS notification settings".to_owned())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("failed to open macOS notification settings".to_owned())
            }
        })
}

#[cfg(not(target_os = "macos"))]
pub fn open_notification_settings() -> Result<(), String> {
    Err("notification settings are only available on macOS".to_owned())
}

pub trait NotificationAdapter: Send + Sync {
    fn notify(&self, title: &str, body: &str, inbox_item_id: &str) -> Result<(), String>;

    fn notify_with_url(
        &self,
        title: &str,
        body: &str,
        inbox_item_id: &str,
        url: &str,
    ) -> Result<(), String> {
        let _ = url;
        self.notify(title, body, inbox_item_id)
    }
}

pub struct NativeNotificationAdapter<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> NativeNotificationAdapter<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> NotificationAdapter for NativeNotificationAdapter<R> {
    fn notify(&self, title: &str, body: &str, inbox_item_id: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let _ = (&self.app, inbox_item_id);
            macos::notify(title, body)
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.app
                .notification()
                .builder()
                .title(title)
                .body(body)
                .sound("default")
                .extra("inbox_item_id", inbox_item_id)
                .show()
                .map_err(|_| "failed to send native notification".to_owned())
        }
    }

    fn notify_with_url(
        &self,
        title: &str,
        body: &str,
        inbox_item_id: &str,
        url: &str,
    ) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let _ = url;
            self.notify(title, body, inbox_item_id)
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.app
                .notification()
                .builder()
                .title(title)
                .body(body)
                .sound("default")
                .extra("inbox_item_id", inbox_item_id)
                .extra("issue_url", url)
                .show()
                .map_err(|_| "failed to send native notification".to_owned())
        }
    }
}

pub fn emit_notification_click(app: &AppHandle, inbox_item_id: &str) -> Result<(), String> {
    app.emit("notification_clicked", inbox_item_id.to_owned())
        .map_err(|_| "failed to emit notification click".to_owned())
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::{
        macos::{classify_permission, request_error_permission},
        NotificationPermission,
    };

    #[test]
    fn macos_permission_reflects_authorization_and_alert_setting() {
        assert_eq!(
            classify_permission(0, false, false),
            NotificationPermission::NotDetermined
        );
        assert_eq!(
            classify_permission(0, true, true),
            NotificationPermission::Granted,
            "enabled macOS alert and Notification Center settings mean permission is active",
        );
        assert_eq!(
            classify_permission(1, false, false),
            NotificationPermission::Denied
        );
        assert_eq!(
            classify_permission(2, false, true),
            NotificationPermission::Denied
        );
        assert_eq!(
            classify_permission(2, true, true),
            NotificationPermission::Granted
        );
        assert_eq!(
            classify_permission(2, true, false),
            NotificationPermission::Denied
        );
        assert_eq!(
            classify_permission(3, true, true),
            NotificationPermission::Denied
        );
    }

    #[test]
    fn macos_not_allowed_request_error_maps_to_denied() {
        assert_eq!(
            request_error_permission(1),
            Some(NotificationPermission::Denied)
        );
        assert_eq!(request_error_permission(999), None);
    }
}
