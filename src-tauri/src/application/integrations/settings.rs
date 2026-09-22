use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::domain::models::{Integration, IntegrationHealthStatus, IntegrationKind};
use crate::infrastructure::credentials::keyring::{CredentialError, CredentialStore};
use crate::infrastructure::db::repositories;

use super::health::{HealthCheckResult, IntegrationHealthChecker};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSaveRequest {
    pub id: Option<String>,
    pub kind: IntegrationKind,
    pub base_url: String,
    #[serde(default)]
    pub account_key: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub credential_ref: Option<String>,
    #[serde(default = "default_capabilities", alias = "capabilities_json")]
    pub capabilities: Value,
    #[serde(default, alias = "token")]
    pub secret: Option<String>,
    #[serde(default)]
    pub allow_unavailable: bool,
    #[serde(default)]
    pub allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationDto {
    pub id: String,
    pub kind: IntegrationKind,
    pub base_url: String,
    pub account_key: String,
    pub credential_ref: String,
    pub enabled: bool,
    pub allow_insecure_tls: bool,
    pub account_display_name: Option<String>,
    pub health_status: IntegrationHealthStatus,
    pub health_error: Option<String>,
    pub health_details: Option<String>,
    pub health_checked_at: Option<String>,
    pub capabilities: Value,
    pub last_success_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationHealthDto {
    pub status: IntegrationHealthStatus,
    pub message: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum IntegrationSaveResult {
    Saved { integration: Box<IntegrationDto> },
    RequiresConfirmation { health: IntegrationHealthDto },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum IntegrationError {
    InvalidInput,
    DuplicateIdentity,
    Credential(CredentialError),
    Database,
    NotFound,
}

impl std::fmt::Display for IntegrationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidInput => "invalid integration settings",
            Self::DuplicateIdentity => "an integration with this identity already exists",
            Self::Credential(CredentialError::NotFound) => "integration credential was not found",
            Self::Credential(_) => "integration credential operation failed",
            Self::Database => "integration database operation failed",
            Self::NotFound => "integration was not found",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for IntegrationError {}

pub async fn list_integrations(pool: &SqlitePool) -> Result<Vec<IntegrationDto>, IntegrationError> {
    repositories::list_integrations(pool)
        .await
        .map_err(|_| IntegrationError::Database)?
        .into_iter()
        .map(redact)
        .collect()
}

pub async fn save_integration<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    store: &S,
    request: IntegrationSaveRequest,
) -> Result<IntegrationDto, IntegrationError> {
    save_integration_with_health(
        pool,
        store,
        request,
        HealthCheckResult {
            status: IntegrationHealthStatus::Unknown,
            message: None,
            details: None,
            account_display_name: None,
        },
    )
    .await
}

async fn save_integration_with_health<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    store: &S,
    request: IntegrationSaveRequest,
    health: HealthCheckResult,
) -> Result<IntegrationDto, IntegrationError> {
    let id = request
        .id
        .clone()
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let existing = match repositories::get_integration(pool, &id).await {
        Ok(integration) => Some(integration),
        Err(sqlx::Error::RowNotFound) => None,
        Err(_) => return Err(IntegrationError::Database),
    };
    validate_request(&request, existing.as_ref())?;
    let credential_ref = request.credential_ref.clone().unwrap_or_else(|| {
        existing
            .as_ref()
            .map(|integration| integration.credential_ref.clone())
            .unwrap_or_else(|| format!("keyring://mework/integration/{id}"))
    });
    let account_key = if request.account_key.trim().is_empty() {
        existing
            .as_ref()
            .map(|integration| integration.account_key.clone())
            .unwrap_or_default()
    } else {
        request.account_key.clone()
    };
    let duplicate_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM integrations
         WHERE kind = ? AND base_url = ? AND account_key = ? AND id != ?",
    )
    .bind(request.kind.as_str())
    .bind(&request.base_url)
    .bind(&account_key)
    .bind(&id)
    .fetch_optional(pool)
    .await
    .map_err(|_| IntegrationError::Database)?;
    if duplicate_id.is_some() {
        return Err(IntegrationError::DuplicateIdentity);
    }

    if let Some(secret) = request
        .secret
        .as_deref()
        .filter(|secret| !secret.is_empty())
    {
        store
            .save(&credential_ref, secret)
            .map_err(IntegrationError::Credential)?;
    }

    let mut capabilities = request.capabilities.clone();
    if request.kind == IntegrationKind::Jira
        && capabilities
            .get("deployment")
            .and_then(Value::as_str)
            .is_none()
    {
        capabilities["deployment"] = Value::String("data_center".into());
    }
    if request.kind == IntegrationKind::Confluence
        && capabilities
            .get("deployment")
            .and_then(Value::as_str)
            .is_none()
    {
        capabilities["deployment"] = Value::String("data_center".into());
    }

    let health_status = if health.status == IntegrationHealthStatus::Unknown {
        existing
            .as_ref()
            .map(|item| item.health_status)
            .unwrap_or(IntegrationHealthStatus::Unknown)
    } else {
        health.status
    };
    let health_error = if health.status == IntegrationHealthStatus::Unknown {
        existing.as_ref().and_then(|item| item.health_error.clone())
    } else {
        health.message.clone()
    };
    let health_details = if health.status == IntegrationHealthStatus::Unknown {
        existing
            .as_ref()
            .and_then(|item| item.health_details.clone())
    } else {
        health.details.clone()
    };
    let health_checked_at = if health.status == IntegrationHealthStatus::Unknown {
        existing
            .as_ref()
            .and_then(|item| item.health_checked_at.clone())
    } else {
        None
    };
    let account_display_name = health.account_display_name.clone().or_else(|| {
        existing
            .as_ref()
            .and_then(|item| item.account_display_name.clone())
    });

    let integration = Integration {
        id: id.clone(),
        kind: request.kind,
        base_url: request.base_url,
        account_key,
        credential_ref: credential_ref.clone(),
        enabled: true,
        allow_insecure_tls: request.allow_insecure_tls,
        account_display_name,
        health_status,
        health_error,
        health_details,
        health_checked_at,
        capabilities_json: capabilities.to_string(),
        last_success_at: existing
            .as_ref()
            .and_then(|item| item.last_success_at.clone()),
        created_at: existing
            .as_ref()
            .map(|item| item.created_at.clone())
            .unwrap_or_default(),
        updated_at: existing
            .as_ref()
            .map(|item| item.updated_at.clone())
            .unwrap_or_default(),
    };

    let database_result = if existing.is_some() {
        repositories::update_integration(pool, &integration).await
    } else {
        repositories::insert_integration_with_database_timestamps(pool, &integration).await
    };
    if database_result.is_err() {
        if existing
            .as_ref()
            .is_none_or(|previous| previous.credential_ref != credential_ref)
        {
            let _ = store.delete(&credential_ref);
        }
        return Err(IntegrationError::Database);
    }

    if let Some(previous) = existing {
        if previous.credential_ref != credential_ref {
            store
                .delete(&previous.credential_ref)
                .map_err(IntegrationError::Credential)?;
        }
    }

    if health.status != IntegrationHealthStatus::Unknown {
        repositories::update_integration_health(
            pool,
            &id,
            health.status,
            health.message.as_deref(),
            health.details.as_deref(),
            health.account_display_name.as_deref(),
        )
        .await
        .map_err(|_| IntegrationError::Database)?;
    }

    repositories::get_integration(pool, &id)
        .await
        .map_err(|_| IntegrationError::Database)
        .and_then(redact)
}

pub async fn save_integration_checked<S, C>(
    pool: &SqlitePool,
    store: &S,
    checker: &C,
    request: IntegrationSaveRequest,
) -> Result<IntegrationSaveResult, IntegrationError>
where
    S: CredentialStore + ?Sized,
    C: IntegrationHealthChecker + ?Sized,
{
    let existing = match request.id.as_deref() {
        Some(id) => match repositories::get_integration(pool, id).await {
            Ok(integration) => Some(integration),
            Err(sqlx::Error::RowNotFound) => None,
            Err(_) => return Err(IntegrationError::Database),
        },
        None => None,
    };
    validate_request(&request, existing.as_ref())?;

    let account_key = if request.account_key.trim().is_empty() {
        existing
            .as_ref()
            .map(|integration| integration.account_key.as_str())
            .unwrap_or_default()
    } else {
        request.account_key.as_str()
    };
    let secret = request
        .secret
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|integration| store.load(&integration.credential_ref).ok())
        });
    let health = checker
        .check(
            request.kind,
            &request.base_url,
            account_key,
            request.allow_insecure_tls,
            secret.as_deref(),
        )
        .await;

    if health.status == IntegrationHealthStatus::Unavailable && !request.allow_unavailable {
        return Ok(IntegrationSaveResult::RequiresConfirmation {
            health: health_dto(&health),
        });
    }

    let integration = save_integration_with_health(pool, store, request, health).await?;
    Ok(IntegrationSaveResult::Saved {
        integration: Box::new(integration),
    })
}

