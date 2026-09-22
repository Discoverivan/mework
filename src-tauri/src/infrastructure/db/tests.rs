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
