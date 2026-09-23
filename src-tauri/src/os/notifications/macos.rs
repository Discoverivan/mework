//! macOS UserNotifications backend. The Tauri 2.4 desktop plugin returns
//! Granted unconditionally and drops delivery errors from its detached task.
use std::{path::Path, ptr::NonNull, sync::Mutex, time::Duration};

use block2::RcBlock;
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{Bool, ProtocolObject},
    ClassType,
};
use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNErrorCode, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationSettings,
    UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

use super::NotificationPermission;

fn ensure_bundled_app_executable(executable: &Path) -> Result<(), String> {
    let is_bundled_app = executable.ancestors().any(|app| {
        app.extension().is_some_and(|extension| extension == "app")
            && app.join("Contents/MacOS").is_dir()
            && app.join("Contents/Info.plist").is_file()
    });

    if is_bundled_app {
        Ok(())
    } else {
        Err("macOS notifications require launching the bundled .app".to_owned())
    }
}

fn ensure_current_process_is_bundled_app() -> Result<(), String> {
    let executable =
        std::env::current_exe().map_err(|_| "failed to locate running application".to_owned())?;
    ensure_bundled_app_executable(&executable)
}

define_class!(
    #[unsafe(super(NSObject))]
    struct ForegroundNotificationDelegate;

    unsafe impl NSObjectProtocol for ForegroundNotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for ForegroundNotificationDelegate {
        #[allow(non_snake_case)]
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn userNotificationCenter_willPresentNotification_withCompletionHandler(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }
    }
);

pub fn setup() {
    if ensure_current_process_is_bundled_app().is_err() {
        return;
    }

    let delegate: Retained<ForegroundNotificationDelegate> =
        unsafe { msg_send![ForegroundNotificationDelegate::class(), new] };
    UNUserNotificationCenter::currentNotificationCenter()
        .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // The notification center holds a weak reference; retain for process lifetime.
    std::mem::forget(delegate);
}

pub(super) fn classify_permission(
    status: isize,
    alerts_enabled: bool,
    notification_center_enabled: bool,
) -> NotificationPermission {
    match status {
        0 if alerts_enabled && notification_center_enabled => NotificationPermission::Granted,
        0 => NotificationPermission::NotDetermined,
        2 if alerts_enabled && notification_center_enabled => NotificationPermission::Granted,
        _ => NotificationPermission::Denied,
    }
}

pub(super) fn request_error_permission(code: isize) -> Option<NotificationPermission> {
    (code == UNErrorCode::NotificationsNotAllowed.0).then_some(NotificationPermission::Denied)
}

pub async fn permission_status() -> Result<NotificationPermission, String> {
    ensure_current_process_is_bundled_app()?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let tx = Mutex::new(Some(tx));
        let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // The framework owns settings for the duration of this callback.
            let settings = unsafe { settings.as_ref() };
            let permission = classify_permission(
                settings.authorizationStatus().0,
                settings.alertSetting() == objc2_user_notifications::UNNotificationSetting::Enabled,
                settings.notificationCenterSetting()
                    == objc2_user_notifications::UNNotificationSetting::Enabled,
            );
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(permission);
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&callback);
    }
    tokio::time::timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| "notification permission check timed out".to_owned())?
        .map_err(|_| "notification permission check failed".to_owned())
}

pub async fn request_permission() -> Result<NotificationPermission, String> {
    ensure_current_process_is_bundled_app()?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let tx = Mutex::new(Some(tx));
        let callback = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            let result = if let Some(error) = NonNull::new(error) {
                Err(unsafe { error.as_ref().code() })
            } else {
                Ok(granted.as_bool())
            };
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &callback,
            );
    }
    let granted = tokio::time::timeout(Duration::from_secs(120), rx)
        .await
        .map_err(|_| "timed out requesting notification permission".to_owned())?
        .map_err(|_| "notification permission request was cancelled".to_owned())?;

    if let Err(code) = granted {
        return request_error_permission(code).ok_or_else(|| {
            format!("macOS notification permission request failed (system error {code})")
        });
    }

    // Check the actual settings, including alerts disabled while authorization remains on.
    permission_status().await
}

pub fn notify(title: &str, body: &str) -> Result<(), String> {
    ensure_current_process_is_bundled_app()?;

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let id = NSString::from_str(&uuid::Uuid::now_v7().to_string());
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let tx = Mutex::new(Some(tx));
    let callback = RcBlock::new(move |error: *mut NSError| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(error.is_null());
        }
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(true) => Ok(()),
        Ok(false) => Err("macOS rejected the notification request".to_owned()),
        Err(_) => Err("macOS notification request timed out".to_owned()),
    }
}

#[cfg(test)]
mod bundle_context_tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::ensure_bundled_app_executable;

    #[test]
    fn bundled_app_executable_is_accepted_for_notifications() {
        let temp = tempdir().unwrap();
        let app = temp.path().join("mework-dev.app");
        let executable = app.join("Contents/MacOS/mework-dev");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(app.join("Contents/Info.plist"), "bundle metadata").unwrap();

        assert!(ensure_bundled_app_executable(&executable).is_ok());
    }

    #[test]
    fn raw_tauri_dev_executable_is_rejected_for_notifications() {
        let executable = Path::new("/work/src-tauri/target/debug/mework-dev");

        assert_eq!(
            ensure_bundled_app_executable(executable),
            Err("macOS notifications require launching the bundled .app".to_owned())
        );
    }
}
