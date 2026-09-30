use crate::application::ai::AiProviderId;
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    env,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub mod claude_code;
pub mod codex;
pub mod hermes_cli;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn local_cli_command(path: impl AsRef<OsStr>) -> Command {
    let command = Command::new(path);
    #[cfg(target_os = "windows")]
    let mut command = command;
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
    let mut candidates: Vec<(AiProviderId, String, PathBuf)> = Vec::new();
    for (provider, override_key) in [
        (AiProviderId::CodexCli, "MEWORK_CODEX_BIN"),
        (AiProviderId::ClaudeCodeCli, "MEWORK_CLAUDE_BIN"),
        (AiProviderId::HermesCli, "MEWORK_HERMES_BIN"),
    ] {
        if let Some(path) = env::var_os(override_key) {
            candidates.push((provider, override_key.to_owned(), PathBuf::from(path)));
        }
    }
    if let Some(path) = env::var_os("PATH") {
        for (index, entry) in env::split_paths(&path).enumerate() {
            for (provider, names) in [
                (
                    AiProviderId::CodexCli,
                    codex::executable_names(cfg!(windows)),
                ),
                (AiProviderId::ClaudeCodeCli, claude_code::executable_names()),
                (AiProviderId::HermesCli, hermes_cli::executable_names()),
            ] {
                for name in names {
                    candidates.push((provider, format!("PATH[{index}]/{name}"), entry.join(name)));
                }
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(root) = env::var_os("LOCALAPPDATA") {
            candidates.push((
                AiProviderId::CodexCli,
                "LOCALAPPDATA".to_owned(),
                PathBuf::from(root).join("Programs/OpenAI/Codex/bin/codex.exe"),
            ));
        }
        if let Some(root) = env::var_os("USERPROFILE") {
            candidates.push((
                AiProviderId::CodexCli,
                "USERPROFILE".to_owned(),
                PathBuf::from(root).join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe"),
            ));
        } else if let Some(root) = env::var_os("HOME") {
            candidates.push((
                AiProviderId::CodexCli,
                "HOME-fallback".to_owned(),
                PathBuf::from(root).join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe"),
            ));
        }
        if let Some(root) = dirs::data_local_dir() {
            candidates.push((
                AiProviderId::CodexCli,
                "system-local-data".to_owned(),
                root.join("Programs/OpenAI/Codex/bin/codex.exe"),
            ));
        }
        if let Some(path) = env::current_exe()
            .ok()
            .as_deref()
            .and_then(codex::path_beside_installed_app)
        {
            candidates.push((AiProviderId::CodexCli, "beside-app".to_owned(), path));
        }
        if let Some(root) = dirs::home_dir() {
            candidates.push((
                AiProviderId::CodexCli,
                "system-home".to_owned(),
                root.join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe"),
            ));
        }
    }
    #[cfg(not(windows))]
    for (source, path) in [
        ("homebrew", PathBuf::from("/opt/homebrew/bin/codex")),
        ("usr-local", PathBuf::from("/usr/local/bin/codex")),
    ] {
        candidates.push((AiProviderId::CodexCli, source.to_owned(), path));
    }
    #[cfg(not(windows))]
    if let Some(root) = env::var_os("HOME") {
        let root = PathBuf::from(root);
        candidates.push((
            AiProviderId::CodexCli,
            "HOME-local".to_owned(),
            root.join(".local/bin/codex"),
        ));
        candidates.push((
            AiProviderId::CodexCli,
            "HOME-npm-global".to_owned(),
            root.join(".npm-global/bin/codex"),
        ));
    }
    for (source, path) in claude_code::diagnostic_install_paths() {
        candidates.push((AiProviderId::ClaudeCodeCli, source.to_owned(), path));
    }
    for (source, path) in hermes_cli::diagnostic_install_paths() {
        candidates.push((AiProviderId::HermesCli, source.to_owned(), path));
    }
    candidates
        .into_iter()
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
