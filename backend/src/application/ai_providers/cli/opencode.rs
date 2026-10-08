use super::{capture_cli_output, local_cli_command};
use crate::application::ai::{AiProviderDto, AiProviderId, AiProviderStatus};
use crate::application::ai_usage_statistics::AiTokenUsageCounts;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

// OpenCode keeps ownership of its credentials. Only non-secret run configuration is created here.
struct Workspace {
    directory: tempfile::TempDir,
}
impl Workspace {
    fn new() -> Result<Self, String> {
        let directory =
            tempfile::tempdir().map_err(|_| "Unable to prepare OpenCode workspace".to_owned())?;
        let config = json!({
            "permission": {"*": "deny"}, "share": "disabled", "autoupdate": false,
            "snapshot": false, "instructions": [], "plugin": [], "mcp": {},
            "default_agent": "mework", "agent": {"mework": {
                "mode": "primary", "description": "Generate a mework structured response",
                "permission": {"*": "deny"}, "steps": 1,
                "prompt": "Use only the supplied input. Do not use tools. Return only the JSON object requested by the input."
            }}
        });
        std::fs::write(directory.path().join("opencode.json"), config.to_string())
            .map_err(|_| "Unable to prepare OpenCode configuration".to_owned())?;
        Ok(Self { directory })
    }
    fn command(&self, binary: &Path) -> Command {
        let mut command = local_cli_command(binary);
        let path = self.directory.path();
        command
            .current_dir(path)
            .env("NO_COLOR", "1")
            .env("OPENCODE_PURE", "1")
            .env("OPENCODE_DISABLE_PROJECT_CONFIG", "1")
            .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
            .env("OPENCODE_TEST_HOME", path)
            .env("XDG_CONFIG_HOME", path.join("config"))
            .env("OPENCODE_CONFIG_DIR", path)
            .env("OPENCODE_CONFIG", path.join("opencode.json"))
            .env("OPENCODE_DB", path.join("session.sqlite"))
            .env_remove("OPENCODE_CONFIG_CONTENT")
            .env_remove("OPENCODE_PERMISSION")
            .env_remove("OPENCODE_SERVER_PASSWORD")
            .env_remove("OPENCODE_SERVER_USERNAME");
        command
    }
}

pub fn inspect() -> AiProviderDto {
    resolve_binary()
        .map(|path| inspect_at(&path))
        .unwrap_or_else(|| {
            provider(
                AiProviderStatus::NotFound,
                None,
                None,
                vec![],
                Some("settings.opencode.notFound"),
            )
        })
}
fn provider(
    status: AiProviderStatus,
    path: Option<&Path>,
    version: Option<String>,
    models: Vec<String>,
    message: Option<&str>,
) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::OpenCodeCli,
        instance_id: None,
        name: "OpenCode CLI".to_owned(),
        status,
        available: status == AiProviderStatus::Connected,
        models,
        executable_path: path.map(|p| p.display().to_string()),
        version,
        base_url: None,
        allow_insecure_tls: None,
        message: message.map(str::to_owned),
    }
}
fn supported_version(version: &str) -> bool {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let major = parts.next().and_then(|v| v.parse::<u32>().ok());
    let minor = parts.next().and_then(|v| v.parse::<u32>().ok());
    let patch = parts.next().and_then(|v| v.parse::<u32>().ok());
    matches!((major, minor, patch), (Some(1), Some(minor), Some(_)) if minor >= 18)
        && parts.next().is_none()
}
fn capabilities(binary: &Path, workspace: &Workspace) -> Result<String, String> {
    let mut command = workspace.command(binary);
    command.arg("--version");
    let bytes = capture_cli_output(
        command,
        None,
        Duration::from_secs(10),
        "OpenCode CLI",
        "inspect",
        None,
    )?;
    let version = String::from_utf8_lossy(&bytes).trim().to_owned();
    if !supported_version(&version) {
        return Err("OpenCode CLI requires a supported stable 1.18+ version".to_owned());
    }
    let mut command = workspace.command(binary);
    command.args(["run", "--help"]);
    let bytes = capture_cli_output(
        command,
        None,
        Duration::from_secs(10),
        "OpenCode CLI",
        "inspect",
        None,
    )?;
    let help = String::from_utf8_lossy(&bytes);
    if ["--pure", "--format", "--model", "--agent", "--title"]
        .iter()
        .any(|flag| !help.contains(flag))
    {
        return Err("OpenCode CLI does not support isolated structured runs".to_owned());
    }
    Ok(version)
}
fn inspect_at(binary: &Path) -> AiProviderDto {
    let Ok(workspace) = Workspace::new() else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(binary),
            None,
            vec![],
            Some("settings.opencode.unavailable"),
        );
    };
    let Ok(version) = capabilities(binary, &workspace) else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(binary),
            None,
            vec![],
            Some("settings.opencode.unsupported"),
        );
    };
    let mut command = workspace.command(binary);
    command.args(["--pure", "models"]);
    let Ok(output) = capture_cli_output(
        command,
        None,
        Duration::from_secs(30),
        "OpenCode CLI",
        "inspect",
        None,
    ) else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(binary),
            Some(version),
            vec![],
            Some("settings.opencode.unavailable"),
        );
    };
    let models = parse_models(&output);
    let status = if models.is_empty() {
        AiProviderStatus::NotConfigured
    } else {
        AiProviderStatus::Connected
    };
    provider(
        status,
        Some(binary),
        Some(version),
        models,
        (status != AiProviderStatus::Connected).then_some("settings.opencode.configure"),
    )
}
fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 300
        && value.contains('/')
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._/:".contains(&b))
}
fn parse_models(output: &[u8]) -> Vec<String> {
    let mut models = String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .filter(|v| valid_identifier(v))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models
}
pub fn resolve_binary() -> Option<PathBuf> {
    super::discovery::resolve_binary(AiProviderId::OpenCodeCli)
}

