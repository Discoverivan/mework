use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

use crate::application::general::{self, AppIconStyle};

static CHANGE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub fn change_lock() -> &'static tokio::sync::Mutex<()> {
    CHANGE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn image(style: AppIconStyle) -> tauri::image::Image<'static> {
    match style {
        AppIconStyle::Original => tauri::include_image!("../public/mework-icon-original.png"),
        AppIconStyle::Transparent => tauri::include_image!("icons/icon.png"),
    }
}

pub fn apply<R: Runtime>(app: &AppHandle<R>, style: AppIconStyle) -> Result<(), String> {
    let icon = image(style);
    for window in app.webview_windows().values() {
        window
            .set_icon(icon.clone())
            .map_err(|_| "Could not update the window icon")?;
    }
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_icon(Some(icon))
            .map_err(|_| "Could not update the tray icon")?;
    }
    #[cfg(target_os = "macos")]
    {
        let bytes: &'static [u8] = match style {
            AppIconStyle::Original => include_bytes!("../../../public/mework-icon-original.png"),
            AppIconStyle::Transparent => include_bytes!("../../icons/icon.png"),
        };
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;
            let result = (|| {
                let marker =
                    MainThreadMarker::new().ok_or("Application icon requires the main thread")?;
                let data = NSData::with_bytes(bytes);
                let icon = NSImage::initWithData(NSImage::alloc(), &data)
                    .ok_or("Could not decode application icon")?;
                unsafe {
                    NSApplication::sharedApplication(marker).setApplicationIconImage(Some(&icon))
                };
                Ok::<(), &str>(())
            })();
            let _ = send.send(result);
        })
        .map_err(|_| "Could not update the Dock icon")?;
        receive
            .recv()
            .map_err(|_| "Could not update the Dock icon")?
            .map_err(str::to_owned)?;
    }
    Ok(())
}

pub async fn restore_saved<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _guard = change_lock().lock().await;
    let pool = app.state::<sqlx::SqlitePool>();
    let settings = general::load(&pool).await?;
    apply(&app, settings.app_icon_style)
}
