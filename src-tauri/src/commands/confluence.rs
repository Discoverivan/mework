use sqlx::SqlitePool;
use tauri::State;

use crate::application::confluence::{
    self, ConfluenceSearchError, ConfluenceSearchRequest, ConfluenceSearchResponse,
    ConfluenceSpaceDto, ConfluenceSpaceResolveRequest,
};
use crate::application::dev_overlay::DevMockMode;
use crate::application::integration_error::{IntegrationCommandError, IntegrationErrorDetails};

fn map_error(
    error: ConfluenceSearchError,
    operation: &'static str,
    endpoint: &'static str,
) -> IntegrationCommandError {
    let response_body = match &error {
        ConfluenceSearchError::RemoteHttp(_, Some(body)) => {
            crate::infrastructure::integrations::error_body::sanitize_error_body(
                body.to_string().as_bytes(),
            )
        }
        _ => None,
    };
    let (code, message, retryable, http_status) = match error {
        ConfluenceSearchError::RemoteHttp(401, _) => (
            "authentication_required",
            "Confluence authentication failed",
            false,
            Some(401),
        ),
        ConfluenceSearchError::RemoteHttp(403, _) => (
            "permission_denied",
            "Confluence access was denied",
            false,
            Some(403),
        ),
        ConfluenceSearchError::RemoteHttp(429, _) => (
            "rate_limited",
            "Confluence rate limit exceeded",
            true,
            Some(429),
        ),
        ConfluenceSearchError::RemoteHttp(status, _) => (
            "remote_error",
            "Confluence request failed",
            status >= 500,
            Some(status),
        ),
        ConfluenceSearchError::ProviderUnavailable => (
            "transport_unavailable",
            "Confluence is temporarily unavailable",
            true,
            None,
        ),
        ConfluenceSearchError::InvalidProviderResponse => (
            "invalid_response",
            "Confluence returned an invalid response",
            false,
            None,
        ),
        ConfluenceSearchError::CredentialUnavailable => (
            "credential_unavailable",
            "Confluence credential is unavailable",
            false,
            None,
        ),
        ConfluenceSearchError::IntegrationUnavailable => (
            "integration_unavailable",
            "Confluence integration is unavailable",
            false,
            None,
        ),
        ConfluenceSearchError::InvalidInput => {
            ("invalid_input", "invalid Confluence request", false, None)
        }
        ConfluenceSearchError::Database => (
            "database",
            "Confluence integration database operation failed",
            true,
            None,
        ),
    };
    let details = matches!(
        code,
        "remote_error"
            | "authentication_required"
            | "permission_denied"
            | "rate_limited"
            | "transport_unavailable"
            | "invalid_response"
    )
    .then(|| {
        let mut details =
            IntegrationErrorDetails::new("confluence", operation, "GET", endpoint, http_status);
        details.response_body = response_body;
        Box::new(details)
    });
    IntegrationCommandError {
        code,
        message,
        retryable,
        details,
    }
}

fn credential_store_error() -> IntegrationCommandError {
    IntegrationCommandError {
        code: "credential_unavailable",
        message: "Confluence credential store is unavailable",
        retryable: false,
        details: None,
    }
}

fn mock_mode_error() -> IntegrationCommandError {
    IntegrationCommandError {
        code: "mock_mode",
        message: "Provider access is disabled in mock mode",
        retryable: false,
        details: None,
    }
}

#[tauri::command]
pub async fn confluence_search(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: ConfluenceSearchRequest,
) -> Result<ConfluenceSearchResponse, IntegrationCommandError> {
    if mode.is_enabled() {
        return mode
            .mock_confluence_search(request)
            .map_err(|_| mock_mode_error());
    }
    let store = super::integrations::credential_store(&state)
        .await
        .map_err(|_| credential_store_error())?;
    confluence::search(&state, store.as_ref(), request)
        .await
        .map_err(|error| map_error(error, "search", "/rest/api/search"))
}

#[tauri::command]
pub async fn confluence_space_resolve(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: ConfluenceSpaceResolveRequest,
) -> Result<ConfluenceSpaceDto, IntegrationCommandError> {
    if mode.is_enabled() {
        return mode
            .mock_confluence_space(&request.integration_id, &request.key_or_url)
            .map_err(|_| mock_mode_error());
    }
    let store = super::integrations::credential_store(&state)
        .await
        .map_err(|_| credential_store_error())?;
    confluence::resolve_space(&state, store.as_ref(), request)
        .await
        .map_err(|error| map_error(error, "resolve_space", "/rest/api/space/{key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_error_serializes_safe_operation_details() {
        let dto = map_error(
            ConfluenceSearchError::RemoteHttp(
                403,
                Some(serde_json::json!({"message":"Access is denied","authorization":"hidden"})),
            ),
            "resolve_space",
            "/rest/api/space/{key}",
        );
        let value = serde_json::to_value(dto).unwrap();
        assert_eq!(value["code"], "permission_denied");
        assert_eq!(value["details"]["httpStatus"], 403);
        assert_eq!(
            value["details"]["responseBody"]["message"],
            "Access is denied"
        );
        assert!(!value.to_string().contains("hidden"));
        assert_eq!(value["details"]["endpoint"], "/rest/api/space/{key}");
    }
}
