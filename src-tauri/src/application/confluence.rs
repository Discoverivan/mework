use reqwest::Url;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::domain::models::IntegrationKind;
use crate::infrastructure::credentials::keyring::CredentialStore;
use crate::infrastructure::db::repositories;
use crate::infrastructure::integrations::confluence::client::{
    ConfluenceClient, ConfluenceError, ConfluenceSearchResult,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSearchRequest {
    pub integration_id: String,
    pub query: String,
    pub space_key: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSpaceResolveRequest {
    pub integration_id: String,
    pub key_or_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSpaceDto {
    pub integration_id: String,
    pub space_id: String,
    pub space_key: String,
    pub space_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSearchResponse {
    pub integration_id: String,
    pub results: Vec<ConfluenceSearchResult>,
}

#[derive(Debug)]
pub enum ConfluenceSearchError {
    InvalidInput,
    IntegrationUnavailable,
    CredentialUnavailable,
    AuthenticationFailed,
    AccessDenied,
    ProviderUnavailable,
    InvalidProviderResponse,
    Database,
}

impl std::fmt::Display for ConfluenceSearchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "invalid Confluence search request",
            Self::IntegrationUnavailable => "Confluence integration is unavailable",
            Self::CredentialUnavailable => "Confluence credential is unavailable",
            Self::AuthenticationFailed => "Confluence authentication failed",
            Self::AccessDenied => "Confluence search access was denied",
            Self::ProviderUnavailable => "Confluence search is temporarily unavailable",
            Self::InvalidProviderResponse => "Confluence returned an invalid response",
            Self::Database => "Confluence integration database operation failed",
        })
    }
}

pub async fn search<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    store: &S,
    request: ConfluenceSearchRequest,
) -> Result<ConfluenceSearchResponse, ConfluenceSearchError> {
    if request.integration_id.trim().is_empty()
        || request.query.trim().is_empty()
        || request.query.chars().count() > 200
        || !(1..=50).contains(&request.limit)
    {
        return Err(ConfluenceSearchError::InvalidInput);
    }
    let integration = repositories::get_integration(pool, &request.integration_id)
        .await
        .map_err(|error| match error {
            sqlx::Error::RowNotFound => ConfluenceSearchError::IntegrationUnavailable,
            _ => ConfluenceSearchError::Database,
        })?;
    if integration.kind != IntegrationKind::Confluence || !integration.enabled {
        return Err(ConfluenceSearchError::IntegrationUnavailable);
    }
    let token = store
        .load(&integration.credential_ref)
        .map_err(|_| ConfluenceSearchError::CredentialUnavailable)?;
    let client =
        ConfluenceClient::new(&integration.base_url, token, integration.allow_insecure_tls)
            .map_err(map_client_error)?;
    let results = client
        .search(&request.query, request.space_key.as_deref(), request.limit)
        .await
        .map_err(map_client_error)?;
    Ok(ConfluenceSearchResponse {
        integration_id: integration.id,
        results,
    })
}

pub async fn resolve_space<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    store: &S,
    request: ConfluenceSpaceResolveRequest,
) -> Result<ConfluenceSpaceDto, ConfluenceSearchError> {
    if request.integration_id.trim().is_empty() || request.key_or_url.trim().is_empty() {
        return Err(ConfluenceSearchError::InvalidInput);
    }
    let integration = repositories::get_integration(pool, request.integration_id.trim())
        .await
        .map_err(|error| match error {
            sqlx::Error::RowNotFound => ConfluenceSearchError::IntegrationUnavailable,
            _ => ConfluenceSearchError::Database,
        })?;
    if integration.kind != IntegrationKind::Confluence || !integration.enabled {
        return Err(ConfluenceSearchError::IntegrationUnavailable);
    }
    let space_key = normalize_space_key(&integration.base_url, &request.key_or_url)?;
    let token = store
        .load(&integration.credential_ref)
        .map_err(|_| ConfluenceSearchError::CredentialUnavailable)?;
    let client =
        ConfluenceClient::new(&integration.base_url, token, integration.allow_insecure_tls)
            .map_err(map_client_error)?;
    let space = client
        .get_space(&space_key)
        .await
        .map_err(map_client_error)?;
    Ok(ConfluenceSpaceDto {
        integration_id: integration.id,
        space_id: space.id,
        space_key: space.key,
        space_name: space.name,
    })
}

fn normalize_space_key(base_url: &str, key_or_url: &str) -> Result<String, ConfluenceSearchError> {
    let value = key_or_url.trim();
    let key = if let Ok(url) = Url::parse(value) {
        let base = Url::parse(base_url).map_err(|_| ConfluenceSearchError::InvalidInput)?;
        if url.scheme() != base.scheme()
            || url.host_str() != base.host_str()
            || url.port_or_known_default() != base.port_or_known_default()
        {
            return Err(ConfluenceSearchError::InvalidInput);
        }
        let segments = url
            .path_segments()
            .ok_or(ConfluenceSearchError::InvalidInput)?
            .collect::<Vec<_>>();
        segments
            .windows(2)
            .find(|parts| parts[0] == "spaces")
            .map(|parts| parts[1])
            .filter(|key| !key.is_empty())
            .ok_or(ConfluenceSearchError::InvalidInput)?
            .to_owned()
    } else {
        value.to_owned()
    };
    if key.is_empty()
        || key.chars().count() > 255
        || !key.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '~')
        })
    {
        return Err(ConfluenceSearchError::InvalidInput);
    }
    Ok(key)
}

fn map_client_error(error: ConfluenceError) -> ConfluenceSearchError {
    match error {
        ConfluenceError::InvalidBaseUrl | ConfluenceError::InvalidQuery => {
            ConfluenceSearchError::InvalidInput
        }
        ConfluenceError::Http(401) => ConfluenceSearchError::AuthenticationFailed,
        ConfluenceError::Http(403) => ConfluenceSearchError::AccessDenied,
        ConfluenceError::Http(_) | ConfluenceError::Transport => {
            ConfluenceSearchError::ProviderUnavailable
        }
        ConfluenceError::InvalidResponse => ConfluenceSearchError::InvalidProviderResponse,
    }
}

const fn default_limit() -> u16 {
    20
}
