use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationPermission {
    Granted,
    Denied,
    NotDetermined,
}

#[cfg(target_os = "macos")]
pub fn permission_status() -> Result<NotificationPermission, String> {
    use std::ptr::NonNull;
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2_user_notifications::{UNAuthorizationStatus, UNUserNotificationCenter};

    if cfg!(debug_assertions) {
        // Tauri's dev notification backend intentionally uses Terminal as the
        // macOS notification application because the debug binary is not an app bundle.
        return Ok(NotificationPermission::Granted);
    }

    let is_bundled_app = std::env::current_exe()
        .ok()
        .map(|path| {
            path.ancestors().any(|parent| {
                parent
                    .extension()
                    .is_some_and(|extension| extension == "app")
            })
        })
        .unwrap_or(false);
    if !is_bundled_app {
        return Ok(NotificationPermission::NotDetermined);
    }

    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (sender, receiver) = mpsc::sync_channel(1);
    let callback = RcBlock::new(
        move |settings: NonNull<objc2_user_notifications::UNNotificationSettings>| {
            let status = unsafe { settings.as_ref().authorizationStatus() };
            let permission = match status {
                UNAuthorizationStatus::Authorized
                | UNAuthorizationStatus::Provisional
                | UNAuthorizationStatus::Ephemeral => NotificationPermission::Granted,
                UNAuthorizationStatus::Denied => NotificationPermission::Denied,
                _ => NotificationPermission::NotDetermined,
            };
            let _ = sender.send(permission);
        },
    );
    center.getNotificationSettingsWithCompletionHandler(&callback);
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "notification permission check timed out".to_owned())
}

#[cfg(not(target_os = "macos"))]
pub fn permission_status() -> Result<NotificationPermission, String> {
    Ok(NotificationPermission::Granted)
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
}

pub fn emit_notification_click(app: &AppHandle, inbox_item_id: &str) -> Result<(), String> {
    app.emit("notification_clicked", inbox_item_id.to_owned())
        .map_err(|_| "failed to emit notification click".to_owned())
}
