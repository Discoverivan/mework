import type { Update } from "@tauri-apps/plugin-updater";

/** Downloads an update and restarts the desktop application. */
export async function installAvailableUpdate(update: Update): Promise<void> {
  if (import.meta.env.DEV) throw new Error("Update installation is disabled in development builds");
  await update.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
