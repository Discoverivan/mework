import type { DailyMyTasksDto, DailySprintStatsDto, DailySprintStatsProgressEvent, DailyTeamWorkspaceDto, DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { loadDailyMyTasks, loadDailySprintStats, loadDailyTeamWorkspace } from "./api";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { readUpdatedTeamMembers } from "../planning/team-members-state";

const key = (projectId: string, sprintId: string) => `${projectId}:${sprintId}`;
const myTasksCache = new Map<string, DailyMyTasksDto>();
const teamCache = new Map<string, DailyTeamWorkspaceDto>();
const statsCache = new Map<string, DailySprintStatsDto>();
const statsProgressCache = new Map<string, DailySprintStatsProgressEvent>();
const myRequests = new Map<string, Promise<DailyMyTasksDto>>();
const teamRequests = new Map<string, Promise<DailyTeamWorkspaceDto>>();
const statsRequests = new Map<string, Promise<DailySprintStatsDto>>();
const statsRequestIds = new Map<string, string>();
let managedProjectsCache: ManagedProject[] | undefined;
let projectsRequest: Promise<ManagedProject[]> | undefined;
let prefetchRequest: Promise<void> | undefined;

subscribeAppEvent(APP_EVENT.teamMembersChanged, ({ managedProjectId, members }) => {
  for (const [cacheKey, workspace] of teamCache) {
    if (workspace.managedProjectId === managedProjectId) teamCache.set(cacheKey, { ...workspace, members });
  }
});
subscribeAppEvent(APP_EVENT.dailySprintStatsProgress, (progress) => {
  if (statsRequestIds.get(key(progress.managedProjectId, progress.sprintId)) === progress.requestId) {
    statsProgressCache.set(key(progress.managedProjectId, progress.sprintId), progress);
  }
});

export function refreshManagedProjectsCache(): Promise<ManagedProject[]> {
  if (projectsRequest) return projectsRequest;
  const request = listManagedProjects().then((projects) => {
    writeManagedProjectsCache(projects);
    return projects;
  }).finally(() => { if (projectsRequest === request) projectsRequest = undefined; });
  projectsRequest = request;
  return request;
}

function dedupe<T>(requests: Map<string, Promise<T>>, cacheKey: string, run: () => Promise<T>): Promise<T> {
  const current = requests.get(cacheKey);
  if (current) return current;
  const request = run().finally(() => { if (requests.get(cacheKey) === request) requests.delete(cacheKey); });
  requests.set(cacheKey, request);
  return request;
}

export function loadMyTasks(projectId: string, sprintId?: string, force = false): Promise<DailyMyTasksDto> {
  const cacheKey = key(projectId, sprintId ?? "");
  if (!force && myTasksCache.has(cacheKey)) return Promise.resolve(myTasksCache.get(cacheKey)!);
  return dedupe(myRequests, cacheKey, async () => {
    const loaded = await loadDailyMyTasks(projectId, sprintId);
    myTasksCache.set(key(projectId, loaded.selectedSprintId), loaded);
    myTasksCache.set(cacheKey, loaded);
    return loaded;
  });
}

export function loadTeamWorkspace(projectId: string, sprintId?: string, force = false): Promise<DailyTeamWorkspaceDto> {
  const cacheKey = key(projectId, sprintId ?? "");
  if (!force && teamCache.has(cacheKey)) return Promise.resolve(teamCache.get(cacheKey)!);
  return dedupe(teamRequests, cacheKey, async () => {
    const loaded = await loadDailyTeamWorkspace(projectId, sprintId);
    const members = readUpdatedTeamMembers(projectId);
    const workspace = members ? { ...loaded, members } : loaded;
    teamCache.set(key(projectId, workspace.selectedSprintId), workspace);
    teamCache.set(cacheKey, workspace);
    return workspace;
  });
}

export function loadSprintStats(projectId: string, sprintId: string, force = false): Promise<DailySprintStatsDto> {
  const cacheKey = key(projectId, sprintId);
  if (!force && statsCache.has(cacheKey)) return Promise.resolve(statsCache.get(cacheKey)!);
  return dedupe(statsRequests, cacheKey, async () => {
    const requestId = crypto.randomUUID();
    statsRequestIds.set(cacheKey, requestId);
    statsProgressCache.set(cacheKey, { requestId, managedProjectId: projectId, sprintId, phase: "starting", completed: 0, total: 0 });
    const stats = await loadDailySprintStats(projectId, sprintId, requestId);
    statsCache.set(cacheKey, stats);
    statsProgressCache.delete(cacheKey);
    return stats;
  });
}

export function readMyTasksCache(projectId: string, sprintId?: string): DailyMyTasksDto | undefined {
  return myTasksCache.get(key(projectId, sprintId ?? ""));
}
export function readTeamWorkspaceCache(projectId: string, sprintId?: string): DailyTeamWorkspaceDto | undefined {
  return teamCache.get(key(projectId, sprintId ?? ""));
}
export function readSprintStatsCache(projectId: string, sprintId: string): DailySprintStatsDto | undefined {
  return statsCache.get(key(projectId, sprintId));
}
export function readSprintStatsProgress(projectId: string, sprintId: string): DailySprintStatsProgressEvent | undefined {
  return statsProgressCache.get(key(projectId, sprintId));
}

export function prefetchDailyWorkspaces(integrationIds: string[]): Promise<void> {
  if (prefetchRequest) return prefetchRequest;
  const request = refreshManagedProjectsCache().then(async (projects) => {
    for (const project of projects) {
      if (integrationIds.includes(project.integrationId)) await loadMyTasks(project.id).catch(() => undefined);
    }
  }).finally(() => { if (prefetchRequest === request) prefetchRequest = undefined; });
  prefetchRequest = request;
  return request;
}

export function readManagedProjectsCache(): ManagedProject[] | undefined { return managedProjectsCache?.slice(); }
export function writeManagedProjectsCache(projects: ManagedProject[]): void { managedProjectsCache = projects.slice(); }

export function writeDailyWorkspaceCache(workspace: DailyWorkspace): void {
  myTasksCache.set(key(workspace.managedProjectId, workspace.selectedSprintId), {
    managedProjectId: workspace.managedProjectId, projectName: workspace.projectName, projectKey: workspace.projectKey,
    selectedSprintId: workspace.selectedSprintId, selectedSprintName: workspace.selectedSprintName,
    currentUserAccountId: workspace.currentUserAccountId ?? null, currentUserMember: workspace.currentUserMember ?? null,
    sprints: workspace.sprints, subtasks: workspace.subtasks,
  });
  teamCache.set(key(workspace.managedProjectId, workspace.selectedSprintId), {
    managedProjectId: workspace.managedProjectId, projectName: workspace.projectName, projectKey: workspace.projectKey,
    selectedSprintId: workspace.selectedSprintId, selectedSprintName: workspace.selectedSprintName,
    sprintBoardUrl: workspace.sprintBoardUrl, sprintBoardUrlsByAssignee: workspace.sprintBoardUrlsByAssignee,
    sprints: workspace.sprints, members: workspace.members, subtasks: workspace.subtasks,
  });
  statsCache.set(key(workspace.managedProjectId, workspace.selectedSprintId), workspace.sprintStats);
}

export function clearDailyWorkspaceCacheForTests(): void {
  myTasksCache.clear(); teamCache.clear(); statsCache.clear(); statsProgressCache.clear();
  myRequests.clear(); teamRequests.clear(); statsRequests.clear(); statsRequestIds.clear();
  managedProjectsCache = undefined; projectsRequest = undefined; prefetchRequest = undefined;
}
