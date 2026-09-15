import { invoke } from "@tauri-apps/api/core";

import type {
  CommandBoardItem,
  CommandBoardRunStatus,
  CommandBoardSaveRequest,
} from "@/shared/contracts/command-board";

export const listCommandBoardItems = () =>
  invoke<CommandBoardItem[]>("command_board_list");

export const saveCommandBoardItem = (request: CommandBoardSaveRequest) =>
  invoke<CommandBoardItem>("command_board_save", { request });

export const deleteCommandBoardItem = (id: string) =>
  invoke<boolean>("command_board_delete", { id });

export const runCommandBoardItem = (id: string) =>
  invoke<CommandBoardRunStatus>("command_board_run", { id });
