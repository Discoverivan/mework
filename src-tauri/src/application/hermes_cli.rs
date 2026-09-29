use std::{
    env,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde_json::Value;

use super::ai::{
    local_cli_command, usable_cli_path, AiProviderDto, AiProviderId, AiProviderStatus,
};
use super::ai_usage_statistics::AiTokenUsageCounts;

pub fn inspect() -> AiProviderDto {
    inspect_for_mode(crate::application::dev_overlay::current_mock_mode_requested())
}

fn inspect_for_mode(mock_mode: bool) -> AiProviderDto {
    if mock_mode {
        return provider(
            AiProviderStatus::Connected,
            None,
            Some("mock".to_owned()),
            Some("mock-hermes-model".to_owned()),
            "",
        );
    }
    let Some(path) = resolve_binary() else {
        return provider(
            AiProviderStatus::NotFound,
            None,
            None,
            None,
            "Hermes CLI was not found on this computer",
        );
    };
    let Ok(version_output) = local_cli_command(&path)
        .arg("--version")
        .stderr(Stdio::null())
        .output()
    else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(&path),
            None,
            None,
            "Hermes CLI could not be started",
        );
    };
    if !version_output.status.success() {
        return provider(
            AiProviderStatus::Unavailable,
            Some(&path),
            None,
            None,
            "Hermes CLI is installed but unavailable",
        );
    }
    let version = String::from_utf8_lossy(&version_output.stdout)
        .lines()
        .next()
        .map(|line| {
            line.trim()
                .chars()
                .filter(|ch| !ch.is_control())
                .take(120)
                .collect()
        });
    let Ok(model_output) = local_cli_command(&path)
        .args(["config", "get", "model.default", "--json"])
        .stderr(Stdio::null())
        .output()
    else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(&path),
            version,
            None,
            "Hermes CLI configuration could not be checked",
        );
    };
    if !model_output.status.success() {
        return provider(
            AiProviderStatus::NotConfigured,
            Some(&path),
            version,
            None,
            "Configure a model with hermes model",
        );
    }
    let model = serde_json::from_slice::<String>(&model_output.stdout)
        .ok()
        .filter(|value| valid_model(value));
    match model {
        Some(model) => provider(
            AiProviderStatus::Connected,
            Some(&path),
            version,
            Some(model),
            "",
        ),
        None => provider(
            AiProviderStatus::NotConfigured,
            Some(&path),
            version,
            None,
            "Configure a model with hermes model",
        ),
    }
}

fn provider(
    status: AiProviderStatus,
    path: Option<&Path>,
    version: Option<String>,
    model: Option<String>,
    message: &str,
) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::HermesCli,
        instance_id: None,
        name: "Hermes CLI".to_owned(),
        status,
        available: status == AiProviderStatus::Connected,
        models: model.into_iter().collect(),
        executable_path: path.map(|path| path.display().to_string()),
        version,
        base_url: None,
        allow_insecure_tls: None,
        message: (!message.is_empty()).then(|| message.to_owned()),
    }
}

fn valid_model(model: &str) -> bool {
    !model.trim().is_empty() && model.len() <= 200 && !model.chars().any(char::is_control)
}

pub fn resolve_binary() -> Option<PathBuf> {
    if let Some(configured) = env::var_os("MEWORK_HERMES_BIN") {
        if let Some(path) = usable_cli_path(Path::new(&configured)) {
            return Some(path);
        }
    }
    if let Some(path) = env::var_os("PATH") {
        for entry in env::split_paths(&path) {
            for name in executable_names() {
                if let Some(path) = usable_cli_path(&entry.join(name)) {
                    return Some(path);
                }
            }
        }
    }
    diagnostic_install_paths()
        .into_iter()
        .map(|(_, path)| path)
        .find_map(|path| usable_cli_path(&path))
}

pub(crate) fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["hermes.exe", "hermes.cmd", "hermes"]
    } else {
        &["hermes"]
    }
}

