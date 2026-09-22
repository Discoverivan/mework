use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::task_tracker::{
    self, TaskTrackerJqlPreviewDto, TaskTrackerJqlRequest, TaskTrackerMonitorDto,
    TaskTrackerMonitorRequest,
};

#[tauri::command]
pub async fn task_tracker_list(
    state: State<'_, SqlitePool>,
) -> Result<Vec<TaskTrackerMonitorDto>, String> {
    task_tracker::list_monitors(&state).await
}

#[tauri::command]
pub async fn task_tracker_save(
    state: State<'_, SqlitePool>,
    request: TaskTrackerMonitorRequest,
) -> Result<TaskTrackerMonitorDto, String> {
    task_tracker::save_monitor(&state, request).await
}

#[tauri::command]
pub async fn task_tracker_delete(state: State<'_, SqlitePool>, id: String) -> Result<bool, String> {
    task_tracker::delete_monitor(&state, &id).await
}

#[tauri::command]
pub async fn task_tracker_set_enabled(
    state: State<'_, SqlitePool>,
    id: String,
    enabled: bool,
) -> Result<TaskTrackerMonitorDto, String> {
    task_tracker::set_monitor_enabled(&state, &id, enabled).await
}

#[tauri::command]
pub async fn task_tracker_validate_jql(
    state: State<'_, SqlitePool>,
    request: TaskTrackerJqlRequest,
) -> Result<TaskTrackerJqlPreviewDto, String> {
    task_tracker::validate_jql(&state, request).await
}

#[tauri::command]
pub async fn task_tracker_check_now<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<TaskTrackerMonitorDto, String> {
    task_tracker::check_now(&state, &app, &id).await
}
