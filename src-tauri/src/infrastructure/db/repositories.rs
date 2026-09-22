use sqlx::{Row, SqlitePool};

use crate::domain::models::{Integration, IntegrationHealthStatus, IntegrationKind, Subscription};

pub async fn insert_integration(
    pool: &SqlitePool,
    integration: &Integration,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations
            (id, kind, base_url, account_key, credential_ref, enabled, allow_insecure_tls, account_display_name,
             health_status, health_error, health_details, health_checked_at, capabilities_json,
             last_success_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&integration.id)
    .bind(integration.kind.as_str())
    .bind(&integration.base_url)
    .bind(&integration.account_key)
    .bind(&integration.credential_ref)
    .bind(integration.enabled)
    .bind(integration.allow_insecure_tls)
    .bind(&integration.account_display_name)
    .bind(integration.health_status.as_str())
    .bind(&integration.health_error)
    .bind(&integration.health_details)
    .bind(&integration.health_checked_at)
    .bind(&integration.capabilities_json)
    .bind(&integration.last_success_at)
    .bind(&integration.created_at)
    .bind(&integration.updated_at)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn insert_integration_with_database_timestamps(
    pool: &SqlitePool,
    integration: &Integration,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integrations
            (id, kind, base_url, account_key, credential_ref, enabled, allow_insecure_tls, account_display_name,
             health_status, health_error, health_details, health_checked_at, capabilities_json,
             last_success_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    )
    .bind(&integration.id)
    .bind(integration.kind.as_str())
    .bind(&integration.base_url)
    .bind(&integration.account_key)
    .bind(&integration.credential_ref)
    .bind(integration.enabled)
    .bind(integration.allow_insecure_tls)
    .bind(&integration.account_display_name)
    .bind(integration.health_status.as_str())
    .bind(&integration.health_error)
    .bind(&integration.health_details)
    .bind(&integration.health_checked_at)
    .bind(&integration.capabilities_json)
    .bind(&integration.last_success_at)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn get_integration(pool: &SqlitePool, id: &str) -> Result<Integration, sqlx::Error> {
    sqlx::query(
        "SELECT id, kind, base_url, account_key, credential_ref, enabled, allow_insecure_tls, account_display_name,
                health_status, health_error, health_details, health_checked_at, capabilities_json,
                last_success_at, created_at, updated_at
         FROM integrations WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .and_then(row_to_integration)
}

pub async fn list_integrations(pool: &SqlitePool) -> Result<Vec<Integration>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, kind, base_url, account_key, credential_ref, enabled, allow_insecure_tls, account_display_name,
                health_status, health_error, health_details, health_checked_at, capabilities_json,
                last_success_at, created_at, updated_at
         FROM integrations ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(row_to_integration).collect()
}

pub async fn update_integration(
    pool: &SqlitePool,
    integration: &Integration,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE integrations
         SET kind = ?, base_url = ?, account_key = ?, credential_ref = ?, enabled = ?, allow_insecure_tls = ?, account_display_name = ?,
             health_status = ?, health_error = ?, health_details = ?, health_checked_at = ?, capabilities_json = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(integration.kind.as_str())
    .bind(&integration.base_url)
    .bind(&integration.account_key)
    .bind(&integration.credential_ref)
    .bind(integration.enabled)
    .bind(integration.allow_insecure_tls)
    .bind(&integration.account_display_name)
    .bind(integration.health_status.as_str())
    .bind(&integration.health_error)
    .bind(&integration.health_details)
    .bind(&integration.health_checked_at)
    .bind(&integration.capabilities_json)
    .bind(&integration.id)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn update_integration_health(
    pool: &SqlitePool,
    id: &str,
    status: IntegrationHealthStatus,
    error: Option<&str>,
    details: Option<&str>,
    account_display_name: Option<&str>,
) -> Result<Integration, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE integrations
         SET health_status = ?, health_error = ?, health_details = ?,
             account_display_name = COALESCE(?, account_display_name),
             health_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(status.as_str())
    .bind(error)
    .bind(details)
    .bind(account_display_name)
    .bind(id)
    .execute(pool)
    .await?;
    if result.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    get_integration(pool, id).await
}

pub async fn set_integration_enabled(
    pool: &SqlitePool,
    id: &str,
    enabled: bool,
) -> Result<Integration, sqlx::Error> {
    sqlx::query(
        "UPDATE integrations
         SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(enabled)
    .bind(id)
    .execute(pool)
    .await?;

    get_integration(pool, id).await
}

pub async fn delete_integration(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM integrations WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
}

pub async fn upsert_setting(
    pool: &SqlitePool,
    key: &str,
    value_json: &str,
    schema_version: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value_json, schema_version, created_at, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             schema_version = excluded.schema_version,
             updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value_json)
    .bind(schema_version)
    .execute(pool)
    .await
    .map(|_| ())
}

fn row_to_integration(row: sqlx::sqlite::SqliteRow) -> Result<Integration, sqlx::Error> {
    let kind = match row.try_get::<String, _>("kind")?.as_str() {
        "jira" => IntegrationKind::Jira,
        "bitbucket" => IntegrationKind::Bitbucket,
        "confluence" => IntegrationKind::Confluence,
        other => {
            return Err(sqlx::Error::Protocol(format!(
                "unknown integration kind: {other}"
            )))
        }
    };

    Ok(Integration {
        id: row.try_get("id")?,
        kind,
        base_url: row.try_get("base_url")?,
        account_key: row.try_get("account_key")?,
        credential_ref: row.try_get("credential_ref")?,
        enabled: row.try_get::<i64, _>("enabled")? != 0,
        allow_insecure_tls: row.try_get::<i64, _>("allow_insecure_tls")? != 0,
        account_display_name: row.try_get("account_display_name")?,
        health_status: IntegrationHealthStatus::parse(row.try_get("health_status")?),
        health_error: row.try_get("health_error")?,
        health_details: row.try_get("health_details")?,
        health_checked_at: row.try_get("health_checked_at")?,
        capabilities_json: row.try_get("capabilities_json")?,
        last_success_at: row.try_get("last_success_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub async fn insert_subscription(
    pool: &SqlitePool,
    subscription: &Subscription,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO subscriptions
            (id, integration_id, name, source, filter_json, interval_seconds,
             importance, notification_policy_json, paused, muted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&subscription.id)
    .bind(&subscription.integration_id)
    .bind(&subscription.name)
    .bind(&subscription.source)
    .bind(&subscription.filter_json)
    .bind(subscription.interval_seconds)
    .bind(&subscription.importance)
    .bind(&subscription.notification_policy_json)
    .bind(subscription.paused)
    .bind(subscription.muted)
    .bind(&subscription.created_at)
    .bind(&subscription.updated_at)
    .execute(pool)
    .await
    .map(|_| ())
}
