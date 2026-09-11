use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::queries::{get_inbox_item, InboxItem};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct InboxStatePatch {
    pub read: Option<bool>,
    pub done: Option<bool>,
    pub saved: Option<bool>,
    pub archived: Option<bool>,
    pub following: Option<bool>,
    pub snooze_until: Option<String>,
}

pub async fn update_inbox_state(
    pool: &SqlitePool,
    id: &str,
    patch: InboxStatePatch,
) -> Result<InboxItem, sqlx::Error> {
    sqlx::query(
        "UPDATE inbox_items
         SET read = COALESCE(?, read),
             done = COALESCE(?, done),
             saved = COALESCE(?, saved),
             archived = COALESCE(?, archived),
             following = COALESCE(?, following),
             snooze_until = COALESCE(?, snooze_until),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(patch.read.map(i64::from))
    .bind(patch.done.map(i64::from))
    .bind(patch.saved.map(i64::from))
    .bind(patch.archived.map(i64::from))
    .bind(patch.following.map(i64::from))
    .bind(patch.snooze_until)
    .bind(id)
    .execute(pool)
    .await?;

    get_inbox_item(pool, id).await
}
