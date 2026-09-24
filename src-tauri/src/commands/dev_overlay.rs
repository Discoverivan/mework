use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::application::dev_overlay::{self, DevMockMode, DevOverlaySnapshot};

#[tauri::command]
pub fn dev_overlay_enabled(mode: State<'_, DevMockMode>) -> bool {
    mode.is_enabled()
}

#[tauri::command]
pub fn dev_overlay_state(mode: State<'_, DevMockMode>) -> Result<DevOverlaySnapshot, String> {
    mode.snapshot()
}

#[tauri::command]
pub async fn dev_overlay_add_task<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    summary: String,
) -> Result<DevOverlaySnapshot, String> {
    let snapshot = mode.add_task(&summary)?;
    persist_task_tracker_snapshot(&state, &snapshot).await?;
    emit_task_tracker(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn dev_overlay_set_task_status<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    issue_key: String,
    status: String,
) -> Result<DevOverlaySnapshot, String> {
    let snapshot = mode.set_task_status(&issue_key, &status)?;
    persist_task_tracker_snapshot(&state, &snapshot).await?;
    emit_task_tracker(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn dev_overlay_add_pull_request<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    authored: bool,
) -> Result<crate::application::developer::MyPullRequestsPageDto, String> {
    let page = mode.add_pull_request(authored)?;
    if authored {
        let _ = app.emit("my_pull_requests_updated", &page);
    } else {
        let _ = app.emit("pull_request_review_updated", &page);
    }
    Ok(page)
}

#[tauri::command]
pub async fn dev_overlay_reset_scenario<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
) -> Result<DevOverlaySnapshot, String> {
    let snapshot = mode.reset()?;
    persist_task_tracker_snapshot(&state, &snapshot).await?;
    emit_task_tracker(&app, &snapshot);
    let _ = app.emit(
        "pull_request_review_updated",
        &snapshot.reviewer_pull_requests,
    );
    let _ = app.emit("my_pull_requests_updated", &snapshot.authored_pull_requests);
    Ok(snapshot)
}

async fn persist_task_tracker_snapshot(
    pool: &SqlitePool,
    snapshot: &DevOverlaySnapshot,
) -> Result<(), String> {
    let monitor = snapshot
        .monitors
        .first()
        .ok_or_else(|| "Mock Task Tracker monitor is unavailable".to_owned())?;
    dev_overlay::persist_mock_task_tracker_snapshot(pool, monitor).await
}

fn emit_task_tracker<R: Runtime>(app: &AppHandle<R>, snapshot: &DevOverlaySnapshot) {
    let _ = app.emit("task_tracker_updated", &snapshot.monitors);
}
