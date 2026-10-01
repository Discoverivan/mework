use reqwest::{Request, RequestBuilder, Response};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    future::Future,
    io::Write,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ENTRY_CHARS: usize = 8_000;
const MAX_HTTP_BODY_BYTES: usize = 8_192;
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn ensure_logs_dir(app_data_dir: &Path) -> std::io::Result<PathBuf> {
    let logs_dir = app_data_dir.join("logs");
    fs::create_dir_all(&logs_dir)?;
    Ok(logs_dir)
}

pub fn initialize(app_data_dir: &Path) {
    let logs_dir = match ensure_logs_dir(app_data_dir) {
        Ok(logs_dir) => logs_dir,
        Err(error) => {
            eprintln!("Failed to create application logs directory: {error}");
            return;
        }
    };
    let _ = LOG_PATH.set(logs_dir.join("application.log"));
    info(
        "application",
        "logger_initialized",
        serde_json::json!({"directory": logs_dir}),
    );
}

pub fn info(component: &str, event: &str, details: Value) {
    write("INFO", component, event, details);
}

pub fn error(component: &str, event: &str, details: Value) {
    write("ERROR", component, event, details);
}

pub fn log_parse_failure(component: &str, operation: &str, stage: &str, body: &[u8]) {
    let body = if component.starts_with("data_integrations") {
        safe_http_body_excerpt(body)
    } else {
        safe_body_excerpt(body)
    };
    error(
        component,
        "response_parse_failure",
        serde_json::json!({"operation": operation, "stage": stage, "body": body}),
    );
}

pub fn log_business_failure(component: &str, operation: &str, stage: &str, reason: &str) {
    log_business_failure_with_body(component, operation, stage, reason, None);
}

pub fn log_business_failure_with_body(
    component: &str,
    operation: &str,
    stage: &str,
    reason: &str,
    response_body: Option<&[u8]>,
) {
    let mut details = serde_json::json!({
        "operation": operation,
        "stage": stage,
        "reason": redact_text(reason),
    });
    if let Some(body) = response_body {
        details["response_body"] = safe_http_body_excerpt(body);
    }
    error(component, "business_response_failure", details);
}

pub fn safe_body_excerpt(body: &[u8]) -> Value {
    let safe = match serde_json::from_slice::<Value>(body) {
        Ok(value) => serde_json::to_string(&diagnostic_shape(value, None))
            .unwrap_or_else(|_| "[response body omitted]".to_owned()),
        Err(_) => format!("[non-JSON body omitted; {} bytes]", body.len()),
    };
    Value::String(safe.chars().take(MAX_ENTRY_CHARS).collect())
}

fn diagnostic_shape(value: Value, key: Option<&str>) -> Value {
    const SAFE_TEXT_FIELDS: &[&str] = &[
        "status",
        "code",
        "type",
        "exit_code",
        "event",
        "id",
        "model",
        "object",
        "error_code",
        "finish_reason",
        "operation",
    ];
    const SENSITIVE_TEXT_FIELDS: &[&str] = &[
        "prompt",
        "input",
        "messages",
        "content",
        "text",
        "query",
        "description",
        "diff",
        "task",
        "comment",
        "output",
        "user",
        "system",
    ];
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    let normalized = key.to_ascii_lowercase();
                    let sensitive = SENSITIVE_TEXT_FIELDS
                        .iter()
                        .any(|field| normalized.contains(field));
                    let value = if sensitive {
                        Value::String("[OMITTED]".to_owned())
                    } else {
                        diagnostic_shape(value, Some(&normalized))
                    };
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| diagnostic_shape(value, key))
                .collect(),
        ),
        Value::String(text) => {
            if key.is_some_and(|key| SAFE_TEXT_FIELDS.contains(&key)) {
                Value::String(redact_text(&text))
            } else {
                Value::String("[OMITTED]".to_owned())
            }
        }
        scalar => scalar,
    }
}

pub async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
    component: &str,
    operation: &str,
) -> Result<T, ()> {
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(_) => {
            error(
                component,
                "response_body_read_failure",
                serde_json::json!({"operation": operation}),
            );
            return Err(());
        }
    };
    match serde_json::from_slice(&body) {
        Ok(value) => Ok(value),
        Err(error) => {
            let category = match error.classify() {
                serde_json::error::Category::Io => "io",
                serde_json::error::Category::Syntax => "syntax",
                serde_json::error::Category::Data => "data",
                serde_json::error::Category::Eof => "eof",
            };
            log_parse_failure(component, operation, category, &body);
            Err(())
        }
    }
}

