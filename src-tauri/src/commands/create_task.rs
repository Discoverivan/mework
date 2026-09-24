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
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<JiraTaskMemberDto>, String> {
    if mode.is_enabled() {
        if managed_project_id != "mock-managed-project" {
            return Err("Mock managed project was not found".to_owned());
        }
        return mode.mock_team_members().map(|members| {
            members
                .into_iter()
                .filter(|member| member.active)
                .map(|member| JiraTaskMemberDto {
                    id: member.account_id,
                    display_name: member
                        .alias
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or(member.display_name),
                    avatar_url: None,
                    active: true,
                })
                .collect()
        });
    }
    create_task::list_team_members(&state, &managed_project_id).await
}

#[tauri::command]
pub async fn jira_task_create(
    app: AppHandle,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: JiraTaskCreateRequest,
) -> Result<JiraCreatedTaskDto, String> {
    if mode.is_enabled() {
        let snapshot = mode.add_task(&request.summary)?;
        let issue = snapshot.monitors[0]
            .issues
            .last()
            .ok_or_else(|| "Mock task could not be created".to_owned())?;
        let _ = app.emit("task_tracker_updated", &snapshot.monitors);
        return Ok(JiraCreatedTaskDto {
            id: issue.key.clone(),
            key: issue.key.clone(),
            url: issue.issue_url.clone(),
            warning: None,
        });
    }
    create_task::create_task(&state, request).await
}
