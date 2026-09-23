use std::{
    env,
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::{mpsc, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use crate::infrastructure::{
    credentials::keyring::{
        CredentialStore, OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
    },
    db::repositories,
};

const AI_SETTINGS_KEY: &str = "ai.settings";
const AI_SETTINGS_SCHEMA_VERSION: i64 = 1;
const OPENAI_COMPATIBLE_SETTINGS_KEY: &str = "ai.openai-compatible";
const OPENAI_COMPATIBLE_SETTINGS_SCHEMA_VERSION: i64 = 1;
const OPENAI_COMPATIBLE_CREDENTIAL_REF: &str = "ai-openai-compatible";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn codex_command(path: impl AsRef<OsStr>) -> Command {
    local_cli_command(path)
}

pub(crate) fn local_cli_command(path: impl AsRef<OsStr>) -> Command {
    let command = Command::new(path);
    #[cfg(target_os = "windows")]
    let mut command = command;
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

const AI_KEYRING_SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OpenAiCompatibleProviderConfig {
    base_url: String,
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
    pub base_url: String,
    pub token: String,
    #[serde(default)]
    pub allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AiProviderId {
    CodexCli,
    ClaudeCodeCli,
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
    pub model: String,
    pub reasoning: AiReasoning,
    pub fast_mode: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: None,
            model: String::new(),
            reasoning: AiReasoning::Medium,
            fast_mode: false,
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

pub async fn load(pool: &SqlitePool) -> Result<AiSettings, String> {
    let value = repositories::get_setting(pool, AI_SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load AI settings".to_owned())?;
    Ok(value
        .and_then(|raw| serde_json::from_str::<AiSettings>(&raw).ok())
        .unwrap_or_default())
}

pub async fn save(pool: &SqlitePool, settings: AiSettings) -> Result<(), String> {
    validate_settings(pool, &settings).await?;
    let value = serde_json::to_string(&settings)
        .map_err(|_| "failed to serialize AI settings".to_owned())?;
    repositories::upsert_setting(pool, AI_SETTINGS_KEY, &value, AI_SETTINGS_SCHEMA_VERSION)
        .await
        .map_err(|_| "failed to save AI settings".to_owned())
}

pub async fn save_openai_compatible_provider(
    pool: &SqlitePool,
    request: OpenAiCompatibleProviderSaveRequest,
) -> Result<AiSettingsPageDto, String> {
    let base_url = normalize_openai_base_url(&request.base_url)?;
    if request.token.trim().is_empty() {
        return Err("Token is required".to_owned());
    }

    let models = load_openai_models(&base_url, &request.token, request.allow_insecure_tls).await?;
    if models.is_empty() {
        return Err("Authorization succeeded, but the API returned no models".to_owned());
    }

    let credential_store = openai_credential_store();
    credential_store
        .save(OPENAI_COMPATIBLE_CREDENTIAL_REF, &request.token)
        .map_err(|_| "failed to save token in the operating system keyring".to_owned())?;
    let config = OpenAiCompatibleProviderConfig {
        base_url,
        credential_ref: OPENAI_COMPATIBLE_CREDENTIAL_REF.to_owned(),
        allow_insecure_tls: request.allow_insecure_tls,
    };
    let value = serde_json::to_string(&config)
        .map_err(|_| "failed to serialize OpenAI-compatible API settings".to_owned())?;
    repositories::upsert_setting(
        pool,
        OPENAI_COMPATIBLE_SETTINGS_KEY,
        &value,
        OPENAI_COMPATIBLE_SETTINGS_SCHEMA_VERSION,
    )
    .await
    .map_err(|_| "failed to save OpenAI-compatible API settings".to_owned())?;

    dto(pool).await
}

pub async fn dto(pool: &SqlitePool) -> Result<AiSettingsPageDto, String> {
    let settings = load(pool).await?;
    let (codex, claude) = tokio::join!(
        tokio::task::spawn_blocking(inspect_codex_cli),
        tokio::task::spawn_blocking(crate::application::claude_code::inspect),
    );
    let provider = codex.map_err(|_| "failed to inspect Codex CLI".to_owned())?;
    let claude_provider = claude.map_err(|_| "failed to inspect Claude Code CLI".to_owned())?;
    let openai_provider = inspect_openai_compatible(pool).await;
    Ok(AiSettingsPageDto {
        settings,
        providers: vec![provider, claude_provider, openai_provider],
    })
}

pub async fn ensure_review_ready(pool: &SqlitePool) -> Result<AiSettings, String> {
    let data = dto(pool).await?;
    let Some(provider) = data.settings.provider else {
        return Err(
            "Select a connected AI provider in Settings → Integrations before starting a review"
                .to_owned(),
        );
    };
    let Some(provider_status) = data.providers.iter().find(|item| item.id == provider) else {
        return Err("Selected AI provider is unavailable".to_owned());
    };
    if !provider_status.available || provider_status.status != AiProviderStatus::Connected {
        return Err(provider_status
            .message
            .clone()
            .unwrap_or_else(|| "Selected AI provider is unavailable".to_owned()));
    }
    if !provider_status
        .models
        .iter()
        .any(|model| model == &data.settings.model)
    {
        return Err(
            "Selected AI model is not available. Refresh Settings → Integrations and choose an available model"
                .to_owned(),
        );
    }
    Ok(data.settings)
}

pub fn inspect_codex_cli() -> AiProviderDto {
    let Some(path) = resolve_codex_binary_with_startup_retry() else {
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            name: "Codex CLI".to_owned(),
            status: AiProviderStatus::NotFound,
            available: false,
            models: Vec::new(),
            executable_path: None,
            version: None,
            base_url: None,
            allow_insecure_tls: None,
            message: Some("Codex CLI was not found on this computer".to_owned()),
        };
    };

    let version_output = codex_command(&path).arg("--version").output();
    let Ok(version_output) = version_output else {
        return unavailable_provider(path, Vec::new(), "Codex CLI could not be started");
    };
    if !version_output.status.success() {
        return unavailable_provider(path, Vec::new(), "Codex CLI is installed but unavailable");
    }
    let version =
        safe_first_line(&version_output.stdout).or_else(|| safe_first_line(&version_output.stderr));

    let login_output = codex_command(&path).args(["login", "status"]).output();
    let Ok(login_output) = login_output else {
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            name: "Codex CLI".to_owned(),
            status: AiProviderStatus::Unavailable,
            available: false,
            models: Vec::new(),
            executable_path: Some(path.display().to_string()),
            version,
            base_url: None,
            allow_insecure_tls: None,
            message: Some("Codex CLI login status could not be checked".to_owned()),
        };
    };
    let login_text = format!(
        "{} {}",
        String::from_utf8_lossy(&login_output.stdout),
        String::from_utf8_lossy(&login_output.stderr)
    );
    if login_output.status.success() && login_text.to_ascii_lowercase().contains("logged in") {
        let Some(models) = query_codex_models(&path) else {
            return unavailable_provider(
                path,
                Vec::new(),
                "Codex CLI is signed in, but its model catalog could not be loaded",
            );
        };
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            name: "Codex CLI".to_owned(),
            status: AiProviderStatus::Connected,
            available: true,
            models,
            executable_path: Some(path.display().to_string()),
            version,
            base_url: None,
            allow_insecure_tls: None,
            message: None,
        };
    }

    AiProviderDto {
        id: AiProviderId::CodexCli,
        name: "Codex CLI".to_owned(),
        status: AiProviderStatus::NotAuthenticated,
        available: false,
        models: Vec::new(),
        executable_path: Some(path.display().to_string()),
        version,
        base_url: None,
        allow_insecure_tls: None,
        message: Some("Codex CLI is installed, but it is not signed in".to_owned()),
    }
}

fn resolve_codex_binary_with_startup_retry() -> Option<PathBuf> {
    resolve_codex_binary_with_retry(resolve_codex_binary, &[100, 400])
}

fn resolve_codex_binary_with_retry(
    mut resolve: impl FnMut() -> Option<PathBuf>,
    delays_ms: &[u64],
) -> Option<PathBuf> {
    if let Some(path) = resolve() {
        return Some(path);
    }
    for delay_ms in delays_ms {
        thread::sleep(Duration::from_millis(*delay_ms));
        if let Some(path) = resolve() {
            return Some(path);
        }
    }
    None
}

pub fn available_codex_models() -> Vec<String> {
    let Some(path) = resolve_codex_binary() else {
        return Vec::new();
    };
    query_codex_models(&path).unwrap_or_default()
}

fn query_codex_models(path: &Path) -> Option<Vec<String>> {
    query_codex_models_with_timeout(path, Duration::from_secs(5))
}

fn query_codex_models_with_timeout(path: &Path, timeout: Duration) -> Option<Vec<String>> {
    let mut child = codex_command(path)
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let requests_written = (|| {
        write_app_server_message(
            &mut stdin,
            &serde_json::json!({
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "mework",
                        "title": "mework",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {"experimentalApi": true}
                }
            }),
        )?;
        write_app_server_message(
            &mut stdin,
            &serde_json::json!({"method": "initialized", "params": {}}),
        )?;
        write_app_server_message(
            &mut stdin,
            &serde_json::json!({
                "id": 2,
                "method": "model/list",
                "params": {"includeHidden": false, "limit": 1000}
            }),
        )
    })();

    let result = if requests_written.is_some() {
        let (sender, receiver) = mpsc::channel();
        let reader_handle = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                let Ok(bytes_read) = reader.read_line(&mut line) else {
                    return;
                };
                if bytes_read == 0 {
                    return;
                }
                let Ok(message) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                    continue;
                };
                if message.get("id").and_then(serde_json::Value::as_u64) == Some(2) {
                    let _ = sender.send(parse_codex_model_list_response(&message));
                    return;
                }
            }
        });
        let result = receiver.recv_timeout(timeout).ok().flatten();
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        let _ = reader_handle.join();
        result
    } else {
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        None
    };
    result
}

