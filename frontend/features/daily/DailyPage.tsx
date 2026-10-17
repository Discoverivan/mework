import { Hint } from "@/components/ui/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { readUpdatedTeamMembers } from "../planning/team-members-state";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, CalendarDays, ChartColumnIncreasing, ChevronDown, CircleCheck, CircleGauge, CirclePlus, Copy, ExternalLink, List, ListTodo, MoreHorizontal, Presentation, RefreshCw, Sparkles, Square, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusToast } from "@/components/shared/StatusToast";
import { useInfoPopoverAnchor } from "@/components/shared/use-info-popover-anchor";
import { formatDisplayDate } from "@/lib/display-date";
import { formatAiError } from "@/lib/ai-error";
import { useI18n } from "@/i18n/context";
import { AppLanguage } from "@/i18n/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { enGB, ru } from "react-day-picker/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { directPointerMoveHover } from "@/lib/direct-pointer-hover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DailyIssueTransition, DailySprintStats, DailySubtask, DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject, TeamMember } from "@/shared/contracts/planning";
import { closePresenterView, generateSprintSummary, loadDailyIssueTransitions, loadJiraAvatarData, openPresenterView, publishPresenterState, refreshDailyWorkspace, subscribePresenterState, transitionDailyIssue } from "./api";
import { loadMyTasks, loadSprintStats, loadTeamWorkspace, readManagedProjectsCache, readMyTasksCache, readSprintStatsCache, readTeamWorkspaceCache, refreshManagedProjectsCache, writeDailyWorkspaceCache, writeTeamWorkspaceCache } from "./cache";
import { dailyStatusBadgeClass, dailyStatusTone } from "./status";
import { dailyProgressCategory } from "./presenterMetrics";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Cell, Pie, PieChart } from "recharts";
import "./daily.css";

function DailyLoadingState({ label }: { label: string }) {
  return (
    <div className="daily-centered-loading" role="status" aria-label={label}>
      <RefreshCw className="size-7 animate-spin text-primary" aria-hidden="true" />
      <span className="font-medium">{label}</span>
    </div>
  );
}

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

function dailyStatsDiagnosticReasons(stats: DailySprintStats, t: ReturnType<typeof useI18n>["t"]): string[] {
  const reasons = [
    stats.issuesWithIncompleteScopeHistory.length > 0
      ? t("daily.scopeHistoryIncompleteForIssues", { issues: stats.issuesWithIncompleteScopeHistory.join(", ") })
      : undefined,
    stats.issuesWithUnavailableStatus.length > 0
      ? t("daily.statusHistoryUnavailableForIssues", { issues: stats.issuesWithUnavailableStatus.join(", ") })
      : undefined,
    stats.issuesWithoutScopeStoryPoints.length > 0
      ? t("daily.scopeStoryPointsUnavailableForIssues", { issues: stats.issuesWithoutScopeStoryPoints.join(", ") })
      : undefined,
    stats.issuesWithoutStoryPoints.length > 0
      ? t("daily.storyPointsUnavailableForIssues", { issues: stats.issuesWithoutStoryPoints.join(", ") })
      : undefined,
  ].filter((reason): reason is string => Boolean(reason));

  if (stats.scopeAvailability === "unavailable" && stats.issuesWithIncompleteScopeHistory.length === 0) {
    reasons.push(t("daily.historyScopeUnavailable"));
  }
  if (reasons.length === 0) reasons.push(t("daily.statsIncompleteReason"));
  return reasons;
}

