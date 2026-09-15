use std::{fs, io::Read, path::Path, process::Command};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::infrastructure::db::repositories;

const COMMAND_BOARD_SETTING_KEY: &str = "developer.command_board";
const COMMAND_BOARD_SCHEMA_VERSION: i64 = 2;
const DEFAULT_COMMAND_BOARD_COLOR: &str = "default";
const COMMAND_BOARD_COLORS: [&str; 8] = [
    "default", "blue", "green", "yellow", "orange", "red", "purple", "pink",
];
const MAX_NAME_CHARS: usize = 120;
const MAX_COMMAND_CHARS: usize = 1_000;
const MAX_ARGUMENTS_CHARS: usize = 4_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandBoardItemDto {
    pub id: String,
    pub name: String,
    pub script_path: String,
    pub launch_command: String,
    #[serde(default)]
    pub arguments: String,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default = "default_command_board_color")]
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBoardSaveRequest {
    pub id: Option<String>,
    pub name: String,
    pub script_path: String,
    #[serde(default)]
    pub launch_command: Option<String>,
    #[serde(default)]
    pub arguments: String,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBoardRunStatus {
    pub id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandBoardState {
    #[serde(default)]
    commands: Vec<CommandBoardItemDto>,
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<CommandBoardItemDto>, String> {
    Ok(load_state(pool).await?.commands)
}

pub async fn save(
    pool: &SqlitePool,
    request: CommandBoardSaveRequest,
) -> Result<CommandBoardItemDto, String> {
    let item = validate_and_build_item(request)?;
    let mut state = load_state(pool).await?;
    if let Some(existing) = state.commands.iter_mut().find(|value| value.id == item.id) {
        *existing = item.clone();
    } else {
        state.commands.push(item.clone());
    }
    save_state(pool, &state).await?;
    Ok(item)
}

pub async fn remove(pool: &SqlitePool, id: &str) -> Result<bool, String> {
    if id.trim().is_empty() {
        return Err("Command id is required".to_owned());
    }
    let mut state = load_state(pool).await?;
    let original_len = state.commands.len();
    state.commands.retain(|item| item.id != id);
    if original_len == state.commands.len() {
        return Ok(false);
    }
    save_state(pool, &state).await?;
    Ok(true)
}

pub async fn run(pool: &SqlitePool, id: &str) -> Result<CommandBoardRunStatus, String> {
    if id.trim().is_empty() {
        return Err("Command id is required".to_owned());
    }
    let state = load_state(pool).await?;
    let item = state
        .commands
        .iter()
        .find(|value| value.id == id)
        .ok_or_else(|| "Command was not found".to_owned())?;
    let script_path = validate_script_path(&item.script_path)?;
    let arguments = parse_command_line(&item.arguments)?;
    let working_directory = item
        .working_directory
        .as_deref()
        .map(validate_working_directory)
        .transpose()?;
    #[cfg(target_os = "windows")]
    {
        validate_windows_process_input(&script_path)?;
        if let Some(working_directory) = working_directory.as_deref() {
            validate_windows_process_input(working_directory)?;
        }
        for argument in &arguments {
            validate_windows_process_input(argument)?;
        }
    }
    spawn_script_in_terminal(&script_path, &arguments, working_directory.as_deref())?;
    Ok(CommandBoardRunStatus {
        id: item.id.clone(),
        started: true,
    })
}

fn default_command_board_color() -> String {
    DEFAULT_COMMAND_BOARD_COLOR.to_owned()
}

fn validate_command_board_color(value: Option<&str>) -> Result<String, String> {
    let color = value.unwrap_or(DEFAULT_COMMAND_BOARD_COLOR).trim();
    if COMMAND_BOARD_COLORS.contains(&color) {
        Ok(color.to_owned())
    } else {
        Err("Unsupported Command Board card color".to_owned())
    }
}

fn validate_and_build_item(
    request: CommandBoardSaveRequest,
) -> Result<CommandBoardItemDto, String> {
    let name = validate_text(&request.name, "Command name", MAX_NAME_CHARS)?;
    let script_path = validate_script_path(&request.script_path)?;
    let launch_command = request
        .launch_command
        .as_deref()
        .map(|value| validate_text(value, "Launch command", MAX_COMMAND_CHARS))
        .transpose()?
        .unwrap_or_else(|| "system".to_owned());
    let arguments = validate_optional_text(&request.arguments, "Arguments", MAX_ARGUMENTS_CHARS)?;
    let working_directory = request
        .working_directory
        .as_deref()
        .map(validate_working_directory)
        .transpose()?;
    let color = validate_command_board_color(request.color.as_deref())?;
    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    Ok(CommandBoardItemDto {
        id,
        name,
        script_path,
        launch_command,
        arguments,
        working_directory,
        color,
    })
}

fn validate_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains unsupported control characters"));
    }
    Ok(value.to_owned())
}

fn validate_optional_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(format!("{label} is invalid"));
    }
    Ok(value.to_owned())
}

