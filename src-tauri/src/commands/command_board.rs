use sqlx::SqlitePool;
use tauri::State;

use crate::application::command_board::{
    self, CommandBoardItemDto, CommandBoardRunStatus, CommandBoardSaveRequest,
};

#[tauri::command]
pub async fn command_board_list(
    state: State<'_, SqlitePool>,
) -> Result<Vec<CommandBoardItemDto>, String> {
    command_board::list(&state).await
}

#[tauri::command]
pub async fn command_board_save(
    state: State<'_, SqlitePool>,
    request: CommandBoardSaveRequest,
) -> Result<CommandBoardItemDto, String> {
    command_board::save(&state, request).await
}

#[tauri::command]
pub async fn command_board_delete(
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<bool, String> {
    command_board::remove(&state, &id).await
}

#[tauri::command]
pub async fn command_board_run(
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<CommandBoardRunStatus, String> {
    command_board::run(&state, &id).await
}