pub(crate) fn diagnostic_install_paths() -> Vec<(&'static str, PathBuf)> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push((
            "system-home",
            home.join(if cfg!(windows) {
                ".local/bin/hermes.exe"
            } else {
                ".local/bin/hermes"
            }),
        ));
        #[cfg(windows)]
        paths.extend([
            ("system-home", home.join(".local/bin/hermes.cmd")),
            ("system-home", home.join(".local/bin/hermes")),
            ("system-home", home.join("AppData/Roaming/npm/hermes.cmd")),
        ]);
    }
    #[cfg(not(windows))]
    paths.extend([
        ("homebrew", PathBuf::from("/opt/homebrew/bin/hermes")),
        ("usr-local", PathBuf::from("/usr/local/bin/hermes")),
    ]);
    paths
}

pub fn run_structured_with_usage(
    model: &str,
    schema: &str,
    prompt: &str,
    workdir: &Path,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    if crate::application::dev_overlay::current_mock_mode_requested() {
        return Err("Live Hermes CLI requests are disabled in mock mode".to_owned());
    }
    if !valid_model(model) {
        return Err("Selected Hermes model is invalid".to_owned());
    }
    let binary =
        resolve_binary().ok_or_else(|| "Hermes CLI executable was not found".to_owned())?;
    let input = format!("Return only a JSON object matching this schema. Do not use tools or modify files.\nSchema:\n{schema}\n\nInput:\n{prompt}");
    let mut child = local_cli_command(binary)
        .args([
            "chat",
            "--oneshot",
            "--query-file",
            "-",
            "--format",
            "stream-json",
            "--toolsets",
            "",
            "--ignore-rules",
            "--source",
            "tool",
            "--max-turns",
            "1",
            "--model",
            model,
        ])
        .current_dir(workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Unable to start Hermes CLI".to_owned())?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Unable to send input to Hermes CLI".to_owned())?
        .write_all(input.as_bytes())
        .map_err(|_| "Unable to send input to Hermes CLI".to_owned())?;
    let output = child
        .wait_with_output()
        .map_err(|_| "Hermes CLI did not return a result".to_owned())?;
    if !output.status.success() {
        return Err("Hermes CLI run failed".to_owned());
    }
    parse_result(&output.stdout)
}

fn parse_result(output: &[u8]) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let result = output
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .find(|event| event.get("type").and_then(Value::as_str) == Some("result"))
        .ok_or_else(|| "Hermes CLI returned no result".to_owned())?;
    if result.get("exit_code").and_then(Value::as_i64) != Some(0) {
        return Err("Hermes CLI run failed".to_owned());
    }
    let text = result
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "Hermes CLI returned no structured result".to_owned())?;
    let value: Value = serde_json::from_str(text.trim())
        .map_err(|_| "Hermes CLI returned invalid structured output".to_owned())?;
    let structured = serde_json::to_vec(&value)
        .map_err(|_| "Hermes CLI returned invalid structured output".to_owned())?;
    let tokens = result.get("tokens");
    let input_tokens = tokens
        .and_then(|value| value.get("input"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output_tokens = tokens
        .and_then(|value| value.get("output"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let usage = (input_tokens > 0 || output_tokens > 0).then_some(AiTokenUsageCounts {
        input_tokens,
        output_tokens,
        total_tokens: tokens
            .and_then(|value| value.get("total"))
            .and_then(Value::as_i64)
            .unwrap_or(input_tokens + output_tokens),
    });
    Ok((structured, usage))
}

#[cfg(test)]
mod tests {
    use super::{inspect_for_mode, parse_result};

    #[test]
    fn mock_mode_exposes_a_selectable_hermes_provider() {
        let provider = inspect_for_mode(true);
        assert_eq!(provider.id, super::AiProviderId::HermesCli);
        assert!(provider.available);
        assert_eq!(provider.models, ["mock-hermes-model"]);
    }

    #[test]
    fn parses_structured_one_shot_result() {
        let output = br#"{"type":"system","subtype":"init"}
{"type":"result","exit_code":0,"text":"{\"summary\":\"Example task\"}","tokens":{"input":12,"output":8,"total":20}}
"#;
        let (response, usage) = parse_result(output).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&response).unwrap()["summary"],
            "Example task"
        );
        assert_eq!(usage.unwrap().total_tokens, 20);
    }
}
