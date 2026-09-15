use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Window, WindowEvent,
};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum TrayCommand {
    Open,
    Quit,
}

pub fn tray_command_for_menu_id(id: &str) -> Option<TrayCommand> {
    match id {
        "open" => Some(TrayCommand::Open),
        "quit" => Some(TrayCommand::Quit),
        _ => None,
    }
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open mework", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit mework", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if let Some(command) = tray_command_for_menu_id(event.id.as_ref()) {
                dispatch_menu_command(app, command);
            }
        });
    let tray_builder = match app.default_window_icon() {
        Some(icon) => tray_builder.icon(icon.clone()),
        None => tray_builder,
    };
    let _tray = tray_builder.build(app)?;

    Ok(())
}

pub fn dispatch_menu_command(app: &AppHandle, command: TrayCommand) {
    match command {
        TrayCommand::Open => show_and_focus_main_window(app),
        TrayCommand::Quit => app.exit(0),
    }
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == "daily-presenter" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn show_and_focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
