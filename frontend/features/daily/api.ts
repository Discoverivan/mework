import type { DailyIssueTransition, DailyMyTasksDto, DailyPresenterState, DailySprintStatsDto, DailyTeamWorkspaceDto } from "@/shared/contracts/developer";
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
export const loadDailyMyTasks = (managedProjectId: string, sprintId?: string) =>
  invoke<DailyMyTasksDto>("daily_my_tasks", { managedProjectId, sprintId });

export const loadDailyTeamWorkspace = (managedProjectId: string, sprintId?: string) =>
  invoke<DailyTeamWorkspaceDto>("daily_team_workspace", { managedProjectId, sprintId });

export const loadDailySprintStats = (managedProjectId: string, sprintId: string, requestId: string) =>
  invoke<DailySprintStatsDto>("daily_sprint_stats", { managedProjectId, sprintId, requestId });

export interface AiSummaryRequest {
  managedProjectId: string;
  sprintId: string;
  preset: "weekly" | "custom";
  period?: {
    startAt: string;
    endExclusive: string;
    timeZone: string;
  };
  customPrompt?: string;
  previousResult?: string;
  action?: "generate" | "shorter" | "longer" | "regenerate";
}

export const generateSprintSummary = (request: AiSummaryRequest) =>
  invoke<{ text: string }>("ai_sprint_summary", { request });

export const loadJiraAvatarData = (managedProjectId: string, avatarUrl: string) =>
  invoke<string | null>("jira_avatar_data", { managedProjectId, avatarUrl });

export const refreshDailyWorkspace = async (managedProjectId: string, sprintId: string) =>
  (await loadDailyTeamWorkspace(managedProjectId, sprintId)).subtasks;

export const refreshDailyTeamWorkspace = (managedProjectId: string, sprintId: string) =>
  loadDailyTeamWorkspace(managedProjectId, sprintId);

export const loadDailyIssueTransitions = (managedProjectId: string, sprintId: string, issueKey: string) =>
  invoke<DailyIssueTransition[]>("daily_issue_transitions", { managedProjectId, sprintId, issueKey });

export const transitionDailyIssue = (
  managedProjectId: string,
  sprintId: string,
  issueKey: string,
  transitionId: string,
  idempotencyKey: string,
) => invoke<void>("daily_issue_transition", {
  managedProjectId,
  sprintId,
  issueKey,
  transitionId,
  idempotencyKey,
});

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
