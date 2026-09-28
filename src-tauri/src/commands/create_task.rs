use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

use crate::application::create_task::{
    self, JiraCreatedTaskDto, JiraTaskCreateRequest, JiraTaskMemberDto, TaskDraftDto,
    TaskDraftRequest,
};
use crate::application::dev_overlay::DevMockMode;

#[tauri::command]
pub async fn ai_task_draft(
    state: State<'_, SqlitePool>,
    request: TaskDraftRequest,
) -> Result<TaskDraftDto, String> {
    create_task::generate_draft(&state, request).await
}

#[tauri::command]
pub async fn jira_task_team_members(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<JiraTaskMemberDto>, String> {
    create_task::list_team_members(&state, &managed_project_id).await
}

#[tauri::command]
pub async fn jira_task_create(
    app: AppHandle,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: JiraTaskCreateRequest,
) -> Result<JiraCreatedTaskDto, String> {
    let created = create_task::create_task(&state, request).await?;
    if mode.is_enabled() {
        let snapshot = mode.snapshot()?;
        if let Some(monitor) = snapshot.monitors.first() {
            crate::application::dev_overlay::persist_mock_task_tracker_snapshot(&state, monitor)
                .await?;
        }
        let _ = app.emit("task_tracker_updated", &snapshot.monitors);
    }
    Ok(created)
}