fn write_app_server_message(stdin: &mut ChildStdin, message: &serde_json::Value) -> Option<()> {
    serde_json::to_writer(&mut *stdin, message).ok()?;
    stdin.write_all(b"\n").ok()?;
    stdin.flush().ok()
}

pub fn parse_codex_model_list_response(value: &serde_json::Value) -> Option<Vec<String>> {
    let entries = value.get("result")?.get("data")?.as_array()?;
    let mut models = Vec::new();
    for entry in entries {
        if entry
            .get("hidden")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        let model = entry
            .get("model")
            .and_then(serde_json::Value::as_str)
            .or_else(|| entry.get("id").and_then(serde_json::Value::as_str))
            .map(str::trim)
            .filter(|model| {
                !model.is_empty() && model.len() <= 200 && !model.chars().any(char::is_control)
            });
        let Some(model) = model else {
            continue;
        };
        if !models.iter().any(|known| known == model) {
            models.push(model.to_owned());
        }
    }
    Some(models)
}

pub fn resolve_codex_binary() -> Option<PathBuf> {
    if let Some(configured) = env::var_os("MEWORK_CODEX_BIN") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some(path);
        }
    }
    let windows = cfg!(target_os = "windows");
    if let Some(path) = env::var_os("PATH") {
        for entry in env::split_paths(&path) {
            for executable in codex_executable_names(windows) {
                let candidate = entry.join(executable);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    let candidates = codex_install_paths(
        env::var_os("HOME").map(PathBuf::from),
        env::var_os("LOCALAPPDATA").map(PathBuf::from),
        env::var_os("USERPROFILE").map(PathBuf::from),
        windows,
    );
    #[cfg(windows)]
    let candidates = candidates
        .into_iter()
        .chain(windows_codex_install_paths())
        .collect::<Vec<_>>();
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(windows)]
fn windows_codex_install_paths() -> Vec<PathBuf> {
    let mut paths = codex_install_paths(None, dirs::data_local_dir(), dirs::home_dir(), true);
    if let Some(path) = env::current_exe()
        .ok()
        .as_deref()
        .and_then(codex_path_beside_installed_app)
    {
        paths.push(path);
    }
    paths
}

#[cfg(windows)]
fn codex_path_beside_installed_app(executable: &Path) -> Option<PathBuf> {
    let app_dir = executable.parent()?;
    let local_app_data = app_dir.parent()?;
    let app_data = local_app_data.parent()?;
    if !app_dir
        .file_name()?
        .to_string_lossy()
        .eq_ignore_ascii_case("mework")
        || !local_app_data
            .file_name()?
            .to_string_lossy()
            .eq_ignore_ascii_case("Local")
        || !app_data
            .file_name()?
            .to_string_lossy()
            .eq_ignore_ascii_case("AppData")
    {
        return None;
    }
    Some(local_app_data.join("Programs/OpenAI/Codex/bin/codex.exe"))
}

fn codex_executable_names(windows: bool) -> &'static [&'static str] {
    if windows {
        &["codex.exe", "codex.cmd", "codex"]
    } else {
        &["codex"]
    }
}

fn codex_install_paths(
    home: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
    user_profile: Option<PathBuf>,
    windows: bool,
) -> Vec<PathBuf> {
    if windows {
        let mut candidates = Vec::new();
        if let Some(local_app_data) = local_app_data {
            candidates.push(local_app_data.join("Programs/OpenAI/Codex/bin/codex.exe"));
        }
        if let Some(user_profile) = user_profile.or(home) {
            candidates.push(user_profile.join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe"));
        }
        return candidates;
    }

    [
        Some(PathBuf::from("/opt/homebrew/bin/codex")),
        Some(PathBuf::from("/usr/local/bin/codex")),
        home.as_ref().map(|value| value.join(".local/bin/codex")),
        home.map(|value| value.join(".npm-global/bin/codex")),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn unavailable_provider(path: PathBuf, models: Vec<String>, message: &str) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::CodexCli,
        name: "Codex CLI".to_owned(),
        status: AiProviderStatus::Unavailable,
        available: false,
        models,
        executable_path: Some(path.display().to_string()),
        version: None,
        base_url: None,
        allow_insecure_tls: None,
        message: Some(message.to_owned()),
    }
}

fn safe_first_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| {
            line.chars()
                .filter(|character| !character.is_control())
                .take(120)
                .collect()
        })
}

