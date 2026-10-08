use std::path::Path;

use tauri::{AppHandle, Manager};

#[derive(Debug, Eq, PartialEq)]
pub enum SingleInstanceAction {
    FocusMainWindow,
}

pub fn action_for_second_instance(_args: &[String], _cwd: &Path) -> SingleInstanceAction {
    SingleInstanceAction::FocusMainWindow
}

pub fn handle_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    if action_for_second_instance(&args, Path::new(&cwd)) == SingleInstanceAction::FocusMainWindow {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
