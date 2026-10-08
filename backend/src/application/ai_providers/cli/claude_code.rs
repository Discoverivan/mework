use std::{
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde_json::Value;

use super::{local_cli_command, run_cli_output, spawn_cli};
use crate::application::ai::{AiProviderDto, AiProviderId, AiProviderStatus};
use crate::application::ai_usage_statistics::{parse_response_usage, AiTokenUsageCounts};

const MODELS: [&str; 3] = ["sonnet", "opus", "haiku"];

pub fn inspect() -> AiProviderDto {
    let Some(path) = resolve_binary() else {
        return provider(
            AiProviderStatus::NotFound,
            None,
            None,
            "Claude Code CLI was not found on this computer",
        );
    };
    let mut version_command = local_cli_command(&path);
    version_command.arg("--version");
    let Ok(version_output) =
        run_cli_output(&mut version_command, "claude_code", "version_probe", None)
    else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(&path),
            None,
            "Claude Code CLI could not be started",
        );
    };
    if !version_output.status.success() {
        return provider(
            AiProviderStatus::Unavailable,
            Some(&path),
            None,
            "Claude Code CLI is installed but unavailable",
        );
    }
    let version = String::from_utf8_lossy(&version_output.stdout)
        .lines()
        .next()
        .map(|line| {
            line.trim()
                .chars()
                .filter(|c| !c.is_control())
                .take(120)
                .collect::<String>()
        });
    let mut auth_command = local_cli_command(&path);
    auth_command.args(["auth", "status"]);
    match run_cli_output(&mut auth_command, "claude_code", "auth_status_probe", None) {
        Ok(output) if output.status.success() => AiProviderDto {
            id: AiProviderId::ClaudeCodeCli,
            instance_id: None,
            name: "Claude Code CLI".to_owned(),
            status: AiProviderStatus::Connected,
            available: true,
            models: MODELS.iter().map(|model| (*model).to_owned()).collect(),
            executable_path: Some(path.display().to_string()),
            version,
            base_url: None,
            allow_insecure_tls: None,
            message: None,
        },
        Ok(_) => provider(
            AiProviderStatus::NotAuthenticated,
            Some(&path),
            version,
            "Claude Code CLI is installed, but it is not signed in",
        ),
        Err(_) => provider(
            AiProviderStatus::Unavailable,
            Some(&path),
            version,
            "Claude Code CLI login status could not be checked",
        ),
    }
}

fn provider(
    status: AiProviderStatus,
    path: Option<&Path>,
    version: Option<String>,
    message: &str,
) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::ClaudeCodeCli,
        instance_id: None,
        name: "Claude Code CLI".to_owned(),
        status,
        available: false,
        models: Vec::new(),
        executable_path: path.map(|path| path.display().to_string()),
        version,
        base_url: None,
        allow_insecure_tls: None,
        message: Some(message.to_owned()),
    }
}

pub fn resolve_binary() -> Option<PathBuf> {
    super::discovery::resolve_binary(AiProviderId::ClaudeCodeCli)
}

pub(crate) fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude"]
    } else {
        &["claude"]
    }
}

pub(crate) fn diagnostic_install_paths() -> Vec<(&'static str, PathBuf)> {
    let home = dirs::home_dir();
    let mut candidates = Vec::new();
    if let Some(home) = home.as_ref() {
        candidates.push((
            "HOME-or-USERPROFILE",
            home.join(if cfg!(windows) {
                ".local/bin/claude.exe"
            } else {
                ".local/bin/claude"
            }),
        ));
    }
    #[cfg(windows)]
    {
        if let Some(home) = dirs::home_dir() {
            candidates.push(("system-home", home.join(".local/bin/claude.exe")));
        }
        if let Some(roaming) = dirs::config_dir() {
            candidates.push(("system-config", roaming.join("npm/claude.cmd")));
        }
    }
    #[cfg(not(windows))]
    {
        candidates.push(("homebrew", PathBuf::from("/opt/homebrew/bin/claude")));
        candidates.push(("usr-local", PathBuf::from("/usr/local/bin/claude")));
    }
    candidates
}

pub fn run_structured(
    model: &str,
    schema: &str,
    prompt: &str,
    workdir: &Path,
) -> Result<Vec<u8>, String> {
    run_structured_with_usage(model, schema, prompt, workdir).map(|(output, _)| output)
}

