import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, ChevronDown, Copy, ExternalLink, MoreHorizontal, Plus, Presentation, RefreshCw, Square } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusToast } from "@/components/shared/StatusToast";
import { useI18n } from "@/i18n/context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DailyIssueTransition, DailySubtask, DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject, TeamMember } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { closePresenterView, loadDailyIssueTransitions, loadDailyWorkspace, loadJiraAvatarData, openPresenterView, publishPresenterState, refreshDailyWorkspace, subscribePresenterState, transitionDailyIssue } from "./api";
import { readDailyWorkspaceCache, readManagedProjectsCache, writeDailyWorkspaceCache, writeManagedProjectsCache } from "./cache";
import { dailyStatusTone } from "./status";

function commandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const structured = error as { message?: unknown; code?: unknown };
    if (typeof structured.message === "string" && structured.message.trim()) return structured.message;
    if (typeof structured.code === "string" && structured.code.trim()) return `Command failed (${structured.code})`;
  }
  return "Unknown command error";
}

function statusActionError(error: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  const code = typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "stale_transition") return t("daily.transitionStale");
  if (code === "transition_result_unknown") return t("daily.transitionUnknown");
  if (code === "transition_requires_fields") return t("daily.transitionRequiresFields");
  return t("daily.transitionFailed");
}

