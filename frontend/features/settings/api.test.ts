import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { getAiSettings, refreshAiSettings, saveAiSettings, saveIntegration } from "./api";

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
    const settings = { provider: "codex-cli" as const, model: "sample-model", reasoning: "medium" as const, fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } };
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
    const oldSettings = { settings: { provider: null, model: "", reasoning: "medium", fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } }, providers: [] };
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

  it("reuses session settings across reads and updates them after saving", async () => {
    vi.useFakeTimers();
    const initial = { settings: { provider: null, model: "", reasoning: "medium" as const, fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } }, providers: [] };
    const saved = { ...initial, settings: { ...initial.settings, model: "example-model" } };
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved);
    try {
      await refreshAiSettings();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await getAiSettings()).toEqual(initial);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      await saveAiSettings(saved.settings);
      expect(await getAiSettings()).toEqual(saved);
      expect(invokeMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("keeps a saved AI setting after an older read finishes", async () => {
    const oldSettings = { settings: { provider: null, model: "", reasoning: "medium" as const, fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } }, providers: [] };
    const savedSettings = { settings: { ...oldSettings.settings, model: "example-model" }, providers: [] };
    let resolveOld!: (value: typeof oldSettings) => void;
    invokeMock.mockReset();
    invokeMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(savedSettings);

    const oldRequest = refreshAiSettings();
    expect(await saveAiSettings(savedSettings.settings)).toEqual(savedSettings);
    resolveOld(oldSettings);
    expect(await oldRequest).toEqual(oldSettings);
    expect(await getAiSettings()).toEqual(savedSettings);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
