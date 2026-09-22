import { invoke } from "@tauri-apps/api/core";

export type TaskTrackerScheduleKind = "period" | "cron";
export type TaskTrackerEventKind = "newIssues" | "removedIssues" | "statusChanges" | "newComments";
export type TaskTrackerChangeKind = "new" | "removed" | "status" | "comment";

export interface TaskTrackerChange {
  kind: TaskTrackerChangeKind;
  description: string;
  detectedAt: string;
}

export interface TaskTrackerIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string | null;
  updated?: string | null;
  issueUrl: string;
  lastChange?: TaskTrackerChange | null;
  changed: boolean;
}

export interface TaskTrackerMonitor {
  id: string;
  name: string;
  jql: string;
  scheduleKind: TaskTrackerScheduleKind;
  scheduleValue: string;
  trackedEvents: TaskTrackerEventKind[];
  enabled: boolean;
  lastSuccessAt?: string | null;
  nextCheckAt?: number | null;
  currentIssueCount: number;
  changesAfterLastCheck: number;
  lastError?: string | null;
  issues: TaskTrackerIssue[];
}

export interface TaskTrackerMonitorInput {
  id?: string;
  name: string;
  jql: string;
  scheduleKind: TaskTrackerScheduleKind;
  scheduleValue: string;
  trackedEvents: TaskTrackerEventKind[];
  enabled: boolean;
}

export interface TaskTrackerJqlPreview {
  issueCount: number;
  truncated: boolean;
  issues: TaskTrackerIssue[];
}

export const listTaskTrackerMonitors = () =>
  invoke<TaskTrackerMonitor[]>("task_tracker_list");

export const saveTaskTrackerMonitor = (request: TaskTrackerMonitorInput) =>
  invoke<TaskTrackerMonitor>("task_tracker_save", { request });

export const deleteTaskTrackerMonitor = (id: string) =>
  invoke<boolean>("task_tracker_delete", { id });

export const setTaskTrackerEnabled = (id: string, enabled: boolean) =>
  invoke<TaskTrackerMonitor>("task_tracker_set_enabled", { id, enabled });

export const validateTaskTrackerJql = (jql: string) =>
  invoke<TaskTrackerJqlPreview>("task_tracker_validate_jql", { request: { jql } });

export const checkTaskTrackerNow = (id: string) =>
  invoke<TaskTrackerMonitor>("task_tracker_check_now", { id });
