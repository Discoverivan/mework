use super::JiraCreatedTaskDto;
use sqlx::SqlitePool;

pub(super) const UNKNOWN: &str = "jira_task_outcome_unknown";
const STORAGE: &str = "jira_task_journal_unavailable";

pub(super) async fn result(
    pool: &SqlitePool,
    key: &str,
) -> Result<Option<JiraCreatedTaskDto>, String> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT status, result_json FROM jira_task_create_actions WHERE operation_key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(|_| STORAGE.to_owned())?;
    match row {
        None => Ok(None),
        Some((status, _)) if status == "rejected" => Ok(None),
        Some((status, Some(json))) if status == "succeeded" => serde_json::from_str(&json)
            .map(Some)
            .map_err(|_| UNKNOWN.to_owned()),
        _ => Err(UNKNOWN.to_owned()),
    }
}

pub(super) async fn claim(
    pool: &SqlitePool,
    key: &str,
    integration_id: &str,
) -> Result<(), String> {
    let claimed = sqlx::query(
        "INSERT INTO jira_task_create_actions (operation_key, integration_id, status) VALUES (?, ?, 'running')
         ON CONFLICT(operation_key) DO UPDATE SET status = 'running', integration_id = excluded.integration_id, updated_at = CURRENT_TIMESTAMP
         WHERE jira_task_create_actions.status = 'rejected'",
    )
    .bind(key)
    .bind(integration_id)
    .execute(pool)
    .await
    .map_err(|_| STORAGE.to_owned())?;
    if claimed.rows_affected() != 1 {
        return Err(UNKNOWN.to_owned());
    }
    Ok(())
}

pub(super) async fn reject(pool: &SqlitePool, key: &str) -> Result<(), String> {
    sqlx::query("UPDATE jira_task_create_actions SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE operation_key = ? AND status = 'running'")
        .bind(key)
        .execute(pool)
        .await
        .map_err(|_| UNKNOWN.to_owned())?;
    Ok(())
}

pub(super) async fn succeed(
    pool: &SqlitePool,
    key: &str,
    result: &JiraCreatedTaskDto,
) -> Result<(), String> {
    let json = serde_json::to_string(result).map_err(|_| UNKNOWN.to_owned())?;
    sqlx::query("UPDATE jira_task_create_actions SET status = 'succeeded', result_json = ?, updated_at = CURRENT_TIMESTAMP WHERE operation_key = ?")
        .bind(json)
        .bind(key)
        .execute(pool)
        .await
        .map_err(|_| UNKNOWN.to_owned())?;
    Ok(())
}
