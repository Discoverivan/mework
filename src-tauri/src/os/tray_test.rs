use super::tray::{tray_command_for_menu_id, TrayCommand};

#[test]
fn maps_supported_tray_menu_ids_to_commands() {
    assert_eq!(tray_command_for_menu_id("open"), Some(TrayCommand::Open));
    assert_eq!(tray_command_for_menu_id("quit"), Some(TrayCommand::Quit));
    assert_eq!(tray_command_for_menu_id("sync-now"), None);
}