pub(crate) fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["opencode.exe", "opencode.cmd"]
    } else {
        &["opencode"]
    }
}

pub(crate) fn diagnostic_install_paths() -> Vec<(&'static str, PathBuf)> {
    let home = dirs::home_dir();
    let mut paths = Vec::new();
    if let Some(home) = home {
        paths.push((
            "opencode-install",
            home.join(if cfg!(windows) {
                ".opencode/bin/opencode.exe"
            } else {
                ".opencode/bin/opencode"
            }),
        ));
        paths.push((
            "system-home",
            home.join(if cfg!(windows) {
                ".local/bin/opencode.exe"
            } else {
                ".local/bin/opencode"
            }),
        ));
        #[cfg(not(windows))]
        paths.push(("npm-global", home.join(".npm-global/bin/opencode")));
    }
    #[cfg(windows)]
    if let Some(config) = dirs::config_dir() {
        paths.push(("system-config", config.join("npm/opencode.cmd")));
    }
    #[cfg(not(windows))]
    paths.extend([
        ("homebrew", PathBuf::from("/opt/homebrew/bin/opencode")),
        ("usr-local", PathBuf::from("/usr/local/bin/opencode")),
    ]);
    paths
}

pub fn run_structured_with_usage(
    model: &str,
    schema: &str,
    prompt: &str,
    _workdir: &Path,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let binary =
        resolve_binary().ok_or_else(|| "OpenCode CLI executable was not found".to_owned())?;
    run_at(&binary, model, schema, prompt)
}
fn run_at(
    binary: &Path,
    model: &str,
    schema: &str,
    prompt: &str,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    if !valid_identifier(model) {
        return Err("Selected OpenCode model is invalid".to_owned());
    }
    let workspace = Workspace::new()?;
    capabilities(binary, &workspace)?;
    let input=format!("Return only a JSON object matching this schema. Do not use tools or modify files.\nSchema:\n{schema}\n\nInput:\n{prompt}");
    let mut command = workspace.command(binary);
    command.args([
        "--pure",
        "run",
        "--format",
        "json",
        "--model",
        model,
        "--agent",
        "mework",
        "--title",
        "mework AI action",
    ]);
    let output = capture_cli_output(
        command,
        Some(input),
        Duration::from_secs(15 * 60),
        "OpenCode CLI",
        "run_structured",
        Some(model),
    )?;
    parse_result(&output)
}

