import type { AiSettingsPageData, IntegrationRedacted } from "@/shared/contracts/settings";
import type { MyPullRequestPage, PullRequestReviewChangedEvent } from "@/shared/contracts/developer";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";
import type { TaskTrackerReadStateChanged } from "@/features/product/task-tracker-read-state";

export const APP_EVENT = {
  integrationsChanged: "integrations:changed",
  integrationsHealthRefreshed: "integrations:health-refreshed",
  aiSettingsChanged: "ai-settings:changed",
  pullRequestActivityChanged: "pull-requests:activity-changed",
  pullRequestReviewChanged: "pull-requests:review-changed",
  reviewerPullRequestsUpdated: "pull-requests:reviewer-updated",
  authoredPullRequestsUpdated: "pull-requests:authored-updated",
  taskTrackerUpdated: "task-tracker:updated",
  taskTrackerReadStateChanged: "task-tracker:read-state-changed",
  updateAvailabilityChanged: "updates:availability-changed",
} as const;

interface AppEventMap {
  [APP_EVENT.integrationsChanged]: undefined;
  [APP_EVENT.integrationsHealthRefreshed]: IntegrationRedacted[];
  [APP_EVENT.aiSettingsChanged]: AiSettingsPageData;
  [APP_EVENT.pullRequestActivityChanged]: undefined;
  [APP_EVENT.pullRequestReviewChanged]: PullRequestReviewChangedEvent;
  [APP_EVENT.reviewerPullRequestsUpdated]: MyPullRequestPage;
  [APP_EVENT.authoredPullRequestsUpdated]: MyPullRequestPage;
  [APP_EVENT.taskTrackerUpdated]: TaskTrackerMonitor[];
  [APP_EVENT.taskTrackerReadStateChanged]: TaskTrackerReadStateChanged;
  [APP_EVENT.updateAvailabilityChanged]: string | null;
}

type AppEventName = keyof AppEventMap;
type EmitArgs<Name extends AppEventName> = AppEventMap[Name] extends undefined
  ? []
  : [detail: AppEventMap[Name]];

const eventTarget = new EventTarget();
const lastEmittedAt = new Map<AppEventName, number>();

export function emitAppEvent<Name extends AppEventName>(
  name: Name,
  ...args: EmitArgs<Name>
): void {
  lastEmittedAt.set(name, Date.now());
  eventTarget.dispatchEvent(new CustomEvent(name, { detail: args[0] }));
}

export function getAppEventTimestamp(name: AppEventName): number {
  return lastEmittedAt.get(name) ?? 0;
}

export function subscribeAppEvent<Name extends AppEventName>(
  name: Name,
  listener: (detail: AppEventMap[Name]) => void,
): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AppEventMap[Name]>).detail);
  eventTarget.addEventListener(name, handler);
  return () => eventTarget.removeEventListener(name, handler);
}
