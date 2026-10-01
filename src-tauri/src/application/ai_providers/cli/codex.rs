use super::{local_cli_command, run_cli_output, spawn_cli, usable_cli_path};
use crate::application::ai::{AiProviderDto, AiProviderId, AiProviderStatus, AiSettings};
use crate::application::ai_usage_statistics::{self, AiTokenUsageCounts};
use std::{
    env,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

pub(crate) fn command(path: impl AsRef<std::ffi::OsStr>) -> Command {
    local_cli_command(path)
}

pub(crate) enum RunError {
    MissingBinary,
    PromptOpen,
    Spawn,
    Failed(std::process::Output),
    ResultRead,
}

pub(crate) fn run_structured_with_usage(
    settings: &AiSettings,
    prompt_path: &Path,
    schema_path: &Path,
    output_path: &Path,
    workdir: &Path,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), RunError> {
    let binary = resolve_codex_binary().ok_or_else(|| {
        crate::application::logging::error("ai.cli", "executable_missing", serde_json::json!({"provider": "codex", "operation": "structured_generation", "model": settings.model}));
        RunError::MissingBinary
    })?;

    let reasoning = settings.reasoning.as_str();
    let service_tier = if settings.fast_mode {
        "fast"
    } else {
        "default"
    };
    let fast_mode = if settings.fast_mode { "true" } else { "false" };
    let mut command = command(binary);
    command
        .args([
            "--ask-for-approval",
            "never",
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "--json",
            "--model",
            &settings.model,
            "--config",
            &format!("model_reasoning_effort=\"{reasoning}\""),
            "--config",
            &format!("service_tier=\"{service_tier}\""),
            "--config",
            &format!("features.fast_mode={fast_mode}"),
            "--output-schema",
            schema_path.to_string_lossy().as_ref(),
            "--output-last-message",
            output_path.to_string_lossy().as_ref(),
            "-",
        ])
        .current_dir(workdir)
        .stdin(Stdio::from(std::fs::File::open(prompt_path).map_err(|_| {
            crate::application::logging::error("ai.cli", "prompt_file_open_failure", serde_json::json!({"provider": "codex", "operation": "structured_generation", "model": settings.model}));
            RunError::PromptOpen
        })?));
    let output = match run_cli_output(
        &mut command,
        "codex",
        "structured_generation",
        Some(&settings.model),
    ) {
        Ok(output) => output,
        Err(_) => return Err(RunError::Spawn),
    };
    if !output.status.success() {
        return Err(RunError::Failed(output));
    }
    let bytes = match std::fs::read(output_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            crate::application::logging::error(
                "ai.cli",
                "result_file_read_failure",
                serde_json::json!({"provider": "codex", "operation": "structured_generation"}),
            );
            return Err(RunError::ResultRead);
        }
    };
    let usage = ai_usage_statistics::parse_cli_usage(&output.stdout);
    Ok((bytes, usage))
}

