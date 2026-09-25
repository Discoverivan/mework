import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAiUsageStatistics } from "./api";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("getAiUsageStatistics", () => {
  beforeEach(() => invokeMock.mockReset());

  it("requests the selected period from the native command", async () => {
    const response = {
      period: "seven_days",
      daily: [],
      byModel: [],
      total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    invokeMock.mockResolvedValue(response);

    await expect(getAiUsageStatistics("seven_days")).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith("ai_usage_statistics", { period: "seven_days" });
  });
});
