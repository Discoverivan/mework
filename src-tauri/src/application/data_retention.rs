use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::time::Duration;

use crate::infrastructure::db::repositories;

const SETTINGS_KEY: &str = "maintenance.data_retention";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DataRetentionSettings {
    pub review_history_days: u32,
    pub sync_history_days: u32,
    pub removed_task_days: u32,
}

impl Default for DataRetentionSettings {
    fn default() -> Self {
        Self {
            review_history_days: 90,
            sync_history_days: 30,
            removed_task_days: 30,
        }
    }
}

pub async fn settings(pool: &SqlitePool) -> Result<DataRetentionSettings, String> {
    let raw = repositories::get_setting(pool, SETTINGS_KEY)
        .await
        .map_err(|_| "failed to load data retention settings".to_owned())?;
    let settings = match raw {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|_| "invalid data retention settings".to_owned())?
        }
        None => DataRetentionSettings::default(),
    };
    validate(&settings)?;
    Ok(settings)
}

fn validate(settings: &DataRetentionSettings) -> Result<(), String> {
    if [
        settings.review_history_days,
        settings.sync_history_days,
        settings.removed_task_days,
    ]
    .into_iter()
    .any(|days| days > 3650)
    {
        return Err("retention must be between 0 and 3650 days".to_owned());
    }
    Ok(())
}

pub async fn save_settings(
    pool: &SqlitePool,
    settings: DataRetentionSettings,
) -> Result<DataRetentionSettings, String> {
    validate(&settings)?;
    let json = serde_json::to_string(&settings)
        .map_err(|_| "failed to serialize data retention settings".to_owned())?;
    repositories::upsert_setting(pool, SETTINGS_KEY, &json, 1)
        .await
        .map_err(|_| "failed to save data retention settings".to_owned())?;
    Ok(settings)
}

