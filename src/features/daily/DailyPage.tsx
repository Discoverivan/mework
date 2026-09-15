import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, MoreHorizontal, Play, RefreshCw, Square } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  const refreshWorkspace = useCallback(async (projectId: string) => {
    setLoadingWorkspace(true);
    setError(undefined);
    try {
      const loaded = await loadDailyWorkspace(projectId);
      setWorkspace(loaded);
      setSelectedMemberId((current) =>
        loaded.members.some((member) => member.accountId === current)
          ? current
          : orderedMembers(loaded.members)[0]?.accountId,
      );
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  const refreshStatuses = useCallback(async () => {
    if (!workspace) return;
    setRefreshingStatuses(true);
    setError(undefined);
    try {
      const subtasks = await refreshDailyWorkspace(workspace.managedProjectId, workspace.activeSprintId);
      setWorkspace((current) => current ? { ...current, subtasks } : current);
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setRefreshingStatuses(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (!selectedProjectId) {
      setWorkspace(undefined);
      setSelectedMemberId(undefined);
      return undefined;
    }
    setWorkspace(undefined);
    setSelectedMemberId(undefined);
    void refreshWorkspace(selectedProjectId);
    return undefined;
  }, [refreshWorkspace, selectedProjectId]);

  const activeMembers = useMemo(() => orderedMembers(workspace?.members ?? []), [workspace]);
  const selectedMember = activeMembers.find((member) => member.accountId === selectedMemberId);
  const selectedMemberIndex = selectedMember ? activeMembers.findIndex((member) => member.accountId === selectedMember.accountId) : -1;
  const selectedSubtasks = useMemo(
    () => workspace?.subtasks.filter((subtask) => subtask.assigneeAccountId === selectedMemberId) ?? [],
    [selectedMemberId, workspace],
  );
  const selectedMemberSummary = memberStats(selectedSubtasks);

  function selectAdjacentMember(offset: number) {
    if (selectedMemberIndex < 0 || activeMembers.length === 0) return;
    const nextIndex = (selectedMemberIndex + offset + activeMembers.length) % activeMembers.length;
    setSelectedMemberId(activeMembers[nextIndex]?.accountId);
  }

  useEffect(() => {
    if (!workspace || !selectedMemberId) return;
    void publishPresenterState({ workspace, selectedMemberId });
  }, [selectedMemberId, workspace]);

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
    if (!workspace || !selectedMemberId) return;
    setPresenterError(undefined);
    try {
      await publishPresenterState({ workspace, selectedMemberId });
      await openPresenterView();
      setPresenterOpen(true);
    } catch (reason) {
      setPresenterError(commandError(reason));
    }
  }

  return (
    <section aria-labelledby="daily-title" className="space-y-4">
      <PageHeader
        className="daily-page-header"
        title="Daily"
        titleId="daily-title"
        description="Review today's assigned sub-tasks by team member."
        actions={(
          <>
            {!loadingProjects && projects.length > 0 ? (
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger id="daily-team-select" aria-label="Team" className="w-48">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedProjectId || loadingWorkspace || refreshingStatuses}
              onClick={() => {
                if (workspace) void refreshStatuses();
                else if (selectedProjectId) void refreshWorkspace(selectedProjectId);
              }}
            >
              <RefreshCw aria-hidden="true" className={loadingWorkspace || refreshingStatuses ? "animate-spin" : undefined} />
              {refreshingStatuses ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              type="button"
              variant={presenterOpen ? "secondary" : "default"}
              size="sm"
              disabled={!workspace || !selectedMemberId || loadingWorkspace}
              aria-pressed={presenterOpen}
              onClick={() => void togglePresenter()}
            >
              {presenterOpen ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
              {presenterOpen ? "Stop presenter view" : "Presenter view"}
            </Button>
          </>
        )}
      />

      {presenterError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Presenter view unavailable</AlertTitle>
          <AlertDescription>{presenterError}</AlertDescription>
        </Alert>
      ) : null}

      {loadingProjects ? <div role="status" aria-label="Loading teams">Loading teams…</div> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Daily unavailable</AlertTitle>
          <AlertDescription>Unable to load Daily. {error}</AlertDescription>
        </Alert>
      ) : null}
      {!loadingProjects && !error && projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6"><p>Configure a managed Jira team and its members in Team settings first.</p></CardContent>
        </Card>
      ) : null}

      {loadingWorkspace ? <div role="status" aria-label="Loading daily workspace">Loading Daily workspace…</div> : null}
      {workspace && !loadingWorkspace ? (
        <div className="daily-workspace-layout">
          <Card className="daily-members-card">
            <CardHeader className="daily-panel-header">
              <CardTitle className="text-sm uppercase tracking-wide">Team</CardTitle>
            </CardHeader>
            <CardContent className="daily-members-content">
              {activeMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active team members are configured for this project.</p>
              ) : (
                <div className="daily-member-list">
                  {activeMembers.map((member) => {
                    const taskCount = workspace.subtasks.filter((subtask) => subtask.assigneeAccountId === member.accountId).length;
                    const selected = selectedMemberId === member.accountId;
                    return (
                      <button
                        key={member.accountId}
                        type="button"
                        aria-pressed={selected}
                        className={`daily-member-item${selected ? " daily-member-item-selected" : ""}`}
                        onClick={() => setSelectedMemberId(member.accountId)}
                      >
                        <MemberAvatar member={member} className="h-8 w-8 shrink-0" managedProjectId={workspace.managedProjectId} />
                        <span className="min-w-0 flex-1 truncate font-medium">{memberDisplayName(member)}</span>
                        <span className="daily-member-task-count">{taskCount}</span>
                        <ArrowRight aria-hidden="true" className="daily-member-arrow" />
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <section className="daily-tasks-column" aria-label="Selected member tasks">
            {selectedMember ? (
              <Card className="daily-selected-member-card">
                <CardHeader className="daily-selected-member-header">
                  <div className="flex min-w-0 items-center gap-3">
                    <MemberAvatar member={selectedMember} className="h-10 w-10 shrink-0" managedProjectId={workspace.managedProjectId} />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-xl">{memberDisplayName(selectedMember)}</CardTitle>
                      <CardDescription>
                        {selectedMemberSummary.total} tasks · {selectedMemberSummary.progress} in progress · {selectedMemberSummary.done} done · {selectedMemberSummary.backlog} backlog
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Previous team member"
                      disabled={activeMembers.length < 2}
                      onClick={() => selectAdjacentMember(-1)}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Next team member"
                      disabled={activeMembers.length < 2}
                      onClick={() => selectAdjacentMember(1)}
                    >
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="daily-task-content">
                  <h2 id="daily-subtasks-title" className="daily-task-section-title">Tasks</h2>
                  {selectedSubtasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No assigned sub-tasks in the active sprint.</p>
                  ) : (
                    <div className="daily-task-list" aria-live="polite">
                      {selectedSubtasks.map((subtask) => (
                        <article key={subtask.id} className="daily-task-row">
                          <span className="daily-task-key">{subtask.key}</span>
                          <span className="daily-task-summary">{subtask.summary}</span>
                          <span className="daily-task-points">SP {subtask.storyPoints ?? "—"}</span>
                          <span className={`daily-status-label daily-status-${dailyStatusTone(subtask.status)}`} aria-label={`Status: ${subtask.status}`}>
                            {subtask.status}
                          </span>
                          <Button type="button" variant="ghost" size="icon" className="daily-task-menu" aria-label={`Actions for ${subtask.key}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </article>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="pt-6"><p>Select a team member to see assigned tasks.</p></CardContent></Card>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
