use tempfile::TempDir;

use crate::infrastructure::db::open_database;

use super::checkpoint::{current_checkpoint, record_successful_page};

async fn test_database() -> (TempDir, sqlx::SqlitePool) {
    let temp_dir = TempDir::new().unwrap();
    let pool = open_database(&temp_dir.path().join("mework.sqlite"))
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO integrations
            (id, kind, base_url, account_key, credential_ref, enabled, capabilities_json,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("integration-id")
    .bind("jira")
    .bind("https://jira.example")
    .bind("account")
    .bind("keyring://sample-repository/jira/account")
    .bind(1_i64)
    .bind("{}")
    .bind("2026-09-04T00:00:00Z")
    .bind("2026-09-04T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    (temp_dir, pool)
}

#[tokio::test]
async fn successful_page_advances_checkpoint() {
    let (_temp_dir, pool) = test_database().await;

    record_successful_page(&pool, "integration-id", None, "checkpoint-1")
        .await
        .unwrap();

    assert_eq!(
        current_checkpoint(&pool, "integration-id").await.unwrap(),
        Some("checkpoint-1".to_owned())
    );
}
