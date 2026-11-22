import { invoke, isTauri } from "@tauri-apps/api/core";

export type MicrophonePermissionStatus =
  | "notDetermined"
  | "authorized"
  | "denied"
  | "restricted"
  | "unsupported";

export type MicrophonePermissionOutcome = MicrophonePermissionStatus | "unavailable";

export async function ensureMicrophonePermission(): Promise<MicrophonePermissionOutcome> {
  if (!isTauri()) return "unsupported";
  try {
    let status = await invoke<MicrophonePermissionStatus>("microphone_permission_status");
    if (status === "notDetermined") {
      status = await invoke<MicrophonePermissionStatus>("microphone_request_permission");
    }
    return status;
  } catch {
    return "unavailable";
  }
}

export async function openMicrophoneSettings(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke<void>("microphone_open_settings");
    return true;
  } catch {
    return false;
  }
}
