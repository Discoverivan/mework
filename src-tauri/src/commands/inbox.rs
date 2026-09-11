use sqlx::SqlitePool;
use tauri::State;

use crate::application::inbox::{
    queries::{self, InboxItem, InboxQuery},
    service::{self, InboxStatePatch},
};

#[tauri::command]
pub async fn inbox_list(
    state: State<'_, SqlitePool>,
    query: InboxQuery,
) -> Result<Vec<InboxItem>, String> {
    queries::list_inbox(&state, query)
        .await
        .map_err(|_| "failed to list inbox".to_owned())
}

#[tauri::command]
pub async fn inbox_update_state(
    state: State<'_, SqlitePool>,
    id: String,
    patch: InboxStatePatch,
) -> Result<InboxItem, String> {
    service::update_inbox_state(&state, &id, patch)
        .await
        .map_err(|_| "failed to update inbox state".to_owned())
}
