use std::collections::HashSet;

use sqlx::SqlitePool;
use tauri::State;

use crate::application::ai;
use crate::application::dev_overlay::{
    mock_integration_urls_from_env, DevMockMode, MockIntegrationState, MockIntegrationUrls,
};
use crate::application::integrations::health::ReqwestHealthChecker;
use crate::application::integrations::settings::{
    self, IntegrationDto, IntegrationSaveRequest, IntegrationSaveResult,
};
use crate::infrastructure::credentials::keyring::{
    integration_credential_store, CredentialStore, OsKeyring, DEV_KEYRING_SERVICE,
    PRODUCTION_KEYRING_SERVICE,
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
    Ok(integration_credential_store(KEYRING_SERVICE))
}

pub(crate) async fn preload_all_credentials(state: &SqlitePool) -> Result<(), String> {
    let integrations = repositories::list_integrations(state)
        .await
        .map_err(|_| "failed to load integration credential references".to_owned())?;
    let integration_refs = integrations
        .into_iter()
        .map(|integration| integration.credential_ref)
        .collect::<Vec<_>>();
    let ai_refs = ai::configured_openai_credential_refs(state)
        .await
        .unwrap_or_default();
    let credential_refs = credential_refs_for_preload(integration_refs, ai_refs);
    OsKeyring::new(KEYRING_SERVICE)
        .preload(&credential_refs)
        .map_err(|_| "operating system keyring preload failed".to_owned())
}

