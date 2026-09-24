import { invoke } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";

export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** Checks the configured Tauri updater endpoint without installing anything. */
export async function checkForAvailableUpdate(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
}

/** Reads the last native background check result without starting another network request. */
export async function getBackgroundUpdateVersion(): Promise<string | null> {
  return invoke<string | null>("background_update_version");
}