async fn check_with_one_retry<C>(
    checker: &C,
    kind: IntegrationKind,
    base_url: &str,
    account_key: &str,
    allow_insecure_tls: bool,
    secret: Option<&str>,
) -> HealthCheckResult
where
    C: IntegrationHealthChecker + ?Sized,
{
    let first = checker
        .check(kind, base_url, account_key, allow_insecure_tls, secret)
        .await;
    if first.status == IntegrationHealthStatus::Unavailable {
        checker
            .check(kind, base_url, account_key, allow_insecure_tls, secret)
            .await
    } else {
        first
    }
}

pub async fn refresh_integration_health<S, C>(
    pool: &SqlitePool,
    store: &S,
    checker: &C,
    id: &str,
) -> Result<IntegrationDto, IntegrationError>
where
    S: CredentialStore + ?Sized,
    C: IntegrationHealthChecker + ?Sized,
{
    let integration =
        repositories::get_integration(pool, id)
            .await
            .map_err(|error| match error {
                sqlx::Error::RowNotFound => IntegrationError::NotFound,
                _ => IntegrationError::Database,
            })?;
    let secret = store.load(&integration.credential_ref).ok();
    let health = check_with_one_retry(
        checker,
        integration.kind,
        &integration.base_url,
        &integration.account_key,
        integration.allow_insecure_tls,
        secret.as_deref(),
    )
    .await;
    repositories::update_integration_health(
        pool,
        id,
        health.status,
        health.message.as_deref(),
        health.details.as_deref(),
        health.account_display_name.as_deref(),
    )
    .await
    .map_err(|error| match error {
        sqlx::Error::RowNotFound => IntegrationError::NotFound,
        _ => IntegrationError::Database,
    })
    .and_then(redact)
}

