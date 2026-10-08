import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyPullRequestPage } from "@/shared/contracts/developer";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";
import type { TokenBurnerSnapshot } from "@/shared/contracts/token-burner";
import { APP_EVENT, subscribeAppEvent } from "./app-events";
import { startNativeEventBridge } from "./native-event-bridge";

const { listenMock, nativeListeners } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  nativeListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

describe("native event bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeListeners.clear();
    listenMock.mockImplementation(async (name, listener) => {
      nativeListeners.set(name, listener);
      return vi.fn();
    });
  });

  it("forwards native updates through the typed app event bus", async () => {
    const page: MyPullRequestPage = { values: [], total: 0, hasMore: false };
    const listener = vi.fn();
    const taskTrackerListener = vi.fn();
    const burnerListener = vi.fn();
    const membersListener = vi.fn();
    const unsubscribeMembers = subscribeAppEvent(APP_EVENT.teamMembersChanged, membersListener);
    const unsubscribe = subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, listener);
    const unsubscribeTaskTracker = subscribeAppEvent(APP_EVENT.taskTrackerUpdated, taskTrackerListener);
    const unsubscribeBurner = subscribeAppEvent(APP_EVENT.tokenBurnerChanged, burnerListener);
    const stop = await startNativeEventBridge();

    nativeListeners.get("pull_request_review_updated")?.({ payload: page });
    const monitors: TaskTrackerMonitor[] = [];
    nativeListeners.get("task_tracker_updated")?.({ payload: monitors });
    const burner: TokenBurnerSnapshot = {
      settings: { dailyTarget: 2_000_000, delayBetweenRequestsSeconds: 10, repository: null },
      status: "idle", tokensUsedToday: 0, activeForMs: 0, previousSessionInterrupted: false, activeIterations: [], completedIterations: [],
    };
    nativeListeners.get("token_burner_changed")?.({ payload: burner });
    const members = { managedProjectId: "example-team", members: [] };
    nativeListeners.get("team_members_changed")?.({ payload: members });

    expect(listener).toHaveBeenCalledWith(page);
    expect(taskTrackerListener).toHaveBeenCalledWith(monitors);
    expect(burnerListener).toHaveBeenCalledWith(burner);
    expect(membersListener).toHaveBeenCalledWith(members);
    stop();
    unsubscribe();
    unsubscribeTaskTracker();
    unsubscribeBurner();
    unsubscribeMembers();
  });
});
