use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

use crate::application::dev_overlay::DevMockMode;
use crate::application::task_tracker::{
    self, TaskTrackerJqlPreviewDto, TaskTrackerJqlRequest, TaskTrackerMonitorDto,
    TaskTrackerMonitorExportRequest, TaskTrackerMonitorRequest,
};

#[tauri::command]
pub async fn task_tracker_list(
    state: State<'_, SqlitePool>,
) -> Result<Vec<TaskTrackerMonitorDto>, String> {
    task_tracker::list_monitors(&state).await
}

#[tauri::command]
pub async fn task_tracker_save(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: TaskTrackerMonitorRequest,
) -> Result<TaskTrackerMonitorDto, String> {
    if mode.is_enabled() {
        return Err("Monitor configuration is disabled in mock mode".to_owned());
    }
    task_tracker::save_monitor(&state, request).await
}

#[tauri::command]
pub fn task_tracker_save_export(
    mode: State<'_, DevMockMode>,
    file_path: String,
    request: TaskTrackerMonitorExportRequest,
) -> Result<(), String> {
    if mode.is_enabled() {
        return Err("Monitor export is disabled in mock mode".to_owned());
    }
    task_tracker::save_monitor_export(&file_path, request)
}

#[tauri::command]
pub async fn task_tracker_delete(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<bool, String> {
    if mode.is_enabled() {
        return Err("Monitor changes are disabled in mock mode".to_owned());
    }
    task_tracker::delete_monitor(&state, &id).await
}

#[tauri::command]
pub async fn task_tracker_set_enabled(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    id: String,
    enabled: bool,
) -> Result<TaskTrackerMonitorDto, String> {
    if mode.is_enabled() {
        return Err("Monitor changes are disabled in mock mode".to_owned());
    }
    task_tracker::set_monitor_enabled(&state, &id, enabled).await
}

#[tauri::command]
pub async fn task_tracker_validate_jql(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: TaskTrackerJqlRequest,
) -> Result<TaskTrackerJqlPreviewDto, String> {
    if mode.is_enabled() {
        return mode.mock_task_tracker_jql_preview(&request.jql);
    }
    task_tracker::validate_jql(&state, request).await
}

#[tauri::command]
pub async fn task_tracker_check_now<R: tauri::Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<TaskTrackerMonitorDto, String> {
    if mode.is_enabled() {
        let monitors = task_tracker::list_monitors(&state).await?;
        let monitor = monitors
            .iter()
            .find(|monitor| monitor.id == id)
            .cloned()
            .ok_or_else(|| "Task tracker monitor was not found".to_owned())?;
        let _ = app.emit("task_tracker_updated", monitors);
        return Ok(monitor);
    }
    task_tracker::check_now(&state, &app, &id).await
}
