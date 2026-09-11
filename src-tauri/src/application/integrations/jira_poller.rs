use sqlx::SqlitePool;

use crate::infrastructure::integrations::jira::models::JiraIssue;

pub async fn persist_successful_page(
    pool: &SqlitePool,
    integration_id: &str,
    checkpoint_before: Option<&str>,
    checkpoint_after: &str,
    issues: &[JiraIssue],
    observed_at: &str,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;

    for issue in issues {
        let title = issue
            .fields
            .get("summary")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        sqlx::query(
            "INSERT INTO jira_issues
                (id, integration_id, external_id, issue_key, title, raw_payload_json, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(integration_id, external_id) DO UPDATE SET
                issue_key = excluded.issue_key,
                title = excluded.title,
                raw_payload_json = excluded.raw_payload_json,
                observed_at = excluded.observed_at",
        )
        .bind(&issue.id)
        .bind(integration_id)
        .bind(&issue.id)
        .bind(&issue.key)
        .bind(title)
        .bind(issue.fields.to_string())
        .bind(observed_at)
        .execute(&mut *transaction)
        .await?;
    }

    let updated = sqlx::query(
        "UPDATE integrations
         SET checkpoint = ?, last_success_at = ?, updated_at = ?
         WHERE id = ?
           AND ((? IS NULL AND checkpoint IS NULL) OR checkpoint = ?)",
    )
    .bind(checkpoint_after)
    .bind(observed_at)
    .bind(observed_at)
    .bind(integration_id)
    .bind(checkpoint_before)
    .bind(checkpoint_before)
    .execute(&mut *transaction)
    .await?;

    if updated.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }

    sqlx::query(
        "INSERT INTO sync_runs
            (id, integration_id, job_kind, status, started_at, finished_at,
             checkpoint_before, checkpoint_after, pages, counters_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::now_v7().to_string())
    .bind(integration_id)
    .bind("jira_issue_poll")
    .bind("succeeded")
    .bind(observed_at)
    .bind(observed_at)
    .bind(checkpoint_before)
    .bind(checkpoint_after)
    .bind(1_i64)
    .bind(serde_json::json!({ "issues": issues.len() }).to_string())
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await
}
