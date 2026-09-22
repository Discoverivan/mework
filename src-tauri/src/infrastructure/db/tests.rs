use sqlx::{Row, SqlitePool};
use tempfile::TempDir;

use super::open_database;

async fn test_database() -> (TempDir, SqlitePool) {
    let temp_dir = tempfile::tempdir().expect("temporary database directory");
    let pool = open_database(&temp_dir.path().join("mework.sqlite"))
        .await
        .expect("database should open and migrate");
    (temp_dir, pool)
}

#[tokio::test]
async fn migration_creates_settings_table() {
    let (_temp_dir, pool) = test_database().await;

    let table =
        sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
            .fetch_optional(&pool)
            .await
            .expect("settings table query should succeed");

    assert_eq!(
        table.map(|row| row.get::<String, _>("name")),
        Some("settings".into())
    );

    let task_tracker_tables = sqlx::query(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('task_monitors', 'task_monitor_issues')
         ORDER BY name",
    )
    .fetch_all(&pool)
    .await
    .expect("Task Tracker tables should exist");
    assert_eq!(task_tracker_tables.len(), 2);
}

#[tokio::test]
async fn migration_allows_a_confluence_integration() {
    let (_temp_dir, pool) = test_database().await;

    sqlx::query(
        "INSERT INTO integrations (
            id, kind, base_url, account_key, credential_ref, enabled,
            capabilities_json, created_at, updated_at
         ) VALUES (?, 'confluence', ?, '', ?, 1, '{}', ?, ?)",
    )
    .bind("confluence-1")
    .bind("https://confluence.example.invalid")
    .bind("keyring://mework/integration/confluence-1")
    .bind("2026-09-22T00:00:00Z")
    .bind("2026-09-22T00:00:00Z")
    .execute(&pool)
    .await
    .expect("Confluence integration should be accepted by the current schema");

    let kind: String = sqlx::query_scalar("SELECT kind FROM integrations WHERE id = ?")
        .bind("confluence-1")
        .fetch_one(&pool)
        .await
        .expect("inserted integration should be readable");
    assert_eq!(kind, "confluence");
}
