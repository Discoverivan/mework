use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use serde::Deserialize;
use serde_json::Value;
use std::io::Write;

use super::{capture_cli_output, local_cli_command};
use crate::application::ai::{AiProviderDto, AiProviderId, AiProviderStatus};
use crate::application::ai_usage_statistics::AiTokenUsageCounts;

const ISOLATION_FLAGS: &[&str] = &[
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-session",
];

pub fn inspect() -> AiProviderDto {
    match resolve_binary() {
        Some(path) => inspect_at(&path),
        None => provider(
            AiProviderStatus::NotFound,
            None,
            None,
            Vec::new(),
            Some("settings.pi.notFound"),
        ),
    }
}

fn inspect_at(path: &Path) -> AiProviderDto {
    let mut command = isolated_command(path);
    command.arg("--version");
    let Ok(output) = capture_cli_output(
        command,
        None,
        Duration::from_secs(10),
        "Pi CLI",
        "inspect",
        None,
    ) else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(path),
            None,
            Vec::new(),
            Some("settings.pi.unavailable"),
        );
    };
    let version = String::from_utf8_lossy(&output).lines().next().map(|line| {
        line.trim()
            .chars()
            .filter(|ch| !ch.is_control())
            .take(120)
            .collect::<String>()
    });
    if check_isolation(path).is_err() {
        return provider(
            AiProviderStatus::Unavailable,
            Some(path),
            version,
            Vec::new(),
            Some("settings.pi.updateRequired"),
        );
    }
    let mut command = isolated_command(path);
    command.arg("--list-models");
    let Ok(output) = capture_cli_output(
        command,
        None,
        Duration::from_secs(10),
        "Pi CLI",
        "inspect",
        None,
    ) else {
        return provider(
            AiProviderStatus::Unavailable,
            Some(path),
            version,
            Vec::new(),
            Some("settings.pi.unavailable"),
        );
    };
    let mut models = parse_models(&output);
    let mut subscription_message = None;
    if models.iter().any(|model| model.starts_with("openai/")) {
        match subscription_models(path) {
            Ok(subscription) if subscription.status == "not_oauth" => {}
            Ok(subscription) if subscription.status == "connected" => {
                let supported = models.clone();
                models.retain(|model| !model.starts_with("openai/"));
                models.extend(
                    subscription
                        .models
                        .into_iter()
                        .filter(|model| supported.contains(model)),
                );
                if models.is_empty() {
                    subscription_message = Some("settings.pi.subscriptionEmpty");
                }
            }
            result => {
                models.retain(|model| !model.starts_with("openai/"));
                subscription_message = Some(
                    if result.is_ok_and(|response| response.status == "auth_required") {
                        "settings.pi.subscriptionAuthRequired"
                    } else {
                        "settings.pi.subscriptionUnavailable"
                    },
                );
            }
        }
    }
    let status = if models.is_empty() {
        AiProviderStatus::NotConfigured
    } else {
        AiProviderStatus::Connected
    };
    provider(
        status,
        Some(path),
        version,
        models,
        subscription_message
            .or_else(|| (status != AiProviderStatus::Connected).then_some("settings.pi.configure")),
    )
}

#[derive(Deserialize)]
struct SubscriptionModels {
    status: String,
    models: Vec<String>,
}

fn subscription_models(path: &Path) -> Result<SubscriptionModels, String> {
    // The temporary file contains only bundled code, never credentials or prompts.
    let directory = tempfile::tempdir().map_err(|_| "Pi model adapter is unavailable")?;
    let extension = directory.path().join("subscription-models.ts");
    std::fs::File::create(&extension)
        .and_then(|mut file| file.write_all(include_bytes!("pi-subscription-models.ts")))
        .map_err(|_| "Pi model adapter is unavailable")?;
    let mut command = isolated_command(path);
    command
        .arg("--extension")
        .arg(extension)
        .args(["--mode", "rpc"]);
    let output = capture_cli_output(
        command,
        None,
        Duration::from_secs(30),
        "Pi CLI",
        "subscription_models",
        None,
    )?;
    let response = output
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .filter_map(|event| {
            if event["type"] == "extension_ui_request" && event["method"] == "notify" {
                serde_json::from_str(event["message"].as_str()?).ok()
            } else {
                Some(event)
            }
        })
        .find(|event| event["type"] == "mework_subscription_models")
        .ok_or_else(|| "Pi subscription models are unavailable".to_owned())?;
    let response: SubscriptionModels = serde_json::from_value(response)
        .map_err(|_| "Pi subscription model response is invalid")?;
    if !response
        .models
        .iter()
        .all(|model| model.starts_with("openai/") && valid_identifier(model))
    {
        return Err("Pi subscription model response is invalid".to_owned());
    }
    Ok(response)
}

