import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, MoreHorizontal, Plus, Presentation, RefreshCw, Square } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/i18n/context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
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
import type { DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject, TeamMember } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { closePresenterView, loadDailyWorkspace, loadJiraAvatarData, openPresenterView, publishPresenterState, refreshDailyWorkspace, subscribePresenterState } from "./api";
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

export function DailyPage() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [workspace, setWorkspace] = useState<DailyWorkspace>();
  const [selectedMemberId, setSelectedMemberId] = useState<string>();
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [refreshingStatuses, setRefreshingStatuses] = useState(false);
  const [error, setError] = useState<string>();
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [presenterError, setPresenterError] = useState<string>();
  const [taskActionError, setTaskActionError] = useState<string>();
  const [taskActionNotice, setTaskActionNotice] = useState<string>();

  useEffect(() => {
    if (!taskActionNotice) return;
    const timeoutId = window.setTimeout(() => setTaskActionNotice(undefined), 2_400);
    return () => window.clearTimeout(timeoutId);
  }, [taskActionNotice]);
  const workspaceRequestRevision = useRef(0);
  const statusRefreshRevision = useRef(0);

  useEffect(() => {
    let active = true;
    listManagedProjects()
      .then((loaded) => {
        if (!active) return;
        setProjects(loaded);
        setSelectedProjectId((current) => current ?? loaded[0]?.id);
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
    setLoadingWorkspace(true);
    setRefreshingStatuses(false);
    setError(undefined);
    try {
      const loaded = await loadDailyWorkspace(projectId, sprintId);
      if (workspaceRequestRevision.current !== revision) return;
      setWorkspace(loaded);
    } catch (reason) {
      if (workspaceRequestRevision.current === revision) setError(commandError(reason));
    } finally {
      if (workspaceRequestRevision.current === revision) setLoadingWorkspace(false);
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
      setWorkspace((current) =>
        current?.managedProjectId === managedProjectId && current.selectedSprintId === sprintId
          ? { ...current, subtasks }
          : current,
      );
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
    setWorkspace(undefined);
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
            <SelectTrigger id="daily-team-select" aria-label={t("daily.team")} className="w-48">
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
          <Select
            value={workspace.selectedSprintId}
            onValueChange={(sprintId) => {
              if (selectedProjectId) void refreshWorkspace(selectedProjectId, sprintId);
            }}
          >
            <SelectTrigger id="sprint-tasks-sprint-select" aria-label={t("daily.sprint")} className="w-56" disabled={loadingWorkspace}>
              <SelectValue placeholder={t("daily.selectSprint")} />
            </SelectTrigger>
            <SelectContent>
              {workspace.sprints.map((sprint) => (
                <SelectItem key={sprint.id} value={sprint.id}>
                  {sprint.name} ({sprint.state === "active"
                    ? t("daily.sprintState.active")
                    : sprint.state === "closed"
                      ? t("daily.sprintState.closed")
                      : sprint.state === "future"
                        ? t("daily.sprintState.future")
                        : sprint.state})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
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
      {taskActionNotice ? (
        <div
          className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
          role="status"
          aria-live="polite"
        >
          <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span>{taskActionNotice}</span>
        </div>
      ) : null}

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

      {loadingWorkspace ? <div role="status" aria-label={t("daily.loadingTasks")}>{t("daily.loadingTasks")}</div> : null}
      {workspace && !loadingWorkspace ? (
        <div className="daily-workspace-layout">
          <Card className="daily-members-card">
            <CardHeader className="daily-panel-header">
              <CardTitle className="text-sm uppercase tracking-wide">{t("daily.assignees")}</CardTitle>
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
                    {selectedMember ? <MemberAvatar member={selectedMember} className="h-10 w-10 shrink-0" managedProjectId={workspace.managedProjectId} /> : null}
                    <div className="min-w-0">
                      <CardTitle className="truncate text-xl">{selectedOwner.label}</CardTitle>
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
                          <span className={`daily-status-label daily-status-${dailyStatusTone(subtask.status)}`} aria-label={t("daily.status", { status: subtask.status })}>
                            {subtask.status}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="daily-task-menu" aria-label={t("daily.actions", { key: subtask.key })}>
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
