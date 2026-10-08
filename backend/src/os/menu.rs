use tauri::{
    menu::{Menu, MenuItem, Submenu},
    Manager,
};

pub const OPEN_DEVTOOLS_MENU_ID: &str = "open-devtools";

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let developer_tools = MenuItem::with_id(
        app,
        OPEN_DEVTOOLS_MENU_ID,
        "Open Developer Tools",
        true,
        Some("CmdOrCtrl+Alt+I"),
    )?;
    let developer_menu = Submenu::with_items(app, "Developer", true, &[&developer_tools])?;
    let menu = Menu::default(app.handle())?;
    menu.append(&developer_menu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id.as_ref() == OPEN_DEVTOOLS_MENU_ID {
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::OPEN_DEVTOOLS_MENU_ID;

    #[test]
    fn keeps_a_stable_developer_tools_menu_id() {
        assert_eq!(OPEN_DEVTOOLS_MENU_ID, "open-devtools");
    }
}
