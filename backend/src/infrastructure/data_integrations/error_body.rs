use serde_json::{Map, Value};

// Keep provider error values returned to application/IPC callers on a strict allowlist.
// The shared diagnostics layer separately logs a bounded, secret-redacted body excerpt.
const MAX_BODY_BYTES: usize = 8192;
const MAX_MESSAGE_CHARS: usize = 240;
const REDACTED: &str = "[REDACTED]";

pub async fn read_safe_error_body(mut response: reqwest::Response) -> Option<Value> {
    let status = response.status().as_u16();
    let url = crate::application::logging::safe_url(response.url().as_str());
    let mut bytes = Vec::new();
    let mut truncated = false;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => {
                crate::application::logging::error(
                    "data_integrations",
                    "http_error_body_read_failure",
                    serde_json::json!({"status": status, "url": url}),
                );
                return None;
            }
        };
        let remaining = MAX_BODY_BYTES.saturating_sub(bytes.len());
        if chunk.len() > remaining {
            bytes.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let safe_body = (!truncated).then(|| sanitize_error_body(&bytes)).flatten();
    if truncated {
        crate::application::logging::log_parse_failure(
            "data_integrations",
            "http_error_response",
            "body_truncated",
            &bytes,
        );
    }
    if safe_body.is_none() && !truncated {
        crate::application::logging::log_parse_failure(
            "data_integrations",
            "http_error_response",
            "error_envelope",
            &bytes,
        );
    }
    crate::application::logging::error(
        "data_integrations",
        "http_error_response",
        serde_json::json!({
            "status": status,
            "url": url,
            "body": crate::application::logging::safe_http_body_excerpt(&bytes),
            "body_available": safe_body.is_some(),
            "body_truncated": truncated,
        }),
    );
    safe_body
}

pub fn sanitize_error_body(body: &[u8]) -> Option<Value> {
    if body.len() > MAX_BODY_BYTES {
        return None;
    }
    let value: Value = serde_json::from_slice(body).ok()?;
    let object = value.as_object()?;
    let mut safe = Map::new();
    for field in ["message", "error", "error_description"] {
        if let Some(Value::String(text)) = object.get(field) {
            safe.insert(field.to_owned(), Value::String(safe_text(text)));
        }
    }
    if let Some(Value::Array(messages)) = object.get("errorMessages") {
        let values = messages
            .iter()
            .filter_map(Value::as_str)
            .take(3)
            .map(|value| Value::String(safe_text(value)))
            .collect::<Vec<_>>();
        if !values.is_empty() {
            safe.insert("errorMessages".into(), Value::Array(values));
        }
    }
    if let Some(Value::Array(errors)) = object.get("errors") {
        let values = errors
            .iter()
            .take(3)
            .filter_map(|entry| {
                let message = entry.get("message")?.as_str()?;
                Some(serde_json::json!({"message": safe_text(message)}))
            })
            .collect::<Vec<_>>();
        if !values.is_empty() {
            safe.insert("errors".into(), Value::Array(values));
        }
    } else if let Some(Value::Object(errors)) = object.get("errors") {
        // Jira field-validation errors use an object. Never expose dynamic keys.
        let mut fields = Map::new();
        for field in [
            "summary",
            "description",
            "project",
            "issuetype",
            "assignee",
            "priority",
        ] {
            if let Some(Value::String(message)) = errors.get(field) {
                fields.insert(field.into(), Value::String(safe_text(message)));
            }
        }
        if !fields.is_empty() {
            safe.insert("errors".into(), Value::Object(fields));
        }
    }
    (!safe.is_empty()).then_some(Value::Object(safe))
}

fn safe_text(text: &str) -> String {
    let text = text.trim();
    let lower = text.to_lowercase();
    let forbidden = [
        "token",
        "password",
        "secret",
        "bearer",
        "authorization",
        "cookie",
        "credential",
        "private",
        "session",
        "api key",
    ];
    let allowed = |character: char| {
        character.is_alphabetic()
            || character.is_whitespace()
            || matches!(
                character,
                ' ' | '.' | ',' | '!' | '?' | '-' | '(' | ')' | '\''
            )
    };
    if text.is_empty()
        || text.chars().count() > MAX_MESSAGE_CHARS
        || text
            .chars()
            .any(|character| !allowed(character) || character.is_control())
        || text
            .split_whitespace()
            .any(|word| word.chars().count() > 24)
        || forbidden.iter().any(|marker| lower.contains(marker))
    {
        REDACTED.to_owned()
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_provider_error_messages_but_never_opaque_fields_or_secrets() {
        let body = br#"{"errors":[{"message":"You are not permitted to approve this pull request","exceptionName":"Bearer secret-value"}],"authorization":"Bearer secret-value","errorMessages":["Invalid token: abc.def.ghi"]}"#;
        let safe = sanitize_error_body(body).unwrap();
        assert_eq!(
            safe["errors"][0]["message"],
            "You are not permitted to approve this pull request"
        );
        assert_eq!(safe["errorMessages"][0], REDACTED);
        assert!(!safe.to_string().contains("secret-value"));
        assert!(!safe.to_string().contains("abc.def.ghi"));
        assert!(safe.get("authorization").is_none());
    }

    #[test]
    fn jira_field_errors_keep_only_known_fields_and_safe_messages() {
        let safe = sanitize_error_body(br#"{"errors":{"summary":"Summary is required","customfield_123":"private-value","assignee":"Bearer private-value"}}"#).unwrap();
        assert_eq!(safe["errors"]["summary"], "Summary is required");
        assert_eq!(safe["errors"]["assignee"], REDACTED);
        assert!(!safe.to_string().contains("private-value"));
    }

    #[test]
    fn rejects_html_non_json_and_oversize_bodies() {
        assert_eq!(
            sanitize_error_body(b"<html>Bearer secret-value</html>"),
            None
        );
        assert_eq!(sanitize_error_body(&vec![b'x'; MAX_BODY_BYTES + 1]), None);
        assert_eq!(
            sanitize_error_body(
                br#"{"message":"Unexpected error at https://example.test/?token=secret"}"#
            )
            .unwrap()["message"],
            REDACTED
        );
    }
}
