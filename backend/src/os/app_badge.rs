use tauri::{AppHandle, Manager};

#[cfg(any(target_os = "windows", test))]
#[path = "app_badge_renderer.rs"]
mod renderer;

pub fn set_unread_count(app: &AppHandle, count: u64) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        // Windows overlays are 16 logical pixels; render at the display's physical
        // resolution rather than asking the shell to enlarge a 16 px bitmap.
        let size = renderer::icon_size(window.scale_factor()?);
        let icon = renderer::render(count, size)
            .map(|pixels| tauri::image::Image::new_owned(pixels, size, size));
        window.set_overlay_icon(icon)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let badge_count = if count == 0 {
            None
        } else {
            Some(count.min(i64::MAX as u64) as i64)
        };
        window.set_badge_count(badge_count)?;
    }

    Ok(())
}
