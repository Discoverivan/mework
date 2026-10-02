import type { DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { loadDailyWorkspace } from "./api";

const workspaceCache = new Map<string, DailyWorkspace>();
const latestWorkspaceKeyByProject = new Map<string, string>();
let managedProjectsCache: ManagedProject[] | undefined;
let projectsRequest: Promise<ManagedProject[]> | undefined;
const workspaceRequests = new Map<string, Promise<DailyWorkspace>>();
const workspaceSelections = new Map<string, symbol>();
let prefetchRequest: Promise<void> | undefined;

export function refreshManagedProjectsCache(): Promise<ManagedProject[]> {
  if (projectsRequest) return projectsRequest;
  const request = listManagedProjects().then((projects) => {
    writeManagedProjectsCache(projects);
    return projects;
  }).finally(() => { if (projectsRequest === request) projectsRequest = undefined; });
  projectsRequest = request;
  return request;
}

export function refreshDailyWorkspaceCache(projectId: string, sprintId?: string, selectWorkspace = true): Promise<DailyWorkspace> {
  const selection = selectWorkspace ? Symbol() : undefined;
  if (selection) workspaceSelections.set(projectId, selection);
  const key = cacheKey(projectId, sprintId ?? "");
  let request = workspaceRequests.get(key);
  if (!request) {
    request = loadDailyWorkspace(projectId, sprintId).then((workspace) => {
      cacheDailyWorkspace(workspace, false);
      return workspace;
    }).finally(() => { if (workspaceRequests.get(key) === request) workspaceRequests.delete(key); });
    workspaceRequests.set(key, request);
  }
  return request.then((workspace) => {
    // A late background or previous selection must not replace the chosen sprint.
    if (selection && workspaceSelections.get(projectId) === selection) {
      writeDailyWorkspaceCache(workspace);
    }
    return workspace;
  });
}

export function prefetchDailyWorkspaces(integrationIds: string[]): Promise<void> {
  if (prefetchRequest) return prefetchRequest;
  const request = refreshManagedProjectsCache().then(async (projects) => {
    // Warm active sprints in order so startup does not flood Jira with requests.
    for (const project of projects) {
      if (!integrationIds.includes(project.integrationId)) continue;
      await refreshDailyWorkspaceCache(project.id, undefined, false).catch(() => {
        // A failed background load can be retried when its team is opened.
      });
    }
  }).finally(() => { if (prefetchRequest === request) prefetchRequest = undefined; });
  prefetchRequest = request;
  return request;
}

export function readManagedProjectsCache(): ManagedProject[] | undefined {
  return managedProjectsCache?.slice();
}

export function writeManagedProjectsCache(projects: ManagedProject[]): void {
  managedProjectsCache = projects.slice();
}

function cacheKey(projectId: string, sprintId: string): string {
  return `${projectId}:${sprintId}`;
}

export function readDailyWorkspaceCache(projectId: string, sprintId?: string): DailyWorkspace | undefined {
  if (sprintId) return workspaceCache.get(cacheKey(projectId, sprintId));
  const latestKey = latestWorkspaceKeyByProject.get(projectId);
  return latestKey ? workspaceCache.get(latestKey) : undefined;
}

export function writeDailyWorkspaceCache(workspace: DailyWorkspace): void {
  cacheDailyWorkspace(workspace, true);
}

function cacheDailyWorkspace(workspace: DailyWorkspace, selectWorkspace: boolean): void {
  const key = cacheKey(workspace.managedProjectId, workspace.selectedSprintId);
  workspaceCache.set(key, workspace);
  if (selectWorkspace || !latestWorkspaceKeyByProject.has(workspace.managedProjectId)) {
    latestWorkspaceKeyByProject.set(workspace.managedProjectId, key);
  }
}

export function clearDailyWorkspaceCacheForTests(): void {
  workspaceCache.clear();
  latestWorkspaceKeyByProject.clear();
  managedProjectsCache = undefined;
  projectsRequest = undefined;
  workspaceRequests.clear();
  workspaceSelections.clear();
  prefetchRequest = undefined;
}
