import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { setAppBadgeCount } from "./app-badge";

describe("setAppBadgeCount", () => {
  beforeEach(() => invokeMock.mockClear());

  it("invokes the native command with the sidebar total", async () => {
    await setAppBadgeCount(12);

    expect(invokeMock).toHaveBeenCalledWith("set_app_badge_count", { count: 12 });
  });
});
