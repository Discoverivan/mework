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
pub async fn agent_cli_diagnostics() -> Result<Vec<ai::AiCliCandidateDiagnostic>, String> {
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

#[tauri::command]
pub async fn ai_provider_add(
    state: State<'_, SqlitePool>,
    provider: ai::AiProviderId,
) -> Result<AiSettingsPageDto, String> {
    ai::add_cli_provider(&state, provider).await
}

#[tauri::command]
pub async fn ai_cli_candidate_inspect(
    provider: ai::AiProviderId,
) -> Result<ai::AiProviderDto, String> {
    ai::inspect_cli_candidate(provider).await
}

#[tauri::command]
pub async fn ai_provider_delete(
    state: State<'_, SqlitePool>,
    provider: ai::AiProviderId,
    instance_id: Option<String>,
) -> Result<AiSettingsPageDto, String> {
    ai::delete_provider(&state, provider, instance_id).await
}
