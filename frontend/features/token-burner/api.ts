import { invoke } from "@tauri-apps/api/core";
import type {
  TokenBurnerRepository,
  TokenBurnerSettings,
  TokenBurnerSnapshot,
} from "@/shared/contracts/token-burner";

export const getTokenBurnerSettings = () =>
  invoke<TokenBurnerSettings>("token_burner_settings");

export const saveTokenBurnerSettings = (settings: TokenBurnerSettings) =>
  invoke<TokenBurnerSettings>("token_burner_settings_save", { settings });

export const getTokenBurnerSnapshot = () =>
  invoke<TokenBurnerSnapshot>("token_burner_snapshot");

export const listTokenBurnerRepositories = () =>
  invoke<TokenBurnerRepository[]>("token_burner_repositories");

export const isTokenBurnerIntegrationAvailable = () =>
  invoke<boolean>("token_burner_integration_available");

export const startTokenBurner = () =>
  invoke<TokenBurnerSnapshot>("token_burner_start");

export const pauseTokenBurner = () =>
  invoke<TokenBurnerSnapshot>("token_burner_pause");

export const resumeTokenBurner = () =>
  invoke<TokenBurnerSnapshot>("token_burner_resume");

export const stopTokenBurner = () =>
  invoke<TokenBurnerSnapshot>("token_burner_stop");

export const resetTokenBurnerDailyTarget = () =>
  invoke<TokenBurnerSnapshot>("token_burner_reset_daily_target");