fn health_dto(result: &HealthCheckResult) -> IntegrationHealthDto {
    IntegrationHealthDto {
        status: result.status,
        message: result.message.clone(),
        details: result.details.clone(),
    }
}

pub async fn refresh_all_integration_health<S, C>(
    pool: &SqlitePool,
    store: &S,
    checker: &C,
) -> Result<Vec<IntegrationDto>, IntegrationError>
where
    S: CredentialStore + ?Sized,
    C: IntegrationHealthChecker + ?Sized,
{
    let integrations = repositories::list_integrations(pool)
        .await
        .map_err(|_| IntegrationError::Database)?;
    let mut refreshed = Vec::with_capacity(integrations.len());
    for integration in integrations {
        refreshed.push(refresh_integration_health(pool, store, checker, &integration.id).await?);
    }
    Ok(refreshed)
}

pub async fn delete_integration<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    store: &S,
    id: &str,
) -> Result<(), IntegrationError> {
    let integration =
        repositories::get_integration(pool, id)
            .await
            .map_err(|error| match error {
                sqlx::Error::RowNotFound => IntegrationError::NotFound,
                _ => IntegrationError::Database,
            })?;

    match store.delete(&integration.credential_ref) {
        Ok(()) | Err(CredentialError::NotFound) => {}
        Err(error) => return Err(IntegrationError::Credential(error)),
    }

    if repositories::delete_integration(pool, id)
        .await
        .map_err(|_| IntegrationError::Database)?
    {
        Ok(())
    } else {
        Err(IntegrationError::NotFound)
    }
}

