import { invoke } from "@tauri-apps/api/core";

export interface TaskDraft {
  summary: string;
  description: string;
  epicLink?: string | null;
  assignee?: string | null;
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

export const generateTaskDraft = (prompt: string) =>
  invoke<TaskDraft>("ai_task_draft", { request: { prompt } });

export const listJiraTaskTeamMembers = (managedProjectId: string) =>
  invoke<JiraTaskMember[]>("jira_task_team_members", { managedProjectId });

export const createJiraTask = (request: {
  managedProjectId: string;
  summary: string;
  description: string;
  epicLink?: string;
  assignee?: string;
  sprint?: string;
  storyPoints?: string;
}) => invoke<CreatedJiraTask>("jira_task_create", { request });