pub fn inspect_codex_cli() -> AiProviderDto {
    let Some(path) = resolve_codex_binary_with_startup_retry() else {
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            instance_id: None,
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

    let mut version_command = command(&path);
    version_command.arg("--version");
    let version_output = run_cli_output(&mut version_command, "codex", "version_probe", None);
    let Ok(version_output) = version_output else {
        return unavailable_provider(path, Vec::new(), "Codex CLI could not be started");
    };
    if !version_output.status.success() {
        return unavailable_provider(path, Vec::new(), "Codex CLI is installed but unavailable");
    }
    let version =
        safe_first_line(&version_output.stdout).or_else(|| safe_first_line(&version_output.stderr));

    let mut login_command = command(&path);
    login_command.args(["login", "status"]);
    let login_output = run_cli_output(&mut login_command, "codex", "login_status_probe", None);
    let Ok(login_output) = login_output else {
        return AiProviderDto {
            id: AiProviderId::CodexCli,
            instance_id: None,
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
            instance_id: None,
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
        instance_id: None,
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

pub(crate) fn resolve_codex_binary_with_retry(
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

pub(crate) fn query_codex_models_with_timeout(
    path: &Path,
    timeout: Duration,
) -> Option<Vec<String>> {
    let mut model_command = command(path);
    model_command
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (mut child, invocation) =
        match spawn_cli(&mut model_command, "codex", "model_catalog", None) {
            Ok(process) => process,
            Err(_) => return None,
        };
    let Some(mut stdin) = child.stdin.take() else {
        invocation.failed(None, &[], &[]);
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let Some(stdout) = child.stdout.take() else {
        invocation.failed(None, &[], &[]);
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let Some(mut stderr) = child.stderr.take() else {
        invocation.failed(None, &[], &[]);
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
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

    let (result, exit_code) = if requests_written.is_some() {
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
                    crate::application::logging::log_parse_failure(
                        "ai.cli",
                        "codex_model_catalog",
                        "json_line",
                        line.as_bytes(),
                    );
                    continue;
                };
                if message.get("id").and_then(serde_json::Value::as_u64) == Some(2) {
                    let models = parse_codex_model_list_response(&message);
                    if models.is_none() {
                        crate::application::logging::log_parse_failure(
                            "ai.cli",
                            "codex_model_catalog",
                            "response_shape",
                            line.as_bytes(),
                        );
                    }
                    let _ = sender.send(models);
                    return;
                }
            }
        });
        let result = receiver.recv_timeout(timeout).ok().flatten();
        drop(stdin);
        let _ = child.kill();
        let exit_code = child.wait().ok().and_then(|status| status.code());
        let _ = reader_handle.join();
        (result, exit_code)
    } else {
        drop(stdin);
        let _ = child.kill();
        let exit_code = child.wait().ok().and_then(|status| status.code());
        (None, exit_code)
    };
    let stderr = stderr_reader.join().unwrap_or_default();
    if result.is_none() {
        invocation.failed(exit_code, &[], &stderr);
    } else {
        invocation.completed(result.as_ref().map_or(0, Vec::len));
    }
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
        if let Some(path) = usable_cli_path(&path) {
            return Some(path);
        }
    }
    let windows = cfg!(target_os = "windows");
    if let Some(path) = env::var_os("PATH") {
        for entry in env::split_paths(&path) {
            for executable in executable_names(windows) {
                let candidate = entry.join(executable);
                if let Some(path) = usable_cli_path(&candidate) {
                    return Some(path);
                }
            }
        }
    }
    let candidates = install_paths(
        env::var_os("HOME").map(PathBuf::from),
        env::var_os("LOCALAPPDATA").map(PathBuf::from),
        env::var_os("USERPROFILE").map(PathBuf::from),
        windows,
    );
    #[cfg(windows)]
    let candidates = candidates
        .into_iter()
        .chain(windows_install_paths())
        .collect::<Vec<_>>();
    candidates
        .into_iter()
        .find_map(|path| usable_cli_path(&path))
}

#[cfg(windows)]
pub(crate) fn windows_install_paths() -> Vec<PathBuf> {
    let mut paths = install_paths(None, dirs::data_local_dir(), dirs::home_dir(), true);
    if let Some(path) = env::current_exe()
        .ok()
        .as_deref()
        .and_then(path_beside_installed_app)
    {
        paths.push(path);
    }
    paths
}

#[cfg(windows)]
pub(crate) fn path_beside_installed_app(executable: &Path) -> Option<PathBuf> {
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

pub(crate) fn executable_names(windows: bool) -> &'static [&'static str] {
    if windows {
        &["codex.exe", "codex.cmd", "codex"]
    } else {
        &["codex"]
    }
}

pub(crate) fn install_paths(
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
        instance_id: None,
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

pub(crate) fn safe_first_line(bytes: &[u8]) -> Option<String> {
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
