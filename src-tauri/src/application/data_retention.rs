use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use time::{Date, Duration as TimeDuration, Month, OffsetDateTime};

use crate::infrastructure::db::repositories;

const SETTINGS_KEY: &str = "maintenance.data_retention";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RetentionUnit {
    Minutes,
    Hours,
    #[default]
    Days,
    Months,
}

impl RetentionUnit {
    fn maximum(self) -> u32 {
        match self {
            Self::Minutes => 5_256_000,
            Self::Hours => 87_600,
            Self::Days => 3650,
            Self::Months => 120,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RetentionMode {
    Disabled,
    Period,
    Indefinite,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RetentionPeriod {
    pub mode: RetentionMode,
    pub value: u32,
    pub unit: RetentionUnit,
}

impl<'de> Deserialize<'de> for RetentionPeriod {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum StoredPeriod {
            Period {
                value: u32,
                unit: RetentionUnit,
                mode: Option<RetentionMode>,
            },
            LegacyDays(u32),
        }
        Ok(match StoredPeriod::deserialize(deserializer)? {
            StoredPeriod::Period { value, unit, mode } => Self {
                mode: mode.unwrap_or(if value == 0 {
                    RetentionMode::Indefinite
                } else {
                    RetentionMode::Period
                }),
                value: if mode.is_none() && value == 0 {
                    7
                } else {
                    value
                },
                unit,
            },
            StoredPeriod::LegacyDays(value) => Self::days(value),
        })
    }
}

impl RetentionPeriod {
    fn days(value: u32) -> Self {
        Self {
            mode: if value == 0 {
                RetentionMode::Indefinite
            } else {
                RetentionMode::Period
            },
            value: if value == 0 { 7 } else { value },
            unit: RetentionUnit::Days,
        }
    }

    fn cutoff(&self, now: OffsetDateTime) -> Result<Option<OffsetDateTime>, String> {
        match self.mode {
            RetentionMode::Disabled => return Ok(Some(now)),
            RetentionMode::Indefinite => return Ok(None),
            RetentionMode::Period => {}
        }
        let cutoff = match self.unit {
            RetentionUnit::Minutes => now.checked_sub(TimeDuration::minutes(self.value.into())),
            RetentionUnit::Hours => now.checked_sub(TimeDuration::hours(self.value.into())),
            RetentionUnit::Days => now.checked_sub(TimeDuration::days(self.value.into())),
            RetentionUnit::Months => {
                let months = i32::try_from(self.value).map_err(|_| "invalid retention period")?;
                let index = now.year() * 12 + i32::from(u8::from(now.month())) - 1 - months;
                let year = index.div_euclid(12);
                let month = Month::try_from((index.rem_euclid(12) + 1) as u8)
                    .map_err(|_| "invalid retention period")?;
                let day = now.day().min(time::util::days_in_month(month, year));
                let date = Date::from_calendar_date(year, month, day)
                    .map_err(|_| "invalid retention period")?;
                Some(now.replace_date(date))
            }
        };
        cutoff
            .map(Some)
            .ok_or_else(|| "invalid retention period".to_owned())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DataRetentionSettings {
    #[serde(alias = "reviewHistoryDays")]
    pub review_history: RetentionPeriod,
    #[serde(alias = "syncHistoryDays")]
    pub sync_history: RetentionPeriod,
    #[serde(alias = "removedTaskDays")]
    pub removed_tasks: RetentionPeriod,
    pub diagnostic_logs: RetentionPeriod,
    #[serde(rename = "diagnosticLogMaxMiB")]
    pub diagnostic_log_max_mib: Option<u32>,
}

impl Default for DataRetentionSettings {
    fn default() -> Self {
        Self {
            review_history: RetentionPeriod::days(7),
            sync_history: RetentionPeriod::days(7),
            removed_tasks: RetentionPeriod::days(7),
            diagnostic_logs: RetentionPeriod::days(7),
            diagnostic_log_max_mib: Some(100),
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
        &settings.review_history,
        &settings.sync_history,
        &settings.removed_tasks,
        &settings.diagnostic_logs,
    ]
    .into_iter()
    .any(|period| {
        period.mode == RetentionMode::Period
            && (period.value == 0 || period.value > period.unit.maximum())
    }) {
        return Err("retention period exceeds the supported limit".to_owned());
    }
    if settings
        .diagnostic_log_max_mib
        .is_some_and(|value| value == 0 || value > 1_048_576)
    {
        return Err("invalid diagnostic log size limit".to_owned());
    }
    Ok(())
}

pub async fn sync_history_enabled(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    Ok(settings(pool)
        .await
        .map_err(sqlx::Error::Protocol)?
        .sync_history
        .mode
        != RetentionMode::Disabled)
}

pub async fn prune_review_history(pool: &SqlitePool) -> Result<(), String> {
    let period = settings(pool).await?.review_history;
    let cutoff = if period.mode == RetentionMode::Disabled {
        Some(i64::MAX)
    } else {
        period
            .cutoff(OffsetDateTime::now_utc())?
            .map(|cutoff| (cutoff.unix_timestamp_nanos() / 1_000_000) as i64)
    };
    crate::application::developer_review::prune_old_reviews(pool, cutoff).await
}

pub async fn save_settings(
    pool: &SqlitePool,
    settings: DataRetentionSettings,
) -> Result<DataRetentionSettings, String> {
    validate(&settings)?;
    let json = serde_json::to_string(&settings)
        .map_err(|_| "failed to serialize data retention settings".to_owned())?;
    repositories::upsert_setting(pool, SETTINGS_KEY, &json, 2)
        .await
        .map_err(|_| "failed to save data retention settings".to_owned())?;
    clean_up(pool).await?;
    Ok(settings)
}

pub async fn configure_logs(settings: &DataRetentionSettings) {
    let period = &settings.diagnostic_logs;
    let cutoff = match period.cutoff(OffsetDateTime::now_utc()) {
        Ok(cutoff) => cutoff,
        Err(_) => {
            eprintln!("Invalid diagnostic log retention period");
            return;
        }
    };
    let enabled = period.mode != RetentionMode::Disabled;
    let max_bytes = settings
        .diagnostic_log_max_mib
        .map(|value| u64::from(value) * 1024 * 1024);
    let result = tokio::task::spawn_blocking(move || {
        crate::application::logging::configure(enabled, max_bytes, cutoff)
    })
    .await;
    if !matches!(result, Ok(Ok(()))) {
        eprintln!("Diagnostic log cleanup failed");
    }
}

pub async fn clean_up(pool: &SqlitePool) -> Result<(), String> {
    let settings = settings(pool).await?;
    configure_logs(&settings).await;
    let now = OffsetDateTime::now_utc();
    prune_review_history(pool).await?;
    let mut transaction = pool.begin().await.map_err(db_error)?;
    if let Some(cutoff) = settings.sync_history.cutoff(now)? {
        sqlx::query("DELETE FROM sync_runs WHERE finished_at IS NOT NULL AND status IN ('succeeded', 'failed') AND (? OR datetime(finished_at) < datetime(?, 'unixepoch'))")
            .bind(settings.sync_history.mode == RetentionMode::Disabled)
            .bind(cutoff.unix_timestamp())
            .execute(&mut *transaction).await.map_err(db_error)?;
    }
    if let Some(cutoff) = settings.removed_tasks.cutoff(now)? {
        sqlx::query("DELETE FROM task_monitor_issues WHERE present = 0 AND (? OR datetime(observed_at) < datetime(?, 'unixepoch'))")
            .bind(settings.removed_tasks.mode == RetentionMode::Disabled)
            .bind(cutoff.unix_timestamp())
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
        let defaults = super::settings(&pool).await.unwrap();
        assert_eq!(defaults.review_history, RetentionPeriod::days(7));
        assert_eq!(defaults.sync_history, RetentionPeriod::days(7));
        assert_eq!(defaults.removed_tasks, RetentionPeriod::days(7));
        assert_eq!(defaults.diagnostic_logs, RetentionPeriod::days(7));
        repositories::upsert_setting(
            &pool,
            SETTINGS_KEY,
            r#"{"reviewHistoryDays":17,"syncHistoryDays":12,"removedTaskDays":0}"#,
            1,
        )
        .await
        .unwrap();
        assert_eq!(
            super::settings(&pool).await.unwrap(),
            DataRetentionSettings {
                review_history: RetentionPeriod::days(17),
                sync_history: RetentionPeriod::days(12),
                removed_tasks: RetentionPeriod::days(0),
                diagnostic_logs: RetentionPeriod::days(7),
                diagnostic_log_max_mib: Some(100),
            }
        );
        let settings = DataRetentionSettings {
            review_history: RetentionPeriod {
                mode: RetentionMode::Period,
                value: 1,
                unit: RetentionUnit::Months,
            },
            sync_history: RetentionPeriod {
                mode: RetentionMode::Period,
                value: 1,
                unit: RetentionUnit::Hours,
            },
            diagnostic_logs: RetentionPeriod {
                mode: RetentionMode::Indefinite,
                value: 87_600,
                unit: RetentionUnit::Days,
            },
            diagnostic_log_max_mib: None,
            removed_tasks: RetentionPeriod {
                mode: RetentionMode::Period,
                value: 1,
                unit: RetentionUnit::Minutes,
            },
        };
        save_settings(&pool, settings.clone()).await.unwrap();
        assert_eq!(super::settings(&pool).await.unwrap(), settings);
        sqlx::query("INSERT INTO integrations (id, kind, base_url, account_key, credential_ref, created_at, updated_at) VALUES ('example-integration', 'jira', 'https://example.invalid', 'example', '', '2000-01-01', '2000-01-01')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO task_monitors (id, integration_id, name, jql, schedule_kind, schedule_value, tracked_events_json, created_at, updated_at) VALUES ('example-monitor', 'example-integration', 'Example monitor', '', 'period', '5', '[]', '2000-01-01', '2000-01-01')").execute(&pool).await.unwrap();
        for (key, present) in [("EXAMPLE-1", 0), ("EXAMPLE-2", 1)] {
            sqlx::query("INSERT INTO task_monitor_issues (monitor_id, issue_id, issue_key, summary, status, priority, issue_url, present, observed_at) VALUES ('example-monitor', ?, ?, 'Example task', 'Open', '', 'https://example.invalid', ?, '2000-01-01')").bind(key).bind(key).bind(present).execute(&pool).await.unwrap();
        }
        sqlx::query("UPDATE task_monitor_issues SET observed_at = datetime('now', '-2 minutes')")
            .execute(&pool)
            .await
            .unwrap();
        for (id, status, finished) in [
            ("expired", "succeeded", Some("2000-01-01")),
            ("active", "running", None),
        ] {
            sqlx::query("INSERT INTO sync_runs (id, integration_id, job_kind, status, started_at, finished_at) VALUES (?, 'example-integration', 'example', ?, '2000-01-01', ?)").bind(id).bind(status).bind(finished).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO pull_request_comment_actions (idempotency_key, request_json, status) VALUES ('example-action', '{}', 'completed')").execute(&pool).await.unwrap();
        sqlx::query(
            "UPDATE sync_runs SET finished_at = datetime('now', '-2 hours') WHERE id = 'expired'",
        )
        .execute(&pool)
        .await
        .unwrap();
        for tokens in [30_i64, 70] {
            sqlx::query("INSERT INTO ai_token_usage (recorded_at, provider, model, input_tokens, output_tokens, total_tokens) VALUES ('2000-01-01T12:00:00Z', 'example', 'example-model', ?, 0, ?)").bind(tokens).bind(tokens).execute(&pool).await.unwrap();
        }
        let mut reviews = serde_json::Map::new();
        let review_finished_at = (OffsetDateTime::now_utc()
            .checked_sub(TimeDuration::days(62))
            .unwrap()
            .unix_timestamp_nanos()
            / 1_000_000) as i64;
        for (id, status) in [("1", "completed"), ("2", "completed"), ("3", "running")] {
            reviews.insert(format!("example-integration:EXAMPLE:example-repo:{id}"), serde_json::json!({"runId": id, "status": status, "reviewedCommit": null, "result": null, "error": null, "startedAt": 1, "finishedAt": review_finished_at}));
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
        let mut disabled = DataRetentionSettings::default();
        disabled.review_history.mode = RetentionMode::Disabled;
        // A hidden period may exceed the new unit's limit after switching modes.
        disabled.review_history.value = 3650;
        disabled.review_history.unit = RetentionUnit::Months;
        disabled.sync_history.mode = RetentionMode::Disabled;
        disabled.sync_history.value = 87_600;
        disabled.sync_history.unit = RetentionUnit::Days;
        disabled.removed_tasks.mode = RetentionMode::Disabled;
        disabled.diagnostic_logs.mode = RetentionMode::Disabled;
        sqlx::query("INSERT INTO sync_runs (id, integration_id, job_kind, status, started_at, finished_at) VALUES ('recent', 'example-integration', 'example', 'succeeded', datetime('now'), datetime('now'))")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO task_monitor_issues (monitor_id, issue_id, issue_key, summary, status, priority, issue_url, present, observed_at) VALUES ('example-monitor', 'EXAMPLE-3', 'EXAMPLE-3', 'Example task', 'Open', '', 'https://example.invalid', 0, datetime('now'))")
            .execute(&pool).await.unwrap();
        save_settings(&pool, disabled).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sync_runs WHERE status = 'succeeded'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sync_runs WHERE status = 'running'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM task_monitor_issues WHERE present = 0"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM task_monitor_issues WHERE present = 1"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        crate::application::polling::checkpoint::record_successful_page(
            &pool,
            "example-integration",
            None,
            "example-checkpoint",
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sync_runs WHERE status = 'succeeded'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            crate::application::polling::checkpoint::current_checkpoint(
                &pool,
                "example-integration"
            )
            .await
            .unwrap()
            .as_deref(),
            Some("example-checkpoint")
        );
    }
}
