#[tauri::command]
pub fn set_app_badge_count(app: tauri::AppHandle, count: u64) -> Result<(), String> {
    crate::os::app_badge::set_unread_count(&app, count).map_err(|error| error.to_string())
}
