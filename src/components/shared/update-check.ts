import { invoke } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import type {
  UpdateAvailabilitySnapshot,
  UpdateCheckCompletion,
  UpdateCheckTicket,
} from "@/shared/contracts/updates";

export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** Checks the configured Tauri updater endpoint without installing anything. */
export async function checkForAvailableUpdate(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
}

/** Reads the last native background check result without starting another network request. */
export async function getBackgroundUpdateState(): Promise<UpdateAvailabilitySnapshot> {
  return invoke<UpdateAvailabilitySnapshot>("background_update_state");
}

export async function beginUpdateCheck(): Promise<UpdateCheckTicket> {
  return invoke<UpdateCheckTicket>("begin_update_check");
}

export async function recordUpdateCheckResult(
  checkId: number,
  availableVersion: string | null,
  succeeded: boolean,
): Promise<UpdateCheckCompletion> {
  return invoke<UpdateCheckCompletion>("record_update_check_result", {
    checkId,
    availableVersion,
    succeeded,
  });
}

export async function getBackgroundUpdateVersion(): Promise<string | null> {
  return invoke<string | null>("background_update_version");
}
