use sqlx::{Row, SqlitePool};
use tempfile::TempDir;

use super::{open_database, reset_mock_database_file, DATABASE_FILENAME, MOCK_DATABASE_FILENAME};

#[test]
fn resetting_mock_database_removes_only_its_file_and_sidecars() {
    let temp_dir = tempfile::tempdir().expect("temporary app-data directory");
    let normal_database = temp_dir.path().join(DATABASE_FILENAME);
    let mock_database = temp_dir.path().join(MOCK_DATABASE_FILENAME);
    std::fs::write(&normal_database, "normal-db").expect("normal database fixture");
    std::fs::write(&mock_database, "mock-db").expect("mock database fixture");
    std::fs::write(format!("{}-wal", mock_database.display()), "wal").expect("mock wal fixture");
    std::fs::write(format!("{}-shm", mock_database.display()), "shm").expect("mock shm fixture");

    let reset_path = reset_mock_database_file(temp_dir.path()).expect("reset mock database");

    assert_eq!(reset_path, mock_database);
    assert!(
        normal_database.exists(),
        "normal dev database must be preserved"
    );
    assert!(!mock_database.exists());
    assert!(!std::path::PathBuf::from(format!("{}-wal", mock_database.display())).exists());
    assert!(!std::path::PathBuf::from(format!("{}-shm", mock_database.display())).exists());
}

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

    let monitor_columns = sqlx::query("PRAGMA table_info(task_monitors)")
        .fetch_all(&pool)
        .await
        .expect("Task tracker monitor columns should exist");
    let tracked_limit = monitor_columns
        .iter()
        .find(|row| row.get::<String, _>("name") == "max_tracked_issues");
    assert_eq!(
        tracked_limit.map(|row| row.get::<String, _>("dflt_value")),
        Some("100".to_owned())
    );
    assert!(monitor_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "exceeds_limit"));

    let usage_columns = sqlx::query("PRAGMA table_info(ai_token_usage)")
        .fetch_all(&pool)
        .await
        .expect("AI token usage columns should exist");
    assert_eq!(usage_columns.len(), 6);
    assert!(usage_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "total_tokens"));
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
