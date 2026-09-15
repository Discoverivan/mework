import type { Update } from "@tauri-apps/plugin-updater";

/** Downloads an update and restarts the desktop application. */
export async function installAvailableUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
