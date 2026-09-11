use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxFilter {
    All,
    Unread,
    NeedsMyAction,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InboxQuery {
    pub filter: InboxFilter,
    pub search: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InboxItem {
    pub id: String,
    pub event_id: String,
    pub subscription_id: String,
    pub title: String,
    pub reason: String,
    pub severity: String,
    pub action_kind: String,
    pub source: String,
    pub project: String,
    pub object_type: String,
    pub external_id: String,
    pub source_url: String,
    pub read: bool,
    pub done: bool,
    pub saved: bool,
    pub archived: bool,
    pub following: bool,
    pub snooze_until: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn list_inbox(
    pool: &SqlitePool,
    query: InboxQuery,
) -> Result<Vec<InboxItem>, sqlx::Error> {
    let limit = query.limit.clamp(1, 100);
    let offset = query.offset.max(0);
    let mut statement = String::from(
        "SELECT id, event_id, subscription_id, title, reason, severity, action_kind,
                source, project, object_type, external_id, source_url,
                read, done, saved, archived, following, snooze_until, created_at, updated_at
         FROM inbox_items
         WHERE archived = 0",
    );

    match query.filter {
        InboxFilter::All => {}
        InboxFilter::Unread => statement.push_str(" AND read = 0"),
        InboxFilter::NeedsMyAction => statement.push_str(" AND done = 0 AND action_kind != 'none'"),
    }

    if query
        .search
        .as_deref()
        .is_some_and(|search| !search.trim().is_empty())
    {
        statement.push_str(
            " AND (title LIKE ? OR reason LIKE ? OR object_type LIKE ? OR external_id LIKE ?)",
        );
    }
    statement.push_str(" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?");

    let mut request = sqlx::query(sqlx::AssertSqlSafe(statement));
    if let Some(search) = query.search.filter(|search| !search.trim().is_empty()) {
        let pattern = format!("%{search}%");
        request = request
            .bind(pattern.clone())
            .bind(pattern.clone())
            .bind(pattern.clone())
            .bind(pattern);
    }
    let rows = request.bind(limit).bind(offset).fetch_all(pool).await?;

    rows.into_iter().map(row_to_inbox_item).collect()
}

pub async fn get_inbox_item(pool: &SqlitePool, id: &str) -> Result<InboxItem, sqlx::Error> {
    sqlx::query(
        "SELECT id, event_id, subscription_id, title, reason, severity, action_kind,
                source, project, object_type, external_id, source_url,
                read, done, saved, archived, following, snooze_until, created_at, updated_at
         FROM inbox_items WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .and_then(row_to_inbox_item)
}

fn row_to_inbox_item(row: sqlx::sqlite::SqliteRow) -> Result<InboxItem, sqlx::Error> {
    Ok(InboxItem {
        id: row.try_get("id")?,
        event_id: row.try_get("event_id")?,
        subscription_id: row.try_get("subscription_id")?,
        title: row.try_get("title")?,
        reason: row.try_get("reason")?,
        severity: row.try_get("severity")?,
        action_kind: row.try_get("action_kind")?,
        source: row.try_get("source")?,
        project: row.try_get("project")?,
        object_type: row.try_get("object_type")?,
        external_id: row.try_get("external_id")?,
        source_url: row.try_get("source_url")?,
        read: row.try_get::<i64, _>("read")? != 0,
        done: row.try_get::<i64, _>("done")? != 0,
        saved: row.try_get::<i64, _>("saved")? != 0,
        archived: row.try_get::<i64, _>("archived")? != 0,
        following: row.try_get::<i64, _>("following")? != 0,
        snooze_until: row.try_get("snooze_until")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
