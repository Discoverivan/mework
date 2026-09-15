import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyAndLockCommand,
  EpicLinkJqlIssue,
  EpicLinkJqlPreviewRequest,
  ManagedProject,
  PlanningDraft,
  PlanningBoard,
  PlanningProjectBoardsInput,
  PlanningSprint,
  PlanningWorkspace,
  PlanningWorkspaceRequest,
  TeamMember,
  TeamMemberAddInput,
  TeamMemberReorderInput,
  TeamMemberSearchInput,
  TeamPreset,
  TeamPresetInput,
} from "../../shared/contracts/planning";

/** Renderer boundary: only redacted DTOs cross into the React application. */
export const listManagedProjects = () =>
  invoke<ManagedProject[]>("planning_managed_projects");

export const previewEpicLinkJql = (request: EpicLinkJqlPreviewRequest) =>
  invoke<EpicLinkJqlIssue[]>("planning_epic_link_jql_preview", { request });

export const listTargetSprints = (managedProjectId: string) =>
  invoke<PlanningSprint[]>("planning_target_sprints", { managedProjectId });

export const listPlanningProjectBoards = (request: PlanningProjectBoardsInput) =>
  invoke<PlanningBoard[]>("planning_project_boards", { request });

export const loadPlanningWorkspace = (request: PlanningWorkspaceRequest) =>
  invoke<PlanningWorkspace>("planning_workspace", { request });

export const savePlanningDraft = (request: PlanningDraft) =>
  invoke<PlanningDraft>("planning_draft_save", { request });

export const removePlanningDraft = (draftId: string) =>
  invoke<void>("planning_draft_remove", { draftId });

export const listPlanningTeamPresets = (managedProjectId: string) =>
  invoke<TeamPreset[]>("planning_team_presets", { managedProjectId });

export const savePlanningTeamPreset = (request: TeamPresetInput) =>
  invoke<TeamPreset>("planning_team_preset_save", { request });

export const removePlanningTeamPreset = (presetId: string) =>
  invoke<void>("planning_team_preset_remove", { presetId });

export const listPlanningTeamMembers = (managedProjectId: string) =>
  invoke<TeamMember[]>("planning_team_members", { managedProjectId });

export const listPlanningConfiguredTeamMembers = (managedProjectId: string) =>
  invoke<TeamMember[]>("planning_team_members_configured", { managedProjectId });

export const loadJiraAvatarData = (managedProjectId: string, avatarUrl: string) =>
  invoke<string | null>("jira_avatar_data", { managedProjectId, avatarUrl });


export const searchPlanningTeamMembers = (request: TeamMemberSearchInput) =>
  invoke<TeamMember[]>("planning_team_members_search", { request });

export const addPlanningTeamMember = (request: TeamMemberAddInput) =>
  invoke<TeamMember>("planning_team_member_add", { request });

export const removePlanningTeamMember = (managedProjectId: string, accountId: string) =>
  invoke<void>("planning_team_member_remove", { managedProjectId, accountId });

export const reorderPlanningTeamMembers = (request: TeamMemberReorderInput) =>
  invoke<TeamMember[]>("planning_team_member_reorder", { request });

/** Explicit external-action shape. Save/edit/remove draft never calls this. */
export const applyAndLockPlanning = (request: ApplyAndLockCommand) =>
  invoke<PlanningWorkspace>("planning_apply_and_lock", { request });
