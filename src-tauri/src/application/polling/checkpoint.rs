use sqlx::SqlitePool;

pub async fn current_checkpoint(
    pool: &SqlitePool,
    integration_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let checkpoint =
        sqlx::query_scalar::<_, Option<String>>("SELECT checkpoint FROM integrations WHERE id = ?")
            .bind(integration_id)
            .fetch_optional(pool)
            .await?;

    Ok(checkpoint.flatten())
}

pub async fn record_successful_page(
    pool: &SqlitePool,
    integration_id: &str,
    checkpoint_before: Option<&str>,
    checkpoint_after: &str,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE integrations
         SET checkpoint = ?, last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?
           AND ((? IS NULL AND checkpoint IS NULL) OR checkpoint = ?)",
    )
    .bind(checkpoint_after)
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
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::now_v7().to_string())
    .bind(integration_id)
    .bind("jira_issue_poll")
    .bind("succeeded")
    .bind(checkpoint_before)
    .bind(checkpoint_after)
    .bind(1_i64)
    .bind("{}")
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await
}

pub async fn record_failed_page(
    pool: &SqlitePool,
    integration_id: &str,
    checkpoint_before: &str,
    error_code: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO sync_runs
            (id, integration_id, job_kind, status, started_at, finished_at,
             checkpoint_before, pages, counters_json, error_code)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::now_v7().to_string())
    .bind(integration_id)
    .bind("jira_issue_poll")
    .bind("failed")
    .bind(checkpoint_before)
    .bind(0_i64)
    .bind("{}")
    .bind(error_code)
    .execute(pool)
    .await
    .map(|_| ())
}
