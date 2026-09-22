import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { shouldRefreshPullRequestCache } from "./pull-request-cache";

describe("pull request cache invalidation", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps an integration change until a newer PR snapshot is loaded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T00:00:00.000Z"));
    emitAppEvent(APP_EVENT.integrationsChanged);

    expect(shouldRefreshPullRequestCache(Date.parse("2026-09-22T23:59:59.000Z"))).toBe(true);
    expect(shouldRefreshPullRequestCache(Date.parse("2026-09-23T00:00:01.000Z"))).toBe(false);
  });
});