function initials(displayName: string): string {
  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

function memberDisplayName(member: TeamMember): string {
  return member.alias?.trim() || member.displayName;
}

function activeTeamMemberForAccount(members: TeamMember[], accountId: string | null | undefined): TeamMember | undefined {
  if (!accountId) return undefined;
  const normalizedAccountId = accountId.toLowerCase();
  return members.find((member) => member.active && member.accountId.toLowerCase() === normalizedAccountId);
}

function sprintDateInputValue(value?: string | null): string | undefined {
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function sprintPeriodLabel(startDate?: string | null, endDate?: string | null): string | undefined {
  if (!startDate || !endDate || !Number.isFinite(Date.parse(startDate)) || !Number.isFinite(Date.parse(endDate))) return undefined;
  return `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)}`;
}

function dateFromInputValue(value?: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatDateRange(range: DateRange | undefined, placeholder: string): string {
  if (!range?.from) return placeholder;
  const format = formatDisplayDate;
  return range.to ? `${format(range.from)} – ${format(range.to)}` : `${format(range.from)} – …`;
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
    const tone = dailyStatusTone(subtask.status, subtask.statusCategory);
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
  const { triggerRef, alignOffset, onOpenChange } = useInfoPopoverAnchor();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transitions, setTransitions] = useState<DailyIssueTransition[]>([]);
  const [performingId, setPerformingId] = useState<string>();

  async function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    setOpen(nextOpen);
    if (!nextOpen || performingId) return;
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
    setOpen(false);
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
        <Hint content={t("daily.changeStatusHint")}><button
          ref={triggerRef}
          type="button"
          className={cn(
            badgeVariants({ variant: "outline" }),
            dailyStatusBadgeClass(task.status, task.statusCategory),
            "daily-status-trigger h-8 gap-1.5 px-3 text-[13px] leading-4 focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait",
          )}
          disabled={performingId !== undefined}
          aria-busy={performingId !== undefined}
          aria-label={t("daily.changeStatus", { key: task.key, status: task.status })}
        >
          {performingId ? <RefreshCw className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
          {task.status}
          {performingId ? <span className="sr-only">{t("daily.savingStatus")}</span> : null}
        </button></Hint>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" alignOffset={alignOffset} collisionPadding={5} className="w-max min-w-0 max-w-[var(--radix-dropdown-menu-content-available-width)]">
        <DropdownMenuGroup>
          {!loading && !transitions.some((transition) => transition.toStatus === task.status) ? (
            <DropdownMenuItem disabled aria-current="true" className="bg-primary/10 data-[disabled]:opacity-100">
              {task.status}
            </DropdownMenuItem>
          ) : null}
          {loading ? (
            <DropdownMenuItem disabled>{t("daily.loadingTransitions")}</DropdownMenuItem>
          ) : transitions.length === 0 ? (
            <DropdownMenuItem disabled>{t("daily.noTransitions")}</DropdownMenuItem>
          ) : transitions.map((transition) => (
            <DropdownMenuItem
              key={transition.id}
              aria-current={transition.toStatus === task.status ? "true" : undefined}
              className={transition.toStatus === task.status ? "bg-primary/10" : undefined}
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

type SprintWorkspaceTab = "myTasks" | "teamTasks" | "stats";
const SPRINT_WORKSPACE_TABS: SprintWorkspaceTab[] = ["myTasks", "teamTasks", "stats"];
const SPRINT_WORKSPACE_TAB_ICONS = { myTasks: ListTodo, teamTasks: UsersRound, stats: ChartColumnIncreasing };
const EMPTY_STATS: DailySprintStats = { availability: "unavailable", originalTaskCount: null, completedOriginalTaskCount: null, originalStoryPoints: null, completedOriginalStoryPoints: null, addedTaskCount: null, completedAddedTaskCount: null, addedStoryPoints: null, completedAddedStoryPoints: null, scopeAvailability: "unavailable", issuesWithIncompleteScopeHistory: [], issuesWithUnavailableStatus: [], issuesWithoutScopeStoryPoints: [], scopeIssues: [], statusBreakdown: [], issuesWithoutStoryPoints: [] };

type StatusDonutSlice = { key: string; label: string; value: number; color: string };

function StatusDonut({
  data,
  percent,
  label,
  size = 96,
}: {
  data: StatusDonutSlice[];
  percent: number | null;
  label: string;
  size?: number;
}) {
  const hasValues = data.some((slice) => slice.value > 0);
  const chartData = hasValues ? data : [{ key: "empty", label: "", value: 1, color: "var(--muted)" }];
  const config: ChartConfig = Object.fromEntries(chartData.map(({ key, label: sliceLabel, color }) => [key, { label: sliceLabel, color }]));

  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
      <ChartContainer config={config} className="size-full min-h-full aspect-auto" style={{ width: "100%", height: "100%", minHeight: "100%" }}>
        <PieChart accessibilityLayer>
          <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={size * 0.34} outerRadius={size * 0.47} stroke="var(--card)" strokeWidth={2}>
            {chartData.map((slice) => <Cell key={slice.key} fill={`var(--color-${slice.key})`} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-foreground">
        {percent === null ? "—" : `${percent}%`}
      </span>
    </div>
  );
}

export function DailyPage() {
  const { t, language } = useI18n();
  const [activeTab, setActiveTab] = useState<SprintWorkspaceTab>("myTasks");
  const workspaceTabRefs = useRef<Partial<Record<SprintWorkspaceTab, HTMLButtonElement | null>>>({});
  const [projects, setProjects] = useState<ManagedProject[]>(() => readManagedProjectsCache() ?? []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => readManagedProjectsCache()?.[0]?.id);
  const [workspace, setWorkspace] = useState<DailyWorkspace | undefined>(() => {
    const projectId = readManagedProjectsCache()?.[0]?.id;
    const myTasks = projectId ? readMyTasksCache(projectId) : undefined;
    if (!myTasks) return undefined;
    const team = readTeamWorkspaceCache(projectId!);
    const currentUserMember = activeTeamMemberForAccount(team?.members ?? [], myTasks.currentUserAccountId)
      ?? myTasks.currentUserMember;
    return { ...myTasks, currentUserMember, sprintBoardUrl: team?.sprintBoardUrl ?? "", sprintBoardUrlsByAssignee: team?.sprintBoardUrlsByAssignee ?? {}, members: team?.members ?? [], sprintStats: EMPTY_STATS };
  });
  const [selectedMemberId, setSelectedMemberId] = useState<string>();
  const [sprintPickerOpen, setSprintPickerOpen] = useState(false);
  const [sprintQuery, setSprintQuery] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(() => readManagedProjectsCache() == null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsLoadError, setStatsLoadError] = useState<string>();
  const [scopeIssuesSort, setScopeIssuesSort] = useState<{ column: "key" | "summary" | "status" | "storyPoints"; direction: "ascending" | "descending" }>({ column: "key", direction: "ascending" });
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const [refreshingStatuses, setRefreshingStatuses] = useState(false);
  const [error, setError] = useState<string>();
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [presenterBusy, setPresenterBusy] = useState(false);
  const [presenterError, setPresenterError] = useState<string>();
  const [taskActionError, setTaskActionError] = useState<string>();
  const [taskActionNotice, setTaskActionNotice] = useState<string>();
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiPreset, setAiPreset] = useState<"weekly" | "custom">("weekly");
  const [aiSprintId, setAiSprintId] = useState("");
  const [aiDateRange, setAiDateRange] = useState<DateRange>();
  const [aiCalendarOpen, setAiCalendarOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string>();

  const workspaceRequestRevision = useRef(0);
  const statusRefreshRevision = useRef(0);

  useEffect(() => subscribeAppEvent(APP_EVENT.teamMembersChanged, ({ managedProjectId, members }) => {
    setWorkspace((current) => current?.managedProjectId === managedProjectId ? {
      ...current,
      members,
      currentUserMember: activeTeamMemberForAccount(members, current.currentUserAccountId) ?? null,
    } : current);
  }), []);

  useEffect(() => {
    let active = true;
    setLoadingProjects(readManagedProjectsCache() == null);
    refreshManagedProjectsCache()
      .then((loaded) => {
        if (!active) return;
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

  const refreshWorkspace = useCallback(async (projectId: string, sprintId?: string, force = false, tab: SprintWorkspaceTab = "myTasks") => {
    const revision = workspaceRequestRevision.current + 1;
    workspaceRequestRevision.current = revision;
    setError(undefined);
    if (tab === "myTasks") {
      setLoadingWorkspace(true);
      setStatsLoadError(undefined);
    }
    if (tab === "teamTasks") setLoadingTeam(true);
    if (tab === "stats") {
      setLoadingStats(true);
      setRefreshingStatuses(true);
      setStatsLoadError(undefined);
    }
    try {
      if (tab === "myTasks") {
        const my = await loadMyTasks(projectId, sprintId, force);
        if (workspaceRequestRevision.current !== revision) return;
        const team = readTeamWorkspaceCache(projectId, my.selectedSprintId);
        const stats = readSprintStatsCache(projectId, my.selectedSprintId);
        const currentUserMember = activeTeamMemberForAccount(team?.members ?? [], my.currentUserAccountId)
          ?? my.currentUserMember;
        setWorkspace({ ...my, currentUserMember, sprintBoardUrl: team?.sprintBoardUrl ?? "", sprintBoardUrlsByAssignee: team?.sprintBoardUrlsByAssignee ?? {}, members: team?.members ?? [], sprintStats: stats ?? EMPTY_STATS });
      } else {
        const selectedSprintId = sprintId ?? readMyTasksCache(projectId)?.selectedSprintId;
        if (!selectedSprintId) return;
        if (tab === "teamTasks") {
          const loaded = await loadTeamWorkspace(projectId, selectedSprintId, force);
          if (workspaceRequestRevision.current !== revision) return;
          setWorkspace((my) => my ? {
            ...my,
            ...loaded,
            currentUserAccountId: my.currentUserAccountId,
            currentUserMember: activeTeamMemberForAccount(loaded.members, my.currentUserAccountId) ?? null,
            sprintStats: my.sprintStats,
          } : { ...loaded, currentUserAccountId: null, currentUserMember: null, sprintStats: EMPTY_STATS });
        } else {
          const stats = await loadSprintStats(projectId, selectedSprintId, force);
          if (workspaceRequestRevision.current !== revision) return;
          setWorkspace((currentWorkspace) => currentWorkspace ? { ...currentWorkspace, sprintStats: stats } : currentWorkspace);
        }
      }
    } catch (reason) {
      if (workspaceRequestRevision.current === revision) {
        if (tab === "stats") setStatsLoadError(commandError(reason));
        else setError(commandError(reason));
      }
    } finally {
      if (tab === "myTasks") setLoadingWorkspace(false);
      if (tab === "teamTasks") setLoadingTeam(false);
      if (tab === "stats") { setLoadingStats(false); setRefreshingStatuses(false); }
    }
  }, []);

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
    setStatsLoadError(undefined);
    const cachedMyTasks = readMyTasksCache(selectedProjectId);
    if (cachedMyTasks) {
      const cachedTeam = readTeamWorkspaceCache(selectedProjectId, cachedMyTasks.selectedSprintId);
      const cachedStats = readSprintStatsCache(selectedProjectId, cachedMyTasks.selectedSprintId);
      setWorkspace((current) => current?.managedProjectId === selectedProjectId ? current : {
        ...cachedMyTasks,
        sprintBoardUrl: cachedTeam?.sprintBoardUrl ?? "",
        sprintBoardUrlsByAssignee: cachedTeam?.sprintBoardUrlsByAssignee ?? {},
        members: cachedTeam?.members ?? [],
        sprintStats: cachedStats ?? EMPTY_STATS,
      });
    } else {
      setWorkspace(undefined);
    }
    void refreshWorkspace(selectedProjectId);
    return undefined;
  }, [refreshWorkspace, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !workspace?.selectedSprintId) return;
    if (activeTab === "teamTasks") {
      const cachedTeam = readTeamWorkspaceCache(selectedProjectId, workspace.selectedSprintId);
      if (cachedTeam) setWorkspace((current) => current ? { ...current, ...cachedTeam } : current);
      else void refreshWorkspace(selectedProjectId, workspace.selectedSprintId, false, "teamTasks");
    } else if (activeTab === "stats") {
      const cachedStats = readSprintStatsCache(selectedProjectId, workspace.selectedSprintId);
      if (cachedStats) setWorkspace((current) => current ? { ...current, sprintStats: cachedStats } : current);
      else void refreshWorkspace(selectedProjectId, workspace.selectedSprintId, false, "stats");
    }
  }, [activeTab, selectedProjectId, workspace?.selectedSprintId, refreshWorkspace]);


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
  const selectedAssigneeBoardUrl = selectedMember ? workspace?.sprintBoardUrlsByAssignee?.[selectedMember.accountId] : undefined;
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
    const workspaceRevision = workspaceRequestRevision.current;
    const managedProjectId = workspace.managedProjectId;
    const sprintId = workspace.selectedSprintId;
    await transitionDailyIssue(
      managedProjectId,
      sprintId,
      task.key,
      transition.id,
      crypto.randomUUID(),
    );
    if (workspaceRequestRevision.current !== workspaceRevision) return;
    const revision = ++statusRefreshRevision.current;
    setRefreshingStatuses(false);
    setWorkspace((current) => {
      if (!current || current.managedProjectId !== managedProjectId || current.selectedSprintId !== sprintId) return current;
      const nextWorkspace = {
        ...current,
        subtasks: current.subtasks.map((item) => item.key === task.key ? { ...item, status: transition.toStatus } : item),
      };
      writeDailyWorkspaceCache(nextWorkspace);
      return nextWorkspace;
    });
    setTaskActionError(undefined);
    setTaskActionNotice(t("daily.statusChanged", { key: task.key, status: transition.toStatus }));
    // Jira has confirmed the write. Reconcile other fields without keeping the status control busy.
    void refreshDailyWorkspace(managedProjectId, sprintId).then((subtasks) => {
      if (statusRefreshRevision.current !== revision) return;
      setWorkspace((current) => {
        if (!current || current.managedProjectId !== managedProjectId || current.selectedSprintId !== sprintId) return current;
        const nextWorkspace = { ...current, subtasks };
        writeDailyWorkspaceCache(nextWorkspace);
        return nextWorkspace;
      });
    }).catch(() => {
      if (statusRefreshRevision.current === revision) setTaskActionError(t("daily.statusRefreshFailed"));
    });
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
      writeTeamWorkspaceCache({
        managedProjectId,
        projectName: nextState.workspace.projectName,
        projectKey: nextState.workspace.projectKey,
        selectedSprintId: nextState.workspace.selectedSprintId,
        selectedSprintName: nextState.workspace.selectedSprintName,
        sprintBoardUrl: nextState.workspace.sprintBoardUrl,
        sprintBoardUrlsByAssignee: nextState.workspace.sprintBoardUrlsByAssignee,
        sprints: nextState.workspace.sprints,
        members: nextState.workspace.members,
        subtasks: nextState.workspace.subtasks,
      });
      setWorkspace((current) => current && current.managedProjectId === managedProjectId
        ? { ...current, members: readUpdatedTeamMembers(managedProjectId) ?? nextState.workspace.members, subtasks: nextState.workspace.subtasks }
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
    if (presenterBusy || (!presenterOpen && (!workspace || !selectedMember || !selectedMemberId))) return;
    setPresenterBusy(true);
    setPresenterError(undefined);
    try {
      if (presenterOpen) {
        await closePresenterView();
        setPresenterOpen(false);
      } else if (workspace && selectedMemberId) {
        await publishPresenterState({ workspace, selectedMemberId });
        await openPresenterView();
        setPresenterOpen(true);
      }
    } catch (reason) {
      setPresenterError(commandError(reason));
    } finally {
      setPresenterBusy(false);
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

  async function runAiSummary(action: "generate" | "shorter" | "longer" | "regenerate" = "generate") {
    if (!selectedProjectId || !aiSprintId || (aiPreset === "custom" && !aiPrompt.trim())) return;
    setAiBusy(true);
    setAiError(undefined);
    try {
      const generated = await generateSprintSummary({
        managedProjectId: selectedProjectId,
        sprintId: aiSprintId,
        preset: aiPreset,
        period: aiPreset === "weekly" && aiDateRange?.from && aiDateRange.to
          ? {
            startAt: new Date(aiDateRange.from.getFullYear(), aiDateRange.from.getMonth(), aiDateRange.from.getDate()).toISOString(),
            endExclusive: new Date(aiDateRange.to.getFullYear(), aiDateRange.to.getMonth(), aiDateRange.to.getDate() + 1).toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
          : undefined,
        customPrompt: aiPrompt,
        previousResult: aiResult || undefined,
        action,
      });
      setAiResult(generated.text);
    } catch (reason) {
      const message = commandError(reason);
      const parentTaskFailure = message.match(/^Unable to load parent task (.+): (issue|changelog) request failed: (.+)$/);
      if (parentTaskFailure) {
        const [, key, stage, failure] = parentTaskFailure;
        const httpFailure = failure.match(/^Jira HTTP error \((\d+)\)$/);
        const localizedFailure = httpFailure
          ? t("daily.aiJiraHttpError", { status: httpFailure[1] })
          : failure === "Jira transport error"
            ? t("daily.aiJiraTransportError")
            : failure.startsWith("invalid Jira response")
              ? t("daily.aiJiraInvalidResponse")
              : failure === "unsupported Jira capability"
                ? t("daily.aiJiraUnsupportedCapability")
                : failure === "invalid Jira base URL"
                  ? t("daily.aiJiraInvalidBaseUrl")
                  : failure;
        setAiError(t("daily.aiParentTaskLoadError", {
          key,
          stage: t(stage === "issue" ? "daily.aiIssueRequest" : "daily.aiChangelogRequest"),
          reason: localizedFailure,
        }));
      } else {
        setAiError(message);
      }
    } finally {
      setAiBusy(false);
    }
  }

  const filteredSprints = workspace?.sprints.filter((sprint) =>
    sprint.name.toLocaleLowerCase().includes(sprintQuery.trim().toLocaleLowerCase()),
  ) ?? [];
  const selectedSprint = workspace?.sprints.find((sprint) => sprint.id === workspace.selectedSprintId);
  function handleWorkspaceTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: SprintWorkspaceTab) {
    const currentIndex = SPRINT_WORKSPACE_TABS.indexOf(tab);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % SPRINT_WORKSPACE_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + SPRINT_WORKSPACE_TABS.length) % SPRINT_WORKSPACE_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = SPRINT_WORKSPACE_TABS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = SPRINT_WORKSPACE_TABS[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab);
    workspaceTabRefs.current[nextTab]?.focus();
  }
  const currentUserMember = workspace?.currentUserAccountId
    ? activeTeamMemberForAccount(workspace.members, workspace.currentUserAccountId) ?? workspace.currentUserMember
    : undefined;
  const myTasks = workspace?.currentUserAccountId
    ? workspace.subtasks.filter((task) => task.assigneeAccountId === workspace.currentUserAccountId)
    : [];
  const hasCompleteMyTaskPoints = myTasks.length > 0
    && myTasks.every((task) => task.storyPoints !== null && task.storyPoints !== undefined);
  const myTasksWithoutStoryPoints = myTasks
    .filter((task) => task.storyPoints === null || task.storyPoints === undefined)
    .map((task) => task.key);
  const myTasksPointsUnavailableMessage = myTasksWithoutStoryPoints.length > 0
    ? t("daily.storyPointsUnavailableForIssues", { issues: myTasksWithoutStoryPoints.join(", ") })
    : t("daily.storyPointsUnavailable");
  const myTaskPointsByStatus = myTasks.reduce((points, task) => {
    points[dailyProgressCategory(task.status)] += task.storyPoints ?? 0;
    return points;
  }, { backlog: 0, progress: 0, done: 0 });
  const myTasksPointsTotal = hasCompleteMyTaskPoints
    ? myTaskPointsByStatus.backlog + myTaskPointsByStatus.progress + myTaskPointsByStatus.done
    : null;
  const myTasksCompletionPercent = myTasksPointsTotal !== null && myTasksPointsTotal > 0
    ? Math.round((myTaskPointsByStatus.done / myTasksPointsTotal) * 100)
    : null;
  const myTasksProgressUnavailable = myTasks.length === 0
    ? t("daily.noAssigneeTasks")
    : myTasksPointsTotal === 0
      ? t("daily.myTasksNoPoints")
      : myTasksPointsUnavailableMessage;
  const sprintStats = workspace?.sprintStats;
  const currentSprintId = workspace && workspace.managedProjectId === selectedProjectId ? workspace.selectedSprintId : undefined;
  const hasCachedMyTasks = Boolean(selectedProjectId && (currentSprintId ? readMyTasksCache(selectedProjectId, currentSprintId) : readMyTasksCache(selectedProjectId)));
  const hasCachedTeamData = Boolean(selectedProjectId && currentSprintId && readTeamWorkspaceCache(selectedProjectId, currentSprintId));
  const hasCachedStats = Boolean(selectedProjectId && currentSprintId && readSprintStatsCache(selectedProjectId, currentSprintId));
  const statsHasDiagnostics = Boolean(sprintStats && (
    sprintStats.issuesWithIncompleteScopeHistory.length > 0
    || sprintStats.issuesWithUnavailableStatus.length > 0
    || sprintStats.issuesWithoutScopeStoryPoints.length > 0
    || sprintStats.issuesWithoutStoryPoints.length > 0
  ));
  const hasCompleteStats = sprintStats?.availability === "available" && sprintStats.scopeAvailability === "available" && !statsHasDiagnostics;
  const statsUnavailable = sprintStats !== undefined && (!hasCompleteStats);
  const statsFailureReasons = statsLoadError ? [statsLoadError] : sprintStats ? dailyStatsDiagnosticReasons(sprintStats, t) : [t("daily.statsIncompleteReason")];
  const showStatsFailure = !loadingStats && (statsLoadError !== undefined || statsUnavailable);
  const showInitialStatsLoader = loadingStats && (!hasCachedStats || !hasCompleteStats);
  const showStatsContent = hasCompleteStats && !statsLoadError && !showInitialStatsLoader;
  const sprintScopeIssues = sprintStats?.scopeIssues ?? [];
  const sortedSprintScopeIssues = useMemo(() => {
    const direction = scopeIssuesSort.direction === "ascending" ? 1 : -1;
    return [...sprintScopeIssues].sort((left, right) => {
      const leftValue = left[scopeIssuesSort.column];
      const rightValue = right[scopeIssuesSort.column];
      if (leftValue === null || leftValue === undefined || leftValue === "") return rightValue === null || rightValue === undefined || rightValue === "" ? 0 : 1;
      if (rightValue === null || rightValue === undefined || rightValue === "") return -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") return (leftValue - rightValue) * direction;
      return String(leftValue).localeCompare(String(rightValue), language) * direction;
    });
  }, [language, scopeIssuesSort, sprintScopeIssues]);
  function toggleScopeIssuesSort(column: typeof scopeIssuesSort.column) {
    setScopeIssuesSort((current) => current.column === column
      ? { column, direction: current.direction === "ascending" ? "descending" : "ascending" }
      : { column, direction: "ascending" });
  }
  const plannedScopePoints = sprintStats?.originalStoryPoints ?? null;
  const plannedScopeTasks = sprintStats?.originalTaskCount ?? null;
  const addedScopePoints = sprintStats?.addedStoryPoints ?? null;
  const addedScopeTasks = sprintStats?.addedTaskCount ?? null;
  const completedPlannedPoints = sprintStats?.completedOriginalStoryPoints ?? null;
  const completedPlannedTasks = sprintStats?.completedOriginalTaskCount ?? null;
  const completedAddedPoints = sprintStats?.completedAddedStoryPoints ?? null;
  const completedAddedTasks = sprintStats?.completedAddedTaskCount ?? null;
  const completedScopePoints = completedPlannedPoints !== null && completedAddedPoints !== null
    ? completedPlannedPoints + completedAddedPoints
    : null;
  const completedScopeTasks = completedPlannedTasks !== null && completedAddedTasks !== null
    ? completedPlannedTasks + completedAddedTasks
    : null;
  const scopeClosurePercent = plannedScopePoints !== null && plannedScopePoints > 0 && completedScopePoints !== null
    ? Math.round(completedScopePoints / plannedScopePoints * 100)
    : null;
  const scopeChartReady = sprintStats?.scopeAvailability === "available"
    && plannedScopePoints !== null && addedScopePoints !== null
    && completedPlannedPoints !== null && completedAddedPoints !== null
    && plannedScopePoints + addedScopePoints > 0;
  const scopeChartTotalPoints = scopeChartReady
    ? (plannedScopePoints ?? 0) + (addedScopePoints ?? 0)
    : null;
  const scopePlanTargetPercent = scopeChartReady && plannedScopePoints !== null && addedScopePoints !== null && addedScopePoints > 0
    ? plannedScopePoints / (plannedScopePoints + addedScopePoints) * 100
    : null;
  const scopeProgressPoints = (category: string) => sprintStats?.statusBreakdown
    .find((status) => status.category === category)?.storyPoints ?? 0;
  const scopeProgressSegments = [
    { key: "done", label: t("daily.statusCategory.done"), value: scopeProgressPoints("done"), color: "var(--success)" },
    { key: "inProgress", label: t("daily.statusCategory.inProgress"), value: scopeProgressPoints("inProgress"), color: "var(--chart-1)" },
    { key: "todo", label: t("daily.statusCategory.todo"), value: scopeProgressPoints("todo"), color: "var(--muted-foreground)" },
  ];
  const scopeProgressAriaLabel = scopeChartReady && scopeChartTotalPoints !== null
    && plannedScopePoints !== null && addedScopePoints !== null
    ? t("daily.sprintProgressAria", {
      done: scopeProgressPoints("done"),
      inProgress: scopeProgressPoints("inProgress"),
      todo: scopeProgressPoints("todo"),
      planned: plannedScopePoints,
      total: scopeChartTotalPoints,
    })
    : t("daily.scopeChartUnavailable");
  const scopeTaskCountText = (count: number | null) => {
    if (count === null) return "—";
    if (language !== AppLanguage.Russian) {
      return t(count === 1 ? "daily.scopeTaskCount.one" : "daily.scopeTaskCount.other", { count });
    }
    const modulo10 = count % 10;
    const modulo100 = count % 100;
    const plural = modulo10 === 1 && modulo100 !== 11
      ? "daily.scopeTaskCount.one"
      : [2, 3, 4].includes(modulo10) && ![12, 13, 14].includes(modulo100)
        ? "daily.scopeTaskCount.few"
        : "daily.scopeTaskCount.many";
    return t(plural, { count });
  };
  const scopeKpis = [
    {
      key: "planned",
      icon: CalendarDays,
      label: t("daily.kpiPlanned"),
      value: plannedScopePoints === null ? "—" : t("daily.pointsValue", { points: plannedScopePoints }),
      detail: scopeTaskCountText(plannedScopeTasks),
      tone: "planned",
    },
    {
      key: "added",
      icon: CirclePlus,
      label: t("daily.kpiAdded"),
      value: addedScopePoints === null ? "—" : t("daily.pointsValue", { points: addedScopePoints }),
      detail: scopeTaskCountText(addedScopeTasks),
      tone: "added",
    },
    {
      key: "done",
      icon: CircleCheck,
      label: t("daily.kpiDone"),
      value: completedScopePoints === null ? "—" : t("daily.pointsValue", { points: completedScopePoints }),
      detail: scopeTaskCountText(completedScopeTasks),
      tone: "done",
    },
    {
      key: "closure",
      icon: CircleGauge,
      label: t("daily.kpiClosure"),
      value: scopeClosurePercent === null ? "—" : `${scopeClosurePercent}%`,
      detail: completedScopePoints === null || plannedScopePoints === null
        ? "—"
        : t("daily.kpiClosureDetail", { done: completedScopePoints, planned: plannedScopePoints }),
      tone: "closure",
    },
  ];
  const selectedSprintPeriod = sprintPeriodLabel(selectedSprint?.startDate, selectedSprint?.endDate);
  const selectedSprintStateLabel = selectedSprint?.state === "active"
    ? t("daily.sprintState.active")
    : selectedSprint?.state === "closed"
      ? t("daily.sprintState.closed")
      : selectedSprint?.state === "future"
        ? t("daily.sprintState.future")
        : undefined;
  const aiSelectedSprint = workspace?.sprints.find((sprint) => sprint.id === aiSprintId);
  const aiSprintStartDate = sprintDateInputValue(aiSelectedSprint?.startDate);
  const aiSprintEndDate = sprintDateInputValue(aiSelectedSprint?.endDate);

  return (
    <section aria-labelledby="daily-title" className="space-y-4">
      <PageHeader
        className="daily-page-header items-center!"
        title={t("page.sprintTasks")}
        titleId="daily-title"
        description={t("daily.description")}
        actions={<>
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
                className="w-fit max-w-full justify-between gap-2 px-3 font-normal"
              >
                <span className="truncate">{selectedSprint?.name ?? t("daily.selectSprint")}</span>
                <ChevronDown aria-hidden="true" className="-mr-1 size-4 shrink-0 opacity-50" />
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
                          className="flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-1.5 text-left text-sm outline-none data-[pointer-hover=true]:text-primary focus-visible:text-primary aria-selected:bg-primary/10"
                          {...directPointerMoveHover<HTMLButtonElement>({})}
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
        {workspace?.selectedSprintId ? (
          <Button type="button" variant="outline" size="icon" aria-label={t("daily.openSprintBoard")} title={t("daily.openSprintBoard")} disabled={!workspace.sprintBoardUrl || loadingTeam} onClick={() => { if (workspace.sprintBoardUrl) void openJiraIssue(workspace.sprintBoardUrl); }}>
            <ExternalLink aria-hidden="true" />
          </Button>
        ) : null}
        </>}
      />

      <AlertDialog open={refreshConfirmOpen} onOpenChange={setRefreshConfirmOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("daily.confirmRefreshTitle")}</AlertDialogTitle><AlertDialogDescription>{t("daily.confirmRefreshDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("settings.common.cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => { setRefreshConfirmOpen(false); if (selectedProjectId && workspace) void refreshWorkspace(selectedProjectId, workspace.selectedSprintId, true, activeTab); }}>{t("daily.refresh")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <Dialog open={aiSummaryOpen} onOpenChange={(open) => { if (!aiBusy) setAiSummaryOpen(open); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="text-chart-5" aria-hidden="true" />{t("daily.aiSummary")}</DialogTitle>
            <DialogDescription>{t("daily.aiSummaryDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {!aiResult ? (
              <>
                <FieldGroup className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="ai-summary-preset">{t("daily.aiPreset")}</FieldLabel>
                    <Select value={aiPreset} onValueChange={(value) => setAiPreset(value as "weekly" | "custom")}>
                      <SelectTrigger id="ai-summary-preset" aria-label={t("daily.aiPreset")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">{t("daily.aiWeekly")}</SelectItem>
                        <SelectItem value="custom">{t("daily.aiCustom")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ai-summary-sprint">{t("daily.sprint")}</FieldLabel>
                    <Select value={aiSprintId} onValueChange={(value) => {
                      setAiSprintId(value);
                      setAiDateRange(undefined);
                      setAiCalendarOpen(false);
                    }}>
                      <SelectTrigger id="ai-summary-sprint" aria-label={t("daily.sprint")}><SelectValue placeholder={t("daily.selectSprint")} /></SelectTrigger>
                      <SelectContent>{(workspace?.sprints ?? []).map((sprint) => <SelectItem key={sprint.id} value={sprint.id}>{sprint.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                {aiPreset === "weekly" ? (
                  <Field>
                    <FieldLabel htmlFor="ai-summary-period">{t("daily.aiDateRange")}</FieldLabel>
                    <Popover open={aiCalendarOpen} onOpenChange={setAiCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          id="ai-summary-period"
                          type="button"
                          variant="outline"
                          aria-label={t("daily.aiDateRange")}
                          className="w-full justify-start text-left font-normal"
                        >
                          <CalendarDays data-icon="inline-start" aria-hidden="true" />
                          {formatDateRange(aiDateRange, t("daily.aiSelectDateRange"))}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="range"
                          min={1}
                          selected={aiDateRange}
                          onSelect={(range) => {
                            setAiDateRange(range);
                            if (range?.from && range.to) setAiCalendarOpen(false);
                          }}
                          defaultMonth={aiDateRange?.from ?? dateFromInputValue(aiSprintStartDate) ?? new Date()}
                          startMonth={dateFromInputValue(aiSprintStartDate)}
                          endMonth={dateFromInputValue(aiSprintEndDate)}
                          locale={language === "russian" ? ru : enGB}
                          disabled={(date) => {
                            const start = dateFromInputValue(aiSprintStartDate);
                            const end = dateFromInputValue(aiSprintEndDate);
                            return Boolean((start && date < start) || (end && date > end));
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="ai-summary-prompt">{t("daily.aiPrompt")}</FieldLabel>
                    <Textarea id="ai-summary-prompt" rows={5} value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder={t("daily.aiPromptPlaceholder")} />
                  </Field>
                )}
              </>
            ) : null}
            {aiError ? <Alert variant="destructive" role="alert"><AlertTitle>{t("daily.aiError")}</AlertTitle><AlertDescription>{formatAiError(aiError, t)}</AlertDescription></Alert> : null}
            {aiResult ? (
              <div className="flex flex-col gap-3">
                <Textarea aria-label={t("daily.aiResult")} rows={8} value={aiResult} onChange={(event) => setAiResult(event.target.value)} className="max-h-72 resize-y bg-muted/40 leading-relaxed" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={aiBusy} onClick={() => void runAiSummary("shorter")}>{t("daily.aiShorter")}</Button>
                  <Button type="button" variant="outline" size="sm" disabled={aiBusy} onClick={() => void runAiSummary("longer")}>{t("daily.aiLonger")}</Button>
                  <Button type="button" variant="outline" size="sm" disabled={aiBusy} onClick={() => void runAiSummary("regenerate")}>{t("daily.aiRegenerate")}</Button>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button data-dialog-cancel type="button" variant="outline" disabled={aiBusy} onClick={() => setAiSummaryOpen(false)}>{t("settings.common.cancel")}</Button>
            {aiResult ? (
              <Button type="button" className="bg-gradient-to-r from-chart-5 to-primary text-primary-foreground hover:brightness-110" onClick={() => void copyTaskValue(aiResult, t("daily.aiCopied"))}>
                <Copy data-icon="inline-start" aria-hidden="true" />{t("daily.copy")}
              </Button>
            ) : (
              <Button type="button" className="bg-gradient-to-r from-chart-5 to-primary text-primary-foreground hover:brightness-110" disabled={aiBusy || !aiSprintId || (aiPreset === "weekly" && (!aiDateRange?.from || !aiDateRange.to)) || (aiPreset === "custom" && !aiPrompt.trim())} onClick={() => void runAiSummary()}>
                {aiBusy ? t("daily.aiGenerating") : <><span>{t("daily.aiGenerate")}</span><Sparkles data-icon="inline-end" aria-hidden="true" /></>}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {loadingProjects && !workspace ? <DailyLoadingState label={t("daily.loadingTasks")} /> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("daily.unavailable")}</AlertTitle>
          <AlertDescription>{t("daily.loadError", { error })}</AlertDescription>
        </Alert>
      ) : null}
      {!loadingProjects && !error && projects.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-3 text-sm text-muted-foreground"><p>{t("daily.configureTeam")}</p></CardContent>
        </Card>
      ) : null}

      {loadingWorkspace && !hasCachedMyTasks ? <DailyLoadingState label={t("daily.loadingTasks")} /> : null}
      {workspace && (!loadingWorkspace || hasCachedMyTasks || !workspace.selectedSprintId) ? (
        workspace.selectedSprintId ? <>
        <div className="daily-workspace-tabs-row flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t("daily.workspaceTabs")} className="daily-workspace-tabs">
          {SPRINT_WORKSPACE_TABS.map((tab) => {
            const TabIcon = SPRINT_WORKSPACE_TAB_ICONS[tab];
            return (
              <Button
                key={tab}
                ref={(element) => { workspaceTabRefs.current[tab] = element; }}
                id={`sprint-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`sprint-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                variant="ghost"
                className="daily-workspace-tab"
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => handleWorkspaceTabKeyDown(event, tab)}
              >
                <TabIcon data-icon="inline-start" aria-hidden="true" />
                {t(`daily.tab.${tab}`)}
              </Button>
            );
          })}
        </div>
        <div className="daily-workspace-actions ml-auto flex items-center gap-2">
          {activeTab === "teamTasks" ? <>
            <Button type="button" variant="outline" size="icon" aria-label={t("daily.aiSummary")} title={t("daily.aiSummary")} className="mb-1" disabled={!workspace?.selectedSprintId} onClick={() => { setAiSprintId(workspace?.selectedSprintId ?? ""); setAiDateRange(undefined); setAiCalendarOpen(false); setAiResult(""); setAiError(undefined); setAiSummaryOpen(true); }}><Sparkles aria-hidden="true" /></Button>
            <Button type="button" variant={presenterOpen ? "secondary" : "default"} size="icon" className="mb-1" disabled={presenterBusy || !workspace || !hasCachedTeamData || loadingTeam || (!presenterOpen && !selectedMember)} aria-busy={presenterBusy} aria-pressed={presenterOpen} aria-label={presenterOpen ? t("daily.presenter.stop") : t("daily.presenter.start")} title={presenterOpen ? t("daily.presenter.stop") : t("daily.presenter.start")} onClick={() => void togglePresenter()}>{presenterOpen ? <Square aria-hidden="true" /> : <Presentation aria-hidden="true" />}</Button>
          </> : null}
          <Button type="button" variant="outline" size="icon" aria-label={t("daily.refresh")} title={t("daily.refresh")} className="daily-workspace-refresh mb-1" disabled={!selectedProjectId || loadingWorkspace || loadingTeam || loadingStats || refreshingStatuses} onClick={() => activeTab === "myTasks" ? selectedProjectId && void refreshWorkspace(selectedProjectId, workspace?.selectedSprintId, true, "myTasks") : setRefreshConfirmOpen(true)}><RefreshCw aria-hidden="true" className={loadingWorkspace || loadingTeam || loadingStats ? "animate-spin" : undefined} /></Button>
        </div>
        </div>
        {activeTab !== "stats" ? <section id="sprint-panel-stats" role="tabpanel" aria-labelledby="sprint-tab-stats" hidden /> : null}
        {activeTab !== "myTasks" ? <section id="sprint-panel-myTasks" role="tabpanel" aria-labelledby="sprint-tab-myTasks" hidden /> : null}
        {activeTab !== "teamTasks" ? <section id="sprint-panel-teamTasks" role="tabpanel" aria-labelledby="sprint-tab-teamTasks" hidden /> : null}
        {activeTab === "stats" ? (
          <section id="sprint-panel-stats" role="tabpanel" aria-labelledby="sprint-tab-stats" className="daily-stats-layout">
            {showInitialStatsLoader ? (
              <DailyLoadingState label={t("daily.statsLoading")} />
            ) : showStatsFailure ? (
              <div className="daily-stats-error-state">
                <Alert variant="destructive" role="alert">
                  <AlertTitle>{t("daily.statsLoadFailed")}</AlertTitle>
                  <AlertDescription>
                    <ul className="grid gap-2">
                      {statsFailureReasons.map((reason) => <li key={reason} className="break-words">{reason}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
                <Button type="button" variant="outline" disabled={loadingStats} onClick={() => {
                  if (selectedProjectId && workspace) void refreshWorkspace(selectedProjectId, workspace.selectedSprintId, true, "stats");
                }}>
                  {loadingStats ? <RefreshCw data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
                  {t("daily.statsRetry")}
                </Button>
              </div>
            ) : (
              <>
              {loadingStats && hasCachedStats ? (
                <div className="daily-stats-refresh-progress" role="status" aria-label={t("daily.statsLoading")}>
                  <RefreshCw className="size-4 animate-spin text-primary" aria-hidden="true" />
                  <span className="font-medium">{t("daily.statsLoading")}</span>
                </div>
              ) : null}
              {showStatsContent ? <>
            <Card className="daily-scope-summary">
              <CardHeader variant="section" className="daily-sprint-overview-header flex-row">
                <div className="daily-sprint-overview-title">
                  <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-primary" />
                  <CardTitle>{t("daily.sprintOverview")}</CardTitle>
                </div>
                <div className="daily-sprint-overview-meta">
                  {selectedSprintPeriod ? <span className="daily-sprint-period">{selectedSprintPeriod}</span> : null}
                  {selectedSprintStateLabel && selectedSprint ? (
                    <span className="daily-sprint-state" data-state={selectedSprint.state}>{selectedSprintStateLabel}</span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="daily-scope-summary-content p-4">
                <div className="daily-scope-kpis">
                  {scopeKpis.map((metric) => {
                    const MetricIcon = metric.icon;
                    return (
                      <article key={metric.key} role="group" aria-label={metric.label} className="daily-scope-kpi" data-tone={metric.tone}>
                        <div className="daily-scope-kpi-heading">
                          <MetricIcon aria-hidden="true" className="daily-scope-kpi-icon" />
                          <span>{metric.label}</span>
                        </div>
                        <div className="daily-scope-kpi-main">
                          <div className="daily-scope-kpi-copy">
                            <strong className="daily-scope-kpi-value">{metric.value}</strong>
                            {metric.key !== "closure" && metric.detail ? <span className="daily-scope-kpi-detail">{metric.detail}</span> : null}
                          </div>

                        </div>
                        {metric.key === "closure" ? <span className="daily-scope-kpi-detail">{metric.detail}</span> : null}
                      </article>
                    );
                  })}
                </div>
                {scopeClosurePercent === null ? (
                  <Alert><AlertDescription>{plannedScopePoints === 0
                    ? t("daily.scopeClosureNoPlan")
                    : t("daily.scopeChartUnavailable")}</AlertDescription></Alert>
                ) : null}
                {scopeChartReady && scopeChartTotalPoints !== null ? (
                  <div className="daily-scope-meter-section">
                    <h3 className="daily-scope-meter-heading">{t("daily.sprintProgress")}</h3>
                    <div role="img" aria-label={scopeProgressAriaLabel} className="daily-scope-meter">
                      <div className="daily-scope-meter-track" aria-hidden="true">
                        <div className="daily-scope-meter-segments">
                          {scopeProgressSegments.map((segment) => (
                            <span
                              key={segment.key}
                              className="daily-scope-meter-segment"
                              style={{
                                width: `${segment.value / scopeChartTotalPoints * 100}%`,
                                backgroundColor: segment.color,
                              }}
                            />
                          ))}
                        </div>
                        {scopePlanTargetPercent !== null ? (
                          <span className="daily-scope-meter-target" style={{ left: `${scopePlanTargetPercent}%` }}>
                            <span className="daily-scope-meter-target-label">{t("daily.scopePlanTarget")}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="daily-scope-meter-summary">
                      <span>{scopeClosurePercent === null
                        ? t("daily.scopeProgressDoneNoPlan", { points: completedScopePoints ?? 0 })
                        : t("daily.scopeProgressDoneLabel", { points: completedScopePoints ?? 0, percent: scopeClosurePercent })}</span>
                      <span>{t("daily.scopeProgressPlannedLabel", { points: plannedScopePoints ?? 0 })}</span>
                    </div>
                    <div className="daily-scope-meter-legend">
                      {scopeProgressSegments.map((segment) => (
                        <span key={segment.key}>
                          <i aria-hidden="true" style={{ backgroundColor: segment.color }} />
                          {segment.label} · {t("daily.pointsValue", { points: segment.value })}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader variant="section">
                <CardTitle className="flex items-center gap-2"><List aria-hidden="true" className="size-4 shrink-0 text-primary" />{t("daily.scopeIssuesTitle")}</CardTitle>
                <CardDescription>
                  <span className="daily-scope-issue-added-marker" aria-hidden="true">*</span> {t("daily.scopeIssuesAddedLegend")}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {sprintScopeIssues.length > 0 ? (
                  <div className="daily-scope-issues-scroll">
                    <Table className="min-w-[680px] table-fixed">
                      <TableCaption className="sr-only">{t("daily.scopeIssuesTitle")}</TableCaption>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead scope="col" aria-sort={scopeIssuesSort.column === "key" ? scopeIssuesSort.direction : "none"} className="w-[120px] py-2 pl-3"><button type="button" onClick={() => toggleScopeIssuesSort("key")} className="text-left">{t("daily.scopeIssuesKey")}</button></TableHead>
                          <TableHead scope="col" aria-sort={scopeIssuesSort.column === "summary" ? scopeIssuesSort.direction : "none"} className="py-2"><button type="button" onClick={() => toggleScopeIssuesSort("summary")} className="text-left">{t("daily.scopeIssuesSummary")}</button></TableHead>
                          <TableHead scope="col" aria-sort={scopeIssuesSort.column === "status" ? scopeIssuesSort.direction : "none"} className="w-[150px] py-2"><button type="button" onClick={() => toggleScopeIssuesSort("status")} className="text-left">{t("daily.scopeIssuesStatus")}</button></TableHead>
                          <TableHead scope="col" aria-sort={scopeIssuesSort.column === "storyPoints" ? scopeIssuesSort.direction : "none"} className="w-[80px] py-2 pr-3 text-right"><button type="button" onClick={() => toggleScopeIssuesSort("storyPoints")} className="text-right">{t("daily.scopeIssuesPoints")}</button></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedSprintScopeIssues.map((issue) => (
                          <TableRow key={issue.key} data-added-after-start={issue.addedAfterStart ? "true" : undefined}>
                            <TableCell className="whitespace-nowrap py-2 pl-3 font-medium">{issue.addedAfterStart ? <><span className="daily-scope-issue-added-marker" aria-hidden="true">*</span><span className="sr-only">{t("daily.scopeIssueAddedLabel")}</span></> : null}{issue.key}</TableCell>
                            <TableCell className="whitespace-normal py-2 break-words">{issue.summary || "—"}</TableCell>
                            <TableCell className="py-2">{issue.status ? <span className={cn(badgeVariants({ variant: "outline" }), dailyStatusBadgeClass(issue.status, issue.statusCategory))}>{issue.status}</span> : "—"}</TableCell>
                            <TableCell className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{issue.storyPoints === null ? "—" : t("daily.pointsValue", { points: issue.storyPoints })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : sprintStats?.scopeAvailability === "available" ? (
                  <Alert className="m-4"><AlertDescription>{t("daily.scopeIssuesEmpty")}</AlertDescription></Alert>
                ) : (
                  <Alert className="m-4"><AlertDescription>{t("daily.historyScopeUnavailable")}</AlertDescription></Alert>
                )}
              </CardContent>
            </Card>
            </> : null}
            </>
            )}
          </section>
        ) : activeTab === "myTasks" ? (
          <section id="sprint-panel-myTasks" role="tabpanel" aria-labelledby="sprint-tab-myTasks">
            {!workspace.currentUserAccountId ? (
              <Alert><AlertTitle>{t("daily.myTasksUnavailable")}</AlertTitle><AlertDescription>{t("daily.myTasksConfigureMember")}</AlertDescription></Alert>
            ) : (
              <Card>
                <CardHeader variant="section" className="daily-my-tasks-header">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-3">{currentUserMember ? <MemberAvatar member={currentUserMember} className="h-9 w-9" managedProjectId={workspace.managedProjectId} /> : null}{currentUserMember ? memberDisplayName(currentUserMember) : workspace.projectName}</CardTitle>
                  </div>
                  <div className="daily-my-tasks-progress">
                    <StatusDonut
                      data={[
                        { key: "done", label: t("daily.statusCategory.done"), value: hasCompleteMyTaskPoints ? myTaskPointsByStatus.done : 0, color: "var(--chart-2)" },
                        { key: "progress", label: t("daily.statusCategory.inProgress"), value: hasCompleteMyTaskPoints ? myTaskPointsByStatus.progress : 0, color: "var(--chart-1)" },
                        { key: "backlog", label: t("daily.statusCategory.todo"), value: hasCompleteMyTaskPoints ? myTaskPointsByStatus.backlog : 0, color: "var(--muted-foreground)" },
                      ]}
                      percent={myTasksCompletionPercent}
                      size={76}
                      label={myTasksCompletionPercent === null
                        ? myTasksProgressUnavailable
                        : t("daily.myTasksProgressAria", { percent: myTasksCompletionPercent, done: myTaskPointsByStatus.done, total: myTasksPointsTotal ?? 0 })}
                    />
                    <div className="daily-my-tasks-legend" aria-hidden="true">
                      {[
                        { label: t("daily.statusCategory.done"), points: myTaskPointsByStatus.done },
                        { label: t("daily.statusCategory.inProgress"), points: myTaskPointsByStatus.progress },
                        { label: t("daily.statusCategory.todo"), points: myTaskPointsByStatus.backlog },
                      ].map((item) => (
                        <span key={item.label}>
                          {item.label} · {myTasksPointsTotal === null
                            ? "—"
                            : myTasksPointsTotal > 0
                              ? t("daily.pointsBreakdown", { points: item.points, percent: Math.round(item.points / myTasksPointsTotal * 100) })
                              : t("daily.pointsValue", { points: item.points })}
                        </span>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="daily-task-content">
                  {myTasks.length > 0 && myTasksPointsTotal === null ? (
                    <Alert role="status" className="mb-4 p-3"><AlertDescription className="break-words">{myTasksPointsUnavailableMessage}</AlertDescription></Alert>
                  ) : null}
                  {myTasks.length === 0 ? <p className="text-sm text-muted-foreground">{t("daily.noAssigneeTasks")}</p> : <div className="daily-task-list">{myTasks.map((task) => <article key={task.id} className="daily-task-row"><span className="daily-task-key">{task.key}</span><span className="daily-task-summary"><strong>{task.summary}</strong><small>{task.issueType}</small></span><span className={cn(badgeVariants({ variant: "outline" }), dailyStatusBadgeClass(task.status, task.statusCategory))}>{task.status}</span><span className="daily-task-points">SP {task.storyPoints ?? "—"}</span></article>)}</div>}
                </CardContent>
              </Card>
            )}
          </section>
        ) : (
        <section id="sprint-panel-teamTasks" role="tabpanel" aria-labelledby="sprint-tab-teamTasks">
        {loadingTeam && !hasCachedTeamData ? <DailyLoadingState label={t("daily.loadingTasks")} /> : null}
        {hasCachedTeamData ? <div className="daily-workspace-layout">
            <Card className="daily-members-card">
              <CardHeader variant="section" className="daily-panel-header">
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
              <Card data-icon-size="normal" data-info-popover-boundary className="daily-selected-member-card">
                <CardHeader variant="section" className="daily-selected-member-header">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedMember ? <MemberAvatar member={selectedMember} className="h-9 w-9 shrink-0" managedProjectId={workspace.managedProjectId} /> : null}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <CardTitle className="truncate text-[17px] font-medium">{selectedOwner.label}</CardTitle>
                        {selectedMember ? (
                          <Hint content={selectedAssigneeBoardUrl ? t("daily.openAssigneeSprintBoard") : t("daily.assigneeBoardUnavailable")}><span className="flex h-[17px] shrink-0 items-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="daily-assignee-board-button size-6"
                              aria-label={t("daily.openAssigneeSprintBoard")}
                              disabled={!selectedAssigneeBoardUrl}
                              onClick={() => { if (selectedAssigneeBoardUrl) void openJiraIssue(selectedAssigneeBoardUrl); }}
                            >
                              <ExternalLink aria-hidden="true" />
                            </Button>
                          </span></Hint>
                        ) : null}
                      </div>
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
                  {selectedSubtasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("daily.noAssigneeTasks")}</p>
                  ) : (
                    <div className="daily-task-list" aria-live="polite">
                      {selectedSubtasks.map((subtask) => (
                        <article key={subtask.id} className="daily-task-row">
                          <Hint content={t("daily.openInJira")}><button
                            type="button"
                            className="daily-task-key daily-task-link"
                            onClick={() => void openJiraIssue(subtask.url)}
                          >
                            {subtask.key}
                          </button></Hint>
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
                            <DropdownMenuContent align="end" className="w-max min-w-0 max-w-[var(--radix-dropdown-menu-content-available-width)]">
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
              <Card><CardContent className="px-4 py-3 text-sm text-muted-foreground"><p>{t("daily.selectMember")}</p></CardContent></Card>
            )}
          </section>
        </div> : null}
        </section>
        )}
        </> : loadingWorkspace ? (
          <EmptyState
            titleId="daily-sprint-loading-title"
            title={t("daily.loadingTasks")}
            description={t("daily.loadingTasksDescription")}
            icon={<RefreshCw className="size-5 animate-spin" />}
          />
        ) : (
          <EmptyState
            titleId="daily-sprint-required-title"
            title={t("daily.sprintRequiredTitle")}
            description={t("daily.sprintRequiredDescription")}
            icon={<CalendarDays className="size-5" />}
          />
        )
      ) : null}
    </section>
  );
}
