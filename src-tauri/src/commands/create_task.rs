use sqlx::SqlitePool;
use tauri::State;

use crate::application::create_task::{
    self, JiraCreatedTaskDto, JiraTaskCreateRequest, JiraTaskMemberDto, TaskDraftDto,
    TaskDraftRequest,
};

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
    state: State<'_, SqlitePool>,
    request: JiraTaskCreateRequest,
) -> Result<JiraCreatedTaskDto, String> {
    create_task::create_task(&state, request).await
}
