use super::{capture_cli_output, capture_cli_output_with_status, local_cli_command};
use crate::application::ai::{AiProviderDto, AiProviderId, AiProviderStatus};
use crate::application::ai_usage_statistics::AiTokenUsageCounts;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

// OpenCode keeps ownership of its credentials. Temporary files contain only non-secret run
// overrides; user provider settings are forwarded in memory to the CLI.
struct Workspace {
    directory: tempfile::TempDir,
    config: String,
}
impl Workspace {
    fn new() -> Result<Self, String> {
        Self::with_provider_sources(
            &provider_config_sources(),
            std::env::var("OPENCODE_CONFIG_CONTENT").ok().as_deref(),
        )
    }
    fn with_provider_sources(sources: &[PathBuf], content: Option<&str>) -> Result<Self, String> {
        let directory =
            tempfile::tempdir().map_err(|_| "Unable to prepare OpenCode workspace".to_owned())?;
        let mut config = json!({
            "permissions": [{"action": "*", "resource": "*", "effect": "deny"}],
            "share": "disabled", "update": "disable", "snapshots": false,
            "instructions": [], "skills": [], "warming": false,
            // Plugin selectors disable activation only after modules are imported.
            // Block external modules before import, including system-config plugins.
            "experimental": {"policies": [{"action": "integration.use", "resource": "plugin:*", "effect": "deny"}]},
            "plugins": ["-*", "opencode.models.dev", "opencode.provider.*", "opencode.config.provider", "opencode.config.agent"],
            "default_agent": "mework", "agents": {"mework": {
                "mode": "primary", "description": "Generate a mework structured response",
                // A one-step agent triggers OpenCode's final-step text-summary
                // instruction immediately, conflicting with structured output.
                "permissions": [{"action": "*", "resource": "*", "effect": "deny"}], "steps": 2,
                "system": "Use only the supplied input. Do not use tools. Return only the JSON object requested by the input."
            }}
        });
        std::fs::write(directory.path().join("opencode.json"), config.to_string())
            .map_err(|_| "Unable to prepare OpenCode configuration".to_owned())?;
        for source in sources {
            let text = match std::fs::read_to_string(source) {
                Ok(text) => text,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err("Unable to read OpenCode provider configuration".to_owned()),
            };
            merge_provider_config(&mut config, &text, source.parent())?;
        }
        if let Some(content) = content {
            merge_provider_config(
                &mut config,
                content,
                std::env::current_dir().ok().as_deref(),
            )?;
        }
        let config = config.to_string();
        Ok(Self { directory, config })
    }
    fn command(&self, binary: &Path) -> Command {
        let mut command = local_cli_command(binary);
        let path = self.directory.path();
        command
            .current_dir(path)
            .env("NO_COLOR", "1")
            .env("OPENCODE_CONFIG_PROJECT_DISABLE", "1")
            .env("OPENCODE_DISABLE_PROJECT_CONFIG", "1")
            .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
            .env("OPENCODE_TEST_HOME", path)
            .env("XDG_CONFIG_HOME", path.join("config"))
            .env("OPENCODE_CONFIG_DIR", path)
            .env("OPENCODE_CONFIG", path.join("opencode.json"))
            // V2 keeps credentials in its own database alongside sessions. Leave its
            // data/DB paths intact; every standalone invocation creates a fresh session.
            // Inline config has the highest precedence, including over system agents.
            .env("OPENCODE_CONFIG_CONTENT", &self.config)
            .env_remove("PWD")
            .env_remove("OPENCODE_PERMISSION")
            .env_remove("OPENCODE_SERVER_PASSWORD")
            .env_remove("OPENCODE_PASSWORD")
            .env_remove("OPENCODE_SERVER_USERNAME");
        command
    }

