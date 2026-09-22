import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyPullRequestPage } from "@/shared/contracts/developer";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";
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
    const unsubscribe = subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, listener);
    const unsubscribeTaskTracker = subscribeAppEvent(APP_EVENT.taskTrackerUpdated, taskTrackerListener);
    const stop = await startNativeEventBridge();

    nativeListeners.get("pull_request_review_updated")?.({ payload: page });
    const monitors: TaskTrackerMonitor[] = [];
    nativeListeners.get("task_tracker_updated")?.({ payload: monitors });

    expect(listener).toHaveBeenCalledWith(page);
    expect(taskTrackerListener).toHaveBeenCalledWith(monitors);
    stop();
    unsubscribe();
    unsubscribeTaskTracker();
  });
});
