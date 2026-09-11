use sqlx::SqlitePool;
use tauri::State;

use crate::application::ai::{self, AiSettings, AiSettingsPageDto};

#[tauri::command]
pub async fn ai_settings(state: State<'_, SqlitePool>) -> Result<AiSettingsPageDto, String> {
    ai::dto(&state).await
}

#[tauri::command]
pub async fn ai_settings_save(
    state: State<'_, SqlitePool>,
    settings: AiSettings,
) -> Result<AiSettingsPageDto, String> {
    ai::save(&state, settings).await?;
    ai::dto(&state).await
}
