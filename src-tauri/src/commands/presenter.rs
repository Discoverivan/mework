use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct PresenterState(pub std::sync::Mutex<Option<Value>>);

pub const PRESENTER_WINDOW_LABEL: &str = "daily-presenter";

#[tauri::command]
pub fn open_presenter_view(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PRESENTER_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let (width, height) = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .map(|monitor| {
            let scale_factor = monitor.scale_factor();
            let max_width = (monitor.work_area().size.width as f64 / scale_factor) * 0.85;
            let max_height = (monitor.work_area().size.height as f64 / scale_factor) * 0.85;
            let aspect_ratio = 16.0 / 9.0;
            let width = max_width.min(max_height * aspect_ratio);
            (width, width / aspect_ratio)
        })
        .unwrap_or((1440.0, 810.0));

    WebviewWindowBuilder::new(
        &app,
        PRESENTER_WINDOW_LABEL,
        WebviewUrl::App("index.html#product/daily/presenter".into()),
    )
    .title("Daily: Presenter View")
    .inner_size(width, height)
    .min_inner_size(640.0, 360.0)
    .resizable(true)
    .decorations(true)
    .center()
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_presenter_view(
    app: AppHandle,
    presenter_state: State<'_, PresenterState>,
    state: Value,
) -> Result<(), String> {
    *presenter_state
        .0
        .lock()
        .map_err(|_| "Presenter state lock is unavailable".to_owned())? = Some(state.clone());
    app.emit_to(PRESENTER_WINDOW_LABEL, "daily-presenter-update", state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn presenter_view_state(
    presenter_state: State<'_, PresenterState>,
) -> Result<Option<Value>, String> {
    presenter_state
        .0
        .lock()
        .map_err(|_| "Presenter state lock is unavailable".to_owned())
        .map(|state| state.clone())
}

#[tauri::command]
pub fn close_presenter_view(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PRESENTER_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    app.emit_to("main", "daily-presenter-closed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}
