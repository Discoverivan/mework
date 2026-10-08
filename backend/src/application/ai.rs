use super::ai_providers::cli;
pub use cli::{ai_cli_candidate_diagnostics, AiCliCandidateDiagnostic};

use std::{future::Future, time::Duration};

use serde::{Deserialize, Serialize};

use crate::application::logging::HttpRequestBuilderExt;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::infrastructure::{
    credentials::keyring::{
        CredentialError, CredentialStore, OsKeyring, DEV_KEYRING_SERVICE,
        PRODUCTION_KEYRING_SERVICE,
    },
    db::repositories,
};

const AI_SETTINGS_KEY: &str = "ai.settings";
const AI_SETTINGS_SCHEMA_VERSION: i64 = 3;
pub const MAX_AI_RETRIES: u8 = 10;
const OPENAI_COMPATIBLE_SETTINGS_KEY: &str = "ai.openai-compatible";
const OPENAI_COMPATIBLE_SETTINGS_SCHEMA_VERSION: i64 = 1;
const OPENAI_COMPATIBLE_CREDENTIAL_REF: &str = "ai-openai-compatible";
const OPENAI_INSTANCES_KEY: &str = "ai.openai-compatible.instances";
const ADDED_CLI_PROVIDERS_KEY: &str = "ai.providers.added";

