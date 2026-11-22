use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MicrophonePermission {
    NotDetermined,
    Authorized,
    Denied,
    Restricted,
    Unsupported,
}

pub fn permission_status() -> Result<MicrophonePermission, String> {
    #[cfg(target_os = "macos")]
    {
        macos::permission_status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(MicrophonePermission::Unsupported)
    }
}

pub async fn request_permission() -> Result<MicrophonePermission, String> {
    #[cfg(target_os = "macos")]
    {
        macos::request_permission().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(MicrophonePermission::Unsupported)
    }
}

pub fn open_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::open_settings()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Microphone privacy settings are only available on macOS".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::MicrophonePermission;

    #[test]
    fn permission_status_serializes_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&MicrophonePermission::NotDetermined).unwrap(),
            "\"notDetermined\""
        );
        assert_eq!(
            serde_json::to_string(&MicrophonePermission::Unsupported).unwrap(),
            "\"unsupported\""
        );
    }
}