pub async fn set_integration_enabled(
    pool: &SqlitePool,
    id: &str,
    enabled: bool,
) -> Result<IntegrationDto, IntegrationError> {
    repositories::set_integration_enabled(pool, id, enabled)
        .await
        .map_err(|error| match error {
            sqlx::Error::RowNotFound => IntegrationError::NotFound,
            _ => IntegrationError::Database,
        })
        .and_then(redact)
}

fn validate_request(
    request: &IntegrationSaveRequest,
    existing: Option<&Integration>,
) -> Result<(), IntegrationError> {
    if request.base_url.trim().is_empty() || !request.base_url.starts_with("https://") {
        return Err(IntegrationError::InvalidInput);
    }

    let has_secret = request
        .secret
        .as_deref()
        .is_some_and(|secret| !secret.is_empty());
    if existing.is_none() && !has_secret {
        return Err(IntegrationError::InvalidInput);
    }
    if existing.is_some()
        && request
            .credential_ref
            .as_ref()
            .is_some_and(|credential_ref| {
                existing.is_some_and(|previous| credential_ref != &previous.credential_ref)
            })
        && !has_secret
    {
        return Err(IntegrationError::InvalidInput);
    }
    Ok(())
}

fn redact(integration: Integration) -> Result<IntegrationDto, IntegrationError> {
    let capabilities = serde_json::from_str(&integration.capabilities_json)
        .map_err(|_| IntegrationError::Database)?;
    Ok(IntegrationDto {
        id: integration.id,
        kind: integration.kind,
        base_url: integration.base_url,
        account_key: integration.account_key,
        credential_ref: integration.credential_ref,
        enabled: integration.enabled,
        allow_insecure_tls: integration.allow_insecure_tls,
        account_display_name: integration.account_display_name,
        health_status: integration.health_status,
        health_error: integration.health_error,
        health_details: integration.health_details,
        health_checked_at: integration.health_checked_at,
        capabilities,
        last_success_at: integration.last_success_at,
        created_at: integration.created_at,
        updated_at: integration.updated_at,
    })
}

fn default_enabled() -> bool {
    true
}

fn default_capabilities() -> Value {
    Value::Object(Default::default())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::check_with_one_retry;
    use crate::application::integrations::health::{
        HealthCheckFuture, HealthCheckResult, IntegrationHealthChecker,
    };
    use crate::domain::models::{IntegrationHealthStatus, IntegrationKind};

    struct RetryOnceChecker {
        calls: AtomicUsize,
    }

    impl IntegrationHealthChecker for RetryOnceChecker {
        fn check<'a>(
            &'a self,
            _kind: IntegrationKind,
            _base_url: &'a str,
            _account_key: &'a str,
            _allow_insecure_tls: bool,
            _secret: Option<&'a str>,
        ) -> HealthCheckFuture<'a> {
            let attempt = self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                if attempt == 0 {
                    HealthCheckResult {
                        status: IntegrationHealthStatus::Unavailable,
                        message: Some("temporary failure".to_owned()),
                        details: None,
                        account_display_name: None,
                    }
                } else {
                    HealthCheckResult {
                        status: IntegrationHealthStatus::Working,
                        message: None,
                        details: None,
                        account_display_name: Some("Synthetic Account".to_owned()),
                    }
                }
            })
        }
    }

    #[tokio::test]
    async fn retries_unavailable_health_once_and_uses_the_final_result() {
        let checker = RetryOnceChecker {
            calls: AtomicUsize::new(0),
        };

        let result = check_with_one_retry(
            &checker,
            IntegrationKind::Bitbucket,
            "https://bitbucket.example",
            "",
            false,
            None,
        )
        .await;

        assert_eq!(result.status, IntegrationHealthStatus::Working);
        assert_eq!(checker.calls.load(Ordering::SeqCst), 2);
    }
}
