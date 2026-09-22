import type { DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";

const workspaceCache = new Map<string, DailyWorkspace>();
const latestWorkspaceKeyByProject = new Map<string, string>();
let managedProjectsCache: ManagedProject[] | undefined;

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
  const key = cacheKey(workspace.managedProjectId, workspace.selectedSprintId);
  workspaceCache.set(key, workspace);
  latestWorkspaceKeyByProject.set(workspace.managedProjectId, key);
}

export function clearDailyWorkspaceCacheForTests(): void {
  workspaceCache.clear();
  latestWorkspaceKeyByProject.clear();
  managedProjectsCache = undefined;
}
