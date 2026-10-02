import { invoke } from "@tauri-apps/api/core";
import { matchesSelectedAiProvider } from "@/shared/contracts/settings";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import type {
  AiSettings,
  AiProvider,
  AiCliProviderId,
  AiSettingsPageData,
  OpenAiCompatibleProviderSaveInput,
  IntegrationDeleteInput,
  IntegrationHealthCheckInput,
  IntegrationRedacted,
  IntegrationSaveInput,
  IntegrationSaveResult,
  IntegrationSetEnabledInput,
} from "../../shared/contracts/settings";

const AI_CLI_RECOVERY_DELAY_MS = 5_000;

let aiSettingsRequest: Promise<AiSettingsPageData> | null = null;
let aiSettingsCache: AiSettingsPageData | null = null;
let aiSettingsSnapshot: AiSettingsPageData | null = null;
let aiSettingsRequestRevision = 0;
let aiCliRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let integrationHealthRequest: Promise<IntegrationRedacted[]> | null = null;

function scheduleAiCliRecovery(missingProvider: NonNullable<AiSettings["provider"]>): void {
  if (aiCliRecoveryTimer !== null) return;
  aiCliRecoveryTimer = setTimeout(() => {
    aiCliRecoveryTimer = null;
    void getAiSettings().then((rechecked) => {
      if (rechecked.settings.provider !== missingProvider) return;
      const provider = rechecked.providers.find((candidate) => candidate.id === missingProvider);
      if (provider?.status !== "not_found") emitAppEvent(APP_EVENT.aiSettingsChanged, rechecked);
    }).catch(() => scheduleAiCliRecovery(missingProvider));
  }, AI_CLI_RECOVERY_DELAY_MS);
}

function cacheStableAiSettings(value: AiSettingsPageData): AiSettingsPageData {
  aiSettingsSnapshot = value;
  const selectedProvider = value.providers.find((provider) => matchesSelectedAiProvider(value.settings, provider));
  const cliMissing = selectedProvider?.status === "not_found";
  const transient = value.providers.some((provider) =>
    provider.status === "loading" || provider.status === "unavailable"
  );
  if (!transient && !cliMissing) {
    aiSettingsCache = value;
  } else {
    aiSettingsCache = null;
  }
  if (cliMissing && value.settings.provider) {
    scheduleAiCliRecovery(value.settings.provider);
  } else if (aiCliRecoveryTimer !== null) {
    clearTimeout(aiCliRecoveryTimer);
    aiCliRecoveryTimer = null;
  }
  return value;
}

function cacheMutatedAiSettings(value: AiSettingsPageData): AiSettingsPageData {
  aiSettingsRequestRevision += 1;
  aiSettingsRequest = null;
  return cacheStableAiSettings(value);
}

// The API owns the session cache; event consumers never repeat provider inspection.
const unsubscribeAiSettings = subscribeAppEvent(APP_EVENT.aiSettingsChanged, cacheMutatedAiSettings);
import.meta.hot?.dispose(() => {
  unsubscribeAiSettings();
  if (aiCliRecoveryTimer !== null) clearTimeout(aiCliRecoveryTimer);
});

export function getCachedAiSettings(): AiSettingsPageData | null {
  return aiSettingsSnapshot;
}

export function getAiSettings(): Promise<AiSettingsPageData> {
  if (aiSettingsCache) {
    return Promise.resolve(aiSettingsCache);
  }
  if (aiSettingsRequest) return aiSettingsRequest;

  aiSettingsCache = null;
  const revision = ++aiSettingsRequestRevision;
  const request = invoke<AiSettingsPageData>("ai_settings").then((value) =>
    revision === aiSettingsRequestRevision ? cacheStableAiSettings(value) : value);
  const sharedRequest = request.finally(() => {
    if (aiSettingsRequest === sharedRequest) aiSettingsRequest = null;
  });
  aiSettingsRequest = sharedRequest;
  return sharedRequest;
}

export function refreshAiSettings(): Promise<AiSettingsPageData> {
  aiSettingsCache = null;
  aiSettingsRequest = null;
  return getAiSettings();
}

export const saveAiSettings = (settings: AiSettings) =>
  invoke<AiSettingsPageData>("ai_settings_save", { settings }).then(cacheMutatedAiSettings);

export const saveOpenAiCompatibleProvider = (input: OpenAiCompatibleProviderSaveInput) =>
  invoke<AiSettingsPageData>("ai_openai_compatible_save", { request: input }).then(cacheMutatedAiSettings);

export const addAiCliProvider = (provider: AiCliProviderId) =>
  invoke<AiSettingsPageData>("ai_provider_add", { provider }).then(cacheMutatedAiSettings);

export const inspectAiCliProvider = (provider: AiCliProviderId) =>
  invoke<AiProvider>("ai_cli_candidate_inspect", { provider });

export const deleteAiProvider = (provider: AiSettings["provider"], instanceId?: string | null) =>
  invoke<AiSettingsPageData>("ai_provider_delete", { provider, instanceId: instanceId ?? null }).then(cacheMutatedAiSettings);

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
