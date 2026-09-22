use std::collections::HashSet;

use sqlx::SqlitePool;
use tauri::State;

use crate::application::ai;
use crate::application::integrations::health::ReqwestHealthChecker;
use crate::application::integrations::settings::{
    self, IntegrationDto, IntegrationSaveRequest, IntegrationSaveResult,
};
use crate::infrastructure::credentials::keyring::{
    CredentialStore, OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
};
use crate::infrastructure::db::repositories;

const KEYRING_SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};

pub(crate) async fn credential_store(
    _state: &SqlitePool,
) -> Result<Box<dyn CredentialStore>, String> {
    Ok(Box::new(OsKeyring::new(KEYRING_SERVICE)))
}

pub(crate) async fn preload_all_credentials(state: &SqlitePool) -> Result<(), String> {
    let integrations = repositories::list_integrations(state)
        .await
        .map_err(|_| "failed to load integration credential references".to_owned())?;
    let integration_refs = integrations
        .into_iter()
        .map(|integration| integration.credential_ref)
        .collect::<Vec<_>>();
    let ai_ref = ai::configured_openai_credential_ref(state)
        .await
        .ok()
        .flatten();
    let credential_refs = credential_refs_for_preload(integration_refs, ai_ref);
    OsKeyring::new(KEYRING_SERVICE)
        .preload(&credential_refs)
        .map_err(|_| "operating system keyring preload failed".to_owned())
}

fn credential_refs_for_preload(
    integration_refs: impl IntoIterator<Item = String>,
    ai_ref: Option<String>,
) -> Vec<String> {
    let mut refs = integration_refs
        .into_iter()
        .filter(|credential_ref| !credential_ref.trim().is_empty())
        .collect::<HashSet<_>>();
    if let Some(ai_ref) = ai_ref.filter(|credential_ref| !credential_ref.trim().is_empty()) {
        refs.insert(ai_ref);
    }
    refs.into_iter().collect()
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

#[cfg(test)]
mod tests {
    use super::credential_refs_for_preload;
    use std::collections::HashSet;

    #[test]
    fn startup_preload_aggregates_unique_non_empty_integration_and_ai_refs() {
        let refs = credential_refs_for_preload(
            vec![
                "jira-ref".to_owned(),
                "bitbucket-ref".to_owned(),
                "jira-ref".to_owned(),
                "  ".to_owned(),
            ],
            Some("ai-ref".to_owned()),
        );
        assert_eq!(
            refs.into_iter().collect::<HashSet<_>>(),
            HashSet::from([
                "jira-ref".to_owned(),
                "bitbucket-ref".to_owned(),
                "ai-ref".to_owned(),
            ])
        );
    }
}