fn validate_script_path(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Script file is required".to_owned());
    }
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err("Script path must be absolute".to_owned());
    }
    if !path.is_file() {
        return Err("Script file does not exist".to_owned());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn validate_working_directory(value: &str) -> Result<String, String> {
    let value = value.trim();
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err("Working directory must be an existing absolute directory".to_owned());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn parse_command_line(value: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        match (quote, character) {
            (Some('\''), '\'') | (Some('"'), '"') => quote = None,
            (None, '\'') | (None, '"') => quote = Some(character),
            (_, '\\') => escaped = true,
            (None, character) if character.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            (_, character) => current.push(character),
        }
    }
    if escaped || quote.is_some() {
        return Err("Launch command or arguments contain an unterminated quote".to_owned());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

async fn load_state(pool: &SqlitePool) -> Result<CommandBoardState, String> {
    let value = repositories::get_setting(pool, COMMAND_BOARD_SETTING_KEY)
        .await
        .map_err(|_| "Command Board database operation failed".to_owned())?;
    value
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|_| "Saved Command Board data is invalid".to_owned())
        })
        .transpose()
        .map(|state| state.unwrap_or_default())
}

async fn save_state(pool: &SqlitePool, state: &CommandBoardState) -> Result<(), String> {
    let value = serde_json::to_string(state)
        .map_err(|_| "Command Board data could not be serialized".to_owned())?;
    repositories::upsert_setting(
        pool,
        COMMAND_BOARD_SETTING_KEY,
        &value,
        COMMAND_BOARD_SCHEMA_VERSION,
    )
    .await
    .map_err(|_| "Command Board database operation failed".to_owned())
}

fn spawn_script_in_terminal(
    script_path: &str,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    let path = Path::new(script_path);
    let interpreter = script_interpreter(path);
    if interpreter.is_none() && !is_executable(path) {
        return Err("Script file has no supported interpreter and is not executable".to_owned());
    }

    #[cfg(target_os = "macos")]
    {
        spawn_macos_terminal(script_path, interpreter, arguments, working_directory)
    }

    #[cfg(target_os = "windows")]
    {
        spawn_windows_terminal(script_path, interpreter, arguments, working_directory)
    }

    #[cfg(target_os = "linux")]
    {
        spawn_linux_terminal(script_path, interpreter, arguments, working_directory)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let mut command = Command::new(interpreter.unwrap_or(script_path));
        if interpreter.is_some() {
            command.arg(script_path);
        }
        command.args(arguments);
        if let Some(working_directory) = working_directory {
            command.current_dir(working_directory);
        }
        command
            .spawn()
            .map_err(|_| "Script could not be started".to_owned())?;
        Ok(())
    }
}

fn script_interpreter(path: &Path) -> Option<&'static str> {
    if let Some(interpreter) = shebang_interpreter(path) {
        return Some(interpreter);
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    extension.and_then(|value| interpreter_for_name(&value))
}

fn shebang_interpreter(path: &Path) -> Option<&'static str> {
    let mut bytes = Vec::with_capacity(512);
    fs::File::open(path)
        .ok()?
        .take(512)
        .read_to_end(&mut bytes)
        .ok()?;
    let first_line = bytes.split(|byte| *byte == b'\n').next()?;
    let first_line = std::str::from_utf8(first_line).ok()?.trim();
    let mut shebang = first_line.strip_prefix("#!")?.split_whitespace();
    let mut interpreter_name = shebang.next()?;
    if Path::new(interpreter_name)
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name == "env")
    {
        interpreter_name = shebang.next()?;
    }
    let interpreter_name = Path::new(interpreter_name)
        .file_name()
        .and_then(|value| value.to_str())?;
    interpreter_for_name(&interpreter_name.to_ascii_lowercase())
}

