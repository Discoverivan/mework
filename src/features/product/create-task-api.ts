import { invoke } from "@tauri-apps/api/core";

export type JiraTaskIssueType = "Task" | "Spike";

export interface TaskDraft {
  summary: string;
  description: string;
  epicLink?: string | null;
  assignee?: string | null;
  sources?: TaskDraftSource[];
}

export interface TaskDraftSource {
  title: string;
  url: string;
  kind: "Jira" | "Confluence";
}

export interface JiraTaskMember {
  id: string;
  displayName: string;
  avatarUrl?: string;
  active: boolean;
}

export interface CreatedJiraTask {
  id: string;
  key: string;
  url: string;
  warning?: string;
}

export const generateTaskDraft = (prompt: string, existingSources: TaskDraftSource[] = []) =>
  invoke<TaskDraft>("ai_task_draft", { request: { prompt, existingSources } });

export const listJiraTaskTeamMembers = (managedProjectId: string) =>
  invoke<JiraTaskMember[]>("jira_task_team_members", { managedProjectId });

export const createJiraTask = (request: {
  managedProjectId: string;
  issueType: JiraTaskIssueType;
  summary: string;
  description: string;
  epicLink?: string;
  assignee?: string;
  sprint?: string;
  storyPoints?: string;
}) => invoke<CreatedJiraTask>("jira_task_create", { request });