pub async fn clean_up(pool: &SqlitePool) -> Result<(), String> {
    let settings = settings(pool).await?;
    crate::application::developer_review::prune_old_reviews(pool, settings.review_history_days)
        .await?;
    let mut transaction = pool.begin().await.map_err(db_error)?;
    if settings.sync_history_days > 0 {
        sqlx::query("DELETE FROM sync_runs WHERE finished_at IS NOT NULL AND status IN ('succeeded', 'failed') AND datetime(finished_at) < datetime('now', ?)")
            .bind(format!("-{} days", settings.sync_history_days))
            .execute(&mut *transaction).await.map_err(db_error)?;
    }
    if settings.removed_task_days > 0 {
        sqlx::query("DELETE FROM task_monitor_issues WHERE present = 0 AND datetime(observed_at) < datetime('now', ?)")
            .bind(format!("-{} days", settings.removed_task_days))
            .execute(&mut *transaction).await.map_err(db_error)?;
    }
    // Preserve the local calendar day and exact counts; these rows are outside all live periods.
    let rollups = sqlx::query("SELECT date(recorded_at, 'localtime') AS day, provider, model, MIN(recorded_at) AS recorded_at, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens, SUM(request_count) AS request_count FROM ai_token_usage WHERE date(recorded_at, 'localtime') < date('now', 'localtime', '-31 days') GROUP BY day, provider, model HAVING COUNT(*) > 1")
        .fetch_all(&mut *transaction).await.map_err(db_error)?;
    for row in rollups {
        sqlx::query("DELETE FROM ai_token_usage WHERE date(recorded_at, 'localtime') = ? AND provider = ? AND model = ?")
            .bind(row.try_get::<String, _>("day").map_err(db_error)?)
            .bind(row.try_get::<String, _>("provider").map_err(db_error)?)
            .bind(row.try_get::<String, _>("model").map_err(db_error)?)
            .execute(&mut *transaction).await.map_err(db_error)?;
        sqlx::query("INSERT INTO ai_token_usage (recorded_at, provider, model, input_tokens, output_tokens, total_tokens, request_count) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(row.try_get::<String, _>("recorded_at").map_err(db_error)?)
            .bind(row.try_get::<String, _>("provider").map_err(db_error)?)
            .bind(row.try_get::<String, _>("model").map_err(db_error)?)
            .bind(row.try_get::<i64, _>("input_tokens").map_err(db_error)?)
            .bind(row.try_get::<i64, _>("output_tokens").map_err(db_error)?)
            .bind(row.try_get::<i64, _>("total_tokens").map_err(db_error)?)
            .bind(row.try_get::<i64, _>("request_count").map_err(db_error)?)
            .execute(&mut *transaction).await.map_err(db_error)?;
    }
    transaction.commit().await.map_err(db_error)
}

fn db_error(_: sqlx::Error) -> String {
    "data retention database operation failed".to_owned()
}

pub async fn run_background_cleanup(pool: SqlitePool) {
    let mut interval = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if let Err(error) = clean_up(&pool).await {
            eprintln!("Data retention cleanup failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cleanup_prunes_expired_history_and_preserves_current_data_and_usage_totals() {
        let directory = tempfile::tempdir().unwrap();
        let pool =
            crate::infrastructure::db::open_database(&directory.path().join("retention.sqlite"))
                .await
                .unwrap();
        let settings = DataRetentionSettings {
            review_history_days: 1,
            sync_history_days: 1,
            removed_task_days: 1,
        };
        save_settings(&pool, settings.clone()).await.unwrap();
        assert_eq!(super::settings(&pool).await.unwrap(), settings);
        sqlx::query("INSERT INTO integrations (id, kind, base_url, account_key, credential_ref, created_at, updated_at) VALUES ('example-integration', 'jira', 'https://example.invalid', 'example', '', '2000-01-01', '2000-01-01')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO task_monitors (id, integration_id, name, jql, schedule_kind, schedule_value, tracked_events_json, created_at, updated_at) VALUES ('example-monitor', 'example-integration', 'Example monitor', '', 'period', '5', '[]', '2000-01-01', '2000-01-01')").execute(&pool).await.unwrap();
        for (key, present) in [("EXAMPLE-1", 0), ("EXAMPLE-2", 1)] {
            sqlx::query("INSERT INTO task_monitor_issues (monitor_id, issue_id, issue_key, summary, status, priority, issue_url, present, observed_at) VALUES ('example-monitor', ?, ?, 'Example task', 'Open', '', 'https://example.invalid', ?, '2000-01-01')").bind(key).bind(key).bind(present).execute(&pool).await.unwrap();
        }
        for (id, status, finished) in [
            ("expired", "succeeded", Some("2000-01-01")),
            ("active", "running", None),
        ] {
            sqlx::query("INSERT INTO sync_runs (id, integration_id, job_kind, status, started_at, finished_at) VALUES (?, 'example-integration', 'example', ?, '2000-01-01', ?)").bind(id).bind(status).bind(finished).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO pull_request_comment_actions (idempotency_key, request_json, status) VALUES ('example-action', '{}', 'completed')").execute(&pool).await.unwrap();
        for tokens in [30_i64, 70] {
            sqlx::query("INSERT INTO ai_token_usage (recorded_at, provider, model, input_tokens, output_tokens, total_tokens) VALUES ('2000-01-01T12:00:00Z', 'example', 'example-model', ?, 0, ?)").bind(tokens).bind(tokens).execute(&pool).await.unwrap();
        }
        let mut reviews = serde_json::Map::new();
        for (id, status) in [("1", "completed"), ("2", "completed"), ("3", "running")] {
            reviews.insert(format!("example-integration:EXAMPLE:example-repo:{id}"), serde_json::json!({"runId": id, "status": status, "reviewedCommit": null, "result": null, "error": null, "startedAt": 1, "finishedAt": 2}));
        }
        repositories::upsert_setting(
            &pool,
            "developer.pull_request_reviews",
            &serde_json::json!({"reviews": reviews}).to_string(),
            4,
        )
        .await
        .unwrap();
        repositories::upsert_setting(&pool, "developer.pull_request_cache", &serde_json::json!({"values": [{"integrationId": "example-integration", "projectKey": "EXAMPLE", "repositorySlug": "example-repo", "pullRequestId": "2"}]}).to_string(), 1).await.unwrap();
        clean_up(&pool).await.unwrap();
        let reviews: serde_json::Value = serde_json::from_str(
            &repositories::get_setting(&pool, "developer.pull_request_reviews")
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        let reviews = reviews["reviews"].as_object().unwrap();
        assert_eq!(reviews.len(), 2);
        assert!(reviews.contains_key("example-integration:EXAMPLE:example-repo:2"));
        assert!(reviews.contains_key("example-integration:EXAMPLE:example-repo:3"));
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT issue_key FROM task_monitor_issues")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "EXAMPLE-2"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT id FROM sync_runs")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "active"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pull_request_comment_actions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        let usage: (i64, i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), SUM(total_tokens), SUM(request_count) FROM ai_token_usage",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(usage, (1, 100, 2));
        clean_up(&pool).await.unwrap();
        assert_eq!(
            sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT COUNT(*), SUM(total_tokens), SUM(request_count) FROM ai_token_usage"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            usage
        );
    }
}
