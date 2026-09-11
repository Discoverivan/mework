use std::{error::Error as StdError, future::Future, pin::Pin, time::Duration};

use reqwest::{Client, Url};
use serde_json::Value;

pub use crate::domain::models::IntegrationHealthStatus as HealthStatus;
use crate::domain::models::IntegrationKind;

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct HealthCheckResult {
    pub status: HealthStatus,
    pub message: Option<String>,
    pub details: Option<String>,
    pub account_display_name: Option<String>,
}

impl HealthCheckResult {
    fn working(account_display_name: Option<String>) -> Self {
        Self {
            status: HealthStatus::Working,
            message: None,
            details: None,
            account_display_name,
        }
    }

    fn unavailable(message: impl Into<String>, details: impl Into<String>) -> Self {
        Self {
            status: HealthStatus::Unavailable,
            message: Some(message.into()),
            details: Some(details.into()),
            account_display_name: None,
        }
    }
}

pub type HealthCheckFuture<'a> = Pin<Box<dyn Future<Output = HealthCheckResult> + Send + 'a>>;

pub trait IntegrationHealthChecker: Send + Sync {
    fn check<'a>(
        &'a self,
        kind: IntegrationKind,
        base_url: &'a str,
        account_key: &'a str,
        allow_insecure_tls: bool,
        secret: Option<&'a str>,
    ) -> HealthCheckFuture<'a>;
}

#[derive(Clone)]
pub struct ReqwestHealthChecker {
    secure_client: Client,
    insecure_client: Client,
}

impl ReqwestHealthChecker {
    pub fn new() -> Self {
        let secure_client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("health check HTTP client should build");
        let insecure_client = Client::builder()
            .timeout(Duration::from_secs(10))
            .danger_accept_invalid_certs(true)
            .build()
            .expect("insecure health check HTTP client should build");
        Self {
            secure_client,
            insecure_client,
        }
    }

    pub async fn check(
        &self,
        kind: IntegrationKind,
        base_url: &str,
        account_key: &str,
        allow_insecure_tls: bool,
        secret: Option<&str>,
    ) -> HealthCheckResult {
        let endpoint = match kind {
            IntegrationKind::Jira => "GET /rest/api/2/myself",
            IntegrationKind::Bitbucket => "GET /rest/api/1.0/repos?limit=1",
        };
        let Some(secret) = secret.filter(|value| !value.trim().is_empty()) else {
            let credential_message = if cfg!(debug_assertions) {
                match kind {
                    IntegrationKind::Jira =>
                        "Development Jira credential is missing (set MEWORK_DEV_JIRA_PAT).",
                    IntegrationKind::Bitbucket => "Development Bitbucket credential is missing (set MEWORK_DEV_BITBUCKET_PAT).",
                }
            } else {
                "Personal access token is missing."
            };
            return HealthCheckResult::unavailable(
                credential_message,
                format!(
                    "Health-check log:\n- Request: {endpoint}\n- HTTP status: unavailable (request not sent)\n- Response body: unavailable ({credential_message})\n- Action: Enter a PAT to check authentication."
                ),
            );
        };

        let mut base_url = match Url::parse(base_url) {
            Ok(value)
                if value.username().is_empty()
                    && value.password().is_none()
                    && value.query().is_none()
                    && value.fragment().is_none()
                    && matches!(value.scheme(), "http" | "https")
                    && value.host_str().is_some() => value,
            Ok(_) => {
                return HealthCheckResult::unavailable(
                    "Base URL is invalid.",
                    "Health-check log:\n- Validation: Base URL contains credentials, query parameters, or a fragment.\n- Action: Use only the provider origin/path, without secrets.",
                )
            }
            Err(error) => {
                return HealthCheckResult::unavailable(
                    "Base URL is invalid.",
                    format!("Health-check log:\n- Validation error: {error}\n- Action: Use a valid provider Base URL."),
                )
            }
        };
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }

        let endpoint = match kind {
            IntegrationKind::Jira => base_url.join("rest/api/2/myself"),
            IntegrationKind::Bitbucket => base_url.join("rest/api/1.0/repos"),
        };
        let endpoint = match endpoint {
            Ok(value) => value,
            Err(_) => {
                return HealthCheckResult::unavailable(
                    "Base URL is invalid.",
                    "The provider health-check endpoint could not be built from this Base URL.",
                )
            }
        };

        let request_url = endpoint.to_string();
        let tls_mode = if allow_insecure_tls {
            "certificate verification disabled by user"
        } else {
            "certificate verification enabled"
        };
        let mut request = if allow_insecure_tls {
            self.insecure_client.get(endpoint)
        } else {
            self.secure_client.get(endpoint)
        };
        if kind == IntegrationKind::Bitbucket {
            request = request.query(&[("limit", "1")]);
            request = request.bearer_auth(secret);
        } else if !account_key.trim().is_empty() {
            request = request.basic_auth(account_key, Some(secret));
        } else {
            request = request.bearer_auth(secret);
        }

