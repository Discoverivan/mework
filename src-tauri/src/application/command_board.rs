use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::infrastructure::db::repositories;

const COMMAND_BOARD_SETTING_KEY: &str = "developer.command_board";
const COMMAND_BOARD_SCHEMA_VERSION: i64 = 3;
const DEFAULT_COMMAND_BOARD_COLOR: &str = "default";
const SYSTEM_TERMINAL_ID: &str = "system";
const COMMAND_BOARD_COLORS: [&str; 8] = [
    "default", "blue", "green", "yellow", "orange", "red", "purple", "pink",
];
const MAX_NAME_CHARS: usize = 120;
const MAX_COMMAND_CHARS: usize = 1_000;
const MAX_ARGUMENTS_CHARS: usize = 4_000;
static COMMAND_BOARD_WRITE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn command_board_write_lock() -> &'static tokio::sync::Mutex<()> {
    COMMAND_BOARD_WRITE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn default_terminal_id() -> String {
    SYSTEM_TERMINAL_ID.to_owned()
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBoardTerminalOptionDto {
    pub id: String,
    pub label: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBoardTerminalPreferencesDto {
    pub selected_terminal: String,
    pub options: Vec<CommandBoardTerminalOptionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandBoardState {
    #[serde(default)]
    commands: Vec<CommandBoardItemDto>,
    #[serde(default = "default_terminal_id")]
    terminal_id: String,
}

impl Default for CommandBoardState {
    fn default() -> Self {
        Self {
            commands: Vec::new(),
            terminal_id: default_terminal_id(),
        }
    }
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<CommandBoardItemDto>, String> {
    Ok(load_state(pool).await?.commands)
}

pub async fn terminal_preferences(
    pool: &SqlitePool,
) -> Result<CommandBoardTerminalPreferencesDto, String> {
    let state = load_state(pool).await?;
    Ok(terminal_preferences_for(state.terminal_id))
}

pub async fn set_terminal_preference(
    pool: &SqlitePool,
    terminal_id: &str,
) -> Result<CommandBoardTerminalPreferencesDto, String> {
    let terminal_id = validate_terminal_selection(terminal_id)?;
    let _guard = command_board_write_lock().lock().await;
    let mut state = load_state(pool).await?;
    state.terminal_id = terminal_id;
    save_state(pool, &state).await?;
    Ok(terminal_preferences_for(state.terminal_id))
}

pub async fn save(
    pool: &SqlitePool,
    request: CommandBoardSaveRequest,
) -> Result<CommandBoardItemDto, String> {
    let item = validate_and_build_item(request)?;
    let _guard = command_board_write_lock().lock().await;
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
    let _guard = command_board_write_lock().lock().await;
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
    let terminal_id = validate_terminal_selection(&state.terminal_id)?;
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
    spawn_script_in_terminal(
        &terminal_id,
        &script_path,
        &arguments,
        working_directory.as_deref(),
    )?;
    Ok(CommandBoardRunStatus {
        id: item.id.clone(),
        started: true,
    })
}

fn terminal_preferences_for(selected_terminal: String) -> CommandBoardTerminalPreferencesDto {
    let mut options = available_terminal_options();
    if !options.iter().any(|option| option.id == selected_terminal) {
        options.push(terminal_option(
            &selected_terminal,
            terminal_label(&selected_terminal).unwrap_or(""),
            false,
        ));
    }
    CommandBoardTerminalPreferencesDto {
        selected_terminal,
        options,
    }
}

fn validate_terminal_selection(terminal_id: &str) -> Result<String, String> {
    let terminal_id = terminal_id.trim();
    if terminal_id.is_empty() {
        return Err("Terminal selection is required".to_owned());
    }
    let available = available_terminal_options()
        .into_iter()
        .any(|option| option.id == terminal_id && option.available);
    if available {
        Ok(terminal_id.to_owned())
    } else {
        Err("Selected terminal is not installed or supported".to_owned())
    }
}

fn terminal_option(id: &str, label: &str, available: bool) -> CommandBoardTerminalOptionDto {
    CommandBoardTerminalOptionDto {
        id: id.to_owned(),
        label: label.to_owned(),
        available,
    }
}

fn terminal_label(id: &str) -> Option<&'static str> {
    match id {
        "iterm2" => Some("iTerm2"),
        "kitty" => Some("Kitty"),
        "ghostty" => Some("Ghostty"),
        "wezterm" => Some("WezTerm"),
        "alacritty" => Some("Alacritty"),
        "windows_terminal" => Some("Windows Terminal"),
        "gnome_terminal" => Some("GNOME Terminal"),
        "konsole" => Some("Konsole"),
        "xfce_terminal" => Some("Xfce Terminal"),
        "xterm" => Some("xterm"),
        "foot" => Some("foot"),
        _ => None,
    }
}

fn available_terminal_options() -> Vec<CommandBoardTerminalOptionDto> {
    let mut options = vec![terminal_option(
        SYSTEM_TERMINAL_ID,
        "Default terminal",
        system_terminal_available(),
    )];

    #[cfg(target_os = "macos")]
    if macos_terminal_executable("kitty").is_some() {
        options.push(terminal_option("kitty", "Kitty", true));
    }

    #[cfg(target_os = "macos")]
    if macos_iterm2_available() {
        options.push(terminal_option("iterm2", "iTerm2", true));
    }

    #[cfg(target_os = "macos")]
    for (id, label) in [
        ("ghostty", "Ghostty"),
        ("wezterm", "WezTerm"),
        ("alacritty", "Alacritty"),
    ] {
        if macos_terminal_executable(id).is_some() {
            options.push(terminal_option(id, label, true));
        }
    }

    #[cfg(target_os = "windows")]
    if windows_terminal_executable().is_some() {
        options.push(terminal_option(
            "windows_terminal",
            "Windows Terminal",
            true,
        ));
    }

    #[cfg(target_os = "linux")]
    for (id, label, executable) in LINUX_TERMINALS {
        if find_executable(executable).is_some() {
            options.push(terminal_option(id, label, true));
        }
    }

    options
}

fn system_terminal_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(target_os = "linux")]
    {
        linux_system_terminal_id().is_some()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        true
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn find_executable(name: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file() && is_executable(candidate))
}

#[cfg(target_os = "macos")]
fn macos_application_paths(application_name: &str) -> Vec<PathBuf> {
    let mut applications = vec![PathBuf::from("/Applications").join(application_name)];
    if let Some(home) = env::var_os("HOME") {
        applications.push(
            PathBuf::from(home)
                .join("Applications")
                .join(application_name),
        );
    }
    applications
}

#[cfg(target_os = "macos")]
fn macos_iterm2_available() -> bool {
    macos_application_paths("iTerm.app")
        .iter()
        .any(|application| application.is_dir())
}

#[cfg(target_os = "macos")]
fn macos_terminal_executable(terminal_id: &str) -> Option<PathBuf> {
    let (application, bundled_executables, path_executable): (&str, &[&str], &str) =
        match terminal_id {
            "kitty" => ("kitty.app", &["kitty"], "kitty"),
            "ghostty" => ("Ghostty.app", &["ghostty", "Ghostty"], "ghostty"),
            "wezterm" => ("WezTerm.app", &["wezterm", "wezterm-gui"], "wezterm"),
            "alacritty" => ("Alacritty.app", &["alacritty"], "alacritty"),
            _ => return None,
        };
    macos_terminal_executable_in(&macos_application_paths(application), bundled_executables)
        .or_else(|| find_executable(path_executable))
}

#[cfg(target_os = "macos")]
fn macos_terminal_executable_in(
    applications: &[PathBuf],
    executable_names: &[&str],
) -> Option<PathBuf> {
    applications
        .iter()
        .flat_map(|application| {
            executable_names
                .iter()
                .map(move |name| application.join("Contents/MacOS").join(name))
        })
        .find(|candidate| candidate.is_file() && is_executable(candidate))
}

#[cfg(target_os = "windows")]
fn windows_terminal_executable() -> Option<PathBuf> {
    find_executable("wt.exe").or_else(|| {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|local_app_data| local_app_data.join("Microsoft/WindowsApps/wt.exe"))
            .filter(|candidate| candidate.is_file() && is_executable(candidate))
    })
}

#[cfg(target_os = "linux")]
const LINUX_TERMINALS: [(&str, &str, &str); 8] = [
    ("gnome_terminal", "GNOME Terminal", "gnome-terminal"),
    ("konsole", "Konsole", "konsole"),
    ("xfce_terminal", "Xfce Terminal", "xfce4-terminal"),
    ("xterm", "xterm", "xterm"),
    ("kitty", "kitty", "kitty"),
    ("alacritty", "Alacritty", "alacritty"),
    ("wezterm", "WezTerm", "wezterm"),
    ("foot", "foot", "foot"),
];

#[cfg(target_os = "linux")]
fn linux_system_terminal_id() -> Option<&'static str> {
    if find_executable("x-terminal-emulator").is_some() {
        return Some("x_terminal_emulator");
    }
    LINUX_TERMINALS
        .iter()
        .find(|(_, _, executable)| find_executable(executable).is_some())
        .map(|(id, _, _)| *id)
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
    let Some(raw) = value else {
        return Ok(CommandBoardState::default());
    };
    let mut state: CommandBoardState =
        serde_json::from_str(&raw).map_err(|_| "Saved Command Board data is invalid".to_owned())?;
    if state.terminal_id.trim().is_empty() {
        state.terminal_id = default_terminal_id();
    }
    Ok(state)
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
    terminal_id: &str,
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
        spawn_macos_terminal(
            terminal_id,
            script_path,
            interpreter,
            arguments,
            working_directory,
        )
    }

    #[cfg(target_os = "windows")]
    {
        spawn_windows_terminal(
            terminal_id,
            script_path,
            interpreter,
            arguments,
            working_directory,
        )
    }

    #[cfg(target_os = "linux")]
    {
        spawn_linux_terminal(
            terminal_id,
            script_path,
            interpreter,
            arguments,
            working_directory,
        )
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
    terminal_id: &str,
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    if terminal_id == "kitty" {
        let executable = macos_terminal_executable("kitty")
            .ok_or_else(|| "Kitty is not available".to_owned())?;
        let kitty_arguments = env::var_os("KITTY_LISTEN_ON")
            .map(|socket| {
                macos_kitty_remote_arguments(
                    &socket.to_string_lossy(),
                    script_path,
                    interpreter,
                    arguments,
                    working_directory,
                )
            })
            .unwrap_or_else(|| {
                macos_kitty_arguments(script_path, interpreter, arguments, working_directory)
            });
        Command::new(executable)
            .args(kitty_arguments)
            .spawn()
            .map_err(|_| "Kitty could not be opened".to_owned())?;
        return Ok(());
    }

    if matches!(terminal_id, "wezterm" | "alacritty") {
        let executable = macos_terminal_executable(terminal_id)
            .ok_or_else(|| "Selected terminal is not available".to_owned())?;
        let command_arguments = macos_cli_terminal_arguments(
            terminal_id,
            script_path,
            interpreter,
            arguments,
            working_directory,
        )
        .ok_or_else(|| "Selected terminal is not available".to_owned())?;
        Command::new(executable)
            .args(command_arguments)
            .spawn()
            .map_err(|_| "Selected terminal could not be opened".to_owned())?;
        return Ok(());
    }

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
    let apple_script = macos_terminal_apple_script(terminal_id, &shell_command)?;
    Command::new("/usr/bin/osascript")
        .args(["-e", &apple_script])
        .spawn()
        .map_err(|_| "Terminal could not be opened".to_owned())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_kitty_arguments(
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Vec<String> {
    let mut command_arguments = vec!["--single-instance".to_owned()];
    if let Some(working_directory) = working_directory {
        command_arguments.push("--directory".to_owned());
        command_arguments.push(working_directory.to_owned());
    }
    if let Some(interpreter) = interpreter {
        command_arguments.push(interpreter.to_owned());
    }
    command_arguments.push(script_path.to_owned());
    command_arguments.extend(arguments.iter().cloned());
    command_arguments
}

#[cfg(target_os = "macos")]
fn macos_terminal_apple_script(terminal_id: &str, shell_command: &str) -> Result<String, String> {
    let escaped_shell_command = apple_script_quote(shell_command);
    match terminal_id {
        SYSTEM_TERMINAL_ID => Ok(format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{escaped_shell_command}\"\nend tell"
        )),
        "iterm2" => Ok(format!(
            "tell application \"iTerm\"\nactivate\nif (count of windows) = 0 then\n set targetWindow to (create window with default profile)\n set targetSession to current session of targetWindow\nelse\n tell current window\n  set targetTab to (create tab with default profile)\n  set targetSession to current session of targetTab\n end tell\nend if\ntell targetSession to write text \"{escaped_shell_command}\"\nend tell"
        )),
        "ghostty" => {
            let command_input = apple_script_quote(&format!("{shell_command}\n"));
            Ok(format!(
                "tell application \"Ghostty\"\nset cfg to new surface configuration\nif (count of windows) = 0 then\n set targetWindow to new window with configuration cfg\n set targetTab to selected tab of targetWindow\nelse\n set targetWindow to front window\n set targetTab to new tab in targetWindow with configuration cfg\nend if\nset targetTerminal to focused terminal of targetTab\ninput text \"{command_input}\" to targetTerminal\nend tell"
            ))
        }
        _ => Err("Selected terminal is not available".to_owned()),
    }
}

#[cfg(target_os = "macos")]
fn macos_kitty_remote_arguments(
    socket: &str,
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Vec<String> {
    let mut command_arguments = vec![
        "@".to_owned(),
        "--to".to_owned(),
        socket.to_owned(),
        "launch".to_owned(),
        "--type=tab".to_owned(),
    ];
    if let Some(working_directory) = working_directory {
        command_arguments.push("--cwd".to_owned());
        command_arguments.push(working_directory.to_owned());
    }
    command_arguments.push("--".to_owned());
    if let Some(interpreter) = interpreter {
        command_arguments.push(interpreter.to_owned());
    }
    command_arguments.push(script_path.to_owned());
    command_arguments.extend(arguments.iter().cloned());
    command_arguments
}

#[cfg(target_os = "macos")]
fn macos_cli_terminal_arguments(
    terminal_id: &str,
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Option<Vec<String>> {
    let mut command_arguments = match terminal_id {
        "wezterm" => vec!["start".to_owned(), "--new-tab".to_owned()],
        "alacritty" => Vec::new(),
        _ => return None,
    };
    if let Some(working_directory) = working_directory {
        command_arguments.push(if terminal_id == "wezterm" {
            "--cwd".to_owned()
        } else {
            "--working-directory".to_owned()
        });
        command_arguments.push(working_directory.to_owned());
    }
    if terminal_id == "alacritty" {
        command_arguments.push("-e".to_owned());
    }
    if terminal_id == "wezterm" {
        command_arguments.push("--".to_owned());
    }
    if let Some(interpreter) = interpreter {
        command_arguments.push(interpreter.to_owned());
    }
    command_arguments.push(script_path.to_owned());
    command_arguments.extend(arguments.iter().cloned());
    Some(command_arguments)
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
    terminal_id: &str,
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

    let mut command = match terminal_id {
        SYSTEM_TERMINAL_ID => {
            let mut command = Command::new("cmd.exe");
            command.arg("/K").args(child_arguments);
            command
        }
        "windows_terminal" => {
            let mut command = Command::new(
                windows_terminal_executable()
                    .ok_or_else(|| "Windows Terminal is not available".to_owned())?,
            );
            command.arg("new-tab");
            if let Some(working_directory) = working_directory {
                command.arg("--startingDirectory").arg(working_directory);
            }
            command.args(child_arguments);
            command
        }
        _ => return Err("Selected terminal is not available".to_owned()),
    };
    if terminal_id == SYSTEM_TERMINAL_ID {
        if let Some(working_directory) = working_directory {
            command.current_dir(working_directory);
        }
    }
    command.spawn().map_err(|_| {
        if terminal_id == "windows_terminal" {
            "Windows Terminal could not be opened".to_owned()
        } else {
            "Command Prompt could not be opened".to_owned()
        }
    })?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn spawn_linux_terminal(
    terminal_id: &str,
    script_path: &str,
    interpreter: Option<&str>,
    arguments: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    let terminal_id = if terminal_id == SYSTEM_TERMINAL_ID {
        linux_system_terminal_id()
            .ok_or_else(|| "No supported system terminal is available".to_owned())?
    } else {
        terminal_id
    };
    let (terminal_executable, prefix_arguments) = linux_terminal_invocation(terminal_id)
        .ok_or_else(|| "Selected terminal is not available".to_owned())?;
    let executable = interpreter.unwrap_or(script_path);
    let mut command = Command::new(terminal_executable);
    command.args(prefix_arguments).arg(executable);
    if interpreter.is_some() {
        command.arg(script_path);
    }
    command.args(arguments);
    if let Some(working_directory) = working_directory {
        command.current_dir(working_directory);
    }
    command
        .spawn()
        .map_err(|_| "Selected terminal could not be opened".to_owned())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_terminal_invocation(terminal_id: &str) -> Option<(PathBuf, &'static [&'static str])> {
    let (executable, prefix_arguments): (&str, &[&str]) = match terminal_id {
        "x_terminal_emulator" => ("x-terminal-emulator", &["-e"]),
        "gnome_terminal" => ("gnome-terminal", &["--"]),
        "konsole" => ("konsole", &["-e"]),
        "xfce_terminal" => ("xfce4-terminal", &["--execute"]),
        "xterm" => ("xterm", &["-e"]),
        "kitty" => ("kitty", &[]),
        "alacritty" => ("alacritty", &["-e"]),
        "wezterm" => ("wezterm", &["start", "--"]),
        "foot" => ("foot", &["-e"]),
        _ => return None,
    };
    let executable = find_executable(executable)?;
    Some((executable, prefix_arguments))
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
    fn existing_command_board_state_defaults_to_system_terminal() {
        let state: super::CommandBoardState = serde_json::from_str(r#"{"commands":[]}"#).unwrap();
        assert_eq!(state.terminal_id, "system");
    }

    #[test]
    fn rejects_unrecognized_terminal_selection() {
        assert!(super::validate_terminal_selection("sh -c 'echo unsafe'").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finds_terminal_executable_inside_an_application_bundle() {
        use std::os::unix::fs::PermissionsExt;

        let bundle =
            std::env::temp_dir().join(format!("mework-command-board-kitty-{}", std::process::id()));
        let executable = bundle.join("Contents/MacOS/kitty");
        let _ = std::fs::remove_dir_all(&bundle);
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "synthetic kitty executable").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            super::macos_terminal_executable_in(std::slice::from_ref(&bundle), &["kitty"]),
            Some(executable)
        );
        std::fs::remove_dir_all(bundle).unwrap();

        let installed_kitty = std::path::Path::new("/Applications/kitty.app/Contents/MacOS/kitty");
        if installed_kitty.is_file() {
            assert_eq!(
                super::macos_terminal_executable("kitty"),
                Some(installed_kitty.to_path_buf())
            );
            assert!(super::available_terminal_options()
                .iter()
                .any(|option| option.id == "kitty" && option.available));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn builds_kitty_arguments_without_shell_interpolation() {
        let args = super::macos_kitty_arguments(
            "/tmp/a script.sh",
            Some("/bin/sh"),
            &["hello world".to_owned()],
            Some("/tmp/work dir"),
        );
        assert_eq!(
            args,
            [
                "--single-instance",
                "--directory",
                "/tmp/work dir",
                "/bin/sh",
                "/tmp/a script.sh",
                "hello world",
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn builds_new_tab_automation_for_supported_macos_terminals() {
        let iterm = super::macos_terminal_apple_script("iterm2", "echo safe").unwrap();
        assert!(iterm.contains("create tab with default profile"));
        assert!(iterm.contains("write text"));

        let ghostty = super::macos_terminal_apple_script("ghostty", "echo safe").unwrap();
        assert!(ghostty.contains("new tab in"));
        assert!(ghostty.contains("input text"));

        let kitty = super::macos_kitty_remote_arguments(
            "unix:/tmp/kitty-control",
            "/tmp/a script.sh",
            Some("/bin/sh"),
            &["hello world".to_owned()],
            Some("/tmp/work dir"),
        );
        assert_eq!(
            kitty,
            [
                "@",
                "--to",
                "unix:/tmp/kitty-control",
                "launch",
                "--type=tab",
                "--cwd",
                "/tmp/work dir",
                "--",
                "/bin/sh",
                "/tmp/a script.sh",
                "hello world",
            ]
        );

        let wezterm = super::macos_cli_terminal_arguments(
            "wezterm",
            "/tmp/a script.sh",
            Some("/bin/sh"),
            &["hello world".to_owned()],
            Some("/tmp/work dir"),
        )
        .unwrap();
        assert_eq!(
            wezterm,
            [
                "start",
                "--new-tab",
                "--cwd",
                "/tmp/work dir",
                "--",
                "/bin/sh",
                "/tmp/a script.sh",
                "hello world",
            ]
        );

        let alacritty = super::macos_cli_terminal_arguments(
            "alacritty",
            "/tmp/a script.sh",
            Some("/bin/sh"),
            &["hello world".to_owned()],
            Some("/tmp/work dir"),
        )
        .unwrap();
        assert_eq!(
            alacritty,
            [
                "--working-directory",
                "/tmp/work dir",
                "-e",
                "/bin/sh",
                "/tmp/a script.sh",
                "hello world",
            ]
        );
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