pub fn log_cli_failure(
    provider: &str,
    operation: &str,
    model: Option<&str>,
    exit_code: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
) {
    log_cli_failure_with_duration(provider, operation, model, exit_code, None, stdout, stderr);
}

pub fn log_cli_failure_with_duration(
    provider: &str,
    operation: &str,
    model: Option<&str>,
    exit_code: Option<i32>,
    duration_ms: Option<u128>,
    stdout: &[u8],
    stderr: &[u8],
) {
    error(
        "ai.cli",
        "process_failure",
        serde_json::json!({"provider": provider, "operation": operation, "model": model, "exit_code": exit_code, "duration_ms": duration_ms}),
    );
    if !stdout.is_empty() {
        log_parse_failure("ai.cli", operation, "stdout", stdout);
    }
    if !stderr.is_empty() {
        log_parse_failure("ai.cli", operation, "stderr", stderr);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HttpBodyPolicy {
    Integration,
    Omit,
}

pub trait HttpRequestBuilderExt {
    fn send_logged(
        self,
        component: &'static str,
        operation: &'static str,
        body_policy: HttpBodyPolicy,
    ) -> Pin<Box<dyn Future<Output = Result<Response, reqwest::Error>> + Send>>;
}

impl HttpRequestBuilderExt for RequestBuilder {
    fn send_logged(
        self,
        component: &'static str,
        operation: &'static str,
        body_policy: HttpBodyPolicy,
    ) -> Pin<Box<dyn Future<Output = Result<Response, reqwest::Error>> + Send>> {
        Box::pin(send_http_request(self, component, operation, body_policy))
    }
}

pub async fn send_http_request(
    request: RequestBuilder,
    component: &str,
    operation: &str,
    body_policy: HttpBodyPolicy,
) -> Result<Response, reqwest::Error> {
    let diagnostic = request.try_clone().and_then(|request| request.build().ok());
    if let Some(request) = diagnostic.as_ref() {
        log_http_request(request, component, operation, body_policy);
    }
    let response = request.send().await.map_err(|error| {
        error_log_http_transport(component, operation, diagnostic.as_ref(), &error);
        error
    })?;
    log_http_response(
        component,
        operation,
        diagnostic.as_ref().map(|request| request.method().as_str()),
        &response,
    );
    Ok(response)
}

pub async fn execute_http_request(
    client: &reqwest::Client,
    request: Request,
    component: &str,
    operation: &str,
    body_policy: HttpBodyPolicy,
) -> Result<Response, reqwest::Error> {
    let method = request.method().as_str().to_owned();
    log_http_request(&request, component, operation, body_policy);
    let response = client.execute(request).await.map_err(|error| {
        error_log_http_transport(component, operation, None, &error);
        error
    })?;
    log_http_response(component, operation, Some(&method), &response);
    Ok(response)
}

fn log_http_request(
    request: &Request,
    component: &str,
    operation: &str,
    body_policy: HttpBodyPolicy,
) {
    info(
        component,
        "http_request",
        http_request_details(request, operation, body_policy),
    );
}

fn http_request_details(request: &Request, operation: &str, body_policy: HttpBodyPolicy) -> Value {
    let mut details = serde_json::json!({
        "operation": operation,
        "method": request.method().as_str(),
        "url": safe_url(request.url().as_str()),
        "request_body_policy": if body_policy == HttpBodyPolicy::Integration { "integration" } else { "omitted" },
    });
    if body_policy == HttpBodyPolicy::Integration {
        if let Some(body) = request.body().and_then(reqwest::Body::as_bytes) {
            details["request_body_bytes"] = Value::from(body.len());
            details["request_body"] = safe_http_body_excerpt(body);
        }
    }
    details
}

fn error_log_http_transport(
    component: &str,
    operation: &str,
    request: Option<&Request>,
    transport_error: &reqwest::Error,
) {
    error(
        component,
        "request_transport_error",
        serde_json::json!({
            "operation": operation,
            "method": request.map(|request| request.method().as_str()),
            "url": request.map(|request| safe_url(request.url().as_str())),
            "timeout": transport_error.is_timeout(),
            "connect": transport_error.is_connect(),
        }),
    );
}

fn log_http_response(component: &str, operation: &str, method: Option<&str>, response: &Response) {
    let details = serde_json::json!({
        "operation": operation,
        "method": method,
        "url": safe_url(response.url().as_str()),
        "status": response.status().as_u16(),
        "content_length": response.content_length(),
        "headers": safe_response_headers(response.headers()),
    });
    if response.status().is_client_error() || response.status().is_server_error() {
        error(component, "http_response", details);
    } else {
        info(component, "http_response", details);
    }
}

fn safe_response_headers(headers: &reqwest::header::HeaderMap) -> Value {
    let mut safe = serde_json::Map::new();
    for (name, value) in headers {
        let name = name.as_str();
        let safe_name = matches!(
            name,
            "content-type"
                | "content-length"
                | "date"
                | "etag"
                | "retry-after"
                | "last-modified"
                | "x-request-id"
                | "x-github-request-id"
                | "x-ratelimit-limit"
                | "x-ratelimit-remaining"
                | "x-ratelimit-reset"
                | "x-ratelimit-used"
                | "x-ratelimit-resource"
                | "x-rate-limit-limit"
                | "x-rate-limit-remaining"
                | "x-rate-limit-reset"
        ) || matches!(
            name,
            "server"
                | "allow"
                | "request-id"
                | "x-correlation-id"
                | "x-ms-request-id"
                | "x-amzn-requestid"
        ) || matches!(name, "x-atlassian-request-id" | "x-atlassian-trace-id");
        if safe_name {
            if let Ok(value) = value.to_str() {
                safe.insert(name.to_owned(), Value::String(redact_text(value)));
            }
        }
    }
    Value::Object(safe)
}

pub fn log_http_error_payload(
    status: u16,
    component: &str,
    operation: &str,
    body: &[u8],
    preserve_text: bool,
) {
    let excerpt = if preserve_text {
        safe_http_body_excerpt(body)
    } else {
        safe_body_excerpt(body)
    };
    error(
        component,
        "http_error_body",
        serde_json::json!({
            "operation": operation,
            "status": status,
            "body_bytes_captured": body.len(),
            "body_truncated": body.len() >= MAX_HTTP_BODY_BYTES,
            "body": excerpt,
        }),
    );
}

pub async fn log_http_error_body(
    mut response: Response,
    component: &str,
    operation: &str,
    preserve_text: bool,
) {
    const MAX_BODY_BYTES: usize = 8_192;
    let status = response.status().as_u16();
    let url = safe_url(response.url().as_str());
    let mut body = Vec::new();
    let mut read_failed = false;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => {
                read_failed = true;
                break;
            }
        };
        let remaining = MAX_BODY_BYTES.saturating_sub(body.len());
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if chunk.len() > remaining || body.len() == MAX_BODY_BYTES {
            break;
        }
    }
    let truncated = body.len() == MAX_BODY_BYTES;
    let excerpt = if preserve_text {
        safe_http_body_excerpt(&body)
    } else {
        safe_body_excerpt(&body)
    };
    error(
        component,
        "http_error_body",
        serde_json::json!({
            "operation": operation,
            "status": status,
            "url": url,
            "body_bytes_captured": body.len(),
            "body_truncated": truncated,
            "body_read_failed": read_failed,
            "body": excerpt,
        }),
    );
}

