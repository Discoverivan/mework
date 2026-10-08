use sqlx::SqlitePool;
use tauri::{AppHandle, State};

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
        match crate::application::task_tracker::list_monitors(&state).await {
            Ok(monitors) => {
                for monitor in monitors {
                    if let Err(error) =
                        crate::application::task_tracker::check_now(&state, &app, &monitor.id).await
                    {
                        eprintln!("Mock Task Tracker refresh after Jira create failed: {error}");
                    }
                }
            }
            Err(error) => eprintln!("Mock Task Tracker monitors could not be refreshed: {error}"),
        }
    }
    Ok(created)
}
