import { invoke } from "@tauri-apps/api/core";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import type { PromptAction, PromptSettings } from "@/shared/contracts/settings";

let request: Promise<PromptSettings[]> | null = null;
let cache: PromptSettings[] | null = null;
let revision = 0;

function applySaved(value: PromptSettings): PromptSettings {
  revision += 1;
  request = null;
  if (cache) cache = cache.map((item) => item.action === value.action ? value : item);
  return value;
}

const unsubscribe = subscribeAppEvent(APP_EVENT.aiPromptSettingsChanged, applySaved);
import.meta.hot?.dispose(unsubscribe);

export function getCachedPromptSettings(): PromptSettings[] | null {
  return cache;
}

export function getPromptSettings(): Promise<PromptSettings[]> {
  if (cache) return Promise.resolve(cache);
  if (request) return request;
  const currentRevision = revision;
  const sharedRequest = invoke<PromptSettings[]>("ai_prompt_settings").then((values) => {
    // A save can arrive before the initial preload has populated the cache.
    // Wait for a current read rather than returning that stale first snapshot.
    if (revision !== currentRevision) return cache ?? getPromptSettings();
    cache = values;
    return values;
  }).finally(() => { if (request === sharedRequest) request = null; });
  request = sharedRequest;
  return sharedRequest;
}

export function savePromptSettings(action: PromptAction, instructions: string | null): Promise<PromptSettings> {
  return invoke<PromptSettings>("ai_prompt_settings_save", { action, instructions }).then(applySaved);
}

export function saveReviewFixExamples(enabled: boolean): Promise<PromptSettings> {
  return invoke<PromptSettings>("ai_review_fix_examples_save", { enabled }).then(applySaved);
}
