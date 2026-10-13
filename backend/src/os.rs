pub mod app_badge;
pub mod autostart;
#[cfg(all(desktop, any(debug_assertions, target_os = "macos")))]
pub mod menu;
pub mod notifications;
pub mod single_instance;
#[cfg(test)]
mod single_instance_test;
pub mod tray;

#[cfg(test)]
mod tray_test;
