use sqlx::SqlitePool;
use tauri::State;

use crate::application::daily::{self, AiSummaryRequest};

#[tauri::command]
pub async fn ai_sprint_summary(
    state: State<'_, SqlitePool>,
    request: AiSummaryRequest,
) -> Result<crate::application::ai_summary::AiSummaryResponse, String> {
    daily::generate_ai_summary(&state, request).await
}