    fn enable_json_mode(&mut self, model: &str) -> bool {
        let Some((provider_id, model_id)) = model.split_once('/') else {
            return false;
        };
        let mut config: Value =
            serde_json::from_str(&self.config).expect("Workspace configuration is valid JSON");
        let native = config["providers"].get(provider_id).is_some();
        let provider = if native {
            config["providers"].get(provider_id)
        } else {
            config["provider"].get(provider_id)
        };
        let Some(provider) = provider else {
            return false;
        };
        let model = &provider["models"][model_id];
        let package = if native {
            model.get("package").or_else(|| provider.get("package"))
        } else {
            model["provider"].get("npm").or_else(|| provider.get("npm"))
        }
        .and_then(Value::as_str);
        if !matches!(
            package,
            Some("@ai-sdk/openai-compatible" | "@opencode/ai/providers/openai-compatible")
        ) || provider["body"].get("response_format").is_some()
            || model["body"].get("response_format").is_some()
            || provider["options"]["body"].get("response_format").is_some()
            || model["options"].get("response_format").is_some()
        {
            return false;
        }
        // V2 does not forward agent.request overlays. Legacy compatible-model
        // options migrate into body; keep each definition in its source format.
        if native {
            config["providers"][provider_id]["models"][model_id]["body"]["response_format"] =
                json!({"type":"json_object"});
        } else {
            config["provider"][provider_id]["models"][model_id]["options"]["response_format"] =
                json!({"type":"json_object"});
        }
        self.config = config.to_string();
        true
    }

    fn apply_output_limit(&mut self, model: &str, limit: Option<u32>) -> Result<(), String> {
        let Some(limit) = limit else {
            return Ok(());
        };
        let (provider, model) = model
            .split_once('/')
            .ok_or("Selected OpenCode model is invalid")?;
        let mut config: Value =
            serde_json::from_str(&self.config).map_err(|_| "Invalid OpenCode configuration")?;
        // Keep native and legacy provider definitions in their original format.
        let key = if config["provider"].get(provider).is_some()
            && config["providers"].get(provider).is_none()
        {
            "provider"
        } else {
            "providers"
        };
        if key == "provider"
            && config[key][provider]["models"][model]["limit"]
                .get("context")
                .is_none()
        {
            // Legacy limits require a context value. Keep the output-only native
            // overlay in a separate document so OpenCode can fold it together
            // with the legacy definition without inventing a context limit.
            // This file has only restrictions and non-secret run overrides.
            let path = self.directory.path().join("opencode.json");
            let mut restrictions: Value = serde_json::from_slice(
                &std::fs::read(&path).map_err(|_| "Unable to read OpenCode run configuration")?,
            )
            .map_err(|_| "Invalid OpenCode run configuration")?;
            restrictions["providers"][provider]["models"][model]["limit"]["output"] = json!(limit);
            std::fs::write(path, restrictions.to_string())
                .map_err(|_| "Unable to prepare OpenCode run configuration")?;
            return Ok(());
        }
        config[key][provider]["models"][model]["limit"]["output"] = json!(limit);
        self.config = config.to_string();
        Ok(())
    }
}

fn provider_config_sources() -> Vec<PathBuf> {
    let directory = std::env::var_os("OPENCODE_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("XDG_CONFIG_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
                .map(|root| root.join("opencode"))
        });
    let mut sources = directory
        .into_iter()
        .flat_map(|directory| {
            [
                directory.join("opencode.json"),
                directory.join("opencode.jsonc"),
            ]
        })
        .collect::<Vec<_>>();
    if let Some(path) = std::env::var_os("OPENCODE_CONFIG").filter(|value| !value.is_empty()) {
        sources.push(PathBuf::from(path));
    }
    if let Ok(current) = std::env::current_dir() {
        for source in &mut sources {
            if source.is_relative() {
                *source = current.join(&*source);
            }
        }
    }
    sources
}

