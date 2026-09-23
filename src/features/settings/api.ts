import { invoke } from "@tauri-apps/api/core";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
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
const AI_CLI_RECOVERY_DELAY_MS = 5_000;

let aiSettingsRequest: Promise<AiSettingsPageData> | null = null;
let aiSettingsCache: { value: AiSettingsPageData; expiresAt: number } | null = null;
let aiCliRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let integrationHealthRequest: Promise<IntegrationRedacted[]> | null = null;

function scheduleAiCliRecovery(missingProvider: NonNullable<AiSettings["provider"]>): void {
  if (aiCliRecoveryTimer !== null) return;
  aiCliRecoveryTimer = setTimeout(() => {
    aiCliRecoveryTimer = null;
    void getAiSettings().then((rechecked) => {
      if (rechecked.settings.provider !== missingProvider) return;
      const provider = rechecked.providers.find((candidate) => candidate.id === missingProvider);
      if (provider && !isTransientCliStatus(provider.status)) {
        emitAppEvent(APP_EVENT.aiSettingsChanged, rechecked);
      }
    }).catch(() => scheduleAiCliRecovery(missingProvider));
  }, AI_CLI_RECOVERY_DELAY_MS);
}

function isTransientCliStatus(status: string): boolean {
  return status === "loading" || status === "unavailable" || status === "not_found";
}

function cacheStableAiSettings(value: AiSettingsPageData): AiSettingsPageData {
  const selectedProvider = value.providers.find((provider) => provider.id === value.settings.provider);
  const cliNeedsRecovery = (value.settings.provider === "codex-cli" || value.settings.provider === "claude-code-cli")
    && selectedProvider !== undefined && isTransientCliStatus(selectedProvider.status);
  const transient = value.providers.some((provider) =>
    provider.status === "loading" || provider.status === "unavailable"
  );
  if (!transient && !cliNeedsRecovery) {
    aiSettingsCache = { value, expiresAt: Date.now() + AI_SETTINGS_CACHE_TTL_MS };
  } else {
    aiSettingsCache = null;
  }
  if (cliNeedsRecovery && value.settings.provider) {
    scheduleAiCliRecovery(value.settings.provider);
  } else if (aiCliRecoveryTimer !== null) {
    clearTimeout(aiCliRecoveryTimer);
    aiCliRecoveryTimer = null;
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