function initials(displayName: string): string {
  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

function memberDisplayName(member: TeamMember): string {
  return member.alias?.trim() || member.displayName;
}

function MemberAvatar({ member, className, managedProjectId }: { member: TeamMember; className: string; managedProjectId: string }) {
  const [source, setSource] = useState(member.avatarUrl);
  useEffect(() => {
    let active = true;
    setSource(member.avatarUrl);
    if (member.avatarUrl) {
      void loadJiraAvatarData(managedProjectId, member.avatarUrl)
        .then((dataUrl) => { if (active && dataUrl) setSource(dataUrl); })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [managedProjectId, member.accountId, member.avatarUrl]);
  if (!source) {
    return <span className={`${className} flex items-center justify-center rounded-full bg-muted font-medium`} aria-hidden="true">{initials(member.displayName)}</span>;
  }
  return <img className={`${className} rounded-full object-cover`} src={source} alt="" onError={() => setSource(undefined)} />;
}

function orderedMembers(members: TeamMember[]): TeamMember[] {
  return members
    .filter((member) => member.active)
    .slice()
    .sort((left, right) => {
      const orderDifference = (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER);
      return orderDifference || left.displayName.localeCompare(right.displayName);
    });
}

const OTHER_ASSIGNEES_ID = "__other_assignees__";
const UNASSIGNED_ID = "__unassigned__";

interface TaskOwner {
  id: string;
  label: string;
  member?: TeamMember;
}

function taskOwners(workspace: DailyWorkspace, otherAssigneesLabel: string, unassignedLabel: string): TaskOwner[] {
  const members = orderedMembers(workspace.members);
  const memberIds = new Set(members.map((member) => member.accountId));
  const owners: TaskOwner[] = members.map((member) => ({
    id: member.accountId,
    label: memberDisplayName(member),
    member,
  }));
  if (workspace.subtasks.some((task) => task.assigneeAccountId && !memberIds.has(task.assigneeAccountId))) {
    owners.push({ id: OTHER_ASSIGNEES_ID, label: otherAssigneesLabel });
  }
  if (workspace.subtasks.some((task) => !task.assigneeAccountId)) {
    owners.push({ id: UNASSIGNED_ID, label: unassignedLabel });
  }
  return owners;
}

function ownerTasks(workspace: DailyWorkspace, ownerId: string | undefined): DailyWorkspace["subtasks"] {
  if (!ownerId) return [];
  if (ownerId === UNASSIGNED_ID) return workspace.subtasks.filter((task) => !task.assigneeAccountId);
  if (ownerId === OTHER_ASSIGNEES_ID) {
    const memberIds = new Set(orderedMembers(workspace.members).map((member) => member.accountId));
    return workspace.subtasks.filter((task) => task.assigneeAccountId && !memberIds.has(task.assigneeAccountId));
  }
  return workspace.subtasks.filter((task) => task.assigneeAccountId === ownerId);
}

function memberStats(subtasks: DailyWorkspace["subtasks"]): { total: number; progress: number; done: number; backlog: number } {
  return subtasks.reduce((stats, subtask) => {
    const tone = dailyStatusTone(subtask.status);
    stats.total += 1;
    if (tone === "progress") stats.progress += 1;
    if (tone === "done") stats.done += 1;
    if (tone === "backlog") stats.backlog += 1;
    return stats;
  }, { total: 0, progress: 0, done: 0, backlog: 0 });
}

function TaskStatusMenu({
  managedProjectId,
  sprintId,
  task,
  onTransition,
  onError,
}: {
  managedProjectId: string;
  sprintId: string;
  task: DailySubtask;
  onTransition: (task: DailySubtask, transition: DailyIssueTransition) => Promise<void>;
  onError: (message?: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transitions, setTransitions] = useState<DailyIssueTransition[]>([]);
  const [performingId, setPerformingId] = useState<string>();

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setLoading(true);
    setTransitions([]);
    onError(undefined);
    try {
      setTransitions(await loadDailyIssueTransitions(managedProjectId, sprintId, task.key));
    } catch (reason) {
      onError(t("daily.transitionsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function selectTransition(transition: DailyIssueTransition) {
    if (transition.requiresFields || performingId) return;
    setPerformingId(transition.id);
    onError(undefined);
    try {
      await onTransition(task, transition);
      setOpen(false);
    } catch (reason) {
      onError(statusActionError(reason, t));
      try {
        setTransitions(await loadDailyIssueTransitions(managedProjectId, sprintId, task.key));
      } catch {
        setTransitions([]);
      }
    } finally {
      setPerformingId(undefined);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => void handleOpenChange(nextOpen)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`daily-status-label daily-status-${dailyStatusTone(task.status)} daily-status-trigger`}
          aria-label={t("daily.changeStatus", { key: task.key, status: task.status })}
          title={t("daily.changeStatus", { key: task.key, status: task.status })}
        >
          {task.status}
          <ChevronDown aria-hidden="true" className="daily-status-chevron" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t("daily.availableTransitions", { key: task.key })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {loading ? (
            <DropdownMenuItem disabled>{t("daily.loadingTransitions")}</DropdownMenuItem>
          ) : transitions.length === 0 ? (
            <DropdownMenuItem disabled>{t("daily.noTransitions")}</DropdownMenuItem>
          ) : transitions.map((transition) => (
            <DropdownMenuItem
              key={transition.id}
              disabled={transition.requiresFields || performingId !== undefined}
              onSelect={() => void selectTransition(transition)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{transition.toStatus}</span>
                {transition.requiresFields ? (
                  <span className="text-xs text-muted-foreground">{t("daily.transitionRequiresFields")}</span>
                ) : transition.name !== transition.toStatus ? (
                  <span className="truncate text-xs text-muted-foreground">{transition.name}</span>
                ) : null}
              </span>
              {performingId === transition.id ? <RefreshCw aria-hidden="true" className="ml-auto animate-spin" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DailyPage() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ManagedProject[]>(() => readManagedProjectsCache() ?? []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => readManagedProjectsCache()?.[0]?.id);
  const [workspace, setWorkspace] = useState<DailyWorkspace>();
  const [selectedMemberId, setSelectedMemberId] = useState<string>();
  const [sprintPickerOpen, setSprintPickerOpen] = useState(false);
  const [sprintQuery, setSprintQuery] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(() => readManagedProjectsCache() == null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [refreshingStatuses, setRefreshingStatuses] = useState(false);
  const [error, setError] = useState<string>();
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [presenterError, setPresenterError] = useState<string>();
  const [taskActionError, setTaskActionError] = useState<string>();
  const [taskActionNotice, setTaskActionNotice] = useState<string>();

  const workspaceRequestRevision = useRef(0);
  const statusRefreshRevision = useRef(0);

  useEffect(() => {
    let active = true;
    setLoadingProjects(readManagedProjectsCache() == null);
    listManagedProjects()
      .then((loaded) => {
        if (!active) return;
        writeManagedProjectsCache(loaded);
        setProjects(loaded);
        setSelectedProjectId((current) =>
          current && loaded.some((project) => project.id === current) ? current : loaded[0]?.id,
        );
      })
      .catch((reason) => {
        if (active) setError(commandError(reason));
      })
      .finally(() => {
        if (active) setLoadingProjects(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshWorkspace = useCallback(async (projectId: string, sprintId?: string) => {
    const revision = workspaceRequestRevision.current + 1;
    workspaceRequestRevision.current = revision;
    statusRefreshRevision.current += 1;
    const cachedWorkspace = readDailyWorkspaceCache(projectId, sprintId);
    setWorkspace(cachedWorkspace);
    setLoadingWorkspace(cachedWorkspace == null);
    setRefreshingStatuses(cachedWorkspace != null);
    setError(undefined);
    try {
      const loaded = await loadDailyWorkspace(projectId, sprintId);
      if (workspaceRequestRevision.current !== revision) return;
      writeDailyWorkspaceCache(loaded);
      setWorkspace(loaded);
    } catch (reason) {
      if (workspaceRequestRevision.current === revision) setError(commandError(reason));
    } finally {
      if (workspaceRequestRevision.current === revision) {
        setLoadingWorkspace(false);
        setRefreshingStatuses(false);
      }
    }
  }, []);

  const refreshStatuses = useCallback(async () => {
    if (!workspace) return;
    const managedProjectId = workspace.managedProjectId;
    const sprintId = workspace.selectedSprintId;
    const revision = statusRefreshRevision.current + 1;
    statusRefreshRevision.current = revision;
    setRefreshingStatuses(true);
    setError(undefined);
    try {
      const subtasks = await refreshDailyWorkspace(managedProjectId, sprintId);
      if (statusRefreshRevision.current !== revision) return;
      if (workspace.managedProjectId === managedProjectId && workspace.selectedSprintId === sprintId) {
        const nextWorkspace = { ...workspace, subtasks };
        writeDailyWorkspaceCache(nextWorkspace);
        setWorkspace(nextWorkspace);
      }
    } catch (reason) {
      if (statusRefreshRevision.current === revision) setError(commandError(reason));
    } finally {
      if (statusRefreshRevision.current === revision) setRefreshingStatuses(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (!selectedProjectId) {
      workspaceRequestRevision.current += 1;
      statusRefreshRevision.current += 1;
      setWorkspace(undefined);
      setSelectedMemberId(undefined);
      setLoadingWorkspace(false);
      setRefreshingStatuses(false);
      return undefined;
    }
    setSelectedMemberId(undefined);
    void refreshWorkspace(selectedProjectId);
    return undefined;
  }, [refreshWorkspace, selectedProjectId]);

  const owners = useMemo(
    () => workspace ? taskOwners(workspace, t("daily.otherAssignees"), t("daily.unassigned")) : [],
    [t, workspace],
  );
  useEffect(() => {
    setSelectedMemberId((current) =>
      owners.some((owner) => owner.id === current) ? current : owners[0]?.id,
    );
  }, [owners]);
  const selectedOwner = owners.find((owner) => owner.id === selectedMemberId);
  const selectedMember = selectedOwner?.member;
  const selectedOwnerIndex = selectedOwner ? owners.findIndex((owner) => owner.id === selectedOwner.id) : -1;
  const selectedSubtasks = useMemo(
    () => workspace ? ownerTasks(workspace, selectedMemberId) : [],
    [selectedMemberId, workspace],
  );
  const selectedMemberSummary = memberStats(selectedSubtasks);

  function selectAdjacentMember(offset: number) {
    if (selectedOwnerIndex < 0 || owners.length === 0) return;
    const nextIndex = (selectedOwnerIndex + offset + owners.length) % owners.length;
    setSelectedMemberId(owners[nextIndex]?.id);
  }

  async function handleTaskTransition(task: DailySubtask, transition: DailyIssueTransition) {
    if (!workspace) return;
    const managedProjectId = workspace.managedProjectId;
    const sprintId = workspace.selectedSprintId;
    await transitionDailyIssue(
      managedProjectId,
      sprintId,
      task.key,
      transition.id,
      crypto.randomUUID(),
    );
    setTaskActionError(undefined);
    setTaskActionNotice(t("daily.statusChanged", { key: task.key, status: transition.toStatus }));
    try {
      const subtasks = await refreshDailyWorkspace(managedProjectId, sprintId);
      statusRefreshRevision.current += 1;
      setWorkspace((current) => {
        if (!current || current.managedProjectId !== managedProjectId || current.selectedSprintId !== sprintId) return current;
        const nextWorkspace = { ...current, subtasks };
        writeDailyWorkspaceCache(nextWorkspace);
        return nextWorkspace;
      });
    } catch {
      setTaskActionError(t("daily.statusRefreshFailed"));
    }
  }

  useEffect(() => {
    if (!workspace || !selectedMember || !selectedMemberId) return;
    void publishPresenterState({ workspace, selectedMemberId });
  }, [selectedMember, selectedMemberId, workspace]);

  useEffect(() => {
    const managedProjectId = workspace?.managedProjectId;
    if (!managedProjectId) return undefined;
    return subscribePresenterState((nextState) => {
      if (nextState.workspace.managedProjectId !== managedProjectId) return;
      setSelectedMemberId(nextState.selectedMemberId);
      setWorkspace((current) => current && current.managedProjectId === managedProjectId
        ? { ...current, members: nextState.workspace.members, subtasks: nextState.workspace.subtasks }
        : current);
    });
  }, [workspace?.managedProjectId]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen("daily-presenter-closed", () => {
      if (active) setPresenterOpen(false);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  async function togglePresenter() {
    if (presenterOpen) {
      await closePresenterView();
      setPresenterOpen(false);
      return;
    }
    if (!workspace || !selectedMember || !selectedMemberId) return;
    setPresenterError(undefined);
    try {
      await publishPresenterState({ workspace, selectedMemberId });
      await openPresenterView();
      setPresenterOpen(true);
    } catch (reason) {
      setPresenterError(commandError(reason));
    }
  }

  async function openJiraIssue(url: string) {
    setTaskActionError(undefined);
    setTaskActionNotice(undefined);
    try {
      await openUrl(url);
    } catch (reason) {
      setTaskActionError(commandError(reason));
    }
  }

  async function copyTaskValue(value: string, notice: string) {
    setTaskActionError(undefined);
    setTaskActionNotice(undefined);
    try {
      if (!navigator.clipboard) throw new Error(t("daily.clipboardUnavailable"));
      await navigator.clipboard.writeText(value);
      setTaskActionNotice(notice);
    } catch (reason) {
      setTaskActionError(commandError(reason));
    }
  }

  const filteredSprints = workspace?.sprints.filter((sprint) =>
    sprint.name.toLocaleLowerCase().includes(sprintQuery.trim().toLocaleLowerCase()),
  ) ?? [];
  const selectedSprint = workspace?.sprints.find((sprint) => sprint.id === workspace.selectedSprintId);

  return (
    <section aria-labelledby="daily-title" className="space-y-4">
      <PageHeader
        className="daily-page-header"
        title={t("page.sprintTasks")}
        titleId="daily-title"
        description={t("daily.description")}
      />

      <div className="flex flex-wrap items-center gap-2">
        {!loadingProjects && projects.length > 0 ? (
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger id="daily-team-select" aria-label={t("daily.team")}>
              <SelectValue placeholder={t("daily.selectTeam")} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {workspace ? (
          <Popover open={sprintPickerOpen} onOpenChange={(open) => {
            setSprintPickerOpen(open);
            if (!open) setSprintQuery("");
          }}>
            <PopoverTrigger asChild>
              <Button
                id="sprint-tasks-sprint-select"
                type="button"
                variant="outline"
                role="combobox"
                aria-label={t("daily.sprint")}
                aria-expanded={sprintPickerOpen}
                disabled={loadingWorkspace}
                className="h-10 min-w-40 justify-between gap-3 px-3 font-normal"
              >
                <span className="truncate">{selectedSprint?.name ?? t("daily.selectSprint")}</span>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-2">
              <Input
                type="search"
                aria-label={t("daily.searchSprints")}
                placeholder={t("daily.searchSprints")}
                value={sprintQuery}
                onChange={(event) => setSprintQuery(event.target.value)}
                className="mb-2 h-9"
              />
              <div role="listbox" aria-label={t("daily.sprint")} className="max-h-[min(18rem,calc(100vh-10rem))] overflow-y-auto">
                {filteredSprints.length > 0 ? (
                  filteredSprints.map((sprint) => {
                      const state = sprint.state === "active"
                        ? t("daily.sprintState.active")
                        : sprint.state === "closed"
                          ? t("daily.sprintState.closed")
                          : sprint.state === "future"
                            ? t("daily.sprintState.future")
                            : sprint.state;
                      return (
                        <button
                          key={sprint.id}
                          type="button"
                          role="option"
                          aria-selected={sprint.id === workspace.selectedSprintId}
                          className="flex w-full cursor-pointer items-center rounded-sm px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                          onClick={() => {
                            setSprintPickerOpen(false);
                            if (selectedProjectId) void refreshWorkspace(selectedProjectId, sprint.id);
                          }}
                        >
                          {sprint.name} ({state})
                        </button>
                      );
                    })
                ) : (
                  <p className="px-3 py-2 text-sm text-muted-foreground">{t("daily.noSprintsFound")}</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("daily.openSprintBoard")}
            title={t("daily.openSprintBoard")}
            disabled={!workspace || loadingWorkspace}
            onClick={() => {
              if (workspace) void openJiraIssue(
                (selectedMember && workspace.sprintBoardUrlsByAssignee?.[selectedMember.accountId]) || workspace.sprintBoardUrl,
              );
            }}
          >
            <ExternalLink aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant={presenterOpen ? "secondary" : "default"}
            size="icon"
            className="h-9 w-9"
            disabled={!workspace || loadingWorkspace || (!presenterOpen && !selectedMember)}
            aria-pressed={presenterOpen}
            aria-label={presenterOpen ? t("daily.presenter.stop") : t("daily.presenter.start")}
            title={presenterOpen ? t("daily.presenter.stop") : t("daily.presenter.start")}
            onClick={() => void togglePresenter()}
          >
            {presenterOpen ? <Square aria-hidden="true" /> : <Presentation aria-hidden="true" />}
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={refreshingStatuses ? t("daily.refreshing") : t("daily.refresh")}
            title={refreshingStatuses ? t("daily.refreshing") : t("daily.refresh")}
            disabled={!selectedProjectId || loadingWorkspace || refreshingStatuses}
            onClick={() => {
              if (workspace) void refreshStatuses();
              else if (selectedProjectId) void refreshWorkspace(selectedProjectId);
            }}
          >
            <RefreshCw aria-hidden="true" className={loadingWorkspace || refreshingStatuses ? "animate-spin" : undefined} />
          </Button>
          <Button
            type="button"
            size="icon"
            actionTone="add"
            className="h-9 w-9"
            aria-label={t("daily.createTask")}
            title={t("daily.createTask")}
            disabled={!selectedProjectId || !workspace}
            onClick={() => {
              if (!selectedProjectId || !workspace) return;
              window.location.hash = `#product/create-task?team=${encodeURIComponent(selectedProjectId)}&sprint=${encodeURIComponent(workspace.selectedSprintId)}`;
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>

      {presenterError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("daily.presenter.unavailable")}</AlertTitle>
          <AlertDescription>{presenterError}</AlertDescription>
        </Alert>
      ) : null}
      {taskActionError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("daily.taskActionUnavailable")}</AlertTitle>
          <AlertDescription>{taskActionError}</AlertDescription>
        </Alert>
      ) : null}
      <StatusToast message={taskActionNotice} onDismiss={() => setTaskActionNotice(undefined)} />

      {loadingProjects ? <div role="status" aria-label={t("daily.loadingTeams")}>{t("daily.loadingTeams")}</div> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("daily.unavailable")}</AlertTitle>
          <AlertDescription>{t("daily.loadError", { error })}</AlertDescription>
        </Alert>
      ) : null}
      {!loadingProjects && !error && projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6"><p>{t("daily.configureTeam")}</p></CardContent>
        </Card>
      ) : null}

      {loadingWorkspace ? (
        <Card role="status" aria-label={t("daily.loadingTasks")} className="overflow-hidden">
          <CardContent className="flex items-center gap-4 py-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <RefreshCw className="size-6 animate-spin" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("daily.loadingTasks")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("daily.loadingTasksDescription")}</p>
              <div className="mt-4 grid gap-2" aria-hidden="true">
                <span className="h-2 w-3/4 animate-pulse rounded bg-muted" />
                <span className="h-2 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {workspace && !loadingWorkspace ? (
        <div className="daily-workspace-layout">
          <Card className="daily-members-card">
            <CardHeader className="daily-panel-header">
              <CardTitle className="text-[15px]">{t("daily.assignees")}</CardTitle>
            </CardHeader>
            <CardContent className="daily-members-content">
              {owners.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("daily.noSprintTasks")}</p>
              ) : (
                <div className="daily-member-list">
                  {owners.map((owner) => {
                    const taskCount = ownerTasks(workspace, owner.id).length;
                    const selected = selectedMemberId === owner.id;
                    return (
                      <button
                        key={owner.id}
                        type="button"
                        aria-pressed={selected}
                        className={`daily-member-item${selected ? " daily-member-item-selected" : ""}`}
                        onClick={() => setSelectedMemberId(owner.id)}
                      >
                        {owner.member ? (
                          <MemberAvatar member={owner.member} className="h-8 w-8 shrink-0" managedProjectId={workspace.managedProjectId} />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium" aria-hidden="true">
                            {owner.id === UNASSIGNED_ID ? "—" : "+"}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">{owner.label}</span>
                        <span className="daily-member-task-count">{taskCount}</span>
                        <ArrowRight aria-hidden="true" className="daily-member-arrow" />
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <section className="daily-tasks-column" aria-label={t("daily.selectedTasks")}>
            {selectedOwner ? (
              <Card className="daily-selected-member-card">
                <CardHeader className="daily-selected-member-header">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedMember ? <MemberAvatar member={selectedMember} className="h-9 w-9 shrink-0" managedProjectId={workspace.managedProjectId} /> : null}
                    <div className="min-w-0">
                      <CardTitle className="truncate text-[17px] font-medium">{selectedOwner.label}</CardTitle>
                      <CardDescription>
                        {t("daily.summary", selectedMemberSummary)}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9"
                      aria-label={t("daily.previousMember")}
                      disabled={owners.length < 2}
                      onClick={() => selectAdjacentMember(-1)}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9"
                      aria-label={t("daily.nextMember")}
                      disabled={owners.length < 2}
                      onClick={() => selectAdjacentMember(1)}
                    >
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="daily-task-content">
                  <h2 id="daily-subtasks-title" className="daily-task-section-title">{t("daily.tasks")}</h2>
                  {selectedSubtasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("daily.noAssigneeTasks")}</p>
                  ) : (
                    <div className="daily-task-list" aria-live="polite">
                      {selectedSubtasks.map((subtask) => (
                        <article key={subtask.id} className="daily-task-row">
                          <button
                            type="button"
                            className="daily-task-key daily-task-link"
                            title={t("daily.openInJira")}
                            onClick={() => void openJiraIssue(subtask.url)}
                          >
                            {subtask.key}
                          </button>
                          <span className="daily-task-summary">
                            <strong>{subtask.summary}</strong>
                            <small>
                              {subtask.issueType}
                              {subtask.parentIssueKey ? ` · ${t("daily.parent", { key: subtask.parentIssueKey })}` : ""}
                              {selectedOwner.id === OTHER_ASSIGNEES_ID && subtask.assigneeDisplayName ? ` · ${subtask.assigneeDisplayName}` : ""}
                            </small>
                          </span>
                          <span className="daily-task-points">SP {subtask.storyPoints ?? "—"}</span>
                          <TaskStatusMenu
                            managedProjectId={workspace.managedProjectId}
                            sprintId={workspace.selectedSprintId}
                            task={subtask}
                            onTransition={handleTaskTransition}
                            onError={setTaskActionError}
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="daily-task-menu size-8" aria-label={t("daily.actions", { key: subtask.key })}>
                                <MoreHorizontal aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuLabel>{subtask.key}</DropdownMenuLabel>
                              <DropdownMenuSeparator className="mx-2 my-1 w-auto bg-border" />
                              <DropdownMenuItem onSelect={() => void openJiraIssue(subtask.url)}>
                                <ExternalLink aria-hidden="true" />
                                {t("daily.openInJira")}
                              </DropdownMenuItem>
                              {subtask.parentUrl && subtask.parentIssueKey ? (
                                <DropdownMenuItem
                                  className="items-start"
                                  aria-label={t("daily.openParentInJira", { key: subtask.parentIssueKey })}
                                  onSelect={() => void openJiraIssue(subtask.parentUrl!)}
                                >
                                  <ExternalLink aria-hidden="true" className="mt-0.5" />
                                  <span className="flex min-w-0 flex-col">
                                    <span>{t("daily.openParent")}</span>
                                    <span className="truncate text-xs text-muted-foreground">{subtask.parentIssueKey}</span>
                                  </span>
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator className="mx-2 my-1.5 w-auto bg-border" />
                              <DropdownMenuItem onSelect={() => void copyTaskValue(subtask.key, t("daily.keyCopied", { key: subtask.key }))}>
                                <Copy aria-hidden="true" />
                                {t("daily.copyKey")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void copyTaskValue(subtask.url, t("daily.linkCopied", { key: subtask.key }))}>
                                <Copy aria-hidden="true" />
                                {t("daily.copyLink")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </article>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="pt-6"><p>{t("daily.selectMember")}</p></CardContent></Card>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