fn merge_provider_config(
    target: &mut Value,
    text: &str,
    base: Option<&Path>,
) -> Result<(), String> {
    let source: Value = jsonc_parser::parse_to_serde_value(text, &Default::default())
        .map_err(|_| "Invalid OpenCode provider configuration".to_owned())?;
    // V2 accepts both native `providers` and legacy V1 `provider` definitions.
    // Never carry user agents, permissions, plugins, or other execution settings.
    for key in ["provider", "providers"] {
        if let Some(providers) = source.get(key).filter(|value| value.is_object()) {
            let mut providers = providers.clone();
            resolve_provider_file_references(&mut providers, base);
            merge_values(&mut target[key], providers);
        }
    }
    Ok(())
}

fn merge_values(target: &mut Value, source: Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            merge_values(
                target.entry(key.clone()).or_insert(Value::Null),
                value.clone(),
            );
        }
    } else {
        *target = source;
    }
}

fn resolve_provider_file_references(value: &mut Value, base: Option<&Path>) {
    match value {
        Value::Object(values) => values
            .values_mut()
            .for_each(|value| resolve_provider_file_references(value, base)),
        Value::Array(values) => values
            .iter_mut()
            .for_each(|value| resolve_provider_file_references(value, base)),
        Value::String(text) => {
            let mut remaining = text.as_str();
            let mut resolved = String::new();
            while let Some(start) = remaining.find("{file:") {
                let reference = &remaining[start + 6..];
                let Some(end) = reference.find('}') else {
                    break;
                };
                resolved.push_str(&remaining[..start]);
                let path = Path::new(&reference[..end]);
                let path = if path.is_absolute() || reference.starts_with('~') {
                    path.to_path_buf()
                } else {
                    base.map(|base| base.join(path))
                        .unwrap_or_else(|| path.to_path_buf())
                };
                resolved.push_str(&format!("{{file:{}}}", path.display()));
                remaining = &reference[end + 1..];
            }
            resolved.push_str(remaining);
            *text = resolved;
        }
        _ => {}
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
    let version = version
        .trim()
        .strip_prefix("opencode ")
        .unwrap_or(version.trim())
        .trim_start_matches('v');
    semver::Version::parse(version)
        .is_ok_and(|version| version.major == 2 && version.pre.is_empty())
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
        return Err("OpenCode CLI requires a stable V2 version".to_owned());
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
    if ["--standalone", "--format", "--model", "--agent", "--title"]
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
    command.args(["models", "--standalone"]);
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
    execution: &crate::application::ai::AiExecutionSettings,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let binary =
        resolve_binary().ok_or_else(|| "OpenCode CLI executable was not found".to_owned())?;
    run_at_with_settings(&binary, model, schema, prompt, execution)
}
#[cfg(test)]
fn run_at(
    binary: &Path,
    model: &str,
    schema: &str,
    prompt: &str,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    run_at_with_settings(binary, model, schema, prompt, &Default::default())
}

fn run_at_with_settings(
    binary: &Path,
    model: &str,
    schema: &str,
    prompt: &str,
    execution: &crate::application::ai::AiExecutionSettings,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    if !valid_identifier(model) {
        return Err("Selected OpenCode model is invalid".to_owned());
    }
    run_in_workspace(binary, model, schema, prompt, Workspace::new()?, execution)
}

fn run_in_workspace(
    binary: &Path,
    model: &str,
    schema: &str,
    prompt: &str,
    mut workspace: Workspace,
    execution: &crate::application::ai::AiExecutionSettings,
) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    capabilities(binary, &workspace)?;
    workspace.apply_output_limit(model, execution.opencode_max_output_tokens())?;
    let original_config = workspace.config.clone();
    let json_mode = workspace.enable_json_mode(model);
    let input=format!("Return only a JSON object matching this schema. Do not use tools or modify files.\nSchema:\n{schema}\n\nInput:\n{prompt}");
    for attempt in 0..2 {
        let mut command = workspace.command(binary);
        command.args([
            "run",
            "--standalone",
            "--format",
            "json",
            "--model",
            model,
            "--agent",
            "mework",
            "--title",
            "mework AI action",
        ]);
        let captured = capture_cli_output_with_status(
            command,
            Some(input.clone()),
            execution.timeout(),
            "OpenCode CLI",
            "run_structured",
            Some(model),
        )?;
        let result = parse_result(&captured.output);
        if matches!(&result, Err(error) if error == crate::application::ai::OUTPUT_TOKEN_LIMIT_ERROR)
        {
            return result;
        }
        if captured.success {
            if result.is_err() && session_reached_token_limit(binary, &workspace, &captured.output)
            {
                return Err(crate::application::ai::OUTPUT_TOKEN_LIMIT_ERROR.to_owned());
            }
            return result;
        }
        if attempt == 0 && json_mode && rejected_json_mode(&captured.output) {
            workspace.config.clone_from(&original_config);
            crate::application::logging::info(
                "ai.cli",
                "json_mode_unavailable",
                json!({"provider":"OpenCode CLI","model":model,"operation":"run_structured"}),
            );
            continue;
        }
        return Err("OpenCode CLI run failed".to_owned());
    }
    unreachable!("the final attempt always returns")
}

