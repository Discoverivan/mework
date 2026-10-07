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
const MAX_TOTAL_LOG_BYTES: u64 = 100 * 1024 * 1024;
const MAX_ENTRY_CHARS: usize = 8_000;
const MAX_HTTP_BODY_BYTES: usize = 8_192;
static LOG_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Copy)]
struct LogPolicy {
    enabled: bool,
    max_bytes: Option<u64>,
}
static LOG_POLICY: Mutex<LogPolicy> = Mutex::new(LogPolicy {
    enabled: false,
    max_bytes: Some(MAX_TOTAL_LOG_BYTES),
});

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
    let _ = LOG_DIRECTORY.set(logs_dir.clone());
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

#[derive(Debug)]
pub struct LoggedJsonResponseError;

pub async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
    component: &str,
    operation: &str,
) -> Result<T, LoggedJsonResponseError> {
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(_) => {
            error(
                component,
                "response_body_read_failure",
                serde_json::json!({"operation": operation}),
            );
            return Err(LoggedJsonResponseError);
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
            Err(LoggedJsonResponseError)
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
    let response = request.send().await.inspect_err(|error| {
        error_log_http_transport(component, operation, diagnostic.as_ref(), error);
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
    let response = client.execute(request).await.inspect_err(|error| {
        error_log_http_transport(component, operation, None, error);
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
            let Some(delimiter) = tail.find(['=', ':']) else {
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
    let Some(directory) = LOG_DIRECTORY.get() else {
        return;
    };
    let Ok(_guard) = LOG_LOCK.lock() else { return };
    let Ok(policy) = LOG_POLICY.lock().map(|policy| *policy) else {
        return;
    };
    if !policy.enabled {
        return;
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
    if append_record(
        directory,
        &line,
        local_time(time::OffsetDateTime::now_utc()),
        policy.max_bytes,
    )
    .is_err()
    {
        eprintln!("Application log write failed");
    }
}

fn local_time(instant: time::OffsetDateTime) -> time::OffsetDateTime {
    instant.to_offset(time::UtcOffset::local_offset_at(instant).unwrap_or(time::UtcOffset::UTC))
}

fn modified_at(metadata: &fs::Metadata) -> std::io::Result<time::OffsetDateTime> {
    Ok(metadata.modified()?.into())
}

fn dated_log(name: &str) -> Option<(time::Date, u32)> {
    let middle = name.strip_prefix("application.")?.strip_suffix(".log")?;
    let (date, sequence) = middle.split_once('.')?;
    let parts: Vec<_> = date.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return None;
    }
    let date = time::Date::from_calendar_date(
        parts[0].parse().ok()?,
        time::Month::try_from(parts[1].parse::<u8>().ok()?).ok()?,
        parts[2].parse().ok()?,
    )
    .ok()?;
    if sequence.is_empty() || !sequence.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let sequence = sequence.parse::<u32>().ok()?;
    (sequence > 0).then_some((date, sequence))
}

fn is_legacy_log(name: &str) -> bool {
    matches!(name, "application.log" | "application.log.1")
}

fn append_record(
    directory: &Path,
    line: &str,
    now: time::OffsetDateTime,
    max_bytes: Option<u64>,
) -> std::io::Result<()> {
    let bytes = line.len() as u64 + 1;
    let file_limit = max_bytes.unwrap_or(MAX_LOG_BYTES).min(MAX_LOG_BYTES);
    if bytes > file_limit {
        return Err(std::io::Error::other("log entry exceeds file limit"));
    }
    let date = now.date();
    let mut latest = None;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if let Some((day, sequence)) = entry.file_name().to_str().and_then(dated_log) {
            if day == date && latest.as_ref().is_none_or(|(last, _)| sequence > *last) {
                latest = Some((sequence, entry.path()));
            }
        }
    }
    let (sequence, path) = latest.unwrap_or((0, directory.to_path_buf()));
    let append = if sequence > 0 {
        let metadata = fs::symlink_metadata(&path)?;
        metadata.file_type().is_file() && metadata.len().saturating_add(bytes) <= file_limit
    } else {
        false
    };
    let (path, mut file) = if append {
        let file = OpenOptions::new().append(true).open(&path)?;
        (path, file)
    } else {
        let next = sequence
            .checked_add(1)
            .ok_or_else(|| std::io::Error::other("log sequence exhausted"))?;
        let path = directory.join(format!("application.{date}.{next:03}.log"));
        let file = OpenOptions::new()
            .create_new(true)
            .append(true)
            .open(&path)?;
        (path, file)
    };
    writeln!(file, "{line}")?;
    drop(file);
    // The budget includes the actual size of today's active part.
    prune_logs(directory, None, max_bytes, Some(&path))
}

fn prune_logs(
    directory: &Path,
    cutoff: Option<time::OffsetDateTime>,
    budget: Option<u64>,
    active: Option<&Path>,
) -> std::io::Result<()> {
    if cutoff.is_none() && budget.is_none() {
        return Ok(());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        // Never follow symlinks or touch unrelated diagnostics files.
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let dated = dated_log(name);
        if dated.is_none() && !is_legacy_log(name) {
            continue;
        }
        let metadata = entry.metadata()?;
        let modified = modified_at(&metadata)?;
        let (date, sequence) = dated.unwrap_or((local_time(modified).date(), 0));
        let expired = cutoff.is_some_and(|cutoff| {
            if dated.is_some() {
                // Names own the day; mtime only refines the boundary day for
                // retention periods configured in minutes or hours.
                date < cutoff.date() || (date == cutoff.date() && modified < cutoff)
            } else {
                modified < cutoff
            }
        });
        if active != Some(entry.path().as_path()) && expired {
            fs::remove_file(entry.path())?;
        } else {
            files.push((date, sequence, modified, entry.path(), metadata.len()));
        }
    }
    files.sort_by(|left, right| {
        (&left.0, &left.1, &left.2, &left.3).cmp(&(&right.0, &right.1, &right.2, &right.3))
    });
    let mut total: u64 = files.iter().map(|file| file.4).sum();
    for (_, _, _, path, size) in files {
        if budget != Some(0) && budget.is_none_or(|budget| total <= budget) {
            break;
        }
        if active == Some(path.as_path()) {
            continue;
        }
        fs::remove_file(path)?;
        total -= size;
    }
    Ok(())
}

fn remove_logs(directory: &Path) -> std::io::Result<()> {
    prune_logs(directory, None, Some(0), None)
}

pub fn configure(
    enabled: bool,
    max_bytes: Option<u64>,
    cutoff: Option<time::OffsetDateTime>,
) -> std::io::Result<()> {
    let _guard = LOG_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("log lock poisoned"))?;
    *LOG_POLICY
        .lock()
        .map_err(|_| std::io::Error::other("log policy lock poisoned"))? =
        LogPolicy { enabled, max_bytes };
    let Some(directory) = LOG_DIRECTORY.get() else {
        return Ok(());
    };
    if enabled {
        prune_logs(directory, cutoff.map(local_time), max_bytes, None)
    } else {
        remove_logs(directory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_daily_parts_resumes_them_and_prunes_by_date_and_total_size() {
        let directory = tempfile::tempdir().unwrap();
        let directory = directory.path();
        // Local midnight has passed while the UTC date is still yesterday.
        let offset = time::UtcOffset::from_hms(3, 0, 0).unwrap();
        let now = time::Date::from_calendar_date(2026, time::Month::October, 8)
            .unwrap()
            .with_hms(0, 30, 0)
            .unwrap()
            .assume_offset(offset);
        let current = directory.join("application.2026-10-08.001.log");
        append_record(directory, "first", now, None).unwrap();
        append_record(directory, "after restart", now, None).unwrap();
        assert_eq!(
            fs::read_to_string(&current).unwrap(),
            "first\nafter restart\n"
        );
        fs::File::options()
            .write(true)
            .open(&current)
            .unwrap()
            .set_len(MAX_LOG_BYTES)
            .unwrap();
        append_record(directory, "next part", now, None).unwrap();
        let next = directory.join("application.2026-10-08.002.log");
        assert_eq!(fs::read_to_string(&next).unwrap(), "next part\n");
        append_record(directory, "continued", now, Some(MAX_TOTAL_LOG_BYTES)).unwrap();
        assert_eq!(fs::read_to_string(&next).unwrap(), "next part\ncontinued\n");
        let tomorrow = now + time::Duration::days(1);
        append_record(directory, "next day", tomorrow, None).unwrap();
        let latest = directory.join("application.2026-10-09.001.log");
        assert_eq!(fs::read_to_string(&latest).unwrap(), "next day\n");
        // Even a newly modified old file expires by its named date.
        let expired = directory.join("application.2026-09-01.001.log");
        fs::write(&expired, "expired\n").unwrap();
        let legacy = directory.join("application.log.1");
        fs::write(&legacy, "legacy\n").unwrap();
        fs::File::options()
            .write(true)
            .open(&legacy)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified((now - time::Duration::days(8)).into()))
            .unwrap();
        let unrelated = directory.join("support.log");
        fs::write(&unrelated, "keep\n").unwrap();
        prune_logs(directory, Some(now - time::Duration::days(7)), None, None).unwrap();
        assert!(!expired.exists());
        assert!(!legacy.exists());
        assert!(current.exists());
        prune_logs(directory, None, Some(100), None).unwrap();
        assert!(!current.exists());
        assert!(next.exists());
        assert!(latest.exists());
        assert!(!directory.join("application.log").exists());
        let empty = directory.join("application.2026-10-09.002.log");
        fs::write(&empty, "").unwrap();
        remove_logs(directory).unwrap();
        assert!(!empty.exists());
        assert!(!next.exists());
        assert!(!latest.exists());
        assert!(unrelated.exists());
    }

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
