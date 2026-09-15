import type { Update } from "@tauri-apps/plugin-updater";

export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** Checks the configured Tauri updater endpoint without installing anything. */
export async function checkForAvailableUpdate(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
}
