use sqlx::SqlitePool;
use tauri::State;

use crate::application::daily::DailyWorkspaceDto;
use crate::application::dev_overlay::DevMockMode;
use crate::application::planning::PlanningCommandError;

fn mock_mode_error() -> PlanningCommandError {
    PlanningCommandError {
        code: "mock_mode".to_owned(),
        message: "Provider access is disabled in mock mode".to_owned(),
        retryable: false,
        details: None,
    }
}

#[tauri::command]
pub async fn daily_workspace(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: Option<String>,
) -> Result<DailyWorkspaceDto, PlanningCommandError> {
    if mode.is_enabled() {
        return mode
            .mock_daily_workspace(&managed_project_id, sprint_id.as_deref())
            .map_err(|_| mock_mode_error());
    }
    crate::application::daily::load_daily_workspace(
        &state,
        &managed_project_id,
        sprint_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn daily_workspace_refresh(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: String,
) -> Result<Vec<crate::application::daily::DailySubtaskDto>, PlanningCommandError> {
    if mode.is_enabled() {
        return mode
            .mock_daily_workspace(&managed_project_id, Some(&sprint_id))
            .map(|workspace| workspace.subtasks)
            .map_err(|_| mock_mode_error());
    }
    crate::application::daily::refresh_daily_workspace(&state, &managed_project_id, &sprint_id)
        .await
}
