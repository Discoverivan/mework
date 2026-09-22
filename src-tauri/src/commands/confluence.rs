use sqlx::SqlitePool;
use tauri::State;

use crate::application::confluence::{
    self, ConfluenceSearchRequest, ConfluenceSearchResponse, ConfluenceSpaceDto,
    ConfluenceSpaceResolveRequest,
};

#[tauri::command]
pub async fn confluence_search(
    state: State<'_, SqlitePool>,
    request: ConfluenceSearchRequest,
) -> Result<ConfluenceSearchResponse, String> {
    let store = super::integrations::credential_store(&state).await?;
    confluence::search(&state, store.as_ref(), request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn confluence_space_resolve(
    state: State<'_, SqlitePool>,
    request: ConfluenceSpaceResolveRequest,
) -> Result<ConfluenceSpaceDto, String> {
    let store = super::integrations::credential_store(&state).await?;
    confluence::resolve_space(&state, store.as_ref(), request)
        .await
        .map_err(|error| error.to_string())
}