fn provider(
    status: AiProviderStatus,
    path: Option<&Path>,
    version: Option<String>,
    models: Vec<String>,
    message: Option<&str>,
) -> AiProviderDto {
    AiProviderDto {
        id: AiProviderId::PiCli,
        instance_id: None,
        name: "Pi CLI".to_owned(),
        status,
        available: status == AiProviderStatus::Connected,
        models,
        executable_path: path.map(|path| path.display().to_string()),
        version,
        base_url: None,
        allow_insecure_tls: None,
        message: message.map(str::to_owned),
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 300
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._/:".contains(&byte))
        && !value.starts_with('-')
}

fn parse_models(output: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(output);
    let mut rows = text.lines().skip_while(|line| {
        let columns: Vec<_> = line.split_whitespace().collect();
        columns.first() != Some(&"provider") || columns.get(1) != Some(&"model")
    });
    rows.next(); // The documented provider/model/context/max-out/thinking/images header.
    let mut models = rows
        .filter_map(|line| {
            let columns: Vec<_> = line.split_whitespace().collect();
            if columns.len() != 6
                || !matches!(columns[4], "yes" | "no")
                || !matches!(columns[5], "yes" | "no")
            {
                return None;
            }
            let model = format!("{}/{}", columns[0], columns[1]);
            valid_identifier(&model).then_some(model)
        })
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models
}

fn isolated_command(binary: &Path) -> Command {
    let mut command = local_cli_command(binary);
    command
        .args(ISOLATION_FLAGS)
        .env("NO_COLOR", "1")
        .env("PI_OFFLINE", "1")
        .env("PI_TELEMETRY", "0");
    // Never discover project resources from mework's own source directory.
    command.current_dir(env::temp_dir());
    command
}

fn check_isolation(binary: &Path) -> Result<(), String> {
    let mut command = isolated_command(binary);
    command.arg("--help");
    let help = capture_cli_output(
        command,
        None,
        Duration::from_secs(10),
        "Pi CLI",
        "inspect",
        None,
    )?;
    let help = String::from_utf8_lossy(&help);
    if ISOLATION_FLAGS.iter().any(|flag| !help.contains(flag)) {
        return Err("Pi CLI must be updated to support isolated runs".to_owned());
    }
    Ok(())
}

pub fn resolve_binary() -> Option<PathBuf> {
    super::discovery::resolve_binary(AiProviderId::PiCli)
}

pub(crate) fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["pi.exe", "pi.cmd", "pi.ps1"]
    } else {
        &["pi"]
    }
}

pub(super) fn installation_paths() -> super::discovery::CliInstallationPaths {
    let home = dirs::home_dir();
    let config = dirs::config_dir();
    let local_data = dirs::data_local_dir();
    install_paths(
        home.as_deref(),
        config.as_deref(),
        local_data.as_deref(),
        cfg!(windows),
    )
}

fn install_paths(
    home: Option<&Path>,
    config: Option<&Path>,
    local_data: Option<&Path>,
    windows: bool,
) -> super::discovery::CliInstallationPaths {
    let mut priority = Vec::new();
    let mut paths = Vec::new();
    if let Some(home) = home {
        if windows {
            priority.push(("managed-install", home.join(".pi/agent/bin/pi.cmd")));
            priority.push(("managed-install", home.join(".pi/agent/bin/pi.ps1")));
        }
        paths.push((
            "system-home",
            home.join(if windows {
                ".local/bin/pi.exe"
            } else {
                ".local/bin/pi"
            }),
        ));
        if !windows {
            paths.push(("npm-global", home.join(".npm-global/bin/pi")));
        }
    }
    if windows {
        if let Some(local_data) = local_data {
            paths.push(("user-programs", local_data.join("Programs/Pi/pi.exe")));
        }
        if let Some(config) = config {
            paths.push(("system-config", config.join("npm/pi.cmd")));
        }
    } else {
        paths.extend([
            ("homebrew", PathBuf::from("/opt/homebrew/bin/pi")),
            ("usr-local", PathBuf::from("/usr/local/bin/pi")),
        ]);
    }
    super::discovery::CliInstallationPaths {
        priority,
        additional: paths,
    }
}