fn session_reached_token_limit(binary: &Path, workspace: &Workspace, output: &[u8]) -> bool {
    let events: Vec<Value> = output
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect();
    if events.iter().any(|event| {
        matches!(
            event["type"].as_str(),
            Some("step_finish" | "error" | "tool_use")
        )
    }) {
        return false;
    }
    let mut ids = events
        .iter()
        .filter_map(|event| event["sessionID"].as_str());
    let Some(session_id) = ids.next() else {
        return false;
    };
    if !session_id.starts_with("ses")
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        || ids.any(|id| id != session_id)
    {
        return false;
    }
    // V2 can reconcile text without emitting completion metadata. Read only
    // the sanitized export of this run, without persisting or logging it.
    let mut command = workspace.command(binary);
    command.args([
        "session",
        "export",
        "--standalone",
        "--sanitize",
        session_id,
    ]);
    let Ok(export) = capture_cli_output(
        command,
        None,
        Duration::from_secs(30),
        "OpenCode CLI",
        "read_completion_metadata",
        None,
    ) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&export) else {
        return false;
    };
    value["info"]["id"] == session_id && exported_session_reached_token_limit(&value)
}

fn exported_session_reached_token_limit(value: &Value) -> bool {
    value["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message["type"] == "assistant")
        })
        .is_some_and(|message| message["finish"] == "length")
}

