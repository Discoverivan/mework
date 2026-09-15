use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::infrastructure::db::repositories;

const AI_SETTINGS_KEY: &str = "ai.settings";
const AI_SETTINGS_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AiProviderId {
    CodexCli,
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
    validate_settings(&settings)?;
    let value = serde_json::to_string(&settings)
        .map_err(|_| "failed to serialize AI settings".to_owned())?;
    repositories::upsert_setting(pool, AI_SETTINGS_KEY, &value, AI_SETTINGS_SCHEMA_VERSION)
        .await
        .map_err(|_| "failed to save AI settings".to_owned())
}

pub async fn dto(pool: &SqlitePool) -> Result<AiSettingsPageDto, String> {
    let settings = load(pool).await?;
    let provider = tokio::task::spawn_blocking(inspect_codex_cli)
        .await
        .map_err(|_| "failed to inspect Codex CLI".to_owned())?;
    Ok(AiSettingsPageDto {
        settings,
        providers: vec![provider],
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
            "Selected Codex model is not available. Refresh Settings → Integrations and choose an available model"
                .to_owned(),
        );
    }
    Ok(data.settings)
}

pub fn inspect_codex_cli() -> AiProviderDto {
    let Some(path) = resolve_codex_binary() else {
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            name: "Codex CLI".to_owned(),
            status: AiProviderStatus::NotFound,
            available: false,
            models: Vec::new(),
            executable_path: None,
            version: None,
            message: Some("Codex CLI was not found on this computer".to_owned()),
        };
    };

    let version_output = Command::new(&path).arg("--version").output();
    let Ok(version_output) = version_output else {
        return unavailable_provider(path, Vec::new(), "Codex CLI could not be started");
    };
    if !version_output.status.success() {
        return unavailable_provider(path, Vec::new(), "Codex CLI is installed but unavailable");
    }
    let version =
        safe_first_line(&version_output.stdout).or_else(|| safe_first_line(&version_output.stderr));

    let login_output = Command::new(&path).args(["login", "status"]).output();
    let Ok(login_output) = login_output else {
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            name: "Codex CLI".to_owned(),
            status: AiProviderStatus::Unavailable,
            available: false,
            models: Vec::new(),
            executable_path: Some(path.display().to_string()),
            version,
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
        message: Some("Codex CLI is installed, but it is not signed in".to_owned()),
    }
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
    let mut child = Command::new(path)
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
    if let Some(path) = env::var_os("PATH") {
        for entry in env::split_paths(&path) {
            let candidate = entry.join("codex");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let home = env::var_os("HOME").map(PathBuf::from);
    [
        Some(PathBuf::from("/opt/homebrew/bin/codex")),
        Some(PathBuf::from("/usr/local/bin/codex")),
        home.as_ref().map(|value| value.join(".local/bin/codex")),
        home.as_ref()
            .map(|value| value.join(".npm-global/bin/codex")),
    ]
    .into_iter()
    .flatten()
    .find(|path| path.is_file())
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

fn validate_settings(settings: &AiSettings) -> Result<(), String> {
    if settings.model.trim().is_empty()
        || !available_codex_models()
            .iter()
            .any(|model| model == &settings.model)
    {
        return Err("Selected AI model is invalid".to_owned());
    }
    Ok(())
}

#[cfg(test)]
pub fn test_process_env_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
mod tests {
    use super::{
        inspect_codex_cli, parse_codex_model_list_response, query_codex_models_with_timeout,
        safe_first_line, AiProviderId, AiProviderStatus, AiReasoning, AiSettings,
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
    }

    #[test]
    fn exposes_only_safe_first_line_of_local_command_output() {
        assert_eq!(
            safe_first_line(b"codex-cli 0.142.5\nsecret-token"),
            Some("codex-cli 0.142.5".to_owned())
        );
        assert_eq!(safe_first_line(b"\n\n"), None);
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