async fn validate_settings(pool: &SqlitePool, settings: &AiSettings) -> Result<(), String> {
    if settings.model.trim().is_empty() {
        return Err("Selected AI model is invalid".to_owned());
    }
    let provider = match settings.provider {
        Some(provider) => provider,
        None => return Err("Select an AI provider before saving".to_owned()),
    };
    let providers = dto(pool).await?.providers;
    let Some(provider_status) = providers.iter().find(|item| item.id == provider) else {
        return Err("Selected AI provider is unavailable".to_owned());
    };
    if !provider_status.available
        || provider_status.status != AiProviderStatus::Connected
        || !provider_status
            .models
            .iter()
            .any(|model| model == &settings.model)
    {
        return Err("Selected AI model is invalid".to_owned());
    }
    Ok(())
}

fn openai_credential_store() -> OsKeyring {
    OsKeyring::new(AI_KEYRING_SERVICE)
}

async fn load_openai_config(
    pool: &SqlitePool,
) -> Result<Option<OpenAiCompatibleProviderConfig>, String> {
    let value = repositories::get_setting(pool, OPENAI_COMPATIBLE_SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load OpenAI-compatible API settings".to_owned())?;
    value
        .map(|raw| {
            serde_json::from_str::<OpenAiCompatibleProviderConfig>(&raw)
                .map_err(|_| "stored OpenAI-compatible API settings are invalid".to_owned())
        })
        .transpose()
}

pub async fn configured_openai_credential_ref(pool: &SqlitePool) -> Result<Option<String>, String> {
    Ok(load_openai_config(pool)
        .await?
        .map(|config| config.credential_ref))
}

pub async fn openai_compatible_runtime_config(
    pool: &SqlitePool,
) -> Result<OpenAiCompatibleRuntimeConfig, String> {
    let Some(config) = load_openai_config(pool).await? else {
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

async fn inspect_openai_compatible(pool: &SqlitePool) -> AiProviderDto {
    let config = match load_openai_config(pool).await {
        Ok(Some(config)) => config,
        Ok(None) => return openai_not_configured_provider(),
        Err(message) => return openai_unavailable_provider(None, message),
    };
    let base_url = match normalize_openai_base_url(&config.base_url) {
        Ok(base_url) => base_url,
        Err(message) => return openai_unavailable_provider(Some(config.base_url), message),
    };
    let token =
        match openai_credential_store().load(&config.credential_ref) {
            Ok(token) => token,
            Err(_) => return openai_provider(
                AiProviderStatus::NotAuthenticated,
                false,
                base_url,
                Vec::new(),
                Some(config.allow_insecure_tls),
                Some(
                    "OpenAI-compatible API token is not available in the operating system keyring"
                        .to_owned(),
                ),
            ),
        };
    match load_openai_models(&base_url, &token, config.allow_insecure_tls).await {
        Ok(models) => openai_provider(
            AiProviderStatus::Connected,
            true,
            base_url,
            models,
            Some(config.allow_insecure_tls),
            None,
        ),
        Err(message) => openai_provider(
            AiProviderStatus::Unavailable,
            false,
            base_url,
            Vec::new(),
            Some(config.allow_insecure_tls),
            Some(message),
        ),
    }
}

fn openai_not_configured_provider() -> AiProviderDto {
    openai_provider(
        AiProviderStatus::NotConfigured,
        false,
        String::new(),
        Vec::new(),
        None,
        Some("Configure an API URL and token to load available models".to_owned()),
    )
}

fn openai_unavailable_provider(base_url: Option<String>, message: String) -> AiProviderDto {
    openai_provider(
        AiProviderStatus::Unavailable,
        false,
        base_url.unwrap_or_default(),
        Vec::new(),
        None,
        Some(message),
    )
}

fn openai_provider(
    status: AiProviderStatus,
    available: bool,
    base_url: String,
    models: Vec<String>,
    allow_insecure_tls: Option<bool>,
    message: Option<String>,
) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::OpenAiCompatible,
        name: "OpenAI-compatible API".to_owned(),
        status,
        available,
        models,
        executable_path: None,
        version: None,
        base_url: (!base_url.is_empty()).then_some(base_url),
        allow_insecure_tls,
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
    let label = safe_openai_error_label(error.get("code"))
        .or_else(|| safe_openai_error_label(error.get("type")))?;
    let parameter = safe_openai_error_label(error.get("param"));
    Some(match parameter {
        Some(parameter) => format!("{label} (parameter: {parameter})"),
        None => label,
    })
}

fn safe_openai_error_label(value: Option<&serde_json::Value>) -> Option<String> {
    let label = value?.as_str()?.trim();
    if label.is_empty()
        || label.chars().count() > 80
        || !label.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | '[' | ']')
        })
    {
        return None;
    }
    Some(label.to_owned())
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
const OPENAI_DEBUG_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
static OPENAI_DEBUG_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

