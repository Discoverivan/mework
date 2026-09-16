import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DailyPresenterState, DailySubtask } from "@/shared/contracts/developer";
import type { TeamMember } from "@/shared/contracts/planning";
import {
  closePresenterView,
  loadJiraAvatarData,
  publishPresenterState,
  readNativePresenterState,
  readPresenterState,
  refreshDailyWorkspace,
  subscribePresenterState,
} from "./api";
import { dailyStatusTone } from "./status";
import { dailyProgressMetrics, formatStatusTransitionDate } from "./presenterMetrics";
import "./presenter.css";

type DailySubtaskWithPoints = DailySubtask;

function initials(displayName: string): string {
  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

function memberDisplayName(member: TeamMember): string {
  return member.alias?.trim() || member.displayName;
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

function formatDate(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function MemberAvatar({ member, managedProjectId }: { member: TeamMember; managedProjectId: string }) {
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
  return source ? (
    <img className="daily-presenter-avatar daily-presenter-avatar-large" src={source} alt="" onError={() => setSource(undefined)} />
  ) : (
    <span className="daily-presenter-avatar daily-presenter-avatar-large daily-presenter-avatar-fallback" aria-hidden="true">
      {initials(member.displayName)}
    </span>
  );
}

function taskTitleFontSize(summary: string, taskCount: number): number {
  const length = summary.trim().length;
  let size = length > 260 ? 14 : length > 180 ? 16 : length > 120 ? 18 : 21;
  if (taskCount >= 13) size -= 2;
  else if (taskCount >= 9) size -= 1;
  return Math.max(12, size);
}

function TaskCard({ task, taskCount }: { task: DailySubtaskWithPoints; taskCount: number }) {
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [fontSize, setFontSize] = useState(() => taskTitleFontSize(task.summary, taskCount));

  useLayoutEffect(() => {
    const card = cardRef.current;
    const title = titleRef.current;
    if (!card || !title) return undefined;

    const fitTitle = () => {
      if (title.clientHeight <= 0) return;
      let nextSize = taskTitleFontSize(task.summary, taskCount);
      title.style.fontSize = `${nextSize}px`;
      while (title.scrollHeight > title.clientHeight && nextSize > 12) {
        nextSize -= 1;
        title.style.fontSize = `${nextSize}px`;
      }
      setFontSize((current) => current === nextSize ? current : nextSize);
    };

    fitTitle();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fitTitle);
    observer.observe(card);
    return () => observer.disconnect();
  }, [task.summary, taskCount]);

  const statusTransitionDate = formatStatusTransitionDate(task.statusTransitionAt);

  return (
    <article ref={cardRef} className="daily-presenter-task-card">
      <div className="daily-presenter-task-meta">
        <span className="daily-presenter-ticket-id">{task.key}</span>
        <div className="daily-presenter-status-stack">
          <span className={`daily-presenter-status daily-presenter-status-${dailyStatusTone(task.status)}`} aria-label={`Status: ${task.status}`}>
            {task.status}
          </span>
          {statusTransitionDate ? (
            <time className="daily-presenter-status-date" dateTime={task.statusTransitionAt}>
              {statusTransitionDate}
            </time>
          ) : null}
        </div>
      </div>
      <h2 ref={titleRef} style={{ fontSize: `${fontSize}px` }}>{task.summary}</h2>
      <div className="daily-presenter-task-footer">
        <span className="daily-presenter-points" aria-label={`${task.storyPoints ?? 0} story points`}>
          {task.storyPoints ?? 0} SP
        </span>
      </div>
    </article>
  );
}

export function PresenterView() {
  const [state, setState] = useState<DailyPresenterState | undefined>(() => readPresenterState());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const unsubscribeRendererState = subscribePresenterState((nextState) => {
      if (active) setState(nextState);
    });
    const refreshNativeState = async () => {
      try {
        const nextState = await readNativePresenterState();
        if (active && nextState) setState(nextState);
      } catch {
        // The renderer state remains available while the native command is unavailable.
      }
    };
    void refreshNativeState();
    const nativeStatePoll = window.setInterval(() => void refreshNativeState(), 500);
    void listen<DailyPresenterState>("daily-presenter-update", (event) => {
      if (active) setState(event.payload);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      window.clearInterval(nativeStatePoll);
      unsubscribeRendererState();
      unlisten?.();
    };
  }, []);

  const refreshWorkspace = async () => {
    const managedProjectId = state?.workspace.managedProjectId;
    if (!managedProjectId) return;
    setRefreshing(true);
    try {
      const subtasks = await refreshDailyWorkspace(managedProjectId, state?.workspace.activeSprintId ?? "");
      setState((current) => current
        ? { ...current, workspace: { ...current.workspace, subtasks } }
        : current);
    } finally {
      setRefreshing(false);
    }
  };

  async function stopPresenter() {
    await closePresenterView().catch(() => undefined);
  }

  function selectAdjacentMember(offset: number) {
    if (!state || memberIndex < 0 || activeMembers.length < 2) return;
    const nextIndex = (memberIndex + offset + activeMembers.length) % activeMembers.length;
    const nextMember = activeMembers[nextIndex];
    if (!nextMember) return;
    const nextState = { ...state, selectedMemberId: nextMember.accountId };
    setState(nextState);
    void publishPresenterState(nextState);
  }

  const workspace = state?.workspace;
  const activeMembers = useMemo(() => orderedMembers(workspace?.members ?? []), [workspace]);
  const member = activeMembers.find((candidate) => candidate.accountId === state?.selectedMemberId);
  const memberIndex = member ? activeMembers.findIndex((candidate) => candidate.accountId === member.accountId) : -1;
  const tasks = workspace?.subtasks.filter((task) => task.assigneeAccountId === state?.selectedMemberId) ?? [];
  const progressMetrics = useMemo(() => dailyProgressMetrics(tasks), [tasks]);

  return (
    <main className="daily-presenter-view" aria-label="Daily meeting presenter view">
      <header className="daily-presenter-header" data-tauri-drag-region>
        <div className="daily-presenter-brand">
          <span className="daily-presenter-live-dot" aria-hidden="true" />
          <span>Daily</span>
        </div>
        <div className="daily-presenter-project">{workspace?.projectName ?? "Daily meeting"}</div>
        <div className="daily-presenter-header-actions">
          <div className="daily-presenter-date">{formatDate()}</div>
          <Button type="button" variant="ghost" className="daily-presenter-refresh" onClick={() => void refreshWorkspace()} disabled={!workspace || refreshing}>
            <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
            Refresh
          </Button>
          <Button type="button" variant="ghost" className="daily-presenter-close" onClick={() => void stopPresenter()}>
            Stop
          </Button>
        </div>
      </header>

      <section className="daily-presenter-content">
        {workspace && member ? (
          <>
            <div className="daily-presenter-member-heading">
              <div className="daily-presenter-member-identity">
                <MemberAvatar member={member} managedProjectId={workspace.managedProjectId} />
                <div className="daily-presenter-member-copy">
                  <h1>{memberDisplayName(member)}</h1>
                  <div
                    className="daily-presenter-progress"
                    aria-label={`Story point progress: ${progressMetrics.completedPoints} closed, ${progressMetrics.inProgressPoints} in progress, ${progressMetrics.backlogPoints} in backlog`}
                  >
                    <div className="daily-presenter-progress-label">
                      <span>Story point progress</span>
                      <strong>{progressMetrics.totalPoints} SP total</strong>
                    </div>
                    <div className="daily-presenter-progress-layout">
                      <div
                        className="daily-presenter-progress-track"
                        role="img"
                        aria-label={`${progressMetrics.completedPercent}% closed, ${progressMetrics.inProgressPercent}% in progress, ${progressMetrics.backlogPercent}% in backlog`}
                      >
                        <span
                          className="daily-presenter-progress-segment daily-presenter-progress-segment-closed"
                          style={{ width: `${progressMetrics.completedPercent}%` }}
                        />
                        <span
                          className="daily-presenter-progress-segment daily-presenter-progress-segment-progress"
                          style={{ width: `${progressMetrics.inProgressPercent}%` }}
                        />
                        <span
                          className="daily-presenter-progress-segment daily-presenter-progress-segment-backlog"
                          style={{ width: `${progressMetrics.backlogPercent}%` }}
                        />
                      </div>
                      <div className="daily-presenter-progress-badges" aria-label="Story point totals by status">
                        <span className="daily-presenter-progress-badge daily-presenter-progress-badge-closed">
                          <span>Closed</span>
                          <strong>{progressMetrics.completedPoints} SP</strong>
                        </span>
                        <span className="daily-presenter-progress-badge daily-presenter-progress-badge-progress">
                          <span>In progress</span>
                          <strong>{progressMetrics.inProgressPoints} SP</strong>
                        </span>
                        <span className="daily-presenter-progress-badge daily-presenter-progress-badge-backlog">
                          <span>In backlog</span>
                          <strong>{progressMetrics.backlogPoints} SP</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="daily-presenter-member-navigation" aria-label="Team member navigation">
                <Button
                  type="button"
                  variant="ghost"
                  className="daily-presenter-member-nav-button"
                  aria-label="Previous team member"
                  disabled={activeMembers.length < 2}
                  onClick={() => selectAdjacentMember(-1)}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="daily-presenter-member-nav-button"
                  aria-label="Next team member"
                  disabled={activeMembers.length < 2}
                  onClick={() => selectAdjacentMember(1)}
                >
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </div>
            {tasks.length > 0 ? (
              <div className={`daily-presenter-task-grid daily-presenter-task-grid-${Math.min(tasks.length, 9)}`}>
                {tasks.map((task) => <TaskCard key={task.id} task={task} taskCount={tasks.length} />)}
              </div>
            ) : (
              <div className="daily-presenter-empty-state">
                <span className="daily-presenter-empty-mark" aria-hidden="true">✓</span>
                <h2>No assigned work</h2>
                <p>This person has no assigned work in the active sprint.</p>
              </div>
            )}
          </>
        ) : (
          <div className="daily-presenter-empty-state daily-presenter-waiting-state">
            <span className="daily-presenter-empty-mark" aria-hidden="true">✦</span>
            <h1>Choose a team member</h1>
            <p>Select a person in Daily to start presenting their work.</p>
          </div>
        )}
      </section>
    </main>
  );
}
