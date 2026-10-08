import { invoke } from "@tauri-apps/api/core";

export function setAppBadgeCount(count: number): Promise<void> {
  return invoke<void>("set_app_badge_count", { count });
}
