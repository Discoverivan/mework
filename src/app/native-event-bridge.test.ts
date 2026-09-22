import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyPullRequestPage } from "@/shared/contracts/developer";
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

  it("forwards a native PR update through the typed app event bus", async () => {
    const page: MyPullRequestPage = { values: [], total: 0, hasMore: false };
    const listener = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, listener);
    const stop = await startNativeEventBridge();

    nativeListeners.get("pull_request_review_updated")?.({ payload: page });

    expect(listener).toHaveBeenCalledWith(page);
    stop();
    unsubscribe();
  });
});