fn parse_result(output: &[u8]) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let mut text = String::new();
    let mut finished = false;
    let mut usage = None;
    for line in output
        .split(|b| *b == b'\n')
        .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
    {
        let event: Value = serde_json::from_slice(line)
            .map_err(|_| "OpenCode CLI returned invalid JSON events".to_owned())?;
        match event.get("type").and_then(Value::as_str) {
            Some("error" | "tool_use") => {
                return Err("OpenCode CLI did not complete an isolated response".to_owned())
            }
            Some("text") => {
                let part = event
                    .get("part")
                    .and_then(|p| p.get("text"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| "OpenCode CLI returned invalid text".to_owned())?;
                text.push_str(part);
            }
            Some("step_finish") => {
                let part = &event["part"];
                if part.get("reason").and_then(Value::as_str) != Some("stop") {
                    return Err("OpenCode CLI did not complete the response".to_owned());
                }
                finished = true;
                let t = &part["tokens"];
                if let (Some(input), Some(output), Some(read), Some(write), Some(reasoning)) = (
                    t["input"].as_i64(),
                    t["output"].as_i64(),
                    t["cache"]["read"].as_i64(),
                    t["cache"]["write"].as_i64(),
                    t["reasoning"].as_i64(),
                ) {
                    if [input, output, read, write, reasoning]
                        .iter()
                        .all(|v| *v >= 0)
                    {
                        let input = input.saturating_add(read).saturating_add(write);
                        let output = output.saturating_add(reasoning);
                        usage = Some(AiTokenUsageCounts {
                            input_tokens: input,
                            output_tokens: output,
                            total_tokens: t["total"]
                                .as_i64()
                                .filter(|v| *v >= 0)
                                .unwrap_or_else(|| input.saturating_add(output)),
                        });
                    }
                }
            }
            _ => {}
        }
    }
    if !finished {
        return Err("OpenCode CLI returned no completed response".to_owned());
    }
    let value: Value = serde_json::from_str(text.trim())
        .map_err(|_| "OpenCode CLI returned invalid structured output".to_owned())?;
    if !value.is_object() {
        return Err("OpenCode CLI returned invalid structured output".to_owned());
    }
    let bytes = serde_json::to_vec(&value)
        .map_err(|_| "OpenCode CLI returned invalid structured output".to_owned())?;
    Ok((bytes, usage))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_models_and_runs_without_tools_or_external_configuration() {
        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join(if cfg!(windows) {
            "opencode.cmd"
        } else {
            "opencode"
        });
        let events = r#"{"type":"text","part":{"text":"{\"summary\":\"Example task\"}"}}
{"type":"step_finish","part":{"reason":"stop","tokens":{"input":12,"output":8,"reasoning":0,"cache":{"read":4,"write":2}}}}"#;
        #[cfg(windows)]
        let script=format!("@echo off\nset args=%*\necho %args% | findstr /c:\"--version\" >nul && (echo 1.18.34 & exit /b 0)\necho %args% | findstr /c:\"--help\" >nul && (echo --pure --format --model --agent --title & exit /b 0)\nif not \"%OPENCODE_PURE%\"==\"1\" exit /b 1\nif not \"%OPENCODE_DISABLE_PROJECT_CONFIG%\"==\"1\" exit /b 1\nfindstr /c:\"deny\" opencode.json >nul || exit /b 1\necho %args% | findstr /c:\"models\" >nul && (echo example/sample-model & exit /b 0)\nset /p input=\n{}\n",events.lines().map(|line|format!("echo {line}")).collect::<Vec<_>>().join("\n"));
        #[cfg(not(windows))]
        let script=format!("#!/bin/sh\ncase \"$*\" in *--version*) echo 1.18.34;exit 0;; *--help*) echo '--pure --format --model --agent --title';exit 0;; esac\n[ \"$OPENCODE_PURE\" = 1 ] && [ \"$OPENCODE_DISABLE_PROJECT_CONFIG\" = 1 ] || exit 1\ngrep -q deny opencode.json || exit 1\ncase \"$*\" in *models*) echo example/sample-model;exit 0;; esac\ncat >/dev/null\nprintf '%s\\n' '{events}'\n");
        std::fs::write(&binary, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let detected = inspect_at(&binary);
        assert_eq!(detected.status, AiProviderStatus::Connected);
        assert_eq!(detected.models, ["example/sample-model"]);
        let (result, usage) = run_at(
            &binary,
            &detected.models[0],
            r#"{"type":"object"}"#,
            "Create an example task",
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&result).unwrap()["summary"],
            "Example task"
        );
        let usage = usage.unwrap();
        assert_eq!(
            (usage.input_tokens, usage.output_tokens, usage.total_tokens),
            (18, 8, 26)
        );
        let workspace = Workspace::new().unwrap();
        let config: Value = serde_json::from_slice(
            &std::fs::read(workspace.directory.path().join("opencode.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config["permission"]["*"], "deny");
        assert_eq!(config["agent"]["mework"]["permission"]["*"], "deny");
        assert_eq!(config["share"], "disabled");
    }
}
