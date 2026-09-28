use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime, State};

use crate::{
    application::token_burner::{
        self, TokenBurnerRepository, TokenBurnerRuntime, TokenBurnerSettings, TokenBurnerSnapshot,
    },
    domain::models::IntegrationKind,
};

#[tauri::command]
pub async fn token_burner_settings(
    state: State<'_, SqlitePool>,
) -> Result<TokenBurnerSettings, String> {
    token_burner::load_settings(&state).await
}

#[tauri::command]
pub async fn token_burner_settings_save(
    state: State<'_, SqlitePool>,
    settings: TokenBurnerSettings,
) -> Result<TokenBurnerSettings, String> {
    token_burner::save_settings(&state, settings).await
}

#[tauri::command]
pub async fn token_burner_snapshot(
    state: State<'_, SqlitePool>,
) -> Result<TokenBurnerSnapshot, String> {
    token_burner::snapshot(&state).await
}

#[tauri::command]
pub async fn token_burner_repositories(
    state: State<'_, SqlitePool>,
) -> Result<Vec<TokenBurnerRepository>, String> {
    token_burner::repositories(&state).await
}

#[tauri::command]
pub async fn token_burner_ai_provider_summary(
    state: State<'_, SqlitePool>,
) -> Result<(String, String), String> {
    token_burner::ai_provider_summary(&state).await
}

#[tauri::command]
pub async fn token_burner_start<R: Runtime>(
    state: State<'_, SqlitePool>,
    runtime: State<'_, Arc<TokenBurnerRuntime>>,
    app: AppHandle<R>,
) -> Result<TokenBurnerSnapshot, String> {
    token_burner::start(state.inner().clone(), app, runtime.inner().clone()).await
}

#[tauri::command]
pub async fn token_burner_pause<R: Runtime>(
    state: State<'_, SqlitePool>,
    app: AppHandle<R>,
) -> Result<TokenBurnerSnapshot, String> {
    token_burner::pause(&state, &app).await
}

#[tauri::command]
pub async fn token_burner_resume<R: Runtime>(
    state: State<'_, SqlitePool>,
    runtime: State<'_, Arc<TokenBurnerRuntime>>,
    app: AppHandle<R>,
) -> Result<TokenBurnerSnapshot, String> {
    token_burner::resume(state.inner().clone(), app, runtime.inner().clone()).await
}

#[tauri::command]
pub async fn token_burner_stop<R: Runtime>(
    state: State<'_, SqlitePool>,
    app: AppHandle<R>,
) -> Result<TokenBurnerSnapshot, String> {
    token_burner::stop(&state, &app).await
}

#[tauri::command]
pub async fn token_burner_reset_daily_target<R: Runtime>(
    state: State<'_, SqlitePool>,
    runtime: State<'_, Arc<TokenBurnerRuntime>>,
    app: AppHandle<R>,
) -> Result<TokenBurnerSnapshot, String> {
    token_burner::reset_daily_target(&state, &app, runtime.inner().clone()).await
}

#[tauri::command]
pub async fn token_burner_integration_available(
    state: State<'_, SqlitePool>,
) -> Result<bool, String> {
    let integrations = crate::infrastructure::db::repositories::list_integrations(&state)
        .await
        .map_err(|_| "failed to read integrations".to_owned())?;
    Ok(integrations.iter().any(|integration| {
        integration.kind == IntegrationKind::Bitbucket
            && integration.enabled
            && integration.health_status == crate::domain::models::IntegrationHealthStatus::Working
    }))
}