pub fn run_structured_with_usage(
    model: &str,
    schema: &str,
    prompt: &str,
    workdir: &Path,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    if !MODELS.contains(&model) {
        return Err("Selected Claude Code model is invalid".to_owned());
    }
    let binary = resolve_binary().ok_or_else(|| {
        crate::application::logging::error("ai.cli", "executable_missing", serde_json::json!({"provider": "claude_code", "operation": "structured_generation", "model": model}));
        "Claude Code CLI executable was not found".to_owned()
    })?;
    let schema = simplify_schema(schema)?;
    let mut command = local_cli_command(binary);
    command
        .args([
            "--bare",
            "--tools",
            "",
            "--no-session-persistence",
            "--output-format",
            "json",
            "--json-schema",
            &schema,
            "--model",
            model,
            "-p",
            "Process the supplied input and return the requested structured output.",
        ])
        .current_dir(workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (mut child, invocation) = spawn_cli(
        &mut command,
        "claude_code",
        "structured_generation",
        Some(model),
    )
    .map_err(|_| "Unable to start Claude Code CLI".to_owned())?;
    let Some(mut stdin) = child.stdin.take() else {
        invocation.failed(None, &[], &[]);
        let _ = child.kill();
        let _ = child.wait();
        return Err("Unable to send input to Claude Code CLI".to_owned());
    };
    if stdin.write_all(prompt.as_bytes()).is_err() {
        invocation.failed(None, &[], &[]);
        crate::application::logging::error(
            "ai.cli",
            "stdin_write_failure",
            serde_json::json!({"provider": "claude_code", "operation": "structured_generation", "model": model}),
        );
        let _ = child.kill();
        let _ = child.wait();
        return Err("Unable to send input to Claude Code CLI".to_owned());
    }
    drop(stdin);
    let output = child.wait_with_output().map_err(|_| {
        invocation.failed(None, &[], &[]);
        "Claude Code CLI did not return a result".to_owned()
    })?;
    if !output.status.success() {
        invocation.failed(output.status.code(), &output.stdout, &output.stderr);
        return Err("Claude Code CLI run failed".to_owned());
    }
    let response: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        crate::application::logging::log_parse_failure(
            "ai.cli",
            "claude_code_structured_generation",
            "json",
            &output.stdout,
        );
        "Claude Code CLI returned invalid JSON".to_owned()
    })?;
    let usage = parse_response_usage(&response);
    let structured = response.get("structured_output").ok_or_else(|| {
        crate::application::logging::log_parse_failure(
            "ai.cli",
            "claude_code_structured_generation",
            "missing_structured_output",
            &output.stdout,
        );
        "Claude Code CLI returned no structured result".to_owned()
    })?;
    let output_bytes = serde_json::to_vec(structured).map_err(|_| {
        crate::application::logging::log_parse_failure(
            "ai.cli",
            "claude_code_structured_generation",
            "structured_serialization",
            &output.stdout,
        );
        "Claude Code CLI returned invalid structured output".to_owned()
    })?;
    invocation.completed(output_bytes.len());
    Ok((output_bytes, usage))
}

fn simplify_schema(schema: &str) -> Result<String, String> {
    fn strip_constraints(value: &mut Value) {
        match value {
            Value::Object(fields) => {
                for key in ["minimum", "maximum", "minLength", "maxLength"] {
                    fields.remove(key);
                }
                for child in fields.values_mut() {
                    strip_constraints(child);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(strip_constraints),
            _ => {}
        }
    }
    let mut value: Value = serde_json::from_str(schema)
        .map_err(|_| "Claude Code output schema is invalid".to_owned())?;
    strip_constraints(&mut value);
    serde_json::to_string(&value).map_err(|_| "Claude Code output schema is invalid".to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use super::{inspect, run_structured};
    use crate::application::ai::AiProviderStatus;

    #[test]
    fn detects_authenticated_cli_and_reads_structured_output() {
        let _lock = crate::application::ai::test_process_env_lock()
            .lock()
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join(if cfg!(windows) {
            "claude.cmd"
        } else {
            "claude"
        });
        #[cfg(unix)]
        fs::write(
            &binary,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '2.1.0\\n'; elif [ \"$1\" = \"auth\" ]; then printf '{\"loggedIn\":true}\\n'; else cat >/dev/null; printf '%s\\n' '{\"structured_output\":{\"summary\":\"Example task\",\"description\":\"Example description\"}}'; fi\n",
        )
        .unwrap();
        #[cfg(windows)]
        fs::write(
            &binary,
            "@echo off\r\nif \"%1\"==\"--version\" (echo 2.1.0 & exit /b 0)\r\nif \"%1\"==\"auth\" (echo {\"loggedIn\":true} & exit /b 0)\r\nmore > nul\r\necho {\"structured_output\":{\"summary\":\"Example task\",\"description\":\"Example description\"}}\r\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&binary).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&binary, permissions).unwrap();
        }
        std::env::set_var("MEWORK_CLAUDE_CODE_CLI_BIN", &binary);

        let provider = inspect();
        let output = run_structured(
            "sonnet",
            r#"{"type":"object","properties":{"summary":{"type":"string"}}}"#,
            "Create an example task",
            directory.path(),
        )
        .unwrap();

        std::env::remove_var("MEWORK_CLAUDE_CODE_CLI_BIN");
        assert_eq!(provider.status, AiProviderStatus::Connected);
        assert_eq!(provider.models, vec!["sonnet", "opus", "haiku"]);
        assert_eq!(provider.version.as_deref(), Some("2.1.0"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&output).unwrap()["summary"],
            "Example task"
        );
    }
}
