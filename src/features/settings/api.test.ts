import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { getAiSettings, saveIntegration } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("settings integration API smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({ id: "jira-1", kind: "jira", baseUrl: "https://jira.example.com" });
  });

  it("sends the typed integration save request without expecting a secret response", async () => {
    const result = await saveIntegration({
      kind: "jira",
      baseUrl: "https://jira.example.com",
      secret: "write-only-secret",
      enabled: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("integration_save", {
      request: {
        kind: "jira",
        baseUrl: "https://jira.example.com",
        secret: "write-only-secret",
        enabled: true,
      },
    });
    expect(result).not.toHaveProperty("secret");
  });

  it("rechecks a missing selected CLI and publishes its recovery", async () => {
    vi.useFakeTimers();
    const settings = { provider: "codex-cli" as const, model: "sample-model", reasoning: "medium" as const, fastMode: false };
    const missing = {
      settings,
      providers: [{ id: "codex-cli" as const, name: "Codex CLI", status: "not_found" as const, available: false, models: [] }],
    };
    const connected = {
      settings,
      providers: [{ ...missing.providers[0], status: "connected" as const, available: true, models: ["sample-model"] }],
    };
    invokeMock.mockResolvedValueOnce(missing).mockResolvedValueOnce(missing).mockResolvedValueOnce(connected);
    const recovered = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.aiSettingsChanged, recovered);

    try {
      expect(await getAiSettings()).toEqual(missing);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(recovered).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(invokeMock).toHaveBeenCalledTimes(3);
      expect(recovered).toHaveBeenCalledWith(connected);
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });
});