const AI_KEYRING_SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OpenAiCompatibleProviderConfig {
    #[serde(default)]
    id: String,
    base_url: String,
    #[serde(default)]
    alias: String,
    credential_ref: String,
    #[serde(default)]
    allow_insecure_tls: bool,
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleRuntimeConfig {
    pub base_url: String,
    pub token: String,
    pub allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleProviderSaveRequest {
    pub id: Option<String>,
    pub base_url: String,
    #[serde(default)]
    pub alias: String,
    pub token: String,
    #[serde(default)]
    pub allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AiProviderId {
    CodexCli,
    ClaudeCodeCli,
    OpenCodeCli,
    HermesCli,
    PiCli,
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiReasoning {
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl AiReasoning {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: Option<AiProviderId>,
    #[serde(default)]
    pub provider_instance_id: Option<String>,
    pub model: String,
    pub reasoning: AiReasoning,
    pub fast_mode: bool,
    #[serde(default)]
    pub task_creation: Option<AiSettingsProfile>,
    #[serde(default)]
    pub pull_request_review: Option<AiSettingsProfile>,
    #[serde(default)]
    pub token_burner: Option<AiSettingsProfile>,
    #[serde(default)]
    pub sprint_summary: Option<AiSettingsProfile>,
    #[serde(default)]
    pub retries: AiRetrySettings,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiRetrySettings {
    #[serde(default)]
    pub default: u8,
    #[serde(default)]
    pub actions: AiActionRetries,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiActionRetries {
    #[serde(default)]
    pub task_creation: Option<u8>,
    #[serde(default)]
    pub pull_request_review: Option<u8>,
    #[serde(default)]
    pub token_burner: Option<u8>,
    #[serde(default)]
    pub sprint_summary: Option<u8>,
}

impl AiRetrySettings {
    pub fn for_activity(&self, activity: AiActivity) -> u8 {
        let override_value = match activity {
            AiActivity::TaskCreation => self.actions.task_creation,
            AiActivity::PullRequestReview => self.actions.pull_request_review,
            AiActivity::TokenBurner => self.actions.token_burner,
            AiActivity::SprintSummary => self.actions.sprint_summary,
        };
        override_value.unwrap_or(self.default)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsProfile {
    pub provider: AiProviderId,
    #[serde(default)]
    pub provider_instance_id: Option<String>,
    pub model: String,
    pub reasoning: AiReasoning,
    pub fast_mode: bool,
}

impl AiSettings {
    fn normalize_action_retries(&mut self) -> bool {
        let previous = self.retries.clone();
        let default = self.retries.default;
        for (profile, retries) in [
            (
                self.task_creation.as_ref(),
                &mut self.retries.actions.task_creation,
            ),
            (
                self.pull_request_review.as_ref(),
                &mut self.retries.actions.pull_request_review,
            ),
            (
                self.token_burner.as_ref(),
                &mut self.retries.actions.token_burner,
            ),
            (
                self.sprint_summary.as_ref(),
                &mut self.retries.actions.sprint_summary,
            ),
        ] {
            *retries = profile.map(|_| retries.unwrap_or(default));
        }
        self.retries != previous
    }
}

impl AiSettingsProfile {
    fn apply_to(&self, settings: &mut AiSettings) {
        settings.provider = Some(self.provider);
        settings.provider_instance_id = self.provider_instance_id.clone();
        settings.model = self.model.clone();
        settings.reasoning = self.reasoning;
        settings.fast_mode = self.fast_mode;
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: None,
            provider_instance_id: None,
            model: String::new(),
            reasoning: AiReasoning::Medium,
            fast_mode: false,
            task_creation: None,
            pull_request_review: None,
            token_burner: None,
            sprint_summary: None,
            retries: AiRetrySettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderStatus {
    Loading,
    Connected,
    NotConfigured,
    NotFound,
    NotAuthenticated,
    Unavailable,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderDto {
    pub id: AiProviderId,
    #[serde(default)]
    pub instance_id: Option<String>,
    pub name: String,
    pub status: AiProviderStatus,
    pub available: bool,
    pub models: Vec<String>,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub base_url: Option<String>,
    pub allow_insecure_tls: Option<bool>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsPageDto {
    pub settings: AiSettings,
    pub providers: Vec<AiProviderDto>,
}

pub async fn initialize_mock_cli_providers(pool: &SqlitePool) -> Result<(), String> {
    let cli_providers = [
        AiProviderId::CodexCli,
        AiProviderId::ClaudeCodeCli,
        AiProviderId::OpenCodeCli,
        AiProviderId::HermesCli,
        AiProviderId::PiCli,
    ];
    let providers_json = serde_json::to_string(&cli_providers)
        .map_err(|_| "failed to initialize mock AI providers".to_owned())?;
    repositories::upsert_setting(pool, ADDED_CLI_PROVIDERS_KEY, &providers_json, 1)
        .await
        .map_err(|_| "failed to initialize mock AI providers".to_owned())?;

    let providers = dto(pool).await?.providers;
    let settings = default_mock_ai_settings(&providers);
    let settings_json = serde_json::to_string(&settings)
        .map_err(|_| "failed to initialize mock AI settings".to_owned())?;
    repositories::upsert_setting(
        pool,
        AI_SETTINGS_KEY,
        &settings_json,
        AI_SETTINGS_SCHEMA_VERSION,
    )
    .await
    .map_err(|_| "failed to initialize mock AI settings".to_owned())
}

fn default_mock_ai_settings(providers: &[AiProviderDto]) -> AiSettings {
    let selected = [
        AiProviderId::CodexCli,
        AiProviderId::ClaudeCodeCli,
        AiProviderId::OpenCodeCli,
        AiProviderId::HermesCli,
        AiProviderId::PiCli,
    ]
    .into_iter()
    .find_map(|id| {
        providers.iter().find(|provider| {
            provider.id == id
                && provider.available
                && provider.status == AiProviderStatus::Connected
                && !provider.models.is_empty()
        })
    });
    let mut settings = AiSettings::default();
    if let Some(provider) = selected {
        settings.provider = Some(provider.id);
        settings.model = provider.models[0].clone();
    }
    settings
}

pub async fn load(pool: &SqlitePool) -> Result<AiSettings, String> {
    let stored = repositories::get_setting(pool, AI_SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load AI settings".to_owned())?;
    let mut settings = stored
        .as_deref()
        .and_then(|raw| serde_json::from_str::<AiSettings>(raw).ok())
        .unwrap_or_default();
    let has_retry_settings = stored
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| value.get("retries").cloned())
        .is_some();
    if !has_retry_settings && stored.is_some() {
        let legacy_attempts = crate::application::general::load(pool)
            .await?
            .ai_review_attempts;
        settings.retries.actions.pull_request_review =
            Some(legacy_attempts.saturating_sub(1).min(MAX_AI_RETRIES));
    }
    let normalized = settings.normalize_action_retries();
    if !has_retry_settings || normalized {
        let value = serde_json::to_string(&settings)
            .map_err(|_| "failed to migrate AI retry settings".to_owned())?;
        repositories::upsert_setting(pool, AI_SETTINGS_KEY, &value, AI_SETTINGS_SCHEMA_VERSION)
            .await
            .map_err(|_| "failed to migrate AI retry settings".to_owned())?;
    }
    Ok(settings)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiSettingsScope {
    Default,
    TaskCreation,
    PullRequestReview,
    TokenBurner,
    SprintSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiSettingsField {
    Provider,
    Model,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsSaveError {
    pub message: String,
    pub scope: Option<AiSettingsScope>,
    pub field: Option<AiSettingsField>,
}

impl From<String> for AiSettingsSaveError {
    fn from(message: String) -> Self {
        Self {
            message,
            scope: None,
            field: None,
        }
    }
}

impl AiSettingsSaveError {
    fn field(scope: AiSettingsScope, field: AiSettingsField) -> Self {
        let message = match field {
            AiSettingsField::Provider => "Selected AI provider is unavailable",
            AiSettingsField::Model => "Selected AI model is invalid",
        }
        .to_owned();
        Self {
            message,
            scope: Some(scope),
            field: Some(field),
        }
    }
}

pub async fn save(pool: &SqlitePool, mut settings: AiSettings) -> Result<(), AiSettingsSaveError> {
    settings.normalize_action_retries();
    validate_settings(pool, &settings).await?;
    let value = serde_json::to_string(&settings)
        .map_err(|_| "failed to serialize AI settings".to_owned())?;
    repositories::upsert_setting(pool, AI_SETTINGS_KEY, &value, AI_SETTINGS_SCHEMA_VERSION)
        .await
        .map_err(|_| AiSettingsSaveError::from("failed to save AI settings".to_owned()))
}

pub async fn save_openai_compatible_provider(
    pool: &SqlitePool,
    request: OpenAiCompatibleProviderSaveRequest,
) -> Result<AiSettingsPageDto, String> {
    let base_url = normalize_openai_base_url(&request.base_url)?;
    let alias = request.alias.trim();
    if alias.chars().count() > 80 || alias.chars().any(char::is_control) {
        return Err("AI provider alias is invalid".to_owned());
    }
    let mut configs = load_openai_configs(pool).await?;
    let id = request
        .id
        .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    let existing = configs.iter().find(|config| config.id == id);
    if existing.is_none() && uuid::Uuid::parse_str(&id).is_err() {
        return Err("AI provider ID is invalid".to_owned());
    }
    let credential_ref = existing
        .map(|config| config.credential_ref.clone())
        .unwrap_or_else(|| format!("{OPENAI_COMPATIBLE_CREDENTIAL_REF}-{id}"));
    let credential_store = openai_credential_store();
    let token = if request.token.trim().is_empty() {
        if existing.is_none() {
            return Err("Token is required".to_owned());
        }
        credential_store.load(&credential_ref).map_err(|_| {
            "OpenAI-compatible API token is unavailable in the operating system keyring".to_owned()
        })?
    } else {
        request.token.clone()
    };
    let models = load_openai_models(&base_url, &token, request.allow_insecure_tls).await?;
    if models.is_empty() {
        crate::application::logging::log_business_failure(
            "ai.openai_compatible",
            "model_catalog",
            "empty_model_list",
            "successful response did not include any available models",
        );
        return Err("Authorization succeeded, but the API returned no models".to_owned());
    }
    if !request.token.trim().is_empty() {
        credential_store
            .save(&credential_ref, &request.token)
            .map_err(|_| "failed to save token in the operating system keyring".to_owned())?;
    }
    let config = OpenAiCompatibleProviderConfig {
        id: id.clone(),
        base_url,
        alias: alias.to_owned(),
        credential_ref,
        allow_insecure_tls: request.allow_insecure_tls,
    };
    let value = serde_json::to_string(&config)
        .map_err(|_| "failed to serialize OpenAI-compatible API settings".to_owned())?;
    let config_key = if id == "legacy" {
        OPENAI_COMPATIBLE_SETTINGS_KEY.to_owned()
    } else {
        format!("{OPENAI_COMPATIBLE_SETTINGS_KEY}.{id}")
    };
    repositories::upsert_setting(
        pool,
        &config_key,
        &value,
        OPENAI_COMPATIBLE_SETTINGS_SCHEMA_VERSION,
    )
    .await
    .map_err(|_| "failed to save OpenAI-compatible API settings".to_owned())?;
    if !configs.iter().any(|config| config.id == id) {
        configs.push(config);
        let ids: Vec<&str> = configs
            .iter()
            .filter(|config| config.id != "legacy")
            .map(|config| config.id.as_str())
            .collect();
        let value = serde_json::to_string(&ids)
            .map_err(|_| "failed to serialize AI providers".to_owned())?;
        repositories::upsert_setting(pool, OPENAI_INSTANCES_KEY, &value, 1)
            .await
            .map_err(|_| "failed to save AI providers".to_owned())?;
    }

    dto(pool).await
}

pub async fn dto(pool: &SqlitePool) -> Result<AiSettingsPageDto, String> {
    let settings = load(pool).await?;
    let configs = load_openai_configs(pool).await?;
    let mut providers = Vec::new();
    let added_cli = load_added_cli_providers(pool).await?;
    let show_cli = |id| {
        added_cli.contains(&id)
            || settings.provider == Some(id)
            || [
                &settings.task_creation,
                &settings.pull_request_review,
                &settings.token_burner,
                &settings.sprint_summary,
            ]
            .into_iter()
            .any(|profile| {
                profile
                    .as_ref()
                    .is_some_and(|profile| profile.provider == id)
            })
    };
    let (codex, claude, opencode, hermes, pi) = tokio::join!(
        async {
            if show_cli(AiProviderId::CodexCli) {
                Some(tokio::task::spawn_blocking(cli::codex::inspect_codex_cli).await)
            } else {
                None
            }
        },
        async {
            if show_cli(AiProviderId::ClaudeCodeCli) {
                Some(tokio::task::spawn_blocking(cli::claude_code::inspect).await)
            } else {
                None
            }
        },
        async {
            if show_cli(AiProviderId::OpenCodeCli) {
                Some(tokio::task::spawn_blocking(cli::opencode::inspect).await)
            } else {
                None
            }
        },
        async {
            if show_cli(AiProviderId::HermesCli) {
                Some(tokio::task::spawn_blocking(cli::hermes_cli::inspect).await)
            } else {
                None
            }
        },
        async {
            if show_cli(AiProviderId::PiCli) {
                Some(tokio::task::spawn_blocking(cli::pi::inspect).await)
            } else {
                None
            }
        },
    );
    if let Some(result) = codex {
        providers.push(result.map_err(|_| "failed to inspect Codex CLI".to_owned())?);
    }
    if let Some(result) = claude {
        providers.push(result.map_err(|_| "failed to inspect Claude Code CLI".to_owned())?);
    }
    if let Some(result) = opencode {
        providers.push(result.map_err(|_| "failed to inspect OpenCode CLI".to_owned())?);
    }
    if let Some(result) = hermes {
        providers.push(result.map_err(|_| "failed to inspect Hermes CLI".to_owned())?);
    }
    if let Some(result) = pi {
        providers.push(result.map_err(|_| "failed to inspect Pi CLI".to_owned())?);
    }
    for config in configs {
        providers.push(inspect_openai_compatible(config).await);
    }
    Ok(AiSettingsPageDto {
        settings,
        providers,
    })
}

async fn load_added_cli_providers(pool: &SqlitePool) -> Result<Vec<AiProviderId>, String> {
    let value = repositories::get_setting(pool, ADDED_CLI_PROVIDERS_KEY)
        .await
        .map_err(|_| "failed to load AI providers".to_owned())?;
    Ok(value
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default())
}

pub async fn add_cli_provider(
    pool: &SqlitePool,
    provider: AiProviderId,
) -> Result<AiSettingsPageDto, String> {
    if provider == AiProviderId::OpenAiCompatible {
        return Err("Select an API URL to add this provider".to_owned());
    }
    let inspected = inspect_cli_candidate(provider).await?;
    if !inspected.available
        || inspected.status != AiProviderStatus::Connected
        || inspected.models.is_empty()
    {
        return Err(inspected
            .message
            .unwrap_or_else(|| "Selected CLI provider is unavailable".to_owned()));
    }
    let mut added = load_added_cli_providers(pool).await?;
    if !added.contains(&provider) {
        added.push(provider);
        let value = serde_json::to_string(&added)
            .map_err(|_| "failed to serialize AI providers".to_owned())?;
        repositories::upsert_setting(pool, ADDED_CLI_PROVIDERS_KEY, &value, 1)
            .await
            .map_err(|_| "failed to save AI providers".to_owned())?;
    }
    dto(pool).await
}

pub async fn inspect_cli_candidate(provider: AiProviderId) -> Result<AiProviderDto, String> {
    match provider {
        AiProviderId::CodexCli => tokio::task::spawn_blocking(cli::codex::inspect_codex_cli)
            .await
            .map_err(|_| "failed to inspect Codex CLI".to_owned()),
        AiProviderId::ClaudeCodeCli => tokio::task::spawn_blocking(cli::claude_code::inspect)
            .await
            .map_err(|_| "failed to inspect Claude Code CLI".to_owned()),
        AiProviderId::OpenCodeCli => tokio::task::spawn_blocking(cli::opencode::inspect)
            .await
            .map_err(|_| "failed to inspect OpenCode CLI".to_owned()),
        AiProviderId::HermesCli => tokio::task::spawn_blocking(cli::hermes_cli::inspect)
            .await
            .map_err(|_| "failed to inspect Hermes CLI".to_owned()),
        AiProviderId::PiCli => tokio::task::spawn_blocking(cli::pi::inspect)
            .await
            .map_err(|_| "failed to inspect Pi CLI".to_owned()),
        AiProviderId::OpenAiCompatible => Err("Select a CLI provider".to_owned()),
    }
}

pub async fn delete_provider(
    pool: &SqlitePool,
    provider: AiProviderId,
    instance_id: Option<String>,
) -> Result<AiSettingsPageDto, String> {
    let mut settings = load(pool).await?;
    let mut changed = false;
    let matches_provider = |selected_provider: Option<AiProviderId>,
                            selected_instance: Option<&str>| {
        selected_provider == Some(provider)
            && (provider != AiProviderId::OpenAiCompatible
                || selected_instance.unwrap_or("legacy")
                    == instance_id.as_deref().unwrap_or("legacy"))
    };
    if matches_provider(settings.provider, settings.provider_instance_id.as_deref()) {
        settings.provider = None;
        settings.provider_instance_id = None;
        settings.model.clear();
        changed = true;
    }
    for profile in [
        &mut settings.task_creation,
        &mut settings.pull_request_review,
        &mut settings.token_burner,
        &mut settings.sprint_summary,
    ] {
        if profile.as_ref().is_some_and(|item| {
            matches_provider(Some(item.provider), item.provider_instance_id.as_deref())
        }) {
            *profile = None;
            changed = true;
        }
    }

    let configs = if provider == AiProviderId::OpenAiCompatible {
        Some(load_openai_configs(pool).await?)
    } else {
        None
    };
    let added_cli = if provider != AiProviderId::OpenAiCompatible {
        Some(load_added_cli_providers(pool).await?)
    } else {
        None
    };
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "failed to delete AI provider".to_owned())?;
    if provider == AiProviderId::OpenAiCompatible {
        let id = instance_id.ok_or_else(|| "AI provider ID is required".to_owned())?;
        let configs = configs.as_ref().expect("OpenAI configurations were loaded");
        let config = configs
            .iter()
            .find(|config| config.id == id)
            .ok_or_else(|| "AI provider was not found".to_owned())?;
        if id == "legacy" {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(OPENAI_COMPATIBLE_SETTINGS_KEY)
                .execute(&mut *tx)
                .await
                .map_err(|_| "failed to delete AI provider".to_owned())?;
        } else {
            if uuid::Uuid::parse_str(&id).is_err() {
                return Err("AI provider ID is invalid".to_owned());
            }
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(format!("{OPENAI_COMPATIBLE_SETTINGS_KEY}.{id}"))
                .execute(&mut *tx)
                .await
                .map_err(|_| "failed to delete AI provider".to_owned())?;
            let ids: Vec<&str> = configs
                .iter()
                .filter(|item| item.id != "legacy" && item.id != id)
                .map(|item| item.id.as_str())
                .collect();
            let value = serde_json::to_string(&ids)
                .map_err(|_| "failed to serialize AI providers".to_owned())?;
            sqlx::query("UPDATE settings SET value_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?")
                .bind(value).bind(OPENAI_INSTANCES_KEY).execute(&mut *tx).await.map_err(|_| "failed to delete AI provider".to_owned())?;
        }
        let credential_ref = config.credential_ref.clone();
        match openai_credential_store().load(&credential_ref) {
            Ok(_) => openai_credential_store()
                .delete(&credential_ref)
                .map_err(|_| {
                    "failed to delete AI provider token from the operating system keyring"
                        .to_owned()
                })?,
            Err(CredentialError::NotFound) => {}
            Err(_) => {
                return Err(
                    "failed to access AI provider token in the operating system keyring".to_owned(),
                )
            }
        }
    } else {
        let mut added = added_cli.expect("CLI providers were loaded");
        if !added.contains(&provider) && !changed {
            return Err("AI provider was not found".to_owned());
        }
        added.retain(|item| *item != provider);
        let value = serde_json::to_string(&added)
            .map_err(|_| "failed to serialize AI providers".to_owned())?;
        sqlx::query("UPDATE settings SET value_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?")
            .bind(value).bind(ADDED_CLI_PROVIDERS_KEY).execute(&mut *tx).await.map_err(|_| "failed to delete AI provider".to_owned())?;
    }
    if changed {
        let value = serde_json::to_string(&settings)
            .map_err(|_| "failed to serialize AI settings".to_owned())?;
        sqlx::query("UPDATE settings SET value_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?")
            .bind(value).bind(AI_SETTINGS_KEY).execute(&mut *tx).await.map_err(|_| "failed to clear selected AI provider".to_owned())?;
    }
    tx.commit()
        .await
        .map_err(|_| "failed to delete AI provider".to_owned())?;
    dto(pool).await
}

#[derive(Debug, Clone, Copy)]
pub enum AiActivity {
    TaskCreation,
    PullRequestReview,
    TokenBurner,
    SprintSummary,
}

// Read the selected profile without probing providers; cached work needs no live AI connection.
pub(crate) async fn stored_settings_for_activity(
    pool: &SqlitePool,
    activity: AiActivity,
) -> Result<AiSettings, String> {
    Ok(effective_settings(load(pool).await?, activity))
}

pub async fn settings_for_activity(
    pool: &SqlitePool,
    activity: AiActivity,
) -> Result<AiSettings, String> {
    let data = dto(pool).await?;
    let settings = effective_settings(data.settings, activity);
    validate_selected_settings(&settings, &data.providers)?;
    Ok(settings)
}

pub fn is_retryable_provider_error(error: &str) -> bool {
    if error.contains("could not be completed") {
        return true;
    }
    error
        .split("HTTP ")
        .nth(1)
        .and_then(|status| status.split_whitespace().next())
        .and_then(|status| status.parse::<u16>().ok())
        .is_some_and(|status| status == 408 || status == 429 || (500..=599).contains(&status))
}

pub fn retry_provider_operation<T>(
    retries: u8,
    mut operation: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    let retries = retries.min(MAX_AI_RETRIES);
    for retry in 0..=retries {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if retry < retries && is_retryable_provider_error(&error) => {}
            Err(error) => return Err(error),
        }
    }
    Err("AI provider is unavailable".to_owned())
}

pub async fn retry_provider_operation_async<T, F, Fut>(
    retries: u8,
    mut operation: F,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let retries = retries.min(MAX_AI_RETRIES);
    for retry in 0..=retries {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(error) if retry < retries && is_retryable_provider_error(&error) => {}
            Err(error) => return Err(error),
        }
    }
    Err("AI provider is unavailable".to_owned())
}

fn effective_settings(mut settings: AiSettings, activity: AiActivity) -> AiSettings {
    let profile = match activity {
        AiActivity::TaskCreation => settings.task_creation.clone(),
        AiActivity::PullRequestReview => settings.pull_request_review.clone(),
        AiActivity::TokenBurner => settings.token_burner.clone(),
        AiActivity::SprintSummary => settings.sprint_summary.clone(),
    };
    if let Some(profile) = profile {
        profile.apply_to(&mut settings);
    }
    settings.task_creation = None;
    settings.pull_request_review = None;
    settings.token_burner = None;
    settings.sprint_summary = None;
    settings
}

fn validate_selected_settings(
    settings: &AiSettings,
    providers: &[AiProviderDto],
) -> Result<(), String> {
    let Some(provider) = settings.provider else {
        return Err(
            "Select a connected AI provider in Settings → Integrations before starting a review"
                .to_owned(),
        );
    };
    let Some(provider_status) = providers.iter().find(|item| {
        item.id == provider
            && (provider != AiProviderId::OpenAiCompatible
                || item.instance_id.as_deref()
                    == Some(settings.provider_instance_id.as_deref().unwrap_or("legacy")))
    }) else {
        return Err("Selected AI provider is unavailable".to_owned());
    };
    if !provider_status.available || provider_status.status != AiProviderStatus::Connected {
        if provider == AiProviderId::OpenCodeCli {
            return Err("OpenCode CLI is unavailable. Install stable OpenCode 1.18+, configure a provider with opencode auth login, and refresh AI Settings".to_owned());
        }
        if provider == AiProviderId::PiCli {
            return Err("Pi CLI is unavailable. Install a current Pi CLI, sign in with /login, and refresh AI Settings".to_owned());
        }
        return Err(provider_status
            .message
            .clone()
            .unwrap_or_else(|| "Selected AI provider is unavailable".to_owned()));
    }
    if !provider_status
        .models
        .iter()
        .any(|model| model == &settings.model)
    {
        return Err(
            "Selected AI model is not available. Refresh Settings → Integrations and choose an available model"
                .to_owned(),
        );
    }
    Ok(())
}

async fn validate_settings(
    pool: &SqlitePool,
    settings: &AiSettings,
) -> Result<(), AiSettingsSaveError> {
    let retry_values = [
        Some(settings.retries.default),
        settings.retries.actions.task_creation,
        settings.retries.actions.pull_request_review,
        settings.retries.actions.token_burner,
        settings.retries.actions.sprint_summary,
    ];
    if retry_values
        .into_iter()
        .flatten()
        .any(|retries| retries > MAX_AI_RETRIES)
    {
        return Err(format!("AI retries must be between 0 and {MAX_AI_RETRIES}").into());
    }
    let page = dto(pool).await?;
    validate_changed_selections(settings, &page.settings, &page.providers)
}

fn validate_changed_selections(
    settings: &AiSettings,
    previous: &AiSettings,
    providers: &[AiProviderDto],
) -> Result<(), AiSettingsSaveError> {
    if settings.provider.is_some() {
        if settings.provider != previous.provider
            || settings.provider_instance_id != previous.provider_instance_id
            || settings.model != previous.model
        {
            validate_provider_selection(
                settings.provider,
                settings.provider_instance_id.as_deref(),
                &settings.model,
                providers,
            )
            .map_err(|field| AiSettingsSaveError::field(AiSettingsScope::Default, field))?;
        }
    } else if settings.task_creation.is_none()
        && settings.pull_request_review.is_none()
        && settings.token_burner.is_none()
        && settings.sprint_summary.is_none()
    {
        return Err(AiSettingsSaveError::field(
            AiSettingsScope::Default,
            AiSettingsField::Provider,
        ));
    }
    // Preserve unrelated saved profiles even when their provider catalog changes.
    // Every profile is still checked against live providers before running an activity.
    for (scope, profile, saved) in [
        (
            AiSettingsScope::TaskCreation,
            &settings.task_creation,
            &previous.task_creation,
        ),
        (
            AiSettingsScope::PullRequestReview,
            &settings.pull_request_review,
            &previous.pull_request_review,
        ),
        (
            AiSettingsScope::TokenBurner,
            &settings.token_burner,
            &previous.token_burner,
        ),
        (
            AiSettingsScope::SprintSummary,
            &settings.sprint_summary,
            &previous.sprint_summary,
        ),
    ] {
        if let Some(profile) = profile {
            let selection_unchanged = saved.as_ref().is_some_and(|saved| {
                saved.provider == profile.provider
                    && saved.provider_instance_id == profile.provider_instance_id
                    && saved.model == profile.model
            });
            if !selection_unchanged {
                validate_provider_selection(
                    Some(profile.provider),
                    profile.provider_instance_id.as_deref(),
                    &profile.model,
                    providers,
                )
                .map_err(|field| AiSettingsSaveError::field(scope, field))?;
            }
        }
    }
    Ok(())
}

fn validate_provider_selection(
    provider: Option<AiProviderId>,
    instance_id: Option<&str>,
    model: &str,
    providers: &[AiProviderDto],
) -> Result<(), AiSettingsField> {
    let provider = provider.ok_or(AiSettingsField::Provider)?;
    let provider_status = providers
        .iter()
        .find(|item| {
            item.id == provider
                && (provider != AiProviderId::OpenAiCompatible
                    || item.instance_id.as_deref() == Some(instance_id.unwrap_or("legacy")))
        })
        .ok_or(AiSettingsField::Provider)?;
    if !provider_status.available || provider_status.status != AiProviderStatus::Connected {
        return Err(AiSettingsField::Provider);
    }
    if model.trim().is_empty() || !provider_status.models.iter().any(|known| known == model) {
        return Err(AiSettingsField::Model);
    }
    Ok(())
}
fn openai_credential_store() -> Box<dyn CredentialStore> {
    Box::new(OsKeyring::new(AI_KEYRING_SERVICE))
}

async fn load_openai_configs(
    pool: &SqlitePool,
) -> Result<Vec<OpenAiCompatibleProviderConfig>, String> {
    let mut result = Vec::new();
    if let Some(raw) = repositories::get_setting(pool, OPENAI_COMPATIBLE_SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load OpenAI-compatible API settings".to_owned())?
    {
        let mut legacy: OpenAiCompatibleProviderConfig = serde_json::from_str(&raw)
            .map_err(|_| "stored OpenAI-compatible API settings are invalid".to_owned())?;
        legacy.id = "legacy".to_owned();
        result.push(legacy);
    }
    if let Some(raw) = repositories::get_setting(pool, OPENAI_INSTANCES_KEY)
        .await
        .map_err(|_| "failed to load AI providers".to_owned())?
    {
        let ids: Vec<String> =
            serde_json::from_str(&raw).map_err(|_| "stored AI providers are invalid".to_owned())?;
        for id in ids {
            if uuid::Uuid::parse_str(&id).is_err() {
                return Err("stored AI provider ID is invalid".to_owned());
            }
            let raw =
                repositories::get_setting(pool, &format!("{OPENAI_COMPATIBLE_SETTINGS_KEY}.{id}"))
                    .await
                    .map_err(|_| "failed to load OpenAI-compatible API settings".to_owned())?
                    .ok_or_else(|| "stored AI provider is missing".to_owned())?;
            let mut config: OpenAiCompatibleProviderConfig = serde_json::from_str(&raw)
                .map_err(|_| "stored OpenAI-compatible API settings are invalid".to_owned())?;
            config.id = id;
            result.push(config);
        }
    }
    Ok(result)
}

pub async fn configured_openai_credential_refs(pool: &SqlitePool) -> Result<Vec<String>, String> {
    Ok(load_openai_configs(pool)
        .await?
        .into_iter()
        .map(|config| config.credential_ref)
        .collect())
}

pub async fn provider_display_name(
    pool: &SqlitePool,
    provider: AiProviderId,
    instance_id: Option<&str>,
) -> Result<String, String> {
    match provider {
        AiProviderId::CodexCli => Ok("Codex CLI".to_owned()),
        AiProviderId::ClaudeCodeCli => Ok("Claude Code CLI".to_owned()),
        AiProviderId::OpenCodeCli => Ok("OpenCode CLI".to_owned()),
        AiProviderId::HermesCli => Ok("Hermes CLI".to_owned()),
        AiProviderId::PiCli => Ok("Pi CLI".to_owned()),
        AiProviderId::OpenAiCompatible => {
            let config = load_openai_configs(pool)
                .await?
                .into_iter()
                .find(|config| config.id == instance_id.unwrap_or("legacy"))
                .ok_or_else(|| "OpenAI-compatible API is not configured".to_owned())?;
            Ok(if config.alias.is_empty() {
                "OpenAI-compatible API".to_owned()
            } else {
                config.alias
            })
        }
    }
}

pub async fn openai_compatible_runtime_config(
    pool: &SqlitePool,
    instance_id: Option<&str>,
) -> Result<OpenAiCompatibleRuntimeConfig, String> {
    let configs = load_openai_configs(pool).await?;
    let Some(config) = configs
        .into_iter()
        .find(|config| Some(config.id.as_str()) == instance_id.or(Some("legacy")))
    else {
        return Err("OpenAI-compatible API is not configured".to_owned());
    };
    let base_url = normalize_openai_base_url(&config.base_url)?;
    let token = openai_credential_store()
        .load(&config.credential_ref)
        .map_err(|_| {
            "OpenAI-compatible API token is unavailable in the operating system keyring".to_owned()
        })?;
    Ok(OpenAiCompatibleRuntimeConfig {
        base_url,
        token,
        allow_insecure_tls: config.allow_insecure_tls,
    })
}

async fn inspect_openai_compatible(config: OpenAiCompatibleProviderConfig) -> AiProviderDto {
    let base_url = match normalize_openai_base_url(&config.base_url) {
        Ok(base_url) => base_url,
        Err(message) => {
            return openai_provider(
                &config,
                AiProviderStatus::Unavailable,
                false,
                config.base_url.clone(),
                Vec::new(),
                Some(message),
            )
        }
    };
    let token =
        match openai_credential_store().load(&config.credential_ref) {
            Ok(token) => token,
            Err(_) => return openai_provider(
                &config,
                AiProviderStatus::NotAuthenticated,
                false,
                base_url,
                Vec::new(),
                Some(
                    "OpenAI-compatible API token is not available in the operating system keyring"
                        .to_owned(),
                ),
            ),
        };
    match load_openai_models(&base_url, &token, config.allow_insecure_tls).await {
        Ok(models) => openai_provider(
            &config,
            AiProviderStatus::Connected,
            true,
            base_url,
            models,
            None,
        ),
        Err(message) => openai_provider(
            &config,
            AiProviderStatus::Unavailable,
            false,
            base_url,
            Vec::new(),
            Some(message),
        ),
    }
}

fn openai_provider(
    config: &OpenAiCompatibleProviderConfig,
    status: AiProviderStatus,
    available: bool,
    base_url: String,
    models: Vec<String>,
    message: Option<String>,
) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::OpenAiCompatible,
        instance_id: Some(config.id.clone()),
        name: if config.alias.is_empty() {
            "OpenAI-compatible API"
        } else {
            &config.alias
        }
        .to_owned(),
        status,
        available,
        models,
        executable_path: None,
        version: None,
        base_url: (!base_url.is_empty()).then_some(base_url),
        allow_insecure_tls: Some(config.allow_insecure_tls),
        message,
    }
}

fn normalize_openai_base_url(value: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(value.trim()).map_err(|_| "API URL is invalid".to_owned())?;
    if parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("API URL must not contain credentials, a query, or a fragment".to_owned());
    }
    let is_local_http = parsed.scheme() == "http"
        && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() != "https" && !is_local_http {
        return Err("API URL must use https:// (http:// is allowed only for localhost)".to_owned());
    }
    if parsed.host_str().is_none() {
        return Err("API URL must include a host".to_owned());
    }
    Ok(value.trim().trim_end_matches('/').to_owned())
}

pub fn safe_openai_error_detail(value: &serde_json::Value) -> Option<String> {
    let error = value.get("error")?;
    const SAFE_CODES: &[&str] = &[
        "invalid_api_key",
        "model_not_found",
        "context_length_exceeded",
        "rate_limit_exceeded",
        "insufficient_quota",
        "unsupported_parameter",
        "unsupported_value",
        "invalid_request_error",
        "server_error",
        "internal_server_error",
        "overloaded_error",
        "request_timeout",
        "content_policy_violation",
        "billing_not_active",
        "organization_deactivated",
        "model_not_available",
        "invalid_model",
        "too_many_requests",
        "authentication_error",
        "permission_denied",
    ];
    const SAFE_TYPES: &[&str] = &[
        "invalid_request_error",
        "authentication_error",
        "permission_error",
        "rate_limit_error",
        "server_error",
        "insufficient_quota",
        "request_timeout",
        "service_unavailable_error",
        "not_found_error",
        "conflict_error",
        "unprocessable_entity_error",
    ];
    const SAFE_PARAMS: &[&str] = &[
        "model",
        "messages",
        "temperature",
        "top_p",
        "max_tokens",
        "max_completion_tokens",
        "stream",
        "tools",
        "tool_choice",
        "response_format",
        "n",
        "stop",
        "presence_penalty",
        "frequency_penalty",
        "seed",
        "user",
        "input",
        "prompt",
    ];
    let code = safe_openai_error_label(error.get("code"), SAFE_CODES);
    let error_type = safe_openai_error_label(error.get("type"), SAFE_TYPES);
    let label = code.or(error_type)?;
    let parameter = safe_openai_error_label(error.get("param"), SAFE_PARAMS);
    Some(match parameter {
        Some(parameter) => format!("{label} (parameter: {parameter})"),
        None => label,
    })
}

fn safe_openai_error_label(
    value: Option<&serde_json::Value>,
    allowlist: &[&str],
) -> Option<String> {
    let label = value?.as_str()?.trim();
    allowlist.contains(&label).then(|| label.to_owned())
}

pub fn openai_http_client(
    timeout: Duration,
    allow_insecure_tls: bool,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(timeout);
    if allow_insecure_tls {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder
        .build()
        .map_err(|_| "OpenAI-compatible API client could not be initialized".to_owned())
}

const OPENAI_DEBUG_LOG_MAX_CHARS: usize = 8_000;

pub fn log_openai_chat_request(
    operation: &str,
    base_url: &str,
    allow_insecure_tls: bool,
    payload: &Value,
) {
    append_openai_debug_json(&serde_json::json!({
        "event": "request",
        "operation": operation,
        "method": "POST",
        "url": safe_openai_log_url(&format!("{base_url}/chat/completions")),
        "allow_insecure_tls": allow_insecure_tls,
        "payload": summarize_openai_chat_payload(payload),
    }));
}

pub fn log_openai_chat_response(operation: &str, status: u16, body: &[u8]) {
    if !(200..300).contains(&status) {
        crate::application::logging::log_http_error_payload(
            status,
            "ai.openai_compatible",
            operation,
            body,
            false,
        );
    }
}

pub fn log_openai_transport_error(operation: &str, _detail: &str) {
    append_openai_debug_json(&serde_json::json!({
        "event": "transport_error",
        "operation": operation,
        "detail": "[omitted to avoid logging request URLs or provider data]",
    }));
}

fn append_openai_debug_json(value: &Value) {
    crate::application::logging::info("ai.openai_compatible", "http", value.clone());
}

fn summarize_openai_chat_payload(payload: &Value) -> Value {
    let Some(object) = payload.as_object() else {
        return Value::String("[non-object-payload]".to_owned());
    };
    let mut summary = serde_json::Map::new();
    for key in ["model", "max_tokens", "stream"] {
        if let Some(value) = object.get(key) {
            summary.insert(key.to_owned(), value.clone());
        }
    }
    if let Some(messages) = object.get("messages").and_then(Value::as_array) {
        summary.insert(
            "messages".to_owned(),
            Value::Array(
                messages
                    .iter()
                    .map(|message| {
                        let role = message
                            .get("role")
                            .and_then(Value::as_str)
                            .unwrap_or("[missing]");
                        let content = message.get("content").map(summarize_openai_content);
                        serde_json::json!({
                            "role": truncate_openai_log_text(role),
                            "content": content,
                        })
                    })
                    .collect(),
            ),
        );
    }
    summary.insert(
        "top_level_keys".to_owned(),
        Value::Array(
            object
                .keys()
                .map(|key| Value::String(key.clone()))
                .collect(),
        ),
    );
    Value::Object(summary)
}

fn summarize_openai_content(value: &Value) -> Value {
    match value {
        Value::String(text) => serde_json::json!({
            "type": "text",
            "chars": text.chars().count(),
        }),
        Value::Array(parts) => serde_json::json!({
            "type": "array",
            "parts": parts.len(),
        }),
        Value::Null => Value::String("[null]".to_owned()),
        _ => serde_json::json!({ "type": "other" }),
    }
}

#[cfg(test)]
fn safe_openai_log_body(status: u16, body: &[u8]) -> Value {
    if (200..300).contains(&status) {
        return Value::String("[successful response body omitted]".to_owned());
    }
    let safe_detail = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|payload| safe_openai_error_detail(&payload));
    safe_detail
        .map(Value::String)
        .unwrap_or_else(|| Value::String("[unrecognized error body omitted]".to_owned()))
}

fn truncate_openai_log_text(value: &str) -> String {
    let mut text = value
        .chars()
        .take(OPENAI_DEBUG_LOG_MAX_CHARS)
        .collect::<String>();
    if value.chars().count() > OPENAI_DEBUG_LOG_MAX_CHARS {
        text.push_str("…[truncated]");
    }
    text
}

fn safe_openai_log_url(value: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(value) else {
        return "[invalid-url]".to_owned();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

pub fn openai_stream_message_content(body: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(body);
    let mut content = String::new();
    let mut saw_data = false;
    for line in text.lines() {
        let data = line
            .strip_prefix("data:")
            .map(str::trim_start)
            .filter(|value| !value.is_empty() && *value != "[DONE]");
        let Some(data) = data else {
            continue;
        };
        let Ok(payload) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        saw_data = true;
        let content_value = payload
            .pointer("/choices/0/delta/content")
            .or_else(|| payload.pointer("/choices/0/message/content"));
        if let Some(content_value) = content_value {
            append_openai_content(content_value, &mut content);
        }
    }
    (saw_data && !content.is_empty()).then_some(content)
}

fn append_openai_content(value: &Value, output: &mut String) {
    if let Some(text) = value.as_str() {
        output.push_str(text);
        return;
    }
    if let Some(parts) = value.as_array() {
        for part in parts {
            if let Some(text) = part.as_str() {
                output.push_str(text);
            } else if let Some(text) = part.get("text").and_then(Value::as_str) {
                output.push_str(text);
            }
        }
    }
}

pub const OPENAI_MAX_OUTPUT_TOKENS: u64 = 30_000;

async fn load_openai_models(
    base_url: &str,
    token: &str,
    allow_insecure_tls: bool,
) -> Result<Vec<String>, String> {
    query_openai_models(base_url, token, allow_insecure_tls).await
}

async fn query_openai_models(
    base_url: &str,
    token: &str,
    allow_insecure_tls: bool,
) -> Result<Vec<String>, String> {
    let client = openai_http_client(Duration::from_secs(10), allow_insecure_tls)?;
    let response = client
        .get(format!("{base_url}/models"))
        .bearer_auth(token)
        .send_logged(
            "ai.openai_compatible",
            "model_catalog",
            crate::application::logging::HttpBodyPolicy::Omit,
        )
        .await
        .map_err(|_| "OpenAI-compatible API could not be reached".to_owned())?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        crate::application::logging::log_http_error_body(
            response,
            "ai.openai_compatible",
            "model_catalog",
            false,
        )
        .await;
        if status == 401 || status == 403 {
            return Err("OpenAI-compatible API authorization failed".to_owned());
        }
        return Err(format!(
            "OpenAI-compatible API returned HTTP {status} while loading models"
        ));
    }
    let payload: serde_json::Value = crate::application::logging::parse_json_response(
        response,
        "ai.openai_compatible",
        "model_catalog",
    )
    .await
    .map_err(|_| "OpenAI-compatible API returned an invalid model catalog".to_owned())?;
    parse_openai_model_list_response(&payload).ok_or_else(|| {
        let raw = serde_json::to_vec(&payload).unwrap_or_default();
        crate::application::logging::log_parse_failure(
            "ai.openai_compatible",
            "model_catalog",
            "response_shape",
            &raw,
        );
        "OpenAI-compatible API returned an invalid model catalog".to_owned()
    })
}

pub fn parse_openai_model_list_response(value: &serde_json::Value) -> Option<Vec<String>> {
    let entries = value.get("data")?.as_array()?;
    let mut models = Vec::new();
    for entry in entries {
        let Some(model) = entry
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|model| {
                !model.is_empty() && model.len() <= 200 && !model.chars().any(char::is_control)
            })
        else {
            continue;
        };
        if !models.iter().any(|known| known == model) {
            models.push(model.to_owned());
        }
    }
    Some(models)
}

#[cfg(test)]
pub fn test_process_env_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
mod tests {
    use super::cli;
    use super::{
        default_mock_ai_settings, delete_provider, load, load_openai_models,
        normalize_openai_base_url, parse_openai_model_list_response, retry_provider_operation,
        safe_openai_error_detail, AiActivity, AiProviderDto, AiProviderId, AiProviderStatus,
        AiReasoning, AiSettings, OpenAiCompatibleProviderConfig, ADDED_CLI_PROVIDERS_KEY,
        AI_SETTINGS_KEY,
    };
    #[cfg(unix)]
    use crate::application::ai_providers::cli::codex::{
        inspect_codex_cli, query_codex_models_with_timeout,
    };
    use crate::application::ai_providers::cli::codex::{
        parse_codex_model_list_response, safe_first_line,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn accepts_a_new_pi_selection_with_an_unchanged_unavailable_activity() {
        let previous = AiSettings {
            token_burner: Some(super::AiSettingsProfile {
                provider: AiProviderId::OpenAiCompatible,
                provider_instance_id: Some("example-api".to_owned()),
                model: "retired-example-model".to_owned(),
                reasoning: AiReasoning::Medium,
                fast_mode: false,
            }),
            ..AiSettings::default()
        };
        let settings = AiSettings {
            provider: Some(AiProviderId::PiCli),
            model: "openai/example-model".to_owned(),
            ..previous.clone()
        };
        let providers = vec![AiProviderDto {
            id: AiProviderId::PiCli,
            instance_id: None,
            name: "Pi CLI".to_owned(),
            status: AiProviderStatus::Connected,
            available: true,
            models: vec![settings.model.clone()],
            executable_path: None,
            version: None,
            base_url: None,
            allow_insecure_tls: None,
            message: None,
        }];
        super::validate_changed_selections(&settings, &previous, &providers).unwrap();
        assert_eq!(settings.token_burner, previous.token_burner);
    }

    #[test]
    fn mock_ai_defaults_to_codex_when_both_cli_providers_are_connected() {
        let connected = |id, name: &str, models: &[&str]| AiProviderDto {
            id,
            instance_id: None,
            name: name.to_owned(),
            status: AiProviderStatus::Connected,
            available: true,
            models: models.iter().map(|model| (*model).to_owned()).collect(),
            executable_path: None,
            version: None,
            base_url: None,
            allow_insecure_tls: None,
            message: None,
        };
        let settings = default_mock_ai_settings(&[
            connected(AiProviderId::ClaudeCodeCli, "Claude Code CLI", &["sonnet"]),
            connected(
                AiProviderId::CodexCli,
                "Codex CLI",
                &["example-codex-model"],
            ),
        ]);

        assert_eq!(settings.provider, Some(AiProviderId::CodexCli));
        assert_eq!(settings.model, "example-codex-model");
    }

    #[test]
    fn defaults_to_no_provider_until_user_saves_one() {
        let settings = AiSettings::default();
        assert_eq!(settings.provider, None);
        assert_eq!(settings.model, "");
        assert_eq!(settings.reasoning, AiReasoning::Medium);
        assert!(!settings.fast_mode);
        assert_eq!(settings.retries.default, 0);
        assert_eq!(settings.retries.for_activity(AiActivity::TaskCreation), 0);
    }

    #[test]
    fn retries_only_transient_provider_errors_and_treats_value_as_additional_retries() {
        let mut calls = 0;
        let result = retry_provider_operation(2, || {
            calls += 1;
            if calls < 3 {
                Err("OpenAI-compatible API review returned HTTP 503".to_owned())
            } else {
                Ok("complete")
            }
        });
        assert_eq!(result.unwrap(), "complete");
        assert_eq!(calls, 3);

        calls = 0;
        let result = retry_provider_operation(4, || {
            calls += 1;
            Err::<(), _>("AI provider returned invalid task JSON".to_owned())
        });
        assert!(result.is_err());
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    async fn async_retry_helper_retries_transient_transport_failures() {
        let mut calls = 0;
        let result = super::retry_provider_operation_async(1, || {
            calls += 1;
            async move {
                if calls == 1 {
                    Err("AI summary request could not be completed".to_owned())
                } else {
                    Ok("summary")
                }
            }
        })
        .await;

        assert_eq!(result.unwrap(), "summary");
        assert_eq!(calls, 2);
    }

    #[tokio::test]
    async fn fresh_ai_settings_leave_all_actions_inheriting_the_default_retry_count() {
        let directory = tempfile::tempdir().unwrap();
        let pool =
            crate::infrastructure::db::open_database(&directory.path().join("ai-retries.sqlite"))
                .await
                .unwrap();
        crate::application::general::initialize_if_missing(
            &pool,
            crate::application::general::AppLanguage::English,
        )
        .await
        .unwrap();

        let loaded = load(&pool).await.unwrap();
        assert_eq!(loaded.retries.default, 0);
        assert_eq!(loaded.retries.actions.pull_request_review, None);
        assert_eq!(
            loaded.retries.for_activity(AiActivity::PullRequestReview),
            0
        );
        let mut stored = loaded;
        stored.retries.default = 2;
        stored.retries.actions.task_creation = Some(7);
        stored.pull_request_review = Some(super::AiSettingsProfile {
            provider: AiProviderId::CodexCli,
            provider_instance_id: None,
            model: "example-model".to_owned(),
            reasoning: AiReasoning::Medium,
            fast_mode: false,
        });
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            AI_SETTINGS_KEY,
            &serde_json::to_string(&stored).unwrap(),
            2,
        )
        .await
        .unwrap();
        let mut migrated = load(&pool).await.unwrap();
        assert_eq!(migrated.retries.actions.task_creation, None);
        assert_eq!(migrated.retries.actions.pull_request_review, Some(2));
        let persisted: AiSettings = serde_json::from_str(
            &crate::infrastructure::db::repositories::get_setting(&pool, AI_SETTINGS_KEY)
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(persisted.retries, migrated.retries);
        migrated.retries.default = 4;
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            AI_SETTINGS_KEY,
            &serde_json::to_string(&migrated).unwrap(),
            3,
        )
        .await
        .unwrap();
        let updated = load(&pool).await.unwrap();
        assert_eq!(updated.retries.for_activity(AiActivity::TaskCreation), 4);
        assert_eq!(
            updated.retries.for_activity(AiActivity::PullRequestReview),
            2
        );
    }

    #[tokio::test]
    async fn migrates_legacy_review_attempts_to_per_action_retries() {
        let directory = tempfile::tempdir().unwrap();
        let pool =
            crate::infrastructure::db::open_database(&directory.path().join("ai-retries.sqlite"))
                .await
                .unwrap();
        crate::application::general::initialize_if_missing(
            &pool,
            crate::application::general::AppLanguage::English,
        )
        .await
        .unwrap();
        crate::application::general::save_ai_review_attempts(&pool, 4)
            .await
            .unwrap();
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            AI_SETTINGS_KEY,
            r#"{"provider":"codex-cli","model":"example-model","reasoning":"medium","fastMode":false,"pullRequestReview":{"provider":"codex-cli","model":"example-model","reasoning":"medium","fastMode":false}}"#,
            1,
        )
        .await
        .unwrap();

        let loaded = load(&pool).await.unwrap();
        assert_eq!(loaded.retries.default, 0);
        assert_eq!(loaded.retries.actions.pull_request_review, Some(3));
        assert_eq!(loaded.retries.for_activity(AiActivity::TaskCreation), 0);
        assert_eq!(
            loaded.retries.for_activity(AiActivity::PullRequestReview),
            3
        );

        let mut legacy_general =
            serde_json::to_value(crate::application::general::load(&pool).await.unwrap()).unwrap();
        legacy_general
            .as_object_mut()
            .unwrap()
            .remove("aiReviewAttempts");
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            "general.settings",
            &legacy_general.to_string(),
            6,
        )
        .await
        .unwrap();
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            AI_SETTINGS_KEY,
            r#"{"provider":"codex-cli","model":"example-model","reasoning":"medium","fastMode":false,"pullRequestReview":{"provider":"codex-cli","model":"example-model","reasoning":"medium","fastMode":false}}"#,
            1,
        )
        .await
        .unwrap();

        let missing_legacy_field = load(&pool).await.unwrap();
        assert_eq!(
            missing_legacy_field.retries.actions.pull_request_review,
            Some(2)
        );
    }

    #[tokio::test]
    async fn deleting_selected_cli_clears_its_selection() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
            .execute(&pool).await.unwrap();
        let settings = AiSettings {
            provider: Some(AiProviderId::CodexCli),
            provider_instance_id: None,
            model: "example-model".to_owned(),
            reasoning: AiReasoning::Medium,
            fast_mode: false,
            task_creation: None,
            pull_request_review: None,
            token_burner: None,
            sprint_summary: None,
            retries: super::AiRetrySettings::default(),
        };
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            AI_SETTINGS_KEY,
            &serde_json::to_string(&settings).unwrap(),
            1,
        )
        .await
        .unwrap();
        crate::infrastructure::db::repositories::upsert_setting(
            &pool,
            ADDED_CLI_PROVIDERS_KEY,
            "[\"codex-cli\"]",
            1,
        )
        .await
        .unwrap();

        let result = delete_provider(&pool, AiProviderId::CodexCli, None)
            .await
            .unwrap();
        assert!(result.providers.is_empty());
        assert_eq!(result.settings.provider, None);
        assert_eq!(load(&pool).await.unwrap().model, "");
    }

    #[test]
    fn exposes_only_safe_openai_error_metadata() {
        let payload = serde_json::json!({
            "error": {
                "message": "Bearer synthetic-token is invalid",
                "type": "invalid_request_error",
                "param": "temperature",
                "code": "unsupported_parameter"
            }
        });

        assert_eq!(
            safe_openai_error_detail(&payload),
            Some("unsupported_parameter (parameter: temperature)".to_owned())
        );
        assert!(!safe_openai_error_detail(&payload)
            .unwrap()
            .contains("synthetic-token"));
        let untrusted_code = serde_json::json!({"error": {"code": "sk-abc123"}});
        assert_eq!(safe_openai_error_detail(&untrusted_code), None);
        let untrusted_param =
            serde_json::json!({"error": {"code": "server_error", "param": "token"}});
        assert_eq!(
            safe_openai_error_detail(&untrusted_param),
            Some("server_error".to_owned())
        );
    }

    #[test]
    fn openai_logging_omits_success_body_and_only_keeps_allowlisted_error_metadata() {
        let success_body = br#"{"choices":[{"message":{"content":"private synthetic code"}}]}"#;
        let success = super::safe_openai_log_body(200, success_body).to_string();
        assert!(!success.contains("private synthetic code"));
        assert!(success.contains("omitted"));

        let error_body = br#"{"error":{"message":"private synthetic explanation","type":"invalid_request_error","code":"unsupported_parameter","detail":"do not log this"}}"#;
        let error = super::safe_openai_log_body(500, error_body).to_string();
        assert!(error.contains("unsupported_parameter"));
        assert!(!error.contains("private synthetic explanation"));
        assert!(!error.contains("do not log this"));
    }

    #[test]
    fn request_summary_keeps_shape_without_logging_prompt_content() {
        let payload = serde_json::json!({
            "model": "example-model",
            "max_tokens": 123,
            "messages": [{"role": "user", "content": "private synthetic prompt"}]
        });
        let summary = super::summarize_openai_chat_payload(&payload);
        let logged = summary.to_string();
        assert_eq!(summary["model"], "example-model");
        assert_eq!(summary["max_tokens"], 123);
        assert!(!logged.contains("private synthetic prompt"));
        assert!(logged.contains("\"chars\":24"));
    }

    #[test]
    fn parses_openai_stream_message_content_from_sse_chunks() {
        let first = serde_json::json!({
            "choices": [{"delta": {"content": "part-a"}}]
        });
        let second = serde_json::json!({
            "choices": [{"delta": {"content": "part-b"}}]
        });
        let body = format!("data: {first}\n\ndata: {second}\n\ndata: [DONE]\n\n");
        assert_eq!(
            super::openai_stream_message_content(body.as_bytes()).as_deref(),
            Some("part-apart-b")
        );
    }

    #[test]
    fn selects_activity_override_and_keeps_legacy_settings_compatible() {
        let legacy: AiSettings = serde_json::from_str(
            r#"{"provider":"codex-cli","model":"example-model","reasoning":"medium","fastMode":false}"#,
        )
        .unwrap();
        assert!(legacy.task_creation.is_none());
        assert!(legacy.pull_request_review.is_none());
        assert!(legacy.sprint_summary.is_none());

        let settings = AiSettings {
            provider: Some(AiProviderId::CodexCli),
            provider_instance_id: None,
            model: "example-model".to_owned(),
            reasoning: AiReasoning::Medium,
            fast_mode: false,
            task_creation: None,
            pull_request_review: Some(super::AiSettingsProfile {
                provider: AiProviderId::ClaudeCodeCli,
                provider_instance_id: None,
                model: "sonnet".to_owned(),
                reasoning: AiReasoning::High,
                fast_mode: true,
            }),
            token_burner: Some(super::AiSettingsProfile {
                provider: AiProviderId::OpenAiCompatible,
                provider_instance_id: Some("provider-id".to_owned()),
                model: "example-review-model".to_owned(),
                reasoning: AiReasoning::Medium,
                fast_mode: false,
            }),
            sprint_summary: Some(super::AiSettingsProfile {
                provider: AiProviderId::ClaudeCodeCli,
                provider_instance_id: None,
                model: "example-summary-model".to_owned(),
                reasoning: AiReasoning::Low,
                fast_mode: false,
            }),
            retries: super::AiRetrySettings {
                default: 1,
                actions: super::AiActionRetries {
                    pull_request_review: Some(2),
                    ..super::AiActionRetries::default()
                },
            },
        };
        let stored = serde_json::to_value(&settings).unwrap();
        assert_eq!(stored["sprintSummary"]["model"], "example-summary-model");
        let task = super::effective_settings(settings.clone(), super::AiActivity::TaskCreation);
        let review =
            super::effective_settings(settings.clone(), super::AiActivity::PullRequestReview);
        let summary = super::effective_settings(settings.clone(), super::AiActivity::SprintSummary);
        let burner = super::effective_settings(settings, super::AiActivity::TokenBurner);
        assert_eq!(task.provider, Some(AiProviderId::CodexCli));
        assert_eq!(task.model, "example-model");
        assert_eq!(review.provider, Some(AiProviderId::ClaudeCodeCli));
        assert_eq!(review.model, "sonnet");
        assert_eq!(review.reasoning, AiReasoning::High);
        assert!(review.fast_mode);
        assert!(review.pull_request_review.is_none());
        assert_eq!(summary.provider, Some(AiProviderId::ClaudeCodeCli));
        assert_eq!(summary.model, "example-summary-model");
        assert_eq!(summary.reasoning, AiReasoning::Low);
        assert!(summary.sprint_summary.is_none());
        assert_eq!(burner.provider, Some(AiProviderId::OpenAiCompatible));
        assert_eq!(burner.provider_instance_id.as_deref(), Some("provider-id"));
        assert_eq!(burner.model, "example-review-model");
        assert!(burner.token_burner.is_none());
    }

    #[test]
    fn serializes_provider_and_reasoning_for_renderer_contract() {
        let settings = AiSettings {
            provider: Some(AiProviderId::CodexCli),
            provider_instance_id: None,
            model: "gpt-5.5".to_owned(),
            reasoning: AiReasoning::High,
            fast_mode: true,
            task_creation: None,
            pull_request_review: None,
            token_burner: None,
            sprint_summary: None,
            retries: super::AiRetrySettings::default(),
        };
        let value = serde_json::to_value(settings).unwrap();
        assert_eq!(value["provider"], "codex-cli");
        assert_eq!(value["reasoning"], "high");
        assert_eq!(value["fastMode"], true);
        assert_eq!(
            serde_json::to_value(AiProviderId::OpenAiCompatible).unwrap(),
            "openai-compatible"
        );
    }

    #[test]
    fn exposes_only_safe_first_line_of_local_command_output() {
        assert_eq!(
            safe_first_line(b"codex-cli 0.142.5\nsecret-token"),
            Some("codex-cli 0.142.5".to_owned())
        );
        assert_eq!(safe_first_line(b"\n\n"), None);
    }

    #[test]
    fn includes_the_standard_windows_codex_install_path_and_executable_names() {
        use std::path::PathBuf;

        let user_profile = PathBuf::from("C:/Users/synthetic");
        let local_app_data = user_profile.join("AppData/Local");
        let candidates = cli::codex::install_paths(
            Some(user_profile.clone()),
            Some(local_app_data),
            Some(user_profile.clone()),
            true,
        );
        let expected = user_profile.join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe");

        assert!(candidates.iter().any(|candidate| candidate == &expected));
        #[cfg(windows)]
        assert!(cli::codex::windows_install_paths().contains(
            &dirs::data_local_dir()
                .expect("Windows local app data folder")
                .join("Programs/OpenAI/Codex/bin/codex.exe")
        ));
        #[cfg(windows)]
        assert_eq!(
            cli::codex::path_beside_installed_app(
                &user_profile.join("AppData/Local/mework/mework.exe")
            ),
            Some(expected)
        );
        assert_eq!(
            cli::codex::executable_names(true),
            &["codex.exe", "codex.cmd", "codex"]
        );
    }

    #[cfg(windows)]
    #[test]
    fn resolves_nested_windows_cli_junctions_to_the_concrete_executable() {
        use std::io;
        use std::path::{Path, PathBuf};

        let root = PathBuf::from(r"C:\Users\example");
        let install_bin = root.join(r"AppData\Local\Programs\OpenAI\Codex\bin");
        let current = root.join(r".codex\packages\standalone\current");
        let release = root.join(r".codex\packages\standalone\releases\1.0.0");
        let candidate = install_bin.join("codex.exe");
        let resolved = cli::resolve_windows_cli_junctions(&candidate, |path: &Path| {
            if path == install_bin {
                Ok(current.join("bin"))
            } else if path == current {
                Ok(release.clone())
            } else {
                Err(io::Error::from(io::ErrorKind::NotFound))
            }
        });

        assert_eq!(resolved, Some(release.join("bin/codex.exe")));
    }

    #[test]
    fn diagnoses_both_local_cli_providers_without_returning_paths() {
        let diagnostics = super::ai_cli_candidate_diagnostics();
        assert!(diagnostics
            .iter()
            .any(|item| item.provider == AiProviderId::CodexCli));
        assert!(diagnostics
            .iter()
            .any(|item| item.provider == AiProviderId::ClaudeCodeCli));
        let serialized = serde_json::to_value(diagnostics).unwrap();
        assert!(serialized
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.get("path").is_none()));
    }

    #[test]
    fn retries_transient_codex_binary_discovery() {
        let expected = std::path::PathBuf::from("synthetic-codex");
        let mut attempts = 0;

        let resolved = cli::codex::resolve_codex_binary_with_retry(
            || {
                attempts += 1;
                (attempts == 2).then(|| expected.clone())
            },
            &[0],
        );

        assert_eq!(resolved, Some(expected));
        assert_eq!(attempts, 2);
    }

    #[cfg(unix)]
    #[test]
    fn reports_connected_when_codex_cli_is_installed_and_logged_in() {
        use std::{fs, os::unix::fs::PermissionsExt};

        let _env_lock = super::test_process_env_lock().lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join("codex");
        fs::write(
            &binary,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex-cli test\\n'; elif [ \"$1\" = \"app-server\" ]; then printf '%s\\n' '{\"id\":1,\"result\":{}}'; printf '%s\\n' '{\"id\":2,\"result\":{\"data\":[{\"id\":\"gpt-test\",\"model\":\"gpt-test\",\"hidden\":false}]}}'; sleep 10; else printf 'Logged in using ChatGPT\\n'; fi\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&binary).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).unwrap();
        std::env::set_var("MEWORK_CODEX_CLI_BIN", &binary);

        let provider = inspect_codex_cli();

        std::env::remove_var("MEWORK_CODEX_CLI_BIN");
        assert_eq!(provider.id, AiProviderId::CodexCli);
        assert_eq!(provider.status, AiProviderStatus::Connected);
        assert!(provider.available);
        assert_eq!(provider.version.as_deref(), Some("codex-cli test"));
        assert_eq!(provider.models, vec!["gpt-test"]);
    }

    #[test]
    fn parses_visible_models_from_codex_cli_catalog_response() {
        let response = serde_json::json!({
            "result": {
                "data": [
                    {"id": "gpt-6-astra", "model": "gpt-6-astra", "hidden": false},
                    {"id": "gpt-5.5", "model": "gpt-5.5", "hidden": false},
                    {"id": "internal", "model": "internal", "hidden": true},
                    {"id": "", "model": "", "hidden": false}
                ]
            }
        });
        assert_eq!(
            parse_codex_model_list_response(&response),
            Some(vec!["gpt-6-astra".to_owned(), "gpt-5.5".to_owned()])
        );
    }

    #[tokio::test]
    async fn loads_openai_compatible_models_with_bearer_auth() {
        use wiremock::{
            matchers::{header, method, path},
            Mock, MockServer, ResponseTemplate,
        };

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("authorization", "Bearer synthetic-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [
                    {"id": "example-model"},
                    {"id": "example-model"},
                    {"id": "example-fast-model"},
                    {"id": ""}
                ]
            })))
            .mount(&server)
            .await;

        let models = load_openai_models(&format!("{}/v1", server.uri()), "synthetic-token", false)
            .await
            .unwrap();
        assert_eq!(models, vec!["example-model", "example-fast-model"]);
    }

    #[test]
    fn serializes_openai_provider_without_static_model_metadata() {
        let config = OpenAiCompatibleProviderConfig {
            id: "legacy".to_owned(),
            base_url: "https://api.example.invalid/v1".to_owned(),
            alias: "Example API".to_owned(),
            credential_ref: "ai-openai-compatible".to_owned(),
            allow_insecure_tls: true,
        };
        let value = serde_json::to_value(&config).unwrap();

        assert!(value.get("staticModels").is_none());
        assert_eq!(value["allowInsecureTls"], true);
        assert_eq!(value["credentialRef"], "ai-openai-compatible");
        assert_eq!(value["alias"], "Example API");
        assert_eq!(
            super::openai_provider(
                &config,
                AiProviderStatus::Connected,
                true,
                "https://api.example.invalid/v1".to_owned(),
                vec!["example-model".to_owned()],
                None
            )
            .name,
            "Example API"
        );
    }

    #[test]
    fn ignores_legacy_static_model_metadata_when_loading_provider_config() {
        let config: OpenAiCompatibleProviderConfig = serde_json::from_value(serde_json::json!({
            "baseUrl": "https://api.example.invalid/v1",
            "credentialRef": "ai-openai-compatible",
            "staticModels": [{
                "model": "legacy-model",
                "contextLength": 1_000_000,
                "maxOutputTokens": 30_000
            }]
        }))
        .unwrap();
        let value = serde_json::to_value(config).unwrap();

        assert!(value.get("staticModels").is_none());
    }

    #[test]
    fn uses_the_fixed_openai_output_limit_without_model_metadata() {
        assert_eq!(super::OPENAI_MAX_OUTPUT_TOKENS, 30_000);
    }

    #[test]
    fn validates_openai_compatible_api_url_and_allows_local_http() {
        assert_eq!(
            normalize_openai_base_url("https://api.example.invalid/v1/").unwrap(),
            "https://api.example.invalid/v1"
        );
        assert!(normalize_openai_base_url("http://api.example.invalid/v1").is_err());
        assert!(normalize_openai_base_url("http://localhost:1234/v1").is_ok());
        assert!(normalize_openai_base_url("https://api.example.invalid/v1?token=secret").is_err());
        assert!(normalize_openai_base_url("https://user:pass@api.example.invalid/v1").is_err());
    }

    #[test]
    fn parses_openai_model_catalog_without_returning_untrusted_entries() {
        let response = serde_json::json!({
            "data": [
                {"id": "example-model"},
                {"id": "example-model"},
                {"id": "\u{0000}"},
                {"id": ""}
            ]
        });
        assert_eq!(
            parse_openai_model_list_response(&response),
            Some(vec!["example-model".to_owned()])
        );
    }

    #[cfg(unix)]
    #[test]
    fn times_out_and_reaps_a_stuck_codex_model_catalog() {
        use std::{fs, os::unix::fs::PermissionsExt, time::Duration};

        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join("codex");
        fs::write(&binary, "#!/bin/sh\\nwhile :; do :; done\\n").unwrap();
        let mut permissions = fs::metadata(&binary).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).unwrap();

        assert_eq!(
            query_codex_models_with_timeout(&binary, Duration::from_millis(100)),
            None
        );
    }

    #[test]
    fn returns_an_empty_list_when_codex_catalog_is_empty() {
        let response = serde_json::json!({"result": {"data": []}});
        assert_eq!(
            parse_codex_model_list_response(&response),
            Some(Vec::<String>::new())
        );
    }
}
