use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::Duration;
use uuid::Uuid;

use crate::infrastructure::{
    credentials::keyring::{
        CredentialStore, OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
    },
    db::repositories,
};

const SETTINGS_KEY: &str = "ai.voice.providers";
const MAX_AUDIO_BYTES: usize = 10 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const GPT_BASE_URL: &str = "https://api.openai.com/v1";
const GPT_MODEL: &str = "gpt-4o-mini-transcribe";
const SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceProviderKind {
    GptTranscribe,
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredProvider {
    id: String,
    kind: VoiceProviderKind,
    name: String,
    base_url: String,
    model: String,
    credential_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProviderDto {
    pub id: String,
    pub kind: VoiceProviderKind,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceProviderAddRequest {
    pub kind: VoiceProviderKind,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

fn store() -> OsKeyring {
    OsKeyring::new(SERVICE)
}

fn log_add_failure(kind: VoiceProviderKind, stage: &str, reason: &str) {
    let provider_kind = match kind {
        VoiceProviderKind::GptTranscribe => "gpt-transcribe",
        VoiceProviderKind::OpenAiCompatible => "openai-compatible",
    };
    crate::application::logging::error(
        "voice.provider",
        "add_failed",
        serde_json::json!({
            "provider_kind": provider_kind,
            "stage": stage,
            "reason": reason,
        }),
    );
}

fn log_transcription_failure(stage: &str, reason: &str, http_status: Option<u16>) {
    let mut details = serde_json::json!({"stage": stage, "reason": reason});
    if let Some(status) = http_status {
        details["http_status"] = serde_json::json!(status);
    }
    crate::application::logging::error("voice.transcription", "failed", details);
}

async fn load(pool: &SqlitePool) -> Result<Vec<StoredProvider>, String> {
    let value = repositories::get_setting(pool, SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load voice providers".to_owned())?;
    match value {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|_| "voice provider settings are invalid".to_owned())
        }
        None => Ok(Vec::new()),
    }
}

fn is_loopback_url(value: &str) -> bool {
    reqwest::Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
}

fn safe_base_url(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| "Voice provider URL is invalid".to_owned())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path().ends_with("/audio/transcriptions")
    {
        return Err("Voice provider URL is invalid".to_owned());
    }
    let loopback = is_loopback_url(value.trim());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(
            "Voice provider URL must use HTTPS (HTTP is allowed only for loopback)".to_owned(),
        );
    }
    Ok(value.trim().trim_end_matches('/').to_owned())
}

pub async fn add(
    pool: &SqlitePool,
    request: VoiceProviderAddRequest,
) -> Result<Vec<VoiceProviderDto>, String> {
    add_with_store(pool, request, &store()).await
}

async fn add_with_store<S: CredentialStore>(
    pool: &SqlitePool,
    request: VoiceProviderAddRequest,
    credential_store: &S,
) -> Result<Vec<VoiceProviderDto>, String> {
    let kind = request.kind;
    let (base_url, model, name, key_required) = match kind {
        VoiceProviderKind::GptTranscribe => (
            GPT_BASE_URL.to_owned(),
            GPT_MODEL.to_owned(),
            "GPT Transcribe".to_owned(),
            true,
        ),
        VoiceProviderKind::OpenAiCompatible => {
            let url = match safe_base_url(request.base_url.as_deref().unwrap_or_default()) {
                Ok(url) => url,
                Err(error) => {
                    let reason = if error.contains("HTTPS") {
                        "https_required"
                    } else {
                        "invalid_base_url"
                    };
                    log_add_failure(kind, "validation", reason);
                    return Err(error);
                }
            };
            let model = request
                .model
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_owned();
            if model.is_empty() {
                log_add_failure(kind, "validation", "model_missing");
                return Err("Voice provider model is required".to_owned());
            }
            if model.len() > 200 {
                log_add_failure(kind, "validation", "model_too_long");
                return Err("Voice provider model is required".to_owned());
            }
            let key_required = !is_loopback_url(&url);
            (url, model, "OpenAI Compatible".to_owned(), key_required)
        }
    };
    let key = request.api_key.unwrap_or_default();
    if key_required && key.trim().is_empty() {
        log_add_failure(kind, "validation", "api_key_missing");
        return Err("API key is required".to_owned());
    }

    let mut providers = match load(pool).await {
        Ok(providers) => providers,
        Err(error) => {
            log_add_failure(kind, "load_settings", "provider_settings_load_failed");
            return Err(error);
        }
    };
    let id = Uuid::now_v7().to_string();
    let credential_ref = if key.trim().is_empty() {
        None
    } else {
        Some(format!("voice-provider-{id}"))
    };
    providers.push(StoredProvider {
        id,
        kind: request.kind,
        name,
        base_url,
        model,
        credential_ref: credential_ref.clone(),
    });
    let raw = serde_json::to_string(&providers).map_err(|_| {
        log_add_failure(
            kind,
            "serialize_settings",
            "provider_settings_serialize_failed",
        );
        "failed to save voice provider".to_owned()
    })?;
    if repositories::upsert_setting(pool, SETTINGS_KEY, &raw, 1)
        .await
        .is_err()
    {
        log_add_failure(kind, "save_settings", "provider_settings_write_failed");
        return Err("failed to save voice provider".to_owned());
    }
    if let Some(reference) = credential_ref {
        if credential_store.save(&reference, &key).is_err() {
            log_add_failure(kind, "save_keyring", "credential_store_save_failed");
            if credential_store.delete(&reference).is_ok() {
                let mut rollback = providers;
                rollback.retain(|provider| {
                    provider.credential_ref.as_deref() != Some(reference.as_str())
                });
                let rollback_raw = serde_json::to_string(&rollback).map_err(|_| {
                    log_add_failure(
                        kind,
                        "rollback_settings",
                        "provider_settings_serialize_failed",
                    );
                    "failed to roll back voice provider".to_owned()
                })?;
                if repositories::upsert_setting(pool, SETTINGS_KEY, &rollback_raw, 1)
                    .await
                    .is_err()
                {
                    log_add_failure(kind, "rollback_settings", "provider_settings_write_failed");
                    return Err(
                        "API key save failed; the voice provider cleanup is pending".to_owned()
                    );
                }
                return Err("failed to save API key in the operating system keyring".to_owned());
            }
            log_add_failure(kind, "cleanup_keyring", "credential_cleanup_failed");
            return Err("API key save and cleanup failed; remove the pending voice provider to retry keyring cleanup".to_owned());
        }
    }
    Ok(redact(providers))
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<VoiceProviderDto>, String> {
    Ok(redact(load(pool).await?))
}
fn redact(providers: Vec<StoredProvider>) -> Vec<VoiceProviderDto> {
    providers
        .into_iter()
        .map(|p| VoiceProviderDto {
            id: p.id,
            kind: p.kind,
            name: p.name,
            base_url: p.base_url,
            model: p.model,
            has_api_key: p.credential_ref.is_some(),
        })
        .collect()
}

pub async fn delete(pool: &SqlitePool, id: String) -> Result<Vec<VoiceProviderDto>, String> {
    delete_with_store(pool, id, &store()).await
}

async fn delete_with_store<S: CredentialStore>(
    pool: &SqlitePool,
    id: String,
    credential_store: &S,
) -> Result<Vec<VoiceProviderDto>, String> {
    let mut providers = load(pool).await?;
    let old = providers.iter().find(|p| p.id == id).cloned();
    let old = old.ok_or_else(|| "voice provider was not found".to_owned())?;
    if let Some(reference) = old.credential_ref.as_deref() {
        match credential_store.delete(reference) {
            Ok(())
            | Err(crate::infrastructure::credentials::keyring::CredentialError::NotFound) => {}
            Err(_) => {
                return Err("failed to delete API key from the operating system keyring".to_owned())
            }
        }
    }
    providers.retain(|p| p.id != id);
    let raw = serde_json::to_string(&providers)
        .map_err(|_| "failed to delete voice provider".to_owned())?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| "failed to delete voice provider".to_owned())?;
    repositories::upsert_setting(&mut *transaction, SETTINGS_KEY, &raw, 1)
        .await
        .map_err(|_| "failed to delete voice provider".to_owned())?;
    let settings_raw: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?")
            .bind("ai.settings")
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| "failed to clear voice provider selection".to_owned())?;
    let settings = settings_raw
        .as_deref()
        .map(serde_json::from_str::<super::ai::AiSettings>)
        .transpose()
        .map_err(|_| "failed to clear voice provider selection".to_owned())?;
    if let Some(mut settings) = settings
        .filter(|settings| settings.voice_provider_instance_id.as_deref() == Some(id.as_str()))
    {
        settings.voice_provider_instance_id = None;
        let settings_json = serde_json::to_string(&settings)
            .map_err(|_| "failed to clear voice provider selection".to_owned())?;
        repositories::upsert_setting(&mut *transaction, "ai.settings", &settings_json, 3)
            .await
            .map_err(|_| "failed to clear voice provider selection".to_owned())?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| "failed to delete voice provider".to_owned())?;
    Ok(redact(providers))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscribeRequest {
    pub audio: Vec<u8>,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcription {
    pub text: String,
}

pub async fn transcribe(
    pool: &SqlitePool,
    request: TranscribeRequest,
) -> Result<Transcription, String> {
    if request.audio.is_empty() || request.audio.len() > MAX_AUDIO_BYTES {
        let reason = if request.audio.is_empty() {
            "empty_audio"
        } else {
            "audio_too_large"
        };
        log_transcription_failure("validate_request", reason, None);
        return Err("Audio is empty or exceeds the 10 MB limit".to_owned());
    }
    if ![
        "audio/webm",
        "audio/mp4",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
    ]
    .contains(
        &request
            .mime_type
            .split(';')
            .next()
            .unwrap_or_default()
            .trim(),
    ) {
        log_transcription_failure("validate_request", "unsupported_audio_format", None);
        return Err("Audio format is unsupported".to_owned());
    }
    let settings = match super::ai::load(pool).await {
        Ok(settings) => settings,
        Err(error) => {
            log_transcription_failure("load_ai_settings", "settings_unavailable", None);
            return Err(error);
        }
    };
    let selected = match settings.voice_provider_instance_id {
        Some(selected) => selected,
        None => {
            log_transcription_failure("select_provider", "no_provider_selected", None);
            return Err("No voice provider is selected".to_owned());
        }
    };
    let providers = match load(pool).await {
        Ok(providers) => providers,
        Err(error) => {
            log_transcription_failure("load_provider", "provider_settings_unavailable", None);
            return Err(error);
        }
    };
    let provider = match providers.into_iter().find(|p| p.id == selected) {
        Some(provider) => provider,
        None => {
            log_transcription_failure("select_provider", "selected_provider_unavailable", None);
            return Err("Selected voice provider is unavailable".to_owned());
        }
    };
    let token = match provider.credential_ref.as_deref() {
        Some(reference) => match store().load(reference) {
            Ok(token) => Some(token),
            Err(_) => {
                log_transcription_failure("load_api_key", "credential_unavailable", None);
                return Err(
                    "Voice provider API key is unavailable in the operating system keyring"
                        .to_owned(),
                );
            }
        },
        None => None,
    };
    if token.is_none() && !is_loopback_url(&provider.base_url) {
        log_transcription_failure("load_api_key", "credential_missing", None);
        return Err(
            "Voice provider API key is unavailable in the operating system keyring".to_owned(),
        );
    }
    let base = match safe_base_url(&provider.base_url) {
        Ok(base) => base,
        Err(error) => {
            log_transcription_failure("prepare_request", "invalid_provider_base_url", None);
            return Err(error);
        }
    };
    let url = format!("{base}/audio/transcriptions");
    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            log_transcription_failure("prepare_request", "http_client_initialization_failed", None);
            return Err("Unable to initialize transcription request".to_owned());
        }
    };
    let file_name = match request
        .mime_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
    {
        "audio/mp4" => "recording.mp4",
        "audio/ogg" => "recording.ogg",
        "audio/wav" => "recording.wav",
        "audio/mpeg" => "recording.mp3",
        _ => "recording.webm",
    };
    let file = reqwest::multipart::Part::bytes(request.audio)
        .file_name(file_name)
        .mime_str(&request.mime_type)
        .map_err(|_| {
            log_transcription_failure("prepare_request", "unsupported_audio_format", None);
            "Audio format is unsupported".to_owned()
        })?;
    let form = reqwest::multipart::Form::new()
        .text("model", provider.model)
        .part("file", file);
    let mut builder = client.post(url).multipart(form);
    if let Some(token) = token {
        builder = builder.bearer_auth(token);
    }
    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            let reason = if error.is_timeout() {
                "request_timeout"
            } else if error.is_connect() {
                "connection_failed"
            } else {
                "request_transport_failed"
            };
            log_transcription_failure("send_request", reason, None);
            let error_code = if error.is_timeout() {
                "VOICE_STT_TIMEOUT"
            } else if error.is_connect() {
                "VOICE_STT_CONNECTION_FAILED"
            } else {
                "VOICE_STT_TRANSPORT_FAILED"
            };
            return Err(error_code.to_owned());
        }
    };
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let reason = match status {
            401 | 403 => "provider_rejected_api_key",
            402 => "provider_payment_required",
            404 => "model_or_endpoint_not_found",
            400 => "provider_rejected_request",
            300..=399 => "provider_redirect_disallowed",
            _ => "provider_http_error",
        };
        log_transcription_failure("provider_response", reason, Some(status));
        return Err(format!("VOICE_STT_HTTP_{status}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > 1024 * 1024)
    {
        log_transcription_failure("read_response", "response_too_large", None);
        return Err("Voice provider response is too large".to_owned());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        log_transcription_failure("read_response", "response_read_failed", None);
        "Voice provider returned an invalid response".to_owned()
    })? {
        if bytes.len().saturating_add(chunk.len()) > 1024 * 1024 {
            log_transcription_failure("read_response", "response_too_large", None);
            return Err("Voice provider response is too large".to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        log_transcription_failure("parse_response", "invalid_json_response", None);
        "Voice provider returned an invalid response".to_owned()
    })?;
    bytes.fill(0);
    let text = body
        .get("text")
        .and_then(serde_json::Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| {
            log_transcription_failure("parse_response", "transcription_text_missing", None);
            "Voice provider returned no transcription text".to_owned()
        })?;
    Ok(Transcription {
        text: text.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Mutex;
    use wiremock::{
        matchers::{method, path},
        Mock, MockServer, ResponseTemplate,
    };

    #[derive(Default)]
    struct TestCredentialStore {
        delete_fails: bool,
        deleted: Mutex<Vec<String>>,
    }

    impl CredentialStore for TestCredentialStore {
        fn save(
            &self,
            _credential_ref: &str,
            _secret: &str,
        ) -> Result<(), crate::infrastructure::credentials::keyring::CredentialError> {
            Ok(())
        }

        fn load(
            &self,
            _credential_ref: &str,
        ) -> Result<String, crate::infrastructure::credentials::keyring::CredentialError> {
            Err(crate::infrastructure::credentials::keyring::CredentialError::NotFound)
        }

        fn delete(
            &self,
            credential_ref: &str,
        ) -> Result<(), crate::infrastructure::credentials::keyring::CredentialError> {
            if self.delete_fails {
                return Err(crate::infrastructure::credentials::keyring::CredentialError::Backend);
            }
            self.deleted.lock().unwrap().push(credential_ref.to_owned());
            Ok(())
        }
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn provider_kind_serde_matches_frontend_contract() {
        assert_eq!(
            serde_json::from_str::<VoiceProviderKind>("\"openai-compatible\"").unwrap(),
            VoiceProviderKind::OpenAiCompatible
        );
        assert_eq!(
            serde_json::to_string(&VoiceProviderKind::OpenAiCompatible).unwrap(),
            "\"openai-compatible\""
        );
        assert_eq!(
            serde_json::to_string(&VoiceProviderKind::GptTranscribe).unwrap(),
            "\"gpt-transcribe\""
        );
    }

    #[test]
    fn compatible_base_url_accepts_https_and_loopback_only() {
        assert_eq!(
            safe_base_url("https://voice.example.com/v1").unwrap(),
            "https://voice.example.com/v1"
        );
        assert!(safe_base_url("http://127.0.0.1:8080/v1").is_ok());
        for unsafe_url in [
            "http://voice.example.com/v1",
            "https://user@voice.example.com/v1",
            "https://voice.example.com/v1?token=x",
            "https://voice.example.com/v1#fragment",
        ] {
            assert!(safe_base_url(unsafe_url).is_err());
        }
    }

    #[tokio::test]
    async fn keyring_delete_failure_keeps_provider_config_and_selection_retryable() {
        let pool = test_pool().await;
        let id = "voice-example";
        let providers = vec![StoredProvider {
            id: id.to_owned(),
            kind: VoiceProviderKind::OpenAiCompatible,
            name: "Example voice".to_owned(),
            base_url: "https://voice.example.invalid/v1".to_owned(),
            model: "example-model".to_owned(),
            credential_ref: Some("opaque-credential-ref".to_owned()),
        }];
        repositories::upsert_setting(
            &pool,
            SETTINGS_KEY,
            &serde_json::to_string(&providers).unwrap(),
            1,
        )
        .await
        .unwrap();
        let mut settings = super::super::ai::AiSettings::default();
        settings.voice_provider_instance_id = Some(id.to_owned());
        repositories::upsert_setting(
            &pool,
            "ai.settings",
            &serde_json::to_string(&settings).unwrap(),
            3,
        )
        .await
        .unwrap();

        let result = delete_with_store(
            &pool,
            id.to_owned(),
            &TestCredentialStore {
                delete_fails: true,
                ..Default::default()
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(list(&pool).await.unwrap().len(), 1);
        assert_eq!(
            super::super::ai::load(&pool)
                .await
                .unwrap()
                .voice_provider_instance_id
                .as_deref(),
            Some(id)
        );
    }

    #[tokio::test]
    async fn remote_compatible_provider_requires_an_api_key() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let result = add(
            &pool,
            VoiceProviderAddRequest {
                kind: VoiceProviderKind::OpenAiCompatible,
                base_url: Some("https://voice.example.invalid/v1".to_owned()),
                model: Some("example-model".to_owned()),
                api_key: None,
            },
        )
        .await;
        assert_eq!(result.unwrap_err(), "API key is required");
    }

    #[tokio::test]
    async fn selected_loopback_provider_transcribes_and_delete_clears_selection() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')")
            .execute(&pool)
            .await
            .unwrap();

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/audio/transcriptions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"text":"Example transcript"})),
            )
            .expect(1)
            .mount(&server)
            .await;

        let providers = add(
            &pool,
            VoiceProviderAddRequest {
                kind: VoiceProviderKind::OpenAiCompatible,
                base_url: Some(format!("{}/v1", server.uri())),
                model: Some("example-model".to_owned()),
                api_key: None,
            },
        )
        .await
        .unwrap();
        let provider_id = providers[0].id.clone();
        let mut settings = super::super::ai::AiSettings::default();
        settings.voice_provider_instance_id = Some(provider_id.clone());
        let settings_json = serde_json::to_string(&settings).unwrap();
        repositories::upsert_setting(&pool, "ai.settings", &settings_json, 3)
            .await
            .unwrap();

        let result = transcribe(
            &pool,
            TranscribeRequest {
                audio: b"synthetic audio".to_vec(),
                mime_type: "audio/webm".to_owned(),
            },
        )
        .await
        .unwrap();
        assert_eq!(result.text, "Example transcript");

        delete(&pool, provider_id).await.unwrap();
        assert_eq!(
            super::super::ai::load(&pool)
                .await
                .unwrap()
                .voice_provider_instance_id,
            None
        );
    }

    #[tokio::test]
    async fn provider_auth_errors_do_not_expose_upstream_body() {
        let pool = test_pool().await;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/audio/transcriptions"))
            .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "error": "example upstream error detail"
            })))
            .expect(1)
            .mount(&server)
            .await;
        let providers = add(
            &pool,
            VoiceProviderAddRequest {
                kind: VoiceProviderKind::OpenAiCompatible,
                base_url: Some(format!("{}/v1", server.uri())),
                model: Some("example-model".to_owned()),
                api_key: None,
            },
        )
        .await
        .unwrap();
        let mut settings = super::super::ai::AiSettings::default();
        settings.voice_provider_instance_id = Some(providers[0].id.clone());
        repositories::upsert_setting(
            &pool,
            "ai.settings",
            &serde_json::to_string(&settings).unwrap(),
            3,
        )
        .await
        .unwrap();

        let error = transcribe(
            &pool,
            TranscribeRequest {
                audio: b"synthetic audio".to_vec(),
                mime_type: "audio/webm".to_owned(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error, "VOICE_STT_HTTP_401");
        assert!(!error.contains("example upstream error detail"));
    }

    #[test]
    fn provider_dto_redacts_credential_reference() {
        let providers = redact(vec![StoredProvider {
            id: "synthetic-id".to_owned(),
            kind: VoiceProviderKind::OpenAiCompatible,
            name: "Example voice".to_owned(),
            base_url: "https://voice.example.com/v1".to_owned(),
            model: "example-model".to_owned(),
            credential_ref: Some("secret-key-reference".to_owned()),
        }]);
        let serialized = serde_json::to_string(&providers).unwrap();
        assert!(serialized.contains("\"hasApiKey\":true"));
        assert!(!serialized.contains("secret-key-reference"));
    }
}
