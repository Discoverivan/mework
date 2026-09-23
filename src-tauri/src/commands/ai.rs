use sqlx::SqlitePool;
use tauri::State;

use crate::application::ai::{
    self, AiSettings, AiSettingsPageDto, OpenAiCompatibleProviderSaveRequest,
};

#[tauri::command]
pub async fn ai_settings(state: State<'_, SqlitePool>) -> Result<AiSettingsPageDto, String> {
    ai::dto(&state).await
}

#[tauri::command]
pub async fn ai_cli_diagnostics() -> Result<Vec<ai::AiCliCandidateDiagnostic>, String> {
    tokio::task::spawn_blocking(ai::ai_cli_candidate_diagnostics)
        .await
        .map_err(|_| "failed to inspect local CLI paths".to_owned())
}

#[tauri::command]
pub async fn ai_settings_save(
    state: State<'_, SqlitePool>,
    settings: AiSettings,
) -> Result<AiSettingsPageDto, String> {
    ai::save(&state, settings).await?;
    ai::dto(&state).await
}

#[tauri::command]
pub async fn ai_openai_compatible_save(
    state: State<'_, SqlitePool>,
    request: OpenAiCompatibleProviderSaveRequest,
) -> Result<AiSettingsPageDto, String> {
    ai::save_openai_compatible_provider(&state, request).await
}
