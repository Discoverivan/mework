use sqlx::SqlitePool;
use tauri::State;

use crate::application::integrations::health::ReqwestHealthChecker;
use crate::application::integrations::settings::{
    self, IntegrationDto, IntegrationSaveRequest, IntegrationSaveResult,
};
use crate::infrastructure::credentials::keyring::CredentialStore;
#[cfg(debug_assertions)]
use crate::infrastructure::credentials::keyring::DevCredentialStore;
#[cfg(not(debug_assertions))]
use crate::infrastructure::credentials::keyring::OsKeyring;
#[cfg(debug_assertions)]
use crate::infrastructure::db::repositories;

#[cfg(not(debug_assertions))]
const KEYRING_SERVICE: &str = "com.discoverivan.app.mework";

async fn credential_store(state: &SqlitePool) -> Result<Box<dyn CredentialStore>, String> {
    #[cfg(debug_assertions)]
    {
        let integrations = repositories::list_integrations(state)
            .await
            .map_err(|_| "failed to load integrations for development credentials".to_owned())?;
        let entries = integrations
            .into_iter()
            .map(|integration| (integration.credential_ref, integration.kind));
        Ok(Box::new(DevCredentialStore::from_integrations(entries)))
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = state;
        Ok(Box::new(OsKeyring::new(KEYRING_SERVICE)))
    }
}

pub(crate) async fn refresh_all_integration_health_background(
    state: &SqlitePool,
) -> Result<Vec<IntegrationDto>, String> {
    let store = credential_store(state).await?;
    let checker = ReqwestHealthChecker::new();
    settings::refresh_all_integration_health(state, store.as_ref(), &checker)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn integration_list(state: State<'_, SqlitePool>) -> Result<Vec<IntegrationDto>, String> {
    settings::list_integrations(&state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn integration_save(
    state: State<'_, SqlitePool>,
    request: IntegrationSaveRequest,
) -> Result<IntegrationSaveResult, String> {
    let store = credential_store(&state).await?;
    let checker = ReqwestHealthChecker::new();
    settings::save_integration_checked(&state, store.as_ref(), &checker, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn integration_health_check(
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<IntegrationDto, String> {
    let store = credential_store(&state).await?;
    let checker = ReqwestHealthChecker::new();
    settings::refresh_integration_health(&state, store.as_ref(), &checker, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn integration_health_check_all(
    state: State<'_, SqlitePool>,
) -> Result<Vec<IntegrationDto>, String> {
    let store = credential_store(&state).await?;
    let checker = ReqwestHealthChecker::new();
    settings::refresh_all_integration_health(&state, store.as_ref(), &checker)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn integration_delete(state: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let store = credential_store(&state).await?;
    settings::delete_integration(&state, store.as_ref(), &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn integration_set_enabled(
    state: State<'_, SqlitePool>,
    id: String,
    enabled: bool,
) -> Result<IntegrationDto, String> {
    settings::set_integration_enabled(&state, &id, enabled)
        .await
        .map_err(|error| error.to_string())
}