        match request.send().await {
            Ok(response) if response.status().is_success() => {
                let account_display_name = match kind {
                    IntegrationKind::Jira => response
                        .json::<Value>()
                        .await
                        .ok()
                        .and_then(|body| {
                            body.get("displayName")
                                .or_else(|| body.get("name"))
                                .and_then(Value::as_str)
                                .and_then(safe_display_name)
                        }),
                    IntegrationKind::Bitbucket => response
                        .headers()
                        .get("x-ausername")
                        .and_then(|value| value.to_str().ok())
                        .and_then(safe_display_name),
                };
                HealthCheckResult::working(account_display_name)
            }
            Ok(response) => unavailable_http(kind, response, &request_url, tls_mode).await,
            Err(error) => HealthCheckResult::unavailable(
                "Unable to reach the integration.",
                format!(
                    "Health-check log:\n- Request: GET {request_url}\n- TLS: {tls_mode}\n- HTTP status: unavailable (no response received)\n- Response body: unavailable (transport failed before an HTTP response)\n- Network error: {error}\n- Cause chain: {}\n- Action: Install the issuing CA in the system trust store, or enable Allow insecure TLS connection only for a trusted internal endpoint.",
                    transport_error_causes(&error)                ),
            ),
        }
    }
}

impl Default for ReqwestHealthChecker {
    fn default() -> Self {
        Self::new()
    }
}

impl IntegrationHealthChecker for ReqwestHealthChecker {
    fn check<'a>(
        &'a self,
        kind: IntegrationKind,
        base_url: &'a str,
        account_key: &'a str,
        allow_insecure_tls: bool,
        secret: Option<&'a str>,
    ) -> HealthCheckFuture<'a> {
        Box::pin(self.check(kind, base_url, account_key, allow_insecure_tls, secret))
    }
}

const MAX_RESPONSE_BODY_CHARS: usize = 4_000;

fn safe_display_name(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return None;
    }
    Some(value.chars().take(200).collect())
}

fn transport_error_causes(error: &reqwest::Error) -> String {
    let mut causes = Vec::new();
    let mut current: &dyn StdError = error;
    while let Some(source) = current.source() {
        causes.push(source.to_string());
        current = source;
    }
    if causes.is_empty() {
        "[no nested cause reported]".to_owned()
    } else {
        causes.join(" -> ")
    }
}

async fn unavailable_http(
    kind: IntegrationKind,
    response: reqwest::Response,
    request_url: &str,
    tls_mode: &str,
) -> HealthCheckResult {
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map(|body| redact_response_body(&body))
        .unwrap_or_else(|_| "[unavailable: response body could not be read]".to_owned());
    let endpoint = match kind {
        IntegrationKind::Jira => "GET /rest/api/2/myself",
        IntegrationKind::Bitbucket => "GET /rest/api/1.0/repos?limit=1",
    };
    let (message, explanation) = match status {
        401 => (
            format!("Authentication failed (HTTP {status})."),
            "The provider rejected the PAT. Check that it is valid, not expired, and has the required API permissions.",
        ),
        403 => (
            format!("Access denied (HTTP {status})."),
            "The credentials were accepted, but this account is not allowed to access the health-check endpoint.",
        ),
        404 => (
            format!("Health endpoint was not found (HTTP {status})."),
            "Check the Base URL and the selected provider deployment type.",
        ),
        500..=599 => (
            format!("The integration returned a server error (HTTP {status})."),
            "The provider returned a server-side failure. Retry the health check later.",
        ),
        _ => (
            format!("The integration returned HTTP {status}."),
            "The provider returned an unexpected response to the health-check request.",
        ),
    };
    HealthCheckResult::unavailable(
        message,
        format!(
            "Health-check log:\n- Request: {endpoint}\n- URL: {request_url}\n- TLS: {tls_mode}\n- Response: HTTP {status}\n- Response body:\n{body}\n- Explanation: {explanation}"
        ),
    )
}

fn redact_response_body(body: &str) -> String {
    let body = body.trim();
    if body.is_empty() {
        return "[empty body]".to_owned();
    }

    let redacted = match serde_json::from_str::<Value>(body) {
        Ok(value) => serde_json::to_string_pretty(&redact_json(value))
            .unwrap_or_else(|_| "[unavailable: invalid response body]".to_owned()),
        Err(_) if contains_sensitive_marker(body) => {
            "[non-JSON body omitted because it contains a sensitive marker]".to_owned()
        }
        Err(_) => body.to_owned(),
    };
    truncate_chars(&redacted, MAX_RESPONSE_BODY_CHARS)
}

fn redact_json(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    if is_sensitive_key(&key) {
                        (key, Value::String("[REDACTED]".to_owned()))
                    } else {
                        (key, redact_json(value))
                    }
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(redact_json).collect()),
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "password",
        "secret",
        "authorization",
        "cookie",
        "credential",
    ]
    .iter()
    .any(|marker| key.contains(marker))
}

fn contains_sensitive_marker(body: &str) -> bool {
    let body = body.to_ascii_lowercase();
    [
        "token",
        "password",
        "secret",
        "authorization",
        "cookie",
        "credential",
    ]
    .iter()
    .any(|marker| body.contains(marker))
}

fn truncate_chars(value: &str, maximum: usize) -> String {
    let mut truncated = value.chars().take(maximum).collect::<String>();
    if value.chars().count() > maximum {
        truncated.push_str("\n[response body truncated]");
    }
    truncated
}
