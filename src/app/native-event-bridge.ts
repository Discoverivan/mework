import { listen } from "@tauri-apps/api/event";

import type { MyPullRequestPage, PullRequestReviewChangedEvent } from "@/shared/contracts/developer";
import type { IntegrationRedacted } from "@/shared/contracts/settings";
import type { PromptSettings } from "@/shared/contracts/settings";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";
import type { TokenBurnerSnapshot } from "@/shared/contracts/token-burner";
import type { UpdateAvailabilitySnapshot } from "@/shared/contracts/updates";
import type { TeamMembersChangedEvent } from "@/shared/contracts/planning";
import { APP_EVENT, emitAppEvent } from "./app-events";

type Cleanup = () => void;

interface NativeEventMap {
  team_members_changed: TeamMembersChangedEvent;
  ai_prompt_settings_changed: PromptSettings;
  integrations_health_refreshed: IntegrationRedacted[];
  pull_request_review_updated: MyPullRequestPage;
  my_pull_requests_updated: MyPullRequestPage;
  pull_request_review_changed: PullRequestReviewChangedEvent;
  task_tracker_updated: TaskTrackerMonitor[];
  update_availability_changed: UpdateAvailabilitySnapshot;
  token_burner_changed: TokenBurnerSnapshot;
}

async function listenSafely<Name extends keyof NativeEventMap>(
  nativeEvent: Name,
  forward: (payload: NativeEventMap[Name]) => void,
): Promise<Cleanup | undefined> {
  try {
    return await listen<NativeEventMap[Name]>(nativeEvent, (event) => forward(event.payload));
  } catch (error) {
    if ("__TAURI_INTERNALS__" in window) {
      console.error(`Failed to register native event listener: ${nativeEvent}`, error);
    }
    return undefined;
  }
}

export async function startNativeEventBridge(): Promise<Cleanup> {
  const cleanups = await Promise.all([
    listenSafely("team_members_changed", (payload) =>
      emitAppEvent(APP_EVENT.teamMembersChanged, payload)),
    listenSafely("ai_prompt_settings_changed", (payload) =>
      emitAppEvent(APP_EVENT.aiPromptSettingsChanged, payload)),
    listenSafely("integrations_health_refreshed", (payload) =>
      emitAppEvent(APP_EVENT.integrationsHealthRefreshed, payload)),
    listenSafely("pull_request_review_updated", (payload) =>
      emitAppEvent(APP_EVENT.reviewerPullRequestsUpdated, payload)),
    listenSafely("my_pull_requests_updated", (payload) =>
      emitAppEvent(APP_EVENT.authoredPullRequestsUpdated, payload)),
    listenSafely("pull_request_review_changed", (payload) =>
      emitAppEvent(APP_EVENT.pullRequestReviewChanged, payload)),
    listenSafely("task_tracker_updated", (payload) =>
      emitAppEvent(APP_EVENT.taskTrackerUpdated, payload)),
    listenSafely("update_availability_changed", (payload) =>
      emitAppEvent(APP_EVENT.updateAvailabilityChanged, payload)),
    listenSafely("token_burner_changed", (payload) =>
      emitAppEvent(APP_EVENT.tokenBurnerChanged, payload)),
  ]);

  return () => cleanups.forEach((cleanup) => cleanup?.());
}
