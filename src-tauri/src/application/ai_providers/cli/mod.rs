use crate::application::ai::AiProviderId;
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    env,
    ffi::OsStr,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

pub mod claude_code;
pub mod codex;
mod discovery;
pub mod hermes_cli;
pub mod opencode;
pub mod pi;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) struct CliInvocation {
    provider: &'static str,
    operation: &'static str,
    model: Option<String>,
    started: Instant,
}

impl CliInvocation {
    pub(crate) fn start(
        provider: &'static str,
        operation: &'static str,
        model: Option<&str>,
    ) -> Self {
        crate::application::logging::info(
            "ai.cli",
            "process_started",
            serde_json::json!({"provider": provider, "operation": operation, "model": model}),
        );
        Self {
            provider,
            operation,
            model: model.map(str::to_owned),
            started: Instant::now(),
        }
    }

    pub(crate) fn failed(&self, exit_code: Option<i32>, stdout: &[u8], stderr: &[u8]) {
        crate::application::logging::log_cli_failure_with_duration(
            self.provider,
            self.operation,
            self.model.as_deref(),
            exit_code,
            Some(self.started.elapsed().as_millis()),
            stdout,
            stderr,
        );
    }

    pub(crate) fn completed(&self, output_bytes: usize) {
        crate::application::logging::info(
            "ai.cli",
            "process_completed",
            serde_json::json!({
                "provider": self.provider,
                "operation": self.operation,
                "model": self.model,
                "duration_ms": self.started.elapsed().as_millis(),
                "output_bytes": output_bytes,
            }),
        );
    }
}

pub(crate) fn spawn_cli(
    command: &mut Command,
    provider: &'static str,
    operation: &'static str,
    model: Option<&str>,
) -> std::io::Result<(Child, CliInvocation)> {
    let invocation = CliInvocation::start(provider, operation, model);
    match command.spawn() {
        Ok(child) => Ok((child, invocation)),
        Err(error) => {
            invocation.failed(None, &[], &[]);
            Err(error)
        }
    }
}

pub(crate) fn run_cli_output(
    command: &mut Command,
    provider: &'static str,
    operation: &'static str,
    model: Option<&str>,
) -> std::io::Result<Output> {
    let invocation = CliInvocation::start(provider, operation, model);
    let output = command.output();
    match &output {
        Ok(output) if output.status.success() => invocation.completed(output.stdout.len()),
        Ok(output) => invocation.failed(output.status.code(), &output.stdout, &output.stderr),
        Err(_) => invocation.failed(None, &[], &[]),
    }
    output
}

const OUTPUT_LIMIT: u64 = 8 * 1024 * 1024;

pub(crate) fn capture_cli_output(
    mut command: Command,
    input: Option<String>,
    timeout: Duration,
    provider: &'static str,
    operation: &'static str,
    model: Option<&str>,
) -> Result<Vec<u8>, String> {
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let (mut child, invocation) = spawn_cli(&mut command, provider, operation, model)
        .map_err(|_| format!("Unable to start {provider}"))?;
    let mut exit_code = None;
    let result = (|| {
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{provider} output is unavailable"))?;
        let reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .by_ref()
                .take(OUTPUT_LIMIT + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() as u64 > OUTPUT_LIMIT {
                std::io::copy(&mut stdout, &mut std::io::sink())?;
            }
            Ok::<_, std::io::Error>(bytes)
        });
        let writer = input.and_then(|input| {
            child
                .stdin
                .take()
                .map(|mut stdin| thread::spawn(move || stdin.write_all(input.as_bytes())))
        });
        let deadline = Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                _ => {
                    #[cfg(windows)]
                    {
                        let _ = local_cli_command("taskkill.exe")
                            .args(["/PID", &child.id().to_string(), "/T", "/F"])
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .status();
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        };
        exit_code = status.as_ref().and_then(|status| status.code());
        let output = reader
            .join()
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| format!("{provider} output could not be read"))?;
        let sent = writer.is_none_or(|writer| writer.join().is_ok_and(|result| result.is_ok()));
        let status = status.ok_or_else(|| format!("{provider} timed out"))?;
        if !status.success() || !sent {
            return Err(format!("{provider} run failed"));
        }
        if output.len() as u64 > OUTPUT_LIMIT {
            return Err(format!("{provider} output is too large"));
        }
        Ok(output)
    })();
    match &result {
        Ok(output) => invocation.completed(output.len()),
        // Prompts and generated text must never enter diagnostics.
        Err(_) => invocation.failed(exit_code, &[], &[]),
    }
    result
}

pub(crate) fn local_cli_command(path: impl AsRef<OsStr>) -> Command {
    let binary = Path::new(path.as_ref());
    let mut command = Command::new(binary);
    // npm shebangs need Node; GUI launches may not inherit the shell PATH.
    // Prefer the runtime beside the selected CLI, then the inherited PATH.
    let mut paths = binary
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    if let Some(path) = env::var_os("PATH") {
        paths.extend(env::split_paths(&path));
    }
    #[cfg(not(windows))]
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Ok(path) = env::join_paths(paths) {
        command.env("PATH", path);
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub(crate) fn usable_cli_path(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    #[cfg(windows)]
    {
        // An updater-launched process can have EnforceRedirectionTrust enabled.
        // Windows then rejects a CLI behind a user junction with error 448.
        // Resolve the junctions explicitly and execute the concrete file.
        match fs::File::open(path) {
            Ok(_) => return Some(path.to_path_buf()),
            Err(error) if error.raw_os_error() == Some(448) => {}
            Err(_) => return None,
        }
        let resolved = resolve_windows_cli_junctions(path, |part| fs::read_link(part))?;
        resolved.is_file().then_some(resolved)
    }
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
pub(crate) fn resolve_windows_cli_junctions(
    path: &Path,
    read_link: impl Fn(&Path) -> std::io::Result<PathBuf>,
) -> Option<PathBuf> {
    let mut resolved = path.to_path_buf();
    for _ in 0..8 {
        let junction = resolved
            .ancestors()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .find_map(|ancestor| read_link(ancestor).ok().map(|target| (ancestor, target)));
        let Some((ancestor, target)) = junction else {
            return Some(resolved);
        };
        let suffix = resolved.strip_prefix(ancestor).ok()?;
        resolved = if target.is_absolute() {
            target.join(suffix)
        } else {
            ancestor.parent()?.join(target).join(suffix)
        };
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCliCandidateDiagnostic {
    pub(crate) provider: AiProviderId,
    source: String,
    metadata_is_file: bool,
    metadata_error_code: Option<i32>,
    can_open: bool,
    open_error_code: Option<i32>,
}

pub fn ai_cli_candidate_diagnostics() -> Vec<AiCliCandidateDiagnostic> {
    let candidates = discovery::PROVIDERS.into_iter().flat_map(|provider| {
        discovery::candidates(provider)
            .into_iter()
            .map(move |(source, path)| (provider, source, path))
    });
    candidates
        .map(|(provider, source, path)| {
            let metadata = fs::metadata(&path);
            let opened = fs::File::open(&path);
            AiCliCandidateDiagnostic {
                provider,
                source,
                metadata_is_file: metadata.as_ref().is_ok_and(|value| value.is_file()),
                metadata_error_code: metadata.err().and_then(|error| error.raw_os_error()),
                can_open: opened.is_ok(),
                open_error_code: opened.err().and_then(|error| error.raw_os_error()),
            }
        })
        .collect()
}