pub fn run_structured_with_usage(
    model: &str,
    schema: &str,
    prompt: &str,
    workdir: &Path,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let binary = resolve_binary().ok_or_else(|| "Pi CLI executable was not found".to_owned())?;
    run_at(&binary, model, schema, prompt, workdir)
}

fn run_at(
    binary: &Path,
    model: &str,
    schema: &str,
    prompt: &str,
    workdir: &Path,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    if !valid_identifier(model) || !model.contains('/') {
        return Err("Selected Pi model is invalid".to_owned());
    }
    check_isolation(binary)?;
    let input = format!("Return only a JSON object matching this schema. Do not use tools or modify files.\nSchema:\n{schema}\n\nInput:\n{prompt}");
    let mut command = isolated_command(binary);
    command
        .args(["--print", "--mode", "json", "--model", model])
        .current_dir(workdir);
    let output = capture_cli_output(
        command,
        Some(input),
        Duration::from_secs(15 * 60),
        "Pi CLI",
        "run_structured",
        Some(model),
    )?;
    parse_result(&output)
}

fn parse_result(output: &[u8]) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let mut last_message = None;
    let mut usage = AiTokenUsageCounts {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
    };
    let mut usage_reported = false;
    for line in output
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
    {
        let event: Value = serde_json::from_slice(line)
            .map_err(|_| "Pi CLI returned invalid JSON events".to_owned())?;
        if event.get("type").and_then(Value::as_str) != Some("message_end") {
            continue;
        }
        let Some(message) = event
            .get("message")
            .filter(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
        else {
            continue;
        };
        if let Some(reported) = message.get("usage") {
            if let (Some(input), Some(output), Some(cache_read), Some(cache_write), Some(total)) = (
                reported.get("input").and_then(Value::as_i64),
                reported.get("output").and_then(Value::as_i64),
                reported.get("cacheRead").and_then(Value::as_i64),
                reported.get("cacheWrite").and_then(Value::as_i64),
                reported.get("totalTokens").and_then(Value::as_i64),
            ) {
                if [input, output, cache_read, cache_write, total]
                    .iter()
                    .all(|count| *count >= 0)
                {
                    usage.input_tokens = usage
                        .input_tokens
                        .saturating_add(input)
                        .saturating_add(cache_read)
                        .saturating_add(cache_write);
                    usage.output_tokens = usage.output_tokens.saturating_add(output);
                    usage.total_tokens = usage.total_tokens.saturating_add(total);
                    usage_reported = true;
                }
            }
        }
        last_message = Some(message.clone());
    }
    let message = last_message.ok_or_else(|| "Pi CLI returned no assistant result".to_owned())?;
    if message.get("stopReason").and_then(Value::as_str) != Some("stop") {
        return Err("Pi CLI did not complete the response".to_owned());
    }
    let content = message
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| "Pi CLI returned no structured result".to_owned())?;
    let text = content
        .iter()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<String>();
    let value: Value = serde_json::from_str(text.trim())
        .map_err(|_| "Pi CLI returned invalid structured output".to_owned())?;
    if !value.is_object() {
        return Err("Pi CLI returned invalid structured output".to_owned());
    }
    let bytes = serde_json::to_vec(&value)
        .map_err(|_| "Pi CLI returned invalid structured output".to_owned())?;
    Ok((bytes, usage_reported.then_some(usage)))
}

#[cfg(test)]
mod tests {
    use super::super::usable_cli_path;
    use super::*;

