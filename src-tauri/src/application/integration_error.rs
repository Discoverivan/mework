use serde::Serialize;

/// Safe diagnostic metadata for a failed native integration operation.
/// Values are static operation names and route templates, never upstream URLs,
/// request bodies, headers, credentials or untrusted provider messages.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationErrorDetails {
    pub provider: &'static str,
    pub operation: &'static str,
    pub method: &'static str,
    pub endpoint: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<serde_json::Value>,
}

impl IntegrationErrorDetails {
    pub const fn new(
        provider: &'static str,
        operation: &'static str,
        method: &'static str,
        endpoint: &'static str,
        http_status: Option<u16>,
    ) -> Self {
        Self {
            provider,
            operation,
            method,
            endpoint,
            http_status,
            reason: None,
            response_body: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCommandError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Box<IntegrationErrorDetails>>,
}