fn interpreter_for_name(name: &str) -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        match name {
            "sh" | "bash" | "zsh" | "command" => Some("bash.exe"),
            "py" | "python" | "python2" | "python3" => Some("python.exe"),
            "powershell" | "pwsh" | "ps1" => Some("powershell.exe"),
            "bat" | "cmd" => Some("cmd.exe"),
            _ => None,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        match name {
            "sh" | "command" => Some("/bin/sh"),
            "bash" => Some("/bin/bash"),
            "zsh" => Some("/bin/zsh"),
            "fish" => Some("fish"),
            "python" | "python2" => Some("python"),
            "py" | "python3" => Some("python3"),
            "powershell" | "pwsh" | "ps1" => Some("pwsh"),
            "bat" | "cmd" => None,
            _ => None,
        }
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("exe" | "com" | "bat" | "cmd" | "ps1")
    )
}

#[cfg(target_os = "windows")]
fn validate_windows_process_input(value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|character| matches!(character, '&' | '|' | '<' | '>' | '^' | '%' | '!'))
    {
        return Err("Script path, working directory, or arguments contain unsupported Windows shell characters".to_owned());
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(target_os = "macos")]
fn spawn_macos_terminal(
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    let mut command_parts = Vec::new();
    if let Some(working_directory) = working_directory {
        command_parts.push(format!("cd -- {} &&", shell_quote(working_directory)));
    }
    if let Some(interpreter) = interpreter {
        command_parts.push(shell_quote(interpreter));
    }
    command_parts.push(shell_quote(script_path));
    command_parts.extend(arguments.iter().map(|argument| shell_quote(argument)));
    let shell_command = command_parts.join(" ");
    let apple_script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
        apple_script_quote(&shell_command)
    );
    Command::new("/usr/bin/osascript")
        .args(["-e", &apple_script])
        .spawn()
        .map_err(|_| "Terminal could not be opened".to_owned())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn apple_script_quote(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

#[cfg(target_os = "windows")]
fn spawn_windows_terminal(
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    let mut child_arguments = Vec::new();
    match interpreter {
        Some("cmd.exe") => child_arguments.extend(["cmd.exe".to_owned(), "/K".to_owned()]),
        Some("powershell.exe") => child_arguments.extend([
            "powershell.exe".to_owned(),
            "-NoExit".to_owned(),
            "-ExecutionPolicy".to_owned(),
            "Bypass".to_owned(),
            "-File".to_owned(),
        ]),
        Some(interpreter) => child_arguments.push(interpreter.to_owned()),
        None => {}
    }
    child_arguments.push(script_path.to_owned());
    child_arguments.extend(arguments.iter().cloned());

    let mut command = Command::new("cmd.exe");
    command.arg("/K");
    command.args(child_arguments);
    if let Some(working_directory) = working_directory {
        command.current_dir(working_directory);
    }
    command
        .spawn()
        .map_err(|_| "Command Prompt could not be opened".to_owned())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn spawn_linux_terminal(
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    let executable = interpreter.unwrap_or(script_path);
    let mut command = Command::new("x-terminal-emulator");
    command.arg("-e").arg(executable);
    if interpreter.is_some() {
        command.arg(script_path);
    }
    command.args(arguments);
    if let Some(working_directory) = working_directory {
        command.current_dir(working_directory);
    }
    command
        .spawn()
        .map_err(|_| "System terminal could not be opened".to_owned())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_command_line, script_interpreter, validate_command_board_color};

    #[test]
    fn accepts_only_supported_card_colors() {
        assert_eq!(validate_command_board_color(None).unwrap(), "default");
        assert_eq!(
            validate_command_board_color(Some("purple")).unwrap(),
            "purple"
        );
        assert!(validate_command_board_color(Some("neon")).is_err());
    }

    #[test]
    fn parses_quoted_command_arguments_without_shell_execution() {
        assert_eq!(
            parse_command_line("/usr/bin/open -a Terminal '{script}'").unwrap(),
            vec!["/usr/bin/open", "-a", "Terminal", "{script}"]
        );
    }

    #[test]
    fn detects_interpreter_from_script_extension() {
        assert!(script_interpreter(std::path::Path::new("script.sh")).is_some());
        assert!(script_interpreter(std::path::Path::new("script.py")).is_some());
    }

    #[test]
    fn prefers_shebang_for_custom_extensions() {
        let path = std::env::temp_dir().join(format!(
            "mework-command-board-{}.custom",
            std::process::id()
        ));
        std::fs::write(&path, "#!/bin/bash\nprintf 'synthetic test'\n").unwrap();
        #[cfg(target_os = "windows")]
        assert_eq!(script_interpreter(&path), Some("bash.exe"));
        #[cfg(not(target_os = "windows"))]
        assert_eq!(script_interpreter(&path), Some("/bin/bash"));
        std::fs::remove_file(path).unwrap();
    }
}