    #[test]
    fn discovers_models_and_runs_an_isolated_structured_request() {
        let directory = tempfile::tempdir().unwrap();
        let local_data = directory.path().join("AppData/Local");
        let config = directory.path().join("AppData/Roaming");
        // The official Windows installer exposes a Node-backed command wrapper.
        let binary = if cfg!(windows) {
            directory.path().join(".pi/agent/bin/pi.cmd")
        } else {
            directory.path().join(".local/bin/pi")
        };
        let install = binary.parent().unwrap();
        std::fs::create_dir_all(install).unwrap();
        let subscription = r#"{"type":"mework_subscription_models","status":"connected","models":["openai/sample-model"]}"#;
        let subscription = serde_json::json!({
            "type": "extension_ui_request", "method": "notify", "message": subscription,
        })
        .to_string();
        let event = r#"{"type":"message_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"Synthetic reasoning"},{"type":"text","text":"{\"summary\":\"Example task\"}"}],"usage":{"input":12,"output":8,"cacheRead":4,"cacheWrite":2,"totalTokens":26}}}"#;
        #[cfg(windows)]
        let script = format!("@echo off\nset args=%*\necho %args% | findstr /c:\"--version\" >nul && (echo example-version & exit /b 0)\necho %args% | findstr /c:\"--help\" >nul && (echo {} & exit /b 0)\necho %args% | findstr /c:\"--list-models\" >nul && (echo provider model context max-out thinking images & echo openai sample-model 200K 8K yes no & echo openai catalog-only-model 200K 8K yes no & exit /b 0)\necho %args% | findstr /c:\"--mode rpc\" >nul && (echo {subscription} & exit /b 0)\nset /p input=\necho {event}\n", ISOLATION_FLAGS.join(" "));
        #[cfg(not(windows))]
        let script = format!("#!/usr/bin/env node\ncase \"$*\" in *--version*) echo example-version; exit 0;; *--help*) echo '{}'; exit 0;; *--list-models*) printf 'provider model context max-out thinking images\\nopenai sample-model 200K 8K yes no\\nopenai catalog-only-model 200K 8K yes no\\n'; exit 0;; *--mode\\ rpc*) printf '%s\\n' '{subscription}'; exit 0;; esac\ncat >/dev/null\nprintf '%s\\n' '{event}'\n", ISOLATION_FLAGS.join(" "));
        #[cfg(windows)]
        let checks = ISOLATION_FLAGS
            .iter()
            .map(|flag| format!("echo %args% | findstr /c:\"{flag}\" >nul || exit /b 1\n"))
            .collect::<String>();
        #[cfg(not(windows))]
        let checks = ISOLATION_FLAGS
            .iter()
            .map(|flag| format!("case \"$*\" in *{flag}*) ;; *) exit 1;; esac\n"))
            .collect::<String>();
        #[cfg(windows)]
        let script = script.replace("set /p input=", &(checks + "set /p input="));
        #[cfg(not(windows))]
        let script = script.replace("cat >/dev/null", &(checks + "cat >/dev/null"));
        std::fs::write(&binary, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // A synthetic Node shim proves that the npm shebang can find the
            // runtime beside Pi without relying on the test runner's PATH.
            let node = install.join("node");
            std::fs::write(&node, "#!/bin/sh\nexec /bin/sh \"$@\"\n").unwrap();
            std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let candidates = install_paths(
            Some(directory.path()),
            Some(&config),
            Some(&local_data),
            cfg!(windows),
        );
        let resolved = candidates
            .priority
            .into_iter()
            .chain(candidates.additional)
            .find_map(|(_, path)| usable_cli_path(&path))
            .unwrap();
        let detected = inspect_at(&resolved);
        assert_eq!(detected.status, AiProviderStatus::Connected);
        assert_eq!(detected.models, ["openai/sample-model"]);
        #[cfg(windows)]
        {
            // Exercise the PowerShell fallback using the same synthetic CLI.
            let script = install.join("pi.ps1");
            std::fs::write(
                &script,
                "& \"$PSScriptRoot/pi.cmd\" @args\nexit $LASTEXITCODE\n",
            )
            .unwrap();
            let mut command = local_cli_command(&script);
            command.arg("--version");
            let output = command.output().unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap().trim(),
                "example-version"
            );
        }
        let (output, usage) = run_at(
            &resolved,
            &detected.models[0],
            r#"{"type":"object"}"#,
            "Create an example task",
            directory.path(),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap()["summary"],
            "Example task"
        );
        let usage = usage.unwrap();
        assert_eq!(
            (usage.input_tokens, usage.output_tokens, usage.total_tokens),
            (18, 8, 26)
        );
    }
}