fn rejected_json_mode(output: &[u8]) -> bool {
    output
        .split(|b| *b == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .any(|event| {
            if event["type"] != "error"
                || !matches!(event["error"]["status"].as_u64(), Some(400 | 422))
            {
                return false;
            }
            let body = &event["error"]["response"]["body"];
            let body = body
                .as_str()
                .and_then(|body| serde_json::from_str::<Value>(body).ok())
                .unwrap_or_else(|| body.clone());
            crate::application::ai::openai_rejected_response_format(&body)
        })
}

fn parse_result(output: &[u8]) -> Result<(Vec<u8>, Option<AiTokenUsageCounts>), String> {
    let mut text = String::new();
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
                if part.get("reason").and_then(Value::as_str) == Some("length") {
                    return Err(crate::application::ai::OUTPUT_TOKEN_LIMIT_ERROR.to_owned());
                }
                if part.get("reason").and_then(Value::as_str) != Some("stop") {
                    return Err("OpenCode CLI did not complete the response".to_owned());
                }
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
    // V2 waits for the session before exiting successfully, but can reconcile
    // text from persisted messages without emitting a step_finish event.
    // Usage is optional in that case; the complete JSON object is still required.
    let value: Value = crate::application::ai_structured_output::deserialize(text.as_bytes())
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
    fn identifies_token_exhaustion_from_cli_completion_metadata() {
        let event = br#"{"type":"step_finish","part":{"reason":"length"}}"#;
        assert_eq!(
            parse_result(event).unwrap_err(),
            crate::application::ai::OUTPUT_TOKEN_LIMIT_ERROR
        );
        assert!(exported_session_reached_token_limit(
            &json!({"messages":[{"type":"assistant","finish":"length"}]})
        ));
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires an installed OpenCode V2 binary"]
    async fn runs_json_mode_and_recovers_from_an_explicit_server_rejection() {
        use wiremock::{
            matchers::{body_partial_json, method, path},
            Mock, MockServer, ResponseTemplate,
        };
        let binary = resolve_binary().expect("Install OpenCode V2 before running this check");
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/v1/chat/completions"))
            .and(body_partial_json(json!({"response_format":{"type":"json_object"}})))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error":{"code":"unsupported_parameter","param":"response_format","type":"invalid_request_error","message":"Unsupported parameter: response_format"}})))
            .expect(1).mount(&server).await;
        Mock::given(method("POST")).and(path("/v1/chat/completions"))
            .and(|request: &wiremock::Request| {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                (body["max_tokens"] == 1234 || body["max_completion_tokens"] == 1234)
                    && body.get("response_format").is_none()
                    && body.get("tools").is_none_or(|v|v.as_array().is_some_and(Vec::is_empty))
                    && body.get("reasoning_effort") != Some(&json!("none"))
            })
            .respond_with(ResponseTemplate::new(200).insert_header("content-type","text/event-stream")
                .set_body_string(concat!(
                    "data: {\"id\":\"example\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"sample-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"{\\\"summary\\\":\\\"Example task\\\"}\"},\"finish_reason\":null}]}\n\n",
                    "data: {\"id\":\"example\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
                    "data: [DONE]\n\n"
                )))
            .expect(1).mount(&server).await;
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("opencode.json");
        std::fs::write(&config,json!({"provider":{"example":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":format!("{}/v1",server.uri()),"apiKey":""},"models":{"sample-model":{"name":"Example model"}}}}}).to_string()).unwrap();
        let workspace = Workspace::with_provider_sources(&[config], None).unwrap();
        let result = tokio::task::spawn_blocking(move || run_in_workspace(&binary,"example/sample-model",r#"{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}"#,"Summarize Example task",workspace,&crate::application::ai::AiExecutionSettings { timeout_seconds: 1800, max_output_tokens: Some(1234), output_tokens_mode: crate::application::ai::AiOutputTokensMode::Limited })).await.unwrap();

        let (output, _) = result.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap()["summary"],
            "Example task"
        );
    }

    #[test]
    fn forwards_only_provider_definitions_in_memory() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("opencode.jsonc");
        std::fs::write(&source, r#"{
            // Provider definitions must survive the isolated workspace.
            "providers": {"example": {
                "package": "@ai-sdk/openai-compatible",
                "settings": {"baseURL": "https://api.example.invalid/v1", "apiKey": "{file:empty-key}"},
                "models": {"sample-model": {}},
            }},
            "plugins": ["example-plugin"],
            "permissions": [{"action": "*", "resource": "*", "effect": "allow"}],
            "agents": {"mework": {"system": "Unrelated user instructions"}},
        }"#).unwrap();
        std::fs::write(root.path().join("empty-key"), "").unwrap();
        let workspace = Workspace::with_provider_sources(
            &[source],
            Some(
                r#"{
            "providers": {"example": {"settings": {"timeout": 1000}}}
        }"#,
            ),
        )
        .unwrap();
        let config: Value = serde_json::from_str(&workspace.config).unwrap();
        assert!(config["providers"]["example"]["models"]
            .get("sample-model")
            .is_some());
        assert_eq!(config["providers"]["example"]["settings"]["timeout"], 1000);
        assert_eq!(
            config["providers"]["example"]["settings"]["apiKey"],
            format!("{{file:{}}}", root.path().join("empty-key").display())
        );
        assert_eq!(config["permissions"][0]["effect"], "deny");
        assert!(!workspace.config.contains("example-plugin"));
        assert!(!workspace.config.contains("Unrelated user instructions"));
        let disk: Value = serde_json::from_slice(
            &std::fs::read(workspace.directory.path().join("opencode.json")).unwrap(),
        )
        .unwrap();
        assert!(disk.get("providers").is_none());
    }

    #[test]
    fn discovers_models_and_runs_without_tools_or_external_configuration() {
        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join(if cfg!(windows) {
            "opencode.cmd"
        } else {
            "opencode"
        });
        // V2 may emit only reconciled text after waiting for the session.
        let events = r#"{"type":"text","part":{"text":"Reasoning about {\"example\":true}. </think>\n{\"summary\":\"Example task\"}"}}"#;
        #[cfg(windows)]
        let script=format!("@echo off\nset args=%*\necho %args% | findstr /c:\"--version\" >nul && (echo opencode v2.0.28 & exit /b 0)\necho %args% | findstr /c:\"--help\" >nul && (echo --standalone --format --model --agent --title & exit /b 0)\necho %args% | findstr /c:\"--standalone\" >nul || exit /b 1\nif not \"%OPENCODE_DISABLE_PROJECT_CONFIG%\"==\"1\" exit /b 1\nfindstr /c:\"deny\" opencode.json >nul || exit /b 1\necho %args% | findstr /c:\"models\" >nul && (echo example/sample-model & exit /b 0)\nset /p input=\n{}\n",events.lines().map(|line|format!("echo {line}")).collect::<Vec<_>>().join("\n"));
        #[cfg(not(windows))]
        let script=format!("#!/bin/sh\ncase \"$*\" in *--version*) echo opencode v2.0.28;exit 0;; *--help*) echo '--standalone --format --model --agent --title';exit 0;; esac\ncase \"$*\" in *--standalone*) ;; *) exit 1;; esac\n[ \"$OPENCODE_DISABLE_PROJECT_CONFIG\" = 1 ] || exit 1\ngrep -q deny opencode.json || exit 1\ncase \"$*\" in *models*) echo example/sample-model;exit 0;; esac\ncat >/dev/null\nprintf '%s\\n' '{events}'\n");
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
        assert!(usage.is_none());
        let workspace = Workspace::new().unwrap();
        let config: Value = serde_json::from_slice(
            &std::fs::read(workspace.directory.path().join("opencode.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config["permissions"][0]["effect"], "deny");
        assert_eq!(
            config["agents"]["mework"]["permissions"][0]["effect"],
            "deny"
        );
        assert_eq!(config["share"], "disabled");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires an installed OpenCode V2 binary"]
    fn blocks_system_plugin_before_module_initialization() {
        let binary = resolve_binary().expect("Install OpenCode V2 before running this check");
        let root = tempfile::tempdir().unwrap();
        let system = root.path().join("system/opencode");
        let plugin = root.path().join("synthetic-plugin");
        std::fs::create_dir_all(&system).unwrap();
        std::fs::create_dir(&plugin).unwrap();
        let marker = root.path().join("entered");
        std::fs::write(
            plugin.join("package.json"),
            r#"{"name":"synthetic-plugin","type":"module","exports":{"./server":"./index.js"}}"#,
        )
        .unwrap();
        std::fs::write(
            plugin.join("index.js"),
            format!(
                "import fs from 'node:fs'; fs.writeFileSync({}, 'loaded'); export default {{ id: 'example.marker', async setup() {{}} }};",
                serde_json::to_string(&marker).unwrap()
            ),
        )
        .unwrap();
        std::fs::write(
            system.join("opencode.json"),
            json!({"plugins": [plugin]}).to_string(),
        )
        .unwrap();
        let workspace = Workspace::new().unwrap();
        capabilities(&binary, &workspace).unwrap();
        let mut command = workspace.command(&binary);
        command
            .env("ProgramData", root.path().join("system"))
            .args(["models", "--standalone"]);
        let output = capture_cli_output(
            command,
            None,
            Duration::from_secs(30),
            "OpenCode CLI",
            "inspect",
            None,
        )
        .unwrap();
        assert!(!parse_models(&output).is_empty());
        assert!(
            !marker.exists(),
            "System plugin module must never be imported"
        );
    }
}