pub fn safe_http_body_excerpt(body: &[u8]) -> Value {
    if body.len() > MAX_HTTP_BODY_BYTES {
        return Value::String(format!(
            "[body omitted; {} bytes exceeds {} byte logging limit]",
            body.len(),
            MAX_HTTP_BODY_BYTES
        ));
    }
    let safe = match serde_json::from_slice::<Value>(body) {
        Ok(value) => serde_json::to_string(&redact_value(value))
            .unwrap_or_else(|_| "[response body omitted]".to_owned()),
        Err(_) => redact_text(&String::from_utf8_lossy(body)),
    };
    let excerpt = safe.chars().take(MAX_ENTRY_CHARS).collect::<String>();
    Value::String(if safe.chars().count() > MAX_ENTRY_CHARS {
        format!("{excerpt}…[truncated]")
    } else {
        excerpt
    })
}

pub fn safe_url(value: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(value) else {
        return "[invalid-url]".to_owned();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

pub fn redact_text(value: &str) -> String {
    let mut result = value.to_owned();
    result = redact_labeled_secrets(result);
    for prefix in ["Bearer ", "bearer ", "Basic ", "basic "] {
        let mut cursor = 0;
        while let Some(relative_start) = result[cursor..].find(prefix) {
            let start = cursor + relative_start;
            let secret_start = start + prefix.len();
            let end = result[secret_start..]
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '"' | '\'' | ',' | ')' | ']')
                })
                .map(|offset| secret_start + offset)
                .unwrap_or(result.len());
            result.replace_range(secret_start..end, "[REDACTED]");
            cursor = secret_start + "[REDACTED]".len();
        }
    }
    result.chars().take(MAX_ENTRY_CHARS).collect()
}

