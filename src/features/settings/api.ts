import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  AiSettingsPageData,
  OpenAiCompatibleProviderSaveInput,
  IntegrationDeleteInput,
  IntegrationHealthCheckInput,
  IntegrationRedacted,
  IntegrationSaveInput,
  IntegrationSaveResult,
  IntegrationSetEnabledInput,
} from "../../shared/contracts/settings";

const AI_SETTINGS_CACHE_TTL_MS = 5_000;

let aiSettingsRequest: Promise<AiSettingsPageData> | null = null;
let aiSettingsCache: { value: AiSettingsPageData; expiresAt: number } | null = null;
let integrationHealthRequest: Promise<IntegrationRedacted[]> | null = null;

function cacheStableAiSettings(value: AiSettingsPageData): AiSettingsPageData {
  const transient = value.providers.some((provider) =>
    provider.status === "loading" || provider.status === "unavailable"
  );
  if (!transient) {
    aiSettingsCache = { value, expiresAt: Date.now() + AI_SETTINGS_CACHE_TTL_MS };
  } else {
    aiSettingsCache = null;
  }
  return value;
}

export function getAiSettings(): Promise<AiSettingsPageData> {
  if (aiSettingsCache && aiSettingsCache.expiresAt > Date.now()) {
    return Promise.resolve(aiSettingsCache.value);
  }
  if (aiSettingsRequest) return aiSettingsRequest;

  aiSettingsCache = null;
  const request = invoke<AiSettingsPageData>("ai_settings").then(cacheStableAiSettings);
  const sharedRequest = request.finally(() => {
    if (aiSettingsRequest === sharedRequest) aiSettingsRequest = null;
  });
  aiSettingsRequest = sharedRequest;
  return sharedRequest;
}

export const saveAiSettings = (settings: AiSettings) =>
  invoke<AiSettingsPageData>("ai_settings_save", { settings }).then(cacheStableAiSettings);

export const saveOpenAiCompatibleProvider = (input: OpenAiCompatibleProviderSaveInput) =>
  invoke<AiSettingsPageData>("ai_openai_compatible_save", { request: input }).then(cacheStableAiSettings);

export const listIntegrations = () => invoke<IntegrationRedacted[]>("integration_list");

export const saveIntegration = (input: IntegrationSaveInput) =>
  invoke<IntegrationSaveResult>("integration_save", { request: input });

export const refreshIntegrationHealth = (input: IntegrationHealthCheckInput) =>
  invoke<IntegrationRedacted>("integration_health_check", { id: input.id });

export function refreshAllIntegrationsHealth(): Promise<IntegrationRedacted[]> {
  if (integrationHealthRequest) return integrationHealthRequest;

  const request = invoke<IntegrationRedacted[]>("integration_health_check_all");
  const sharedRequest = request.finally(() => {
    if (integrationHealthRequest === sharedRequest) integrationHealthRequest = null;
  });
  integrationHealthRequest = sharedRequest;
  return sharedRequest;
}

export const deleteIntegration = (input: IntegrationDeleteInput) =>
  invoke<void>("integration_delete", { ...input });

export const setIntegrationEnabled = (input: IntegrationSetEnabledInput) =>
  invoke<IntegrationRedacted>("integration_set_enabled", { ...input });
