import { invoke } from "@tauri-apps/api/core";
import type { MyPullRequestPage } from "@/shared/contracts/developer";
import type { DevOverlaySnapshot } from "@/shared/contracts/dev-overlay";

export type { DevOverlaySnapshot } from "@/shared/contracts/dev-overlay";

export const devOverlayEnabled = () => invoke<boolean>("dev_overlay_enabled");
export const getDevOverlayState = () => invoke<DevOverlaySnapshot>("dev_overlay_state");
export const addDevMockTask = (summary: string) =>
  invoke<DevOverlaySnapshot>("dev_overlay_add_task", { summary });
export const setDevMockTaskStatus = (issueKey: string, status: "To Do" | "In Progress" | "Done") =>
  invoke<DevOverlaySnapshot>("dev_overlay_set_task_status", { issueKey, status });
export const addDevMockPullRequest = (authored: boolean) =>
  invoke<MyPullRequestPage>("dev_overlay_add_pull_request", { authored });
export const resetDevMockScenario = () =>
  invoke<DevOverlaySnapshot>("dev_overlay_reset_scenario");
