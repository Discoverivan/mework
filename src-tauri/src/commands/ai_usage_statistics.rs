use sqlx::SqlitePool;
use tauri::State;

use crate::application::ai_usage_statistics::{self, AiUsagePeriod, AiUsageStatistics};

#[tauri::command]
pub async fn ai_usage_statistics(
    state: State<'_, SqlitePool>,
    period: AiUsagePeriod,
) -> Result<AiUsageStatistics, String> {
    ai_usage_statistics::statistics(&state, period).await
}
