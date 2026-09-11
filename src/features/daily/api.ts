import type { DailyPresenterState, DailyWorkspace } from "@/shared/contracts/developer";
import { invoke } from "@tauri-apps/api/core";

const PRESENTER_STATE_KEY = "mework.daily.presenter.state";
const PRESENTER_CHANNEL_NAME = "mework.daily.presenter";
const presenterChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(PRESENTER_CHANNEL_NAME) : undefined;

function parsePresenterState(raw: string | null): DailyPresenterState | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as DailyPresenterState;
  } catch {
    return undefined;
  }
}
export const loadDailyWorkspace = (managedProjectId: string) =>
  invoke<DailyWorkspace>("daily_workspace", { managedProjectId });

export const loadJiraAvatarData = (managedProjectId: string, avatarUrl: string) =>
  invoke<string | null>("jira_avatar_data", { managedProjectId, avatarUrl });


export const refreshDailyWorkspace = (managedProjectId: string, activeSprintId: string) =>
  invoke<DailyWorkspace["subtasks"]>("daily_workspace_refresh", { managedProjectId, activeSprintId });

export const openPresenterView = () => invoke<void>("open_presenter_view");
export const closePresenterView = () => invoke<void>("close_presenter_view");
export const readNativePresenterState = () => invoke<DailyPresenterState | null>("presenter_view_state");

export async function publishPresenterState(state: DailyPresenterState): Promise<void> {
  window.localStorage.setItem(PRESENTER_STATE_KEY, JSON.stringify(state));
  presenterChannel?.postMessage(state);
  try {
    await invoke<void>("update_presenter_view", { state });
  } catch {
    // The state remains in localStorage for a presenter window that is still loading.
  }
}

export function readPresenterState(): DailyPresenterState | undefined {
  return parsePresenterState(window.localStorage.getItem(PRESENTER_STATE_KEY));
}

export function subscribePresenterState(onState: (state: DailyPresenterState) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PRESENTER_STATE_KEY) {
      const state = parsePresenterState(event.newValue);
      if (state) onState(state);
    }
  };
  window.addEventListener("storage", onStorage);

  const onMessage = (event: MessageEvent<DailyPresenterState>) => onState(event.data);
  presenterChannel?.addEventListener("message", onMessage);

  return () => {
    window.removeEventListener("storage", onStorage);
    presenterChannel?.removeEventListener("message", onMessage);
  };
}
