use crate::infrastructure::db::open_database;
use tempfile::TempDir;

use super::queries::{list_inbox, InboxFilter, InboxQuery};
use super::service::{update_inbox_state, InboxStatePatch};

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
    sqlx::query(
        "INSERT INTO subscriptions
            (id, integration_id, name, source, filter_json, interval_seconds,
             importance, notification_policy_json, paused, muted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("subscription-id")
    .bind("integration-id")
    .bind("DEMO ready")
    .bind("jira")
    .bind("{}")
    .bind(60_i64)
    .bind("medium")
    .bind("{}")
    .bind(0_i64)
    .bind(0_i64)
    .bind("2026-09-04T00:00:00Z")
    .bind("2026-09-04T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO events
            (id, integration_id, object_type, external_id, event_kind, source_version,
             diff_json, occurred_at, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("event-id")
    .bind("integration-id")
    .bind("jira_issue")
    .bind("DEMO-1")
    .bind("status_changed")
    .bind("version-1")
    .bind("{}")
    .bind("2026-09-04T00:00:00Z")
    .bind("2026-09-04T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();

    for (id, event_id, title, read, done, action_kind) in [
        ("inbox-1", "event-1", "First issue", 0_i64, 0_i64, "review"),
        ("inbox-2", "event-2", "Second issue", 0_i64, 0_i64, "none"),
        ("inbox-3", "event-3", "Done issue", 1_i64, 1_i64, "review"),
    ] {
        sqlx::query(
            "INSERT INTO events
                (id, integration_id, object_type, external_id, event_kind, source_version,
                 diff_json, occurred_at, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(event_id)
        .bind("integration-id")
        .bind("jira_issue")
        .bind("DEMO-1")
        .bind("status_changed")
        .bind(event_id)
        .bind("{}")
        .bind("2026-09-04T00:00:00Z")
        .bind("2026-09-04T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO inbox_items
                (id, event_id, subscription_id, title, reason, severity, action_kind,
                 read, done, saved, archived, source, project, object_type, external_id,
                 source_url, following, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(event_id)
        .bind("subscription-id")
        .bind(title)
        .bind("matched subscription")
        .bind("medium")
        .bind(action_kind)
        .bind(read)
        .bind(done)
        .bind(0_i64)
        .bind(0_i64)
        .bind("jira")
        .bind("DEMO")
        .bind("jira_issue")
        .bind("DEMO-1")
        .bind("https://jira.example/browse/DEMO-1")
        .bind(0_i64)
        .bind("2026-09-04T00:00:00Z")
        .bind("2026-09-04T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();
    }

    (temp_dir, pool)
}

#[tokio::test]
async fn lists_filters_search_and_pages_inbox_items() {
    let (_temp_dir, pool) = test_database().await;

    let all = list_inbox(
        &pool,
        InboxQuery {
            filter: InboxFilter::All,
            search: None,
            limit: 2,
            offset: 0,
        },
    )
    .await
    .unwrap();
    assert_eq!(all.len(), 2);

    let unread = list_inbox(
        &pool,
        InboxQuery {
            filter: InboxFilter::Unread,
            search: None,
            limit: 50,
            offset: 0,
        },
    )
    .await
    .unwrap();
    assert_eq!(unread.len(), 2);

    let needs_action = list_inbox(
        &pool,
        InboxQuery {
            filter: InboxFilter::NeedsMyAction,
            search: None,
            limit: 50,
            offset: 0,
        },
    )
    .await
    .unwrap();
    assert_eq!(needs_action.len(), 1);
    assert_eq!(needs_action[0].id, "inbox-1");

    let search = list_inbox(
        &pool,
        InboxQuery {
            filter: InboxFilter::All,
            search: Some("second".into()),
            limit: 50,
            offset: 0,
        },
    )
    .await
    .unwrap();
    assert_eq!(search.len(), 1);
    assert_eq!(search[0].title, "Second issue");
}

#[tokio::test]
async fn updates_persisted_inbox_state() {
    let (_temp_dir, pool) = test_database().await;

    let updated = update_inbox_state(
        &pool,
        "inbox-1",
        InboxStatePatch {
            read: Some(true),
            done: Some(true),
            saved: Some(true),
            archived: None,
            following: Some(true),
            snooze_until: Some("2026-09-05T00:00:00Z".into()),
        },
    )
    .await
    .unwrap();

    assert!(updated.read);
    assert!(updated.done);
    assert!(updated.saved);
    assert!(updated.following);
    assert_eq!(
        updated.snooze_until.as_deref(),
        Some("2026-09-05T00:00:00Z")
    );
}
