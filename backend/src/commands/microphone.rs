use crate::os::microphone::{self, MicrophonePermission};

#[tauri::command]
pub fn microphone_permission_status() -> Result<MicrophonePermission, String> {
    microphone::permission_status()
}

#[tauri::command]
pub async fn microphone_request_permission() -> Result<MicrophonePermission, String> {
    microphone::request_permission().await
}

#[tauri::command]
pub fn microphone_open_settings() -> Result<(), String> {
    microphone::open_settings()
}
