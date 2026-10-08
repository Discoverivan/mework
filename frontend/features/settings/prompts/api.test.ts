import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import type { PromptSettings } from "@/shared/contracts/settings";
import { getCachedPromptSettings, getPromptSettings } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("loads the saved instructions when a save arrives during startup preload", async () => {
  const initial: PromptSettings = {
    action: "pullRequestReview", instructions: "Review concrete defects.",
    instructionsHash: "example-instructions-hash", defaultInstructions: "Review concrete defects.", protectedRules: "Return JSON.", customized: false, includeFixExamples: false,
  };
  const saved = { ...initial, instructions: "Focus on API compatibility.", customized: true };
  let resolveInitial!: (values: PromptSettings[]) => void;
  vi.mocked(invoke)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }))
    .mockResolvedValueOnce([saved]);

  const preload = getPromptSettings();
  emitAppEvent(APP_EVENT.aiPromptSettingsChanged, saved);
  resolveInitial([initial]);

  expect(await preload).toEqual([saved]);
  expect(getCachedPromptSettings()).toEqual([saved]);
  expect(await getPromptSettings()).toEqual([saved]);
  expect(invoke).toHaveBeenCalledTimes(2);
});
