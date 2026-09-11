import { invoke } from "@tauri-apps/api/core";
import type { InboxItem, InboxQuery, InboxStatePatch } from "../../shared/contracts/inbox";

export const listInbox = (query: InboxQuery) =>
  invoke<InboxItem[]>("inbox_list", { query });

export const updateInboxState = (id: string, patch: InboxStatePatch) =>
  invoke<InboxItem>("inbox_update_state", { id, patch });
