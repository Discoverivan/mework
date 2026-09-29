import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { getAiSettings, refreshAiSettings, saveIntegration } from "./api";

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
    invokeMock.mockResolvedValueOnce(missing).mockResolvedValueOnce(connected);
    const recovered = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.aiSettingsChanged, recovered);

    try {
      expect(await getAiSettings()).toEqual(missing);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(recovered).toHaveBeenCalledWith(connected);
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it("refreshes AI settings while an older request is still running", async () => {
    const oldSettings = { settings: { provider: null, model: "", reasoning: "medium", fastMode: false }, providers: [] };
    const newSettings = { ...oldSettings, providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["example-model"] }] };
    let resolveOld!: (value: typeof oldSettings) => void;
    let resolveNew!: (value: typeof newSettings) => void;
    invokeMock.mockReset();
    invokeMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    const oldRequest = refreshAiSettings();
    const newRequest = refreshAiSettings();
    expect(invokeMock).toHaveBeenCalledTimes(2);

    resolveNew(newSettings);
    expect(await newRequest).toEqual(newSettings);
    resolveOld(oldSettings);
    expect(await oldRequest).toEqual(oldSettings);
    expect(await getAiSettings()).toEqual(newSettings);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