fn redact_labeled_secrets(mut text: String) -> String {
    let labels = [
        "authorization",
        "api_key",
        "api-key",
        "apikey",
        "api key",
        "access_token",
        "refresh_token",
        "token",
        "password",
        "secret",
        "credential",
    ];
    for label in labels {
        let lower = text.to_ascii_lowercase();
        let mut cursor = 0;
        while let Some(relative) = lower[cursor..].find(label) {
            let start = cursor + relative + label.len();
            let tail = &text[start..];
            let Some(delimiter) = tail.find(|character: char| character == '=' || character == ':')
            else {
                cursor = start;
                continue;
            };
            if delimiter > 4 {
                cursor = start;
                continue;
            }
            let value_start = start + delimiter + 1;
            let secret_start = value_start + text[value_start..].len()
                - text[value_start..]
                    .trim_start_matches(|character: char| {
                        character.is_whitespace() || matches!(character, '"' | '\'')
                    })
                    .len();
            let end = text[secret_start..]
                .find(|character: char| {
                    if label == "authorization" {
                        matches!(character, '"' | '\'' | ',' | ';' | '&' | ')')
                    } else {
                        character.is_whitespace()
                            || matches!(character, '"' | '\'' | ',' | ';' | '&' | ')')
                    }
                })
                .map(|offset| secret_start + offset)
                .unwrap_or(text.len());
            if end > secret_start {
                text.replace_range(secret_start..end, "[REDACTED]");
                cursor = secret_start + "[REDACTED]".len();
            } else {
                cursor = value_start;
            }
        }
    }
    text
}

pub fn redact_value(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    let normalized = key.to_ascii_lowercase().replace('-', "_");
                    let secret_field = [
                        "authorization",
                        "api_key",
                        "apikey",
                        "credential",
                        "password",
                        "secret",
                        "token",
                        "cookie",
                    ]
                    .iter()
                    .any(|part| normalized.contains(part));
                    (
                        key,
                        if secret_field {
                            Value::String("[REDACTED]".into())
                        } else {
                            redact_value(value)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(redact_value).collect()),
        Value::String(text) => Value::String(redact_text(&text)),
        other => other,
    }
}

