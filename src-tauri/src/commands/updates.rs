use tauri::State;

use crate::application::updates::UpdateAvailabilityState;

#[tauri::command]
pub fn background_update_version(state: State<'_, UpdateAvailabilityState>) -> Option<String> {
    state.current_version()
}