#[cfg(debug_assertions)]
pub fn initialize_openai_debug_log(app_data_dir: &Path) {
    let path = app_data_dir
        .join("logs")
        .join("openai-compatible-debug.log");
    let _ = fs::create_dir_all(path.parent().unwrap_or(app_data_dir));
    let _ = OPENAI_DEBUG_LOG_PATH.set(path);
}

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

pub fn log_openai_chat_response(operation: &str, status: u16, headers: &HeaderMap, body: &[u8]) {
    let mut safe_headers = serde_json::Map::new();
    for header_name in [
        "content-type",
        "content-length",
        "server",
        "allow",
        "x-request-id",
        "request-id",
        "retry-after",
    ] {
        if let Some(value) = headers
            .get(header_name)
            .and_then(|value| value.to_str().ok())
        {
            safe_headers.insert(
                header_name.to_owned(),
                Value::String(truncate_openai_log_text(&redact_bearer_tokens(value))),
            );
        }
    }
    append_openai_debug_json(&serde_json::json!({
        "event": "response",
        "operation": operation,
        "status": status,
        "headers": safe_headers,
        "body": redact_openai_debug_body(body),
    }));
}

pub fn log_openai_transport_error(operation: &str, detail: &str) {
    append_openai_debug_json(&serde_json::json!({
        "event": "transport_error",
        "operation": operation,
        "detail": truncate_openai_log_text(&redact_bearer_tokens(detail)),
    }));
}

