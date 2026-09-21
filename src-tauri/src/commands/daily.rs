use sqlx::SqlitePool;
use tauri::State;

use crate::application::daily::DailyWorkspaceDto;
use crate::application::planning::PlanningCommandError;

#[tauri::command]
pub async fn daily_workspace(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: Option<String>,
) -> Result<DailyWorkspaceDto, PlanningCommandError> {
    crate::application::daily::load_daily_workspace(
        &state,
        &managed_project_id,
        sprint_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn daily_workspace_refresh(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: String,
) -> Result<Vec<crate::application::daily::DailySubtaskDto>, PlanningCommandError> {
    crate::application::daily::refresh_daily_workspace(&state, &managed_project_id, &sprint_id)
        .await
}