fn write(level: &str, component: &str, event: &str, details: Value) {
    let Some(path) = LOG_PATH.get() else { return };
    let Ok(_guard) = LOG_LOCK.lock() else { return };
    if fs::metadata(path)
        .map(|metadata| metadata.len() >= MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let backup = path.with_extension("log.1");
        let _ = fs::remove_file(&backup);
        let _ = fs::rename(path, backup);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let record = serde_json::json!({
        "timestamp_ms": timestamp,
        "level": level,
        "component": redact_text(component),
        "event": redact_text(event),
        "details": redact_value(details),
    });
    let Ok(line) = serde_json::to_string(&record) else {
        return;
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_secret_fields_and_authorization_strings() {
        let value = redact_value(serde_json::json!({
            "Authorization": "Bearer abc123",
            "nested": {"api_key": "example-secret", "message": "failed using Bearer xyz"}
        }));
        assert_eq!(value["Authorization"], "[REDACTED]");
        assert_eq!(value["nested"]["api_key"], "[REDACTED]");
        assert_eq!(value["nested"]["message"], "failed using Bearer [REDACTED]");
        assert_eq!(
            redact_text("request failed: api_key=sk-synthetic token: secret-value"),
            "request failed: api_key=[REDACTED] token: [REDACTED]"
        );
    }

    #[test]
    fn bounds_parse_failure_excerpt_without_retaining_prompt_or_free_text() {
        let body = serde_json::json!({
            "token": "secret-value",
            "prompt": "private prompt text",
            "error": {"code": "server_error", "message": "echoed request text"}
        })
        .to_string();
        let excerpt = safe_body_excerpt(body.as_bytes()).to_string();
        assert!(!excerpt.contains("secret-value"));
        assert!(!excerpt.contains("private prompt text"));
        assert!(!excerpt.contains("echoed request text"));
        assert!(excerpt.contains("server_error"));
        let large = vec![b'x'; MAX_ENTRY_CHARS + 100];
        assert!(safe_body_excerpt(&large).to_string().len() <= MAX_ENTRY_CHARS + 32);
    }

    #[test]
    fn redacts_authorization_scheme_and_credential_as_one_value() {
        let body = br#"{"message":"Authorization: Bearer example-secret-value"}"#;
        let excerpt = safe_http_body_excerpt(body).to_string();
        assert!(!excerpt.contains("example-secret-value"));
        assert!(excerpt.contains("[REDACTED]"));
    }

    #[test]
    fn preserves_integration_error_text_but_redacts_secrets_and_bounds_large_bodies() {
        let body = br#"{"message":"Synthetic service failure","token":"example-secret","authorization":"Bearer hidden"}"#;
        let excerpt = safe_http_body_excerpt(body).to_string();
        assert!(excerpt.contains("Synthetic service failure"));
        assert!(!excerpt.contains("example-secret"));
        assert!(!excerpt.contains("hidden"));
        let large = vec![b'x'; MAX_HTTP_BODY_BYTES + 1];
        assert!(safe_http_body_excerpt(&large)
            .to_string()
            .contains("logging limit"));
    }

    #[test]
    fn integration_request_details_keep_body_but_omit_credentials_and_query() {
        let request = reqwest::Client::new()
            .post("https://example.invalid/issues?jql=private&token=query-secret")
            .header(reqwest::header::AUTHORIZATION, "Bearer header-secret")
            .json(&serde_json::json!({
                "summary": "Synthetic task",
                "description": "Request details for diagnosis",
                "api_token": "body-secret"
            }))
            .build()
            .unwrap();
        let integration =
            http_request_details(&request, "create_issue", HttpBodyPolicy::Integration).to_string();
        assert!(integration.contains("Synthetic task"));
        assert!(integration.contains("Request details for diagnosis"));
        assert!(!integration.contains("header-secret"));
        assert!(!integration.contains("body-secret"));
        assert!(!integration.contains("query-secret"));
        assert!(!integration.contains("jql=private"));

        let ai = http_request_details(&request, "generation", HttpBodyPolicy::Omit);
        assert!(ai.get("request_body").is_none());
        assert!(!ai.to_string().contains("Synthetic task"));
    }

    #[test]
    fn logs_only_safe_response_headers() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("content-type", "application/json".parse().unwrap());
        headers.insert("x-request-id", "trace-example".parse().unwrap());
        headers.insert("set-cookie", "session=private".parse().unwrap());
        headers.insert("www-authenticate", "Bearer private".parse().unwrap());
        let safe = safe_response_headers(&headers);
        assert_eq!(safe["content-type"], "application/json");
        assert_eq!(safe["x-request-id"], "trace-example");
        assert!(safe.get("set-cookie").is_none());
        assert!(safe.get("www-authenticate").is_none());
    }

    #[test]
    fn ensures_logs_directory_exists_for_fresh_app_data_dir() {
        let app_data_dir = tempfile::tempdir().unwrap();
        let logs_dir = ensure_logs_dir(app_data_dir.path()).unwrap();
        assert!(logs_dir.is_dir());
        assert_eq!(logs_dir.file_name().unwrap(), "logs");
    }

    #[test]
    fn strips_url_credentials_and_query_parameters() {
        assert_eq!(
            safe_url("https://user:pass@example.invalid/path?token=secret"),
            "https://example.invalid/path"
        );
    }
}
