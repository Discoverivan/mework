export type PlanningSyncState =
  | "local"
  | "pending"
  | "synced"
  | "conflict"
  | "error"
  | "unmapped";

export type PlanningWorkspaceStatus =
  | "draft"
  | "applying"
  | "partially_synced"
  | "locked"
  | "conflict";

export type PlanningAvailability = "available" | "empty" | "unavailable";

export interface ManagedProject {
  id: string;
  integrationId: string;
  jiraProjectId: string;
  name: string;
  boardId: string;
  boardName: string;
  storyPointsFieldId?: string;
  sourceSprintId?: string;
  sourceSprintName?: string;
  defaultTaskSprintId?: string;
  defaultTaskSprintName?: string;
  epicLinkJql?: string;
  availability?: PlanningAvailability;
}

export interface EpicLinkJqlPreviewRequest {
  managedProjectId: string;
  jql: string;
}

export interface EpicLinkJqlIssue {
  key: string;
  summary: string;
}

export interface PlanningBoard {
  id: string;
  name: string;
  type?: string;
}

export interface PlanningProjectBoardsInput {
  integrationId: string;
  projectKey: string;
}

export interface PlanningSprint {
  id: string;
  boardId: string;
  name: string;
  state: "future" | "active" | "closed" | "unknown";
  usable: boolean;
  startDate?: string;
  endDate?: string;
  availability?: PlanningAvailability;
}

export interface PlanningAssignee {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  active?: boolean;
}

export interface CompetencySubtask {
  id: string;
  summary: string;
  competency?: string;
  storyPoints?: number;
  assignee?: PlanningAssignee;
  syncState: PlanningSyncState;
  isRemote: boolean;
  required?: boolean;
  localRevision?: number;
}

export interface PlanningIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
  storyPoints?: number;
  assignee?: PlanningAssignee;
  sourceSprintId?: string;
  targetSprintId?: string;
  syncState: PlanningSyncState;
  subtasks: CompetencySubtask[];
}

export interface PlanningWorkspace {
  id: string;
  managedProject: ManagedProject;
  sourceSprint: PlanningSprint;
  targetSprint: PlanningSprint;
  sourceIssues: PlanningIssue[];
  targetIssues: PlanningIssue[];
  drafts?: PlanningDraft[];
  revision: string;
  status: PlanningWorkspaceStatus;
  loadedAt: string;
  readState?: PlanningAvailability;
  readStateReason?: string;
}

export interface PlanningWorkspaceRequest {
  managedProjectId: string;
  sourceSprintId: string;
  targetSprintId: string;
}

export interface PlanningDraftSubtask {
  id: string;
  summary: string;
  competency: string;
  storyPoints?: number;
  assigneeAccountId?: string;
  required: boolean;
}

export interface PlanningDraft {
  id?: string;
  workspaceId: string;
  parentIssueId: string;
  subtasks: PlanningDraftSubtask[];
  revision?: number;
}

export interface TeamMember {
  accountId: string;
  displayName: string;
  alias?: string;
  avatarUrl?: string;
  active: boolean;
  tags: string[];
  displayOrder?: number;
}

export interface TeamMemberSearchInput {
  managedProjectId: string;
  query: string;
}

export interface TeamMemberAddInput {
  managedProjectId: string;
  accountId: string;
  displayName: string;
  alias?: string;
  avatarUrl?: string;
  role: string;
}

export interface TeamMemberReorderInput {
  managedProjectId: string;
  accountIds: string[];
}

export interface TeamPreset {
  id: string;
  managedProjectId: string;
  name: string;
  color?: string;
  memberAccountIds: string[];
  memberTags?: Record<string, string[]>;
  selected?: boolean;
}

export interface TeamPresetInput {
  id?: string;
  managedProjectId: string;
  name: string;
  color?: string;
  memberAccountIds: string[];
  memberTags?: Record<string, string[]>;
}

/** Parent/backend contract for the only planning command allowed to write Jira. */
export interface ApplyAndLockCommand {
  workspaceId: string;
  expectedRevision: string;
  idempotencyKey: string;
  confirm: true;
  force?: boolean;
}
