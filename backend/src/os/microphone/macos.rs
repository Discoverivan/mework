use std::{path::Path, sync::OnceLock, time::Duration};

use block2::RcBlock;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use objc2_foundation::{NSBundle, NSString};

use super::MicrophonePermission;

fn map_status(status: AVAuthorizationStatus) -> Result<MicrophonePermission, String> {
    match status {
        AVAuthorizationStatus::NotDetermined => Ok(MicrophonePermission::NotDetermined),
        AVAuthorizationStatus::Authorized => Ok(MicrophonePermission::Authorized),
        AVAuthorizationStatus::Denied => Ok(MicrophonePermission::Denied),
        AVAuthorizationStatus::Restricted => Ok(MicrophonePermission::Restricted),
        _ => Err("macOS returned an unknown microphone permission status".to_owned()),
    }
}

fn raw_permission_status() -> Result<MicrophonePermission, String> {
    let audio_media_type = unsafe { AVMediaTypeAudio }
        .ok_or_else(|| "macOS audio media type is unavailable".to_owned())?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio_media_type) };
    map_status(status)
}

fn ensure_microphone_usage_description() -> Result<(), String> {
    let key = NSString::from_str("NSMicrophoneUsageDescription");
    let value = NSBundle::mainBundle().objectForInfoDictionaryKey(&key);
    if value.is_none() {
        return Err("The application bundle is missing NSMicrophoneUsageDescription".to_owned());
    }
    Ok(())
}

fn is_bundled_app(executable: &Path) -> bool {
    executable.ancestors().any(|app| {
        app.extension().is_some_and(|extension| extension == "app")
            && app.join("Contents/MacOS").is_dir()
            && app.join("Contents/Info.plist").is_file()
    })
}

pub fn permission_status() -> Result<MicrophonePermission, String> {
    raw_permission_status()
}

pub async fn request_permission() -> Result<MicrophonePermission, String> {
    static REQUEST_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let _guard = REQUEST_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;

    match raw_permission_status()? {
        MicrophonePermission::NotDetermined => {}
        status => return Ok(status),
    }

    ensure_microphone_usage_description()?;
    let executable = std::env::current_exe()
        .map_err(|_| "Unable to locate the running application".to_owned())?;
    if !is_bundled_app(&executable) {
        return Err(
            "Microphone permission must be requested from the packaged application".to_owned(),
        );
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let tx = std::sync::Mutex::new(Some(tx));
        let callback = RcBlock::new(move |_granted: objc2::runtime::Bool| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
        });
        let audio_media_type = unsafe { AVMediaTypeAudio }
            .ok_or_else(|| "macOS audio media type is unavailable".to_owned())?;
        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(
                audio_media_type,
                &callback,
            );
        }
    }

    tokio::time::timeout(Duration::from_secs(120), rx)
        .await
        .map_err(|_| "Timed out waiting for macOS microphone permission".to_owned())?
        .map_err(|_| "macOS microphone permission request was cancelled".to_owned())?;

    raw_permission_status()
}

pub fn open_settings() -> Result<(), String> {
    let status = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        .status()
        .map_err(|_| "Unable to open macOS microphone privacy settings".to_owned())?;
    if status.success() {
        Ok(())
    } else {
        Err("Unable to open macOS microphone privacy settings".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{is_bundled_app, map_status};
    use crate::os::microphone::MicrophonePermission;
    use objc2_av_foundation::AVAuthorizationStatus;

    #[test]
    fn maps_known_avfoundation_authorization_states() {
        assert_eq!(
            map_status(AVAuthorizationStatus::NotDetermined).unwrap(),
            MicrophonePermission::NotDetermined
        );
        assert_eq!(
            map_status(AVAuthorizationStatus::Authorized).unwrap(),
            MicrophonePermission::Authorized
        );
        assert_eq!(
            map_status(AVAuthorizationStatus::Denied).unwrap(),
            MicrophonePermission::Denied
        );
        assert_eq!(
            map_status(AVAuthorizationStatus::Restricted).unwrap(),
            MicrophonePermission::Restricted
        );
    }

    #[test]
    fn permission_prompt_requires_a_packaged_app() {
        assert!(!is_bundled_app(Path::new("/work/target/debug/mework")));
    }
}
