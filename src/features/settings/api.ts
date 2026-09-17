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

export const getAiSettings = () => invoke<AiSettingsPageData>("ai_settings");

export const saveAiSettings = (settings: AiSettings) =>
  invoke<AiSettingsPageData>("ai_settings_save", { settings });

export const saveOpenAiCompatibleProvider = (input: OpenAiCompatibleProviderSaveInput) =>
  invoke<AiSettingsPageData>("ai_openai_compatible_save", { request: input });

export const listIntegrations = () => invoke<IntegrationRedacted[]>("integration_list");

export const saveIntegration = (input: IntegrationSaveInput) =>
  invoke<IntegrationSaveResult>("integration_save", { request: input });

export const refreshIntegrationHealth = (input: IntegrationHealthCheckInput) =>
  invoke<IntegrationRedacted>("integration_health_check", { id: input.id });

export const refreshAllIntegrationsHealth = () =>
  invoke<IntegrationRedacted[]>("integration_health_check_all");

export const deleteIntegration = (input: IntegrationDeleteInput) =>
  invoke<void>("integration_delete", { ...input });

export const setIntegrationEnabled = (input: IntegrationSetEnabledInput) =>
  invoke<IntegrationRedacted>("integration_set_enabled", { ...input });