fn append_openai_debug_json(value: &Value) {
    let Some(path) = OPENAI_DEBUG_LOG_PATH.get() else {
        return;
    };
    if fs::metadata(path)
        .map(|metadata| metadata.len() > OPENAI_DEBUG_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::write(path, "");
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let Ok(line) = serde_json::to_string(value) else {
        return;
    };
    let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{timestamp} {line}");
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

fn redact_openai_debug_body(body: &[u8]) -> Value {
    let text = String::from_utf8_lossy(body);
    let value = serde_json::from_slice::<Value>(body)
        .map(redact_openai_debug_value)
        .ok();
    match value {
        Some(value) => Value::String(truncate_openai_log_text(
            &serde_json::to_string(&value).unwrap_or_else(|_| "[invalid-json]".to_owned()),
        )),
        None => Value::String(truncate_openai_log_text(&redact_bearer_tokens(&text))),
    }
}

fn redact_openai_debug_value(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    let lower_key = key.to_ascii_lowercase();
                    let value = if [
                        "authorization",
                        "api_key",
                        "apikey",
                        "credential",
                        "password",
                        "secret",
                        "token",
                    ]
                    .iter()
                    .any(|part| lower_key.contains(part))
                    {
                        Value::String("[REDACTED]".to_owned())
                    } else {
                        redact_openai_debug_value(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(values) => {
            Value::Array(values.into_iter().map(redact_openai_debug_value).collect())
        }
        Value::String(value) => Value::String(redact_bearer_tokens(&value)),
        value => value,
    }
}

fn redact_bearer_tokens(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut result = String::new();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("bearer ") {
        let start = cursor + relative_start;
        result.push_str(&value[cursor..start]);
        result.push_str("Bearer [REDACTED]");
        let token_start = start + "bearer ".len();
        let token_end = value[token_start..]
            .char_indices()
            .find(|(_, character)| {
                character.is_whitespace() || matches!(character, '"' | '\'' | ',' | ')' | ']')
            })
            .map(|(index, _)| token_start + index)
            .unwrap_or(value.len());
        cursor = token_end;
    }
    result.push_str(&value[cursor..]);
    result
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
        .send()
        .await
        .map_err(|_| "OpenAI-compatible API could not be reached".to_owned())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("OpenAI-compatible API authorization failed".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!(
            "OpenAI-compatible API returned HTTP {} while loading models",
            response.status().as_u16()
        ));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "OpenAI-compatible API returned an invalid model catalog".to_owned())?;
    parse_openai_model_list_response(&payload)
        .ok_or_else(|| "OpenAI-compatible API returned an invalid model catalog".to_owned())
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
    #[cfg(unix)]
    use super::{inspect_codex_cli, query_codex_models_with_timeout, AiProviderStatus};
    use super::{
        load_openai_models, normalize_openai_base_url, parse_codex_model_list_response,
        parse_openai_model_list_response, safe_first_line, safe_openai_error_detail, AiProviderId,
        AiReasoning, AiSettings, OpenAiCompatibleProviderConfig,
    };

    #[test]
    fn defaults_to_no_provider_until_user_saves_one() {
        let settings = AiSettings::default();
        assert_eq!(settings.provider, None);
        assert_eq!(settings.model, "");
        assert_eq!(settings.reasoning, AiReasoning::Medium);
        assert!(!settings.fast_mode);
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
    }

    #[test]
    fn debug_body_redacts_bearer_and_credential_fields() {
        let body = br#"{"error":{"message":"Bearer synthetic-token is invalid","api_key":"synthetic-key","detail":"keep this diagnostic"}}"#;
        let logged = super::redact_openai_debug_body(body).to_string();
        assert!(!logged.contains("synthetic-token"));
        assert!(!logged.contains("synthetic-key"));
        assert!(logged.contains("[REDACTED]"));
        assert!(logged.contains("keep this diagnostic"));
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
    fn serializes_provider_and_reasoning_for_renderer_contract() {
        let settings = AiSettings {
            provider: Some(AiProviderId::CodexCli),
            model: "gpt-5.5".to_owned(),
            reasoning: AiReasoning::High,
            fast_mode: true,
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
        let candidates = super::codex_install_paths(
            Some(user_profile.clone()),
            Some(local_app_data),
            Some(user_profile.clone()),
            true,
        );
        let expected = user_profile.join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe");

        assert!(candidates.iter().any(|candidate| candidate == &expected));
        #[cfg(windows)]
        assert!(super::windows_codex_install_paths().contains(
            &dirs::data_local_dir()
                .expect("Windows local app data folder")
                .join("Programs/OpenAI/Codex/bin/codex.exe")
        ));
        #[cfg(windows)]
        assert_eq!(
            super::codex_path_beside_installed_app(
                &user_profile.join("AppData/Local/mework/mework.exe")
            ),
            Some(expected)
        );
        assert_eq!(
            super::codex_executable_names(true),
            &["codex.exe", "codex.cmd", "codex"]
        );
    }

    #[test]
    fn retries_transient_codex_binary_discovery() {
        let expected = std::path::PathBuf::from("synthetic-codex");
        let mut attempts = 0;

        let resolved = super::resolve_codex_binary_with_retry(
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
        std::env::set_var("MEWORK_CODEX_BIN", &binary);

        let provider = inspect_codex_cli();

        std::env::remove_var("MEWORK_CODEX_BIN");
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
            base_url: "https://api.example.invalid/v1".to_owned(),
            credential_ref: "ai-openai-compatible".to_owned(),
            allow_insecure_tls: true,
        };
        let value = serde_json::to_value(config).unwrap();

        assert!(value.get("staticModels").is_none());
        assert_eq!(value["allowInsecureTls"], true);
        assert_eq!(value["credentialRef"], "ai-openai-compatible");
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