fn credential_refs_for_preload(
    integration_refs: impl IntoIterator<Item = String>,
    ai_refs: impl IntoIterator<Item = String>,
) -> Vec<String> {
    let mut refs = integration_refs
        .into_iter()
        .filter(|credential_ref| !credential_ref.trim().is_empty())
        .collect::<HashSet<_>>();
    for ai_ref in ai_refs
        .into_iter()
        .filter(|credential_ref| !credential_ref.trim().is_empty())
    {
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
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: IntegrationSaveRequest,
) -> Result<IntegrationSaveResult, String> {
    if mode.is_enabled() {
        return save_mock_integration(&state, request, &mock_integration_urls_from_env()?).await;
    }
    let store = credential_store(&state).await?;
    let checker = ReqwestHealthChecker::new();
    settings::save_integration_checked(&state, store.as_ref(), &checker, request)
        .await
        .map_err(|error| error.to_string())
}

async fn save_mock_integration(
    state: &SqlitePool,
    request: IntegrationSaveRequest,
    urls: &MockIntegrationUrls,
) -> Result<IntegrationSaveResult, String> {
    let fixture = MockIntegrationState::new(true)
        .mock_integrations()?
        .into_iter()
        .find(|candidate| candidate.kind == request.kind)
        .ok_or_else(|| "Mock integration fixture is missing".to_owned())?;
    let expected_url = match request.kind {
        crate::domain::models::IntegrationKind::Jira => &urls.jira,
        crate::domain::models::IntegrationKind::Bitbucket => &urls.bitbucket,
        crate::domain::models::IntegrationKind::Confluence => &urls.confluence,
    };
    if request.base_url.trim_end_matches('/') != expected_url.trim_end_matches('/')
        || request.id.as_deref().is_some_and(|id| id != fixture.id)
    {
        return Err("Mock integrations must use their local mock service URL".to_owned());
    }
    let existing = repositories::list_integrations(&state)
        .await
        .map_err(|_| "failed to load mock integrations".to_owned())?;
    if existing
        .iter()
        .any(|item| item.kind == request.kind && item.id != fixture.id)
    {
        return Err("A mock integration of this type already exists".to_owned());
    }
    let integration = crate::domain::models::Integration {
        id: fixture.id.clone(),
        kind: fixture.kind,
        base_url: expected_url.clone(),
        account_key: fixture.account_key,
        credential_ref: fixture.credential_ref,
        enabled: true,
        allow_insecure_tls: request.allow_insecure_tls,
        account_display_name: fixture.account_display_name,
        health_status: fixture.health_status,
        health_error: fixture.health_error,
        health_details: fixture.health_details,
        health_checked_at: fixture.health_checked_at,
        capabilities_json: fixture.capabilities.to_string(),
        last_success_at: fixture.last_success_at,
        created_at: fixture.created_at,
        updated_at: fixture.updated_at,
    };
    if existing.iter().any(|item| item.id == integration.id) {
        repositories::update_integration(&state, &integration)
            .await
            .map_err(|_| "failed to update mock integration".to_owned())?;
    } else {
        repositories::insert_integration(&state, &integration)
            .await
            .map_err(|_| "failed to add mock integration".to_owned())?;
    }
    let saved = settings::list_integrations(&state)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|item| item.id == fixture.id)
        .ok_or_else(|| "Mock integration was not saved".to_owned())?;
    Ok(IntegrationSaveResult::Saved {
        integration: Box::new(saved),
    })
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
pub async fn integration_delete(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    if mode.is_enabled() {
        return delete_mock_integration(&state, &id).await;
    }
    let store = credential_store(&state).await?;
    settings::delete_integration(&state, store.as_ref(), &id)
        .await
        .map_err(|error| error.to_string())
}

async fn delete_mock_integration(state: &SqlitePool, id: &str) -> Result<(), String> {
    let fixture_ids = ["mock-jira", "mock-bitbucket", "mock-confluence"];
    if !fixture_ids.contains(&id) {
        return Err("Only synthetic mock integrations can be deleted in mock mode".to_owned());
    }
    match repositories::delete_integration(state, id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Mock integration was not found".to_owned()),
        Err(_) => Err("failed to delete mock integration".to_owned()),
    }
}

#[tauri::command]
pub async fn integration_set_enabled(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    id: String,
    enabled: bool,
) -> Result<IntegrationDto, String> {
    if mode.is_enabled() {
        return Err("Integration changes are disabled in mock mode".to_owned());
    }
    settings::set_integration_enabled(&state, &id, enabled)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{credential_refs_for_preload, delete_mock_integration, save_mock_integration};
    use crate::application::dev_overlay::{seed_mock_settings, MockIntegrationUrls};
    use crate::application::integrations::settings::{
        IntegrationSaveRequest, IntegrationSaveResult,
    };
    use crate::infrastructure::db::{open_database, repositories};
    use serde_json::json;
    use std::collections::HashSet;

    #[tokio::test]
    async fn mock_integration_can_be_edited_deleted_and_added_again() {
        let temp_dir = tempfile::tempdir().expect("temporary mock database");
        let pool = open_database(&temp_dir.path().join("mework-mock.sqlite"))
            .await
            .expect("mock database");
        let urls = MockIntegrationUrls {
            jira: "http://127.0.0.1:43210/jira/".to_owned(),
            bitbucket: "http://127.0.0.1:43210/bitbucket/".to_owned(),
            confluence: "http://127.0.0.1:43210/confluence/".to_owned(),
        };
        seed_mock_settings(&pool, Some(&urls))
            .await
            .expect("seed mocks");
        let edit: IntegrationSaveRequest = serde_json::from_value(json!({
            "id": "mock-confluence", "kind": "confluence", "baseUrl": urls.confluence,
            "allowInsecureTls": true,
        }))
        .expect("edit request");
        let edited = save_mock_integration(&pool, edit, &urls)
            .await
            .expect("edit mock");
        assert!(
            matches!(edited, IntegrationSaveResult::Saved { integration } if integration.allow_insecure_tls)
        );

        delete_mock_integration(&pool, "mock-confluence")
            .await
            .expect("delete mock");
        assert!(repositories::list_integrations(&pool)
            .await
            .expect("list mocks")
            .iter()
            .all(|integration| integration.id != "mock-confluence"));

        let add: IntegrationSaveRequest = serde_json::from_value(json!({
            "kind": "confluence", "baseUrl": urls.confluence,
        }))
        .expect("add request");
        let added = save_mock_integration(&pool, add, &urls)
            .await
            .expect("add mock");
        assert!(
            matches!(added, IntegrationSaveResult::Saved { integration } if integration.id == "mock-confluence")
        );
    }

    #[test]
    fn startup_preload_aggregates_unique_non_empty_integration_and_ai_refs() {
        let refs = credential_refs_for_preload(
            vec![
                "jira-ref".to_owned(),
                "bitbucket-ref".to_owned(),
                "jira-ref".to_owned(),
                "  ".to_owned(),
            ],
            vec!["ai-ref".to_owned(), "ai-ref-2".to_owned()],
        );
        assert_eq!(
            refs.into_iter().collect::<HashSet<_>>(),
            HashSet::from([
                "jira-ref".to_owned(),
                "bitbucket-ref".to_owned(),
                "ai-ref".to_owned(),
                "ai-ref-2".to_owned(),
            ])
        );
    }
}
