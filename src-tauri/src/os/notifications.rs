use serde::Serialize;
use tauri::{plugin::PermissionState, AppHandle, Emitter, Runtime};

use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationPermission {
    Granted,
    Denied,
    NotDetermined,
}

pub fn permission_status<R: Runtime>(app: &AppHandle<R>) -> Result<NotificationPermission, String> {
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

    fn notify_with_url(
        &self,
        title: &str,
        body: &str,
        inbox_item_id: &str,
        url: &str,
    ) -> Result<(), String> {
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

pub fn emit_notification_click(app: &AppHandle, inbox_item_id: &str) -> Result<(), String> {
    app.emit("notification_clicked", inbox_item_id.to_owned())
        .map_err(|_| "failed to emit notification click".to_owned())
}
