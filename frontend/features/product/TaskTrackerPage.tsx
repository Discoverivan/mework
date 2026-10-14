import { Hint } from "@/components/ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, Check, CheckCheck, ChevronDown, ChevronUp, Copy, Download, ExternalLink, Pencil, Radar, RefreshCw, SlidersHorizontal, MoreHorizontal, CircleHelp, Info, Sparkles, Trash2, Upload, X } from "lucide-react";

import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { PageHeader } from "@/components/shared/PageHeader";
import { ActionTextarea } from "@/components/shared/ActionTextarea";
import { EmptyState } from "@/components/shared/EmptyState";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { FieldValidationHint } from "@/components/shared/FieldValidationHint";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useI18n, type I18nContextValue } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CreateButton } from "@/components/shared/CreateButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { issueStatusBadgeClass } from "@/lib/issue-status-badge";
import {
  generateTaskTrackerCron,
  explainTaskTrackerCron,
  checkTaskTrackerNow,
  deleteTaskTrackerMonitor,
  listTaskTrackerMonitors,
  saveTaskTrackerMonitor,
  saveTaskTrackerMonitorExport,
  setTaskTrackerSort,
  validateTaskTrackerJql,
} from "@/shared/contracts/task-tracker";
import { loadTaskTrackerReadCheckpoints, saveTaskTrackerReadCheckpoint } from "./task-tracker-read-state";
import type {
  TaskTrackerChangeKind,
  TaskTrackerEventKind,
  TaskTrackerIssue,
  TaskTrackerMonitor,
  TaskTrackerMonitorInput,
  TaskTrackerScheduleKind,
  TaskTrackerSortDirection,
  TaskTrackerSortKey,
} from "@/shared/contracts/task-tracker";

const ALL_EVENTS: TaskTrackerEventKind[] = ["newIssues", "removedIssues", "statusChanges", "newComments"];

const EVENT_LABEL_KEYS: Record<TaskTrackerEventKind, TranslationKey> = {
  newIssues: "taskTracker.event.newIssues",
  removedIssues: "taskTracker.event.removedIssues",
  statusChanges: "taskTracker.event.statusChanges",
  newComments: "taskTracker.event.newComments",
};

const CHANGE_LABEL_KEYS: Record<TaskTrackerChangeKind, TranslationKey> = {
  new: "taskTracker.change.new",
  status: "taskTracker.change.status",
  comment: "taskTracker.change.comment",
  removed: "taskTracker.change.removed",
};

function changeLabel(kind: TaskTrackerChangeKind, t: I18nContextValue["t"]): string {
  return t(CHANGE_LABEL_KEYS[kind]);
}

type MonitorDraft = TaskTrackerMonitorInput;

const DEFAULT_MAX_TRACKED_ISSUES = 100;
const MAX_ALLOWED_TRACKED_ISSUES = 10_000;
const MONITOR_EXPORT_FORMAT = "mework-task-tracker-monitor";

type FilterChange = "all" | TaskTrackerChangeKind;
type SortKey = TaskTrackerSortKey;
type SortDirection = TaskTrackerSortDirection;
type ActiveFilterKey = "search" | "status" | "change" | "onlyChanged";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMonitorExport(text: string, t: I18nContextValue["t"]): MonitorDraft {
  const document: unknown = JSON.parse(text);
  if (!isRecord(document) || document.format !== MONITOR_EXPORT_FORMAT || document.version !== 1 || !isRecord(document.monitor)) {
    throw new Error(t("taskTracker.import.unsupported"));
  }
  const value = document.monitor;
  const validEvents = new Set(ALL_EVENTS);
  if (
    typeof value.name !== "string" || !value.name.trim() ||
    typeof value.jql !== "string" || !value.jql.trim() ||
    (value.scheduleKind !== "period" && value.scheduleKind !== "cron") ||
    typeof value.scheduleValue !== "string" || !value.scheduleValue.trim() ||
    !Array.isArray(value.trackedEvents) || !value.trackedEvents.every((event) => typeof event === "string" && validEvents.has(event as TaskTrackerEventKind)) ||
    typeof value.enabled !== "boolean" ||
    typeof value.maxTrackedIssues !== "number" || !Number.isInteger(value.maxTrackedIssues) ||
    value.maxTrackedIssues < 1 || value.maxTrackedIssues > MAX_ALLOWED_TRACKED_ISSUES
  ) {
    throw new Error(t("taskTracker.import.invalidSettings"));
  }
  return {
    name: value.name,
    jql: value.jql,
    scheduleKind: value.scheduleKind,
    scheduleValue: value.scheduleValue,
    trackedEvents: value.trackedEvents as TaskTrackerEventKind[],
    enabled: value.enabled,
    maxTrackedIssues: value.maxTrackedIssues,
  };
}

function emptyDraft(): MonitorDraft {
  return {
    name: "",
    jql: "",
    scheduleKind: "period",
    scheduleValue: "300",
    trackedEvents: [...ALL_EVENTS],
    enabled: true,
    maxTrackedIssues: DEFAULT_MAX_TRACKED_ISSUES,
  };
}

function errorMessage(reason: unknown, fallback: string): string {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (typeof reason === "object" && reason !== null && "message" in reason && typeof reason.message === "string") {
    return reason.message;
  }
  return fallback;
}

function monitorExportName(name: string): string {
  const fileBase = name.trim().toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${fileBase || "monitor"}.json`;
}

async function exportMonitorSettings(monitor: TaskTrackerMonitor, t: I18nContextValue["t"]): Promise<void> {
  const filePath = await save({
    title: t("taskTracker.exportDialogTitle"),
    defaultPath: monitorExportName(monitor.name),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!filePath) return;

  await saveTaskTrackerMonitorExport(filePath, {
    name: monitor.name,
    jql: monitor.jql,
    scheduleKind: monitor.scheduleKind,
    scheduleValue: monitor.scheduleValue,
    trackedEvents: monitor.trackedEvents,
    enabled: monitor.enabled,
    maxTrackedIssues: monitor.maxTrackedIssues,
  });
}

function formatRelativeTime(value: string, now: number, locale: string, t: I18nContextValue["t"]): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return t("taskTracker.time.justNow");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  return relative.format(-days, "day");
}

function statusValues(issues: TaskTrackerIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.status).filter(Boolean))].sort();
}

function unreadChangeCount(monitor: TaskTrackerMonitor, readChanges: Record<string, string | null>): number {
  if (readChanges[monitor.id] === (monitor.lastSuccessAt ?? null)) return 0;
  return monitor.issues.filter((issue) => issue.changed).length;
}

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onSort: (sortKey: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === activeSortKey;
  return (
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className={`px-4 py-3 ${className ?? ""}`}>
      <button type="button" className="inline-flex items-center gap-1 font-semibold hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        {active ? (direction === "asc" ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />) : null}
      </button>
    </th>
  );
}

function changeClass(kind?: TaskTrackerChangeKind | null): string {
  if (kind === "new") return "border-emerald-500/50 bg-emerald-500/5";
  if (kind === "status") return "border-blue-500/50 bg-blue-500/5";
  if (kind === "comment") return "border-amber-500/50 bg-amber-500/5";
  return "border-border";
}

function changeBadgeClass(kind?: TaskTrackerChangeKind | null): string {
  if (kind === "new") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (kind === "status") return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  if (kind === "comment") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

export function TaskTrackerPage({ mockMode = false }: { mockMode?: boolean }) {
  const { locale, t } = useI18n();
  const [monitors, setMonitors] = useState<TaskTrackerMonitor[]>([]);
  const monitorsRef = useRef<TaskTrackerMonitor[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<MonitorDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ count: number; truncated: boolean; issues: TaskTrackerIssue[] }>();
  const [dialogError, setDialogError] = useState<string>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [changeFilter, setChangeFilter] = useState<FilterChange>("all");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [filterDraftSearch, setFilterDraftSearch] = useState("");
  const [filterDraftStatus, setFilterDraftStatus] = useState("all");
  const [filterDraftChange, setFilterDraftChange] = useState<FilterChange>("all");
  const [filterDraftOnlyChanged, setFilterDraftOnlyChanged] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [readChanges, setReadChanges] = useState<Record<string, string | null>>(() => loadTaskTrackerReadCheckpoints());
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [jqlCopied, setJqlCopied] = useState(false);
  const monitorsRevision = useRef(0);

  const activeMonitor = monitors.find((monitor) => monitor.id === activeId) ?? monitors[0];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function applyMonitorSnapshot(next: TaskTrackerMonitor[], publish = false) {
    monitorsRef.current = next;
    setMonitors(next);
    setActiveId((current) => current && next.some((monitor) => monitor.id === current) ? current : next[0]?.id);
    if (publish) emitAppEvent(APP_EVENT.taskTrackerUpdated, next);
  }

  async function loadMonitors(showSpinner = true) {
    const revision = monitorsRevision.current + 1;
    monitorsRevision.current = revision;
    if (showSpinner) setRefreshing(true);
    try {
      const next = await listTaskTrackerMonitors();
      if (monitorsRevision.current !== revision) return;
      applyMonitorSnapshot(next, true);
      setPageError(undefined);
    } catch (reason) {
      if (monitorsRevision.current === revision) setPageError(errorMessage(reason, t("taskTracker.unavailable")));
    } finally {
      if (monitorsRevision.current === revision) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadMonitors();
    return subscribeAppEvent(APP_EVENT.taskTrackerUpdated, (updatedMonitors) => {
      monitorsRevision.current += 1;
      applyMonitorSnapshot(updatedMonitors);
      setLoading(false);
      setRefreshing(false);
    });
  }, []);

  const filteredIssues = useMemo(() => {
    if (!activeMonitor) return [];
    const query = search.trim().toLowerCase();
    return activeMonitor.issues.filter((issue) => {
      if (query && !`${issue.key} ${issue.summary} ${issue.assignee ?? ""}`.toLowerCase().includes(query)) return false;
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      if (changeFilter !== "all" && issue.lastChange?.kind !== changeFilter) return false;
      if (onlyChanged && !issue.changed) return false;
      return true;
    });
  }, [activeMonitor, changeFilter, onlyChanged, search, statusFilter]);

  const sortKey = activeMonitor?.sortKey ?? "updated";
  const sortDirection = activeMonitor?.sortDirection ?? "desc";
  const sortedIssues = useMemo(() => {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    return [...filteredIssues].sort((left, right) => {
      if (left.changed !== right.changed) return left.changed ? -1 : 1;
      const value = (issue: TaskTrackerIssue): string => {
        if (sortKey === "issue") return issue.key;
        if (sortKey === "summary") return issue.summary;
        if (sortKey === "status") return issue.status;
        if (sortKey === "updated") return issue.updated ?? "";
        return issue.lastChange ? changeLabel(issue.lastChange.kind, t) : "";
      };
      const comparison = collator.compare(value(left), value(right));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredIssues, locale, sortDirection, sortKey, t]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(sortedIssues.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleIssues = sortedIssues.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [activeId, search, statusFilter, changeFilter, onlyChanged]);

  function selectMonitor(id: string) {
    setActiveId(id);
    setSearch("");
    setStatusFilter("all");
    setChangeFilter("all");
    setOnlyChanged(false);
  }
  async function handleSort(nextKey: SortKey) {
    if (!activeMonitor) return;
    const nextDirection: SortDirection = sortKey === nextKey
      ? (sortDirection === "asc" ? "desc" : "asc")
      : "asc";
    const updatedMonitor = { ...activeMonitor, sortKey: nextKey, sortDirection: nextDirection };
    applyMonitorSnapshot(monitorsRef.current.map((monitor) => monitor.id === activeMonitor.id ? updatedMonitor : monitor));
    setPage(1);
    if (mockMode) return;
    try {
      const saved = await setTaskTrackerSort(activeMonitor.id, nextKey, nextDirection);
      applyMonitorSnapshot(monitorsRef.current.map((monitor) => monitor.id === saved.id ? saved : monitor));
    } catch (reason) {
      setPageError(errorMessage(reason, t("taskTracker.unavailable")));
      void loadMonitors(false);
    }
  }

  function openFilters() {
    setFilterDraftSearch(search);
    setFilterDraftStatus(statusFilter);
    setFilterDraftChange(changeFilter);
    setFilterDraftOnlyChanged(onlyChanged);
    setFiltersOpen(true);
  }

  const filtersChanged = filterDraftSearch.trim() !== search.trim()
    || filterDraftStatus !== statusFilter
    || filterDraftChange !== changeFilter
    || filterDraftOnlyChanged !== onlyChanged;

  function applyFilters() {
    if (!filtersChanged) return;
    setSearch(filterDraftSearch);
    setStatusFilter(filterDraftStatus);
    setChangeFilter(filterDraftChange);
    setOnlyChanged(filterDraftOnlyChanged);
    setFiltersOpen(false);
  }

  function clearFilterDraft() {
    setFilterDraftSearch("");
    setFilterDraftStatus("all");
    setFilterDraftChange("all");
    setFilterDraftOnlyChanged(false);
  }

  function removeFilter(filter: ActiveFilterKey) {
    if (filter === "search") setSearch("");
    if (filter === "status") setStatusFilter("all");
    if (filter === "change") setChangeFilter("all");
    if (filter === "onlyChanged") setOnlyChanged(false);
  }

  function markAllRead() {
    if (!activeMonitor) return;
    const checkpoint = activeMonitor.lastSuccessAt ?? null;
    setReadChanges(saveTaskTrackerReadCheckpoint(activeMonitor.id, checkpoint));
    emitAppEvent(APP_EVENT.taskTrackerReadStateChanged, { monitorId: activeMonitor.id, checkpoint });
  }

  async function copyJql() {
    if (!activeMonitor) return;
    await navigator.clipboard.writeText(activeMonitor.jql);
    setJqlCopied(true);
    window.setTimeout(() => setJqlCopied(false), 1500);
  }

  function openCreate() {
    setEditingId(undefined);
    setDraft(emptyDraft());
    setValidation(undefined);
    setDialogError(undefined);
    setDialogOpen(true);
  }

  function openEdit(monitor: TaskTrackerMonitor) {
    setEditingId(monitor.id);
    setDraft({
      id: monitor.id,
      name: monitor.name,
      jql: monitor.jql,
      scheduleKind: monitor.scheduleKind,
      scheduleValue: monitor.scheduleValue,
      trackedEvents: monitor.trackedEvents,
      enabled: monitor.enabled,
      maxTrackedIssues: monitor.maxTrackedIssues,
    });
    setValidation(undefined);
    setDialogError(undefined);
    setDialogOpen(true);
  }

  async function importMonitor(file: File) {
    try {
      const imported = parseMonitorExport(await file.text(), t);
      setEditingId(undefined);
      setDraft(imported);
      setValidation(undefined);
      setDialogError(undefined);
    } catch (reason) {
      setDialogError(reason instanceof SyntaxError ? t("taskTracker.import.invalidJson") : errorMessage(reason, t("taskTracker.unavailable")));
    }
  }

  function updateDraft<K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "jql") setValidation(undefined);
  }

  async function validateJql() {
    setValidating(true);
    setDialogError(undefined);
    try {
      const result = await validateTaskTrackerJql(draft.jql);
      setValidation({ count: result.issueCount, truncated: result.truncated, issues: result.issues });
    } catch (reason) {
      setDialogError(errorMessage(reason, t("taskTracker.unavailable")));
    } finally {
      setValidating(false);
    }
  }

  async function saveMonitor() {
    const shouldCheckImmediately = editingId === undefined;
    setSaving(true);
    setDialogError(undefined);
    try {
      const saved = await saveTaskTrackerMonitor(draft);
      const current = monitorsRef.current;
      const next = current.some((monitor) => monitor.id === saved.id)
        ? current.map((monitor) => monitor.id === saved.id ? saved : monitor)
        : [...current, saved];
      applyMonitorSnapshot(next, true);
      setActiveId(saved.id);
      setDialogOpen(false);
      if (shouldCheckImmediately) void checkMonitorNow(saved.id);
    } catch (reason) {
      setDialogError(errorMessage(reason, t("taskTracker.unavailable")));
    } finally {
      setSaving(false);
    }
  }

  async function exportMonitor(monitor: TaskTrackerMonitor) {
    setPageError(undefined);
    try {
      await exportMonitorSettings(monitor, t);
    } catch (reason) {
      setPageError(errorMessage(reason, t("taskTracker.exportFailed")));
    }
  }

  async function removeMonitor(monitor: TaskTrackerMonitor) {
    if (!window.confirm(t("taskTracker.confirmDelete", { name: monitor.name }))) return;
    setDialogError(undefined);
    try {
      await deleteTaskTrackerMonitor(monitor.id);
      const next = monitorsRef.current.filter((item) => item.id !== monitor.id);
      applyMonitorSnapshot(next, true);
      setDialogOpen(false);
      setEditingId(undefined);
    } catch (reason) {
      setDialogError(errorMessage(reason, t("taskTracker.unavailable")));
    }
  }

  async function checkMonitorNow(id: string) {
    setChecking(true);
    setPageError(undefined);
    try {
      const updated = await checkTaskTrackerNow(id);
      applyMonitorSnapshot(monitorsRef.current.map((monitor) => monitor.id === updated.id ? updated : monitor), true);
    } catch (reason) {
      setPageError(errorMessage(reason, t("taskTracker.unavailable")));
      await loadMonitors(false);
    } finally {
      setChecking(false);
    }
  }

  async function checkNow() {
    if (!activeMonitor) return;
    await checkMonitorNow(activeMonitor.id);
  }

  const statuses = statusValues(activeMonitor?.issues ?? []);
  const activeFilterBadges: Array<{ key: ActiveFilterKey; label: string }> = [
    ...(search.trim() ? [{ key: "search" as const, label: `${t("taskTracker.search")}: ${search.trim()}` }] : []),
    ...(statusFilter !== "all" ? [{ key: "status" as const, label: `${t("taskTracker.status")}: ${statusFilter}` }] : []),
    ...(changeFilter !== "all" ? [{ key: "change" as const, label: `${t("taskTracker.change")}: ${changeLabel(changeFilter, t)}` }] : []),
    ...(onlyChanged ? [{ key: "onlyChanged" as const, label: t("taskTracker.onlyChanged") }] : []),
  ];
  const changesRead = activeMonitor ? readChanges[activeMonitor.id] === (activeMonitor.lastSuccessAt ?? null) : false;

  if (loading) {
    return <div role="status" className="space-y-4"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.taskTracker")}
        titleId="task-tracker-title"
        description={t("taskTracker.description")}
        actions={mockMode ? undefined : (
          <CreateButton
            type="button"
            className="h-9"
            aria-label={t("taskTracker.createMonitor")}
            title={t("taskTracker.createMonitor")}
            onClick={openCreate}
          />
        )}
      />

      {pageError ? <Alert variant="destructive"><AlertTitle>{t("taskTracker.unavailable")}</AlertTitle><AlertDescription>{pageError}</AlertDescription></Alert> : null}

      {monitors.length > 0 ? <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-border pb-2" role="tablist" aria-label={t("taskTracker.monitors")}>
        {monitors.map((monitor) => {
          const hasUnreadChanges = unreadChangeCount(monitor, readChanges) > 0;
          return <button
            key={monitor.id}
            type="button"
            role="tab"
            aria-selected={activeMonitor?.id === monitor.id}
            onClick={() => selectMonitor(monitor.id)}
            className={`flex min-w-40 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${hasUnreadChanges ? "bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-300" : activeMonitor?.id === monitor.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          >
            {hasUnreadChanges ? <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" /> : null}
            <span className="min-w-0 flex-1 truncate">{monitor.name}</span>
            {monitor.exceedsLimit ? <AlertTriangle role="img" aria-label={t("taskTracker.issueLimitExceeded")} className="size-4 shrink-0 text-destructive" /> : <span className="text-xs opacity-75">{monitor.currentIssueCount}</span>}
          </button>;
        })}
      </div> : null}

      {!activeMonitor ? (
        <EmptyState
          titleId="task-tracker-empty-title"
          title={t("taskTracker.noMonitors")}
          description={t("taskTracker.noMonitorsDescription")}
          icon={<Radar className="size-5" />}
        />
      ) : (
        <section className="space-y-4" aria-labelledby="active-monitor-title">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 items-center gap-3">
                <h2 id="active-monitor-title" className="shrink-0 text-xl font-semibold">{activeMonitor.name}</h2>
                <Badge className={activeMonitor.enabled ? "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-transparent bg-muted text-muted-foreground"}>{activeMonitor.enabled ? t("taskTracker.enabled") : t("taskTracker.disabled")}</Badge>
                <Badge variant="secondary">{t("taskTracker.lastUpdate", { time: formatRelativeTime(activeMonitor.lastSuccessAt ?? "", now, locale, t) })}</Badge>
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <Hint content={activeMonitor.jql}><code className="block min-w-0 truncate rounded bg-muted px-3 py-2 pr-12 font-mono text-xs">{activeMonitor.jql}</code></Hint>
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2" aria-label={jqlCopied ? t("taskTracker.jqlCopied") : t("taskTracker.copyJql")} title={jqlCopied ? t("taskTracker.jqlCopied") : t("taskTracker.copyJql")} onClick={() => void copyJql()}>{jqlCopied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}</Button>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!mockMode ? (
                <Button type="button" variant="outline" size="icon" aria-label={t("taskTracker.exportSettings")} title={t("taskTracker.exportSettings")} onClick={() => void exportMonitor(activeMonitor)}><Download className="size-4" aria-hidden="true" /></Button>
              ) : null}
              <Button type="button" variant="outline" size="icon" aria-label={checking ? t("taskTracker.checking") : t("taskTracker.checkNow")} title={checking ? t("taskTracker.checking") : t("taskTracker.checkNow")} disabled={checking} onClick={() => void checkNow()}><RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" /></Button>
              {!mockMode ? (
                <Button type="button" variant="outline" size="icon" actionTone="edit" aria-label={t("taskTracker.dialog.edit")} title={t("common.edit")} onClick={() => openEdit(activeMonitor)}><Pencil className="size-4" aria-hidden="true" /></Button>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={openFilters}><SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />{t("taskTracker.filters")}{activeFilterBadges.length > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">{activeFilterBadges.length}</span> : null}</Button>
              {activeFilterBadges.map((filter) => <div key={filter.key} className="inline-flex max-w-[24rem] items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-sm"><span className="truncate">{filter.label}</span><Hint content={t("taskTracker.removeFilter", { filter: filter.label })}><button type="button" className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground" aria-label={t("taskTracker.removeFilter", { filter: filter.label })} onClick={() => removeFilter(filter.key)}><X className="size-3.5" aria-hidden="true" /></button></Hint></div>)}
            </div>
            <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0 whitespace-nowrap" disabled={changesRead || !activeMonitor.issues.some((issue) => issue.changed)} onClick={markAllRead}><CheckCheck className="mr-2 size-4" aria-hidden="true" />{t("taskTracker.markAllRead")}</Button>
          </div>

          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("taskTracker.filterDialog")}</DialogTitle><DialogDescription>{t("taskTracker.filterDescription")}</DialogDescription></DialogHeader>
              <DialogBody>
                <div className="space-y-4">
                  <div><Label htmlFor="task-tracker-search">{t("taskTracker.search")}</Label><Input id="task-tracker-search" className="mt-1" value={filterDraftSearch} onChange={(event) => setFilterDraftSearch(event.target.value)} placeholder={t("taskTracker.searchPlaceholder")} /></div>
                  <div><Label htmlFor="task-tracker-status">{t("taskTracker.status")}</Label><select autoComplete="off" id="task-tracker-status" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={filterDraftStatus} onChange={(event) => setFilterDraftStatus(event.target.value)}><option value="all">{t("taskTracker.allStatuses")}</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
                  <div><Label htmlFor="task-tracker-change">{t("taskTracker.changeType")}</Label><select autoComplete="off" id="task-tracker-change" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={filterDraftChange} onChange={(event) => setFilterDraftChange(event.target.value as FilterChange)}><option value="all">{t("taskTracker.allChangeTypes")}</option><option value="new">{changeLabel("new", t)}</option><option value="status">{changeLabel("status", t)}</option><option value="comment">{changeLabel("comment", t)}</option><option value="removed">{changeLabel("removed", t)}</option></select></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filterDraftOnlyChanged} onChange={(event) => setFilterDraftOnlyChanged(event.target.checked)} />{t("taskTracker.onlyChanged")}</label>
                </div>
              </DialogBody>
              <DialogFooter className="sm:justify-between"><Button type="button" variant="outline" onClick={clearFilterDraft} disabled={!filterDraftSearch.trim() && filterDraftStatus === "all" && filterDraftChange === "all" && !filterDraftOnlyChanged}>{t("taskTracker.clearFilters")}</Button><Button type="button" actionTone="edit" onClick={applyFilters} disabled={!filtersChanged}>{t("settings.common.save")}</Button></DialogFooter>
            </DialogContent>
          </Dialog>

          {activeMonitor.exceedsLimit ? (
            <Alert variant="destructive" className="rounded-xl p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <AlertTitle className="mb-2 text-base leading-snug">{t("taskTracker.tooManyIssues")}</AlertTitle>
                  <AlertDescription className="mt-0 text-sm leading-relaxed">
                    {t("taskTracker.tooManyIssuesDescription", { max: activeMonitor.maxTrackedIssues })}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm" aria-label={t("taskTracker.issues")}>
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr><SortableHeader label={t("taskTracker.issue")} sortKey="issue" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} className="w-40 min-w-40 whitespace-nowrap" /><SortableHeader label={t("taskTracker.summary")} sortKey="summary" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /><SortableHeader label={t("taskTracker.status")} sortKey="status" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /><SortableHeader label={t("taskTracker.updated")} sortKey="updated" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /><SortableHeader label={t("taskTracker.change")} sortKey="change" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /></tr></thead>
              <tbody className="divide-y divide-border">
                {visibleIssues.map((issue) => <IssueRow key={issue.key} issue={issue} now={now} locale={locale} t={t} unread={issue.changed && !changesRead} />)}
                {visibleIssues.length === 0 ? <tr><td colSpan={5} className="px-4 py-3 text-sm text-muted-foreground">{t("taskTracker.noMatchingIssues")}</td></tr> : null}
              </tbody>
            </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{t("taskTracker.showingIssues", { count: filteredIssues.length })}</span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("taskTracker.previousPage")}</Button>
                  <span>{t("taskTracker.page", { page: currentPage, pages: pageCount })}</span>
                  <Button type="button" variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{t("taskTracker.nextPage")}</Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <MonitorDialog
        t={t}
        open={dialogOpen}
        editing={Boolean(editingId)}
        draft={draft}
        saving={saving}
        validating={validating}
        validation={validation}
        error={dialogError}
        onOpenChange={setDialogOpen}
        onChange={updateDraft}
        onValidate={() => void validateJql()}
        onImport={(file) => void importMonitor(file)}
        onSave={() => void saveMonitor()}
        onDelete={() => { if (activeMonitor) void removeMonitor(activeMonitor); }}
      />
      <div className="sr-only" aria-live="polite">{refreshing ? t("taskTracker.refreshing") : ""}</div>
    </div>
  );
}

function IssueRow({ issue, now, unread, locale, t }: { issue: TaskTrackerIssue; now: number; unread: boolean; locale: string; t: I18nContextValue["t"] }) {
  return (
    <tr className={unread ? changeClass(issue.lastChange?.kind) : undefined}>
      <td className="w-40 min-w-40 whitespace-nowrap px-4 py-3 align-top"><button type="button" className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary hover:underline" onClick={() => void openUrl(issue.issueUrl)}>{unread ? <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" /> : null}{issue.key}<ExternalLink className="size-3 shrink-0" aria-hidden="true" /></button></td>
      <td className="max-w-[34rem] px-4 py-3 align-top">{issue.summary}</td>
      <td className="px-4 py-3 align-top"><Badge className={issueStatusBadgeClass(issue.status)}>{issue.status || t("taskTracker.unknown")}</Badge></td>
      <td className="whitespace-nowrap px-4 py-3 align-top">{formatRelativeTime(issue.updated ?? "", now, locale, t)}</td>
      <td className="px-4 py-3 align-top">{issue.lastChange ? <Badge className={changeBadgeClass(issue.lastChange.kind)}>{changeLabel(issue.lastChange.kind, t)}</Badge> : <span className="text-muted-foreground">—</span>}</td>
    </tr>
  );
}

interface MonitorDialogProps {
  t: I18nContextValue["t"];
  open: boolean;
  editing: boolean;
  draft: MonitorDraft;
  saving: boolean;
  validating: boolean;
  validation?: { count: number; truncated: boolean; issues: TaskTrackerIssue[] };
  error?: string;
  onOpenChange: (open: boolean) => void;
  onChange: <K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) => void;
  onValidate: () => void;
  onImport: (file: File) => void;
  onSave: () => void;
  onDelete: () => void;
}

const MONITOR_PERIOD_UNITS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 } as const;
type MonitorPeriodUnit = keyof typeof MONITOR_PERIOD_UNITS;
const MAX_MONITOR_PERIOD_SECONDS = 31_536_000;
const DEFAULT_MONITOR_CRON = "*/5 * * * *";

// Immediate form feedback mirrors the Rust parse_cron grammar; the core still validates saves.
function monitorCronError(value: string, t: I18nContextValue["t"]): string | undefined {
  if (!value.trim()) return t("forms.numberRequired");
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) return t("taskTracker.cron.fieldsRequired");
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;
  const names = ["minute", "hour", "day", "month", "weekday"] as const;
  const unsigned = (raw: string) => /^\+?\d+$/.test(raw) && Number(raw) <= 4_294_967_295;
  for (const [index, field] of fields.entries()) {
    const [min, max] = bounds[index];
    const valid = field.split(",").every((part) => {
      const [range, step, extraStep] = part.split("/");
      if (extraStep !== undefined || (step !== undefined && (!unsigned(step) || Number(step) === 0))) return false;
      if (range === "*") return true;
      const values = range.split("-");
      if (values.length > 2 || !values.every(unsigned)) return false;
      const from = Number(values[0]);
      const to = Number(values[1] ?? values[0]);
      return from >= min && to <= max && from <= to;
    });
    if (!valid) return t("taskTracker.cron.invalidField", { field: t(`taskTracker.cron.field.${names[index]}`), min, max });
  }
  return undefined;
}

function MonitorPeriodField({ seconds, disabled, t, onChange, onValidityChange }: {
  seconds: string; disabled: boolean; t: I18nContextValue["t"];
  onChange: (value: string) => void; onValidityChange: (valid: boolean) => void;
}) {
  const [unit, setUnit] = useState<MonitorPeriodUnit>(() => {
    const value = Number(seconds);
    return (["days", "hours", "minutes"] as const).find((candidate) => value > 0 && value % MONITOR_PERIOD_UNITS[candidate] === 0) ?? "seconds";
  });
  const effectiveUnit = Number(seconds) % MONITOR_PERIOD_UNITS[unit] === 0 ? unit : "seconds";
  useEffect(() => { setUnit(effectiveUnit); }, [effectiveUnit]);
  const factor = MONITOR_PERIOD_UNITS[effectiveUnit];
  const max = Math.floor(MAX_MONITOR_PERIOD_SECONDS / factor);
  return <div className="flex items-center gap-2">
    <ManualNumberField key={effectiveUnit} id="monitor-schedule-value" label={t("taskTracker.field.interval")} labelledBy="monitor-interval-label"
      value={Number(seconds) / factor} min={1} max={max} minVisibleDigits={1} disabled={disabled}
      errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), whole: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 1, max }) }}
      onChange={(value) => onChange(String(value * factor))} onValidityChange={onValidityChange} />
    <Select value={effectiveUnit} disabled={disabled} onValueChange={(value) => {
      const nextUnit = value as MonitorPeriodUnit;
      onChange(String(Number(seconds) / factor * MONITOR_PERIOD_UNITS[nextUnit]));
      setUnit(nextUnit);
    }}>
      <SelectTrigger aria-label={t("taskTracker.field.intervalUnit")}><SelectValue /></SelectTrigger>
      <SelectContent>{(Object.keys(MONITOR_PERIOD_UNITS) as MonitorPeriodUnit[]).map((value) => <SelectItem key={value} value={value}>{t(`taskTracker.interval.${value}`)}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

function CronActions({ expression, disabled, invalid, onApply }: { expression: string; disabled: boolean; invalid: boolean; onApply: (expression: string) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"help" | "explain" | "generate" | null>(null);
  const [responses, setResponses] = useState<Record<string, { pending?: boolean; explanation?: string; error?: string }>>({});
  const pending = useRef(new Set<string>());
  const key = expression.trim();
  const response = responses[key];
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const generationLock = useRef(false);
  const [generated, setGenerated] = useState<{ expression: string; explanation: string }>();
  const [generationError, setGenerationError] = useState<string>();
  const [copiedCron, setCopiedCron] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  async function copyCron(value: string) {
    setCopyError(undefined);
    try { await navigator.clipboard.writeText(value); setCopiedCron(value); }
    catch { setCopyError(value); }
  }
  async function explain() {
    setMode("explain");
    if (pending.current.has(key) || response?.explanation) return;
    pending.current.add(key);
    setResponses((current) => ({ ...current, [key]: { pending: true } }));
    try {
      const result = await explainTaskTrackerCron(key);
      setResponses((current) => ({ ...current, [key]: { explanation: result.explanation } }));
    } catch (reason) {
      setResponses((current) => ({ ...current, [key]: { error: errorMessage(reason, t("common.unknownError")) } }));
    } finally { pending.current.delete(key); }
  }
  async function generate() {
    if (generationLock.current) return;
    generationLock.current = true;
    setGenerating(true); setGenerationError(undefined); setGenerated(undefined); setCopiedCron(undefined); setCopyError(undefined);
    try { setGenerated(await generateTaskTrackerCron(description.trim())); }
    catch (reason) { setGenerationError(errorMessage(reason, t("common.unknownError"))); }
    finally { generationLock.current = false; setGenerating(false); }
  }
  const title = t(mode === "generate" ? "taskTracker.cron.aiGenerate" : mode === "explain" ? "taskTracker.cron.aiTitle" : "taskTracker.cron.helpTitle");
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" disabled={disabled} aria-label={t("taskTracker.cron.actions")} title={t("taskTracker.cron.actions")}><MoreHorizontal aria-hidden="true" className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setMode("help")}><Info aria-hidden="true" />{t("taskTracker.cron.helpTitle")}</DropdownMenuItem>
        <DropdownMenuItem disabled={invalid} onSelect={() => void explain()}><CircleHelp aria-hidden="true" />{t("taskTracker.cron.aiExplain")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMode("generate")}><Sparkles aria-hidden="true" />{t("taskTracker.cron.aiGenerate")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) setMode(null); }}>
      <DialogContent className="max-w-lg" {...(mode !== "generate" ? { "aria-describedby": undefined } : {})}>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{mode === "generate" ? <DialogDescription>{t("taskTracker.cron.generateDescription")}</DialogDescription> : null}</DialogHeader>
        <DialogBody layout="sections">
          {mode === "help" ? <>
            <Card>
              <CardHeader variant="section" className="py-2"><CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.cron.syntaxTitle")}</CardTitle></CardHeader>
              <CardContent className="space-y-2 p-4 text-sm"><p>{t("taskTracker.cron.format")}</p><p>{t("taskTracker.cron.syntax")}</p></CardContent>
            </Card>
            <Card>
              <CardHeader variant="section" className="py-2"><CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.cron.examplesTitle")}</CardTitle></CardHeader>
              <CardContent className="p-4">
                <ul className="space-y-3 text-sm">{([
                  [DEFAULT_MONITOR_CRON, "taskTracker.cron.everyFiveMinutes"],
                  ["0 9 * * *", "taskTracker.cron.dailyAtNine"],
                  ["0 9 * * 1-5", "taskTracker.cron.weekdaysAtNine"],
                ] as const).map(([value, label], index) => <li key={value}>
                  {index > 0 ? <Separator className="mb-3" /> : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Label htmlFor={`cron-example-${index}`} alignment="inline" className="font-normal">{t(label)}</Label>
                    <div className="flex max-w-full items-center gap-1.5">
                      <Input id={`cron-example-${index}`} readOnly value={value} className="w-auto min-w-0 [field-sizing:content]" />
                      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("taskTracker.cron.copyExpression", { expression: value })} title={t(copiedCron === value ? "taskTracker.cron.copied" : "taskTracker.cron.copy")} onClick={() => void copyCron(value)}>{copiedCron === value ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
                    </div>
                  </div>
                  {copyError === value ? <p role="alert" className="mt-1 text-sm text-destructive">{t("taskTracker.cron.copyFailed")}</p> : null}
                </li>)}</ul>
              </CardContent>
            </Card>
          </> : mode === "explain" ? <>
            <Card>
              <CardHeader variant="section" className="py-2"><CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.cron.analyzed")}</CardTitle></CardHeader>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center gap-1.5">
                  <Input readOnly aria-label={t("taskTracker.cron.analyzed")} value={key} className="w-auto min-w-0 max-w-full font-mono [field-sizing:content]" />
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("taskTracker.cron.copy")} title={t(copiedCron === key ? "taskTracker.cron.copied" : "taskTracker.cron.copy")} onClick={() => void copyCron(key)}>{copiedCron === key ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
                </div>
                {copyError === key ? <p role="alert" className="text-sm text-destructive">{t("taskTracker.cron.copyFailed")}</p> : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader variant="section" className="py-2"><CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.cron.syntaxTitle")}</CardTitle></CardHeader>
              <CardContent className="space-y-2 p-4 text-sm"><p>{t("taskTracker.cron.format")}</p><p>{t("taskTracker.cron.syntax")}</p></CardContent>
            </Card>
            <Card>
              <CardHeader variant="section" className="py-2"><CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.cron.explanationTitle")}</CardTitle></CardHeader>
              <CardContent className="p-4">
                {response?.explanation ? <MarkdownContent>{response.explanation}</MarkdownContent>
                  : response?.error ? <p role="alert" className="text-sm text-destructive">{response.error}</p>
                  : <p role="status" className="text-sm text-muted-foreground">{t("taskTracker.cron.aiPending")}</p>}
              </CardContent>
            </Card>
          </> : <>
            <Card>
              <CardHeader variant="section" className="py-2"><CardTitle id="cron-description-label" className="text-sm font-semibold leading-tight">{t("taskTracker.cron.description")}</CardTitle></CardHeader>
              <CardContent className="space-y-4 p-4">
                <ActionTextarea id="cron-description" aria-labelledby="cron-description-label" className="bg-background" maxLength={4000} value={description} disabled={generating} placeholder={t("taskTracker.cron.descriptionPlaceholder")} onChange={(event) => { setDescription(event.target.value); setGenerated(undefined); setGenerationError(undefined); }} action={
                  <Button type="button" variant="outline" size="sm" disabled={generating || !description.trim()} onClick={() => void generate()}><Sparkles aria-hidden="true" />{t(generating ? "taskTracker.cron.generating" : "taskTracker.cron.generate")}</Button>
                } />
                {generated && !generated.expression ? <Alert variant="destructive" className="bg-background px-4 py-3"><AlertDescription><MarkdownContent className="text-destructive [&_p]:text-inherit">{generated.explanation}</MarkdownContent></AlertDescription></Alert> : null}
                {generationError ? <Alert variant="destructive"><AlertDescription>{generationError}</AlertDescription></Alert> : null}
              </CardContent>
            </Card>
            {generated?.expression ? <Card>
              <CardHeader variant="section" className="py-2"><CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.cron.generatedTitle")}</CardTitle></CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="space-y-1">
                  <Label htmlFor="generated-cron">{t("taskTracker.field.cron")}</Label>
                  <div className="flex items-center gap-1.5">
                    <Input id="generated-cron" readOnly value={generated.expression} className="min-w-0 flex-1 font-mono" />
                    <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("taskTracker.cron.copy")} title={t(copiedCron === generated.expression ? "taskTracker.cron.copied" : "taskTracker.cron.copy")} onClick={() => void copyCron(generated.expression)}>{copiedCron === generated.expression ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
                  </div>
                  {copyError === generated.expression ? <p role="alert" className="text-sm text-destructive">{t("taskTracker.cron.copyFailed")}</p> : null}
                </div>
                <div className="space-y-1">
                  <Label id="generated-cron-explanation-label">{t("taskTracker.cron.explanationTitle")}</Label>
                  <div role="textbox" aria-readonly="true" aria-multiline="true" aria-labelledby="generated-cron-explanation-label" tabIndex={0} className="rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MarkdownContent>{generated.explanation}</MarkdownContent></div>
                </div>
              </CardContent>
            </Card> : null}
          </>}
        </DialogBody>
        <DialogFooter>
          <Button data-dialog-cancel type="button" variant="outline" onClick={() => setMode(null)}>{t("common.close")}</Button>
          {mode === "generate" ? <Button type="button" actionTone="success" disabled={generating || disabled || !generated?.expression} onClick={() => { if (generated?.expression) { onApply(generated.expression); setMode(null); } }}>{t("taskTracker.cron.apply")}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function MonitorDialog({ t, open, editing, draft, saving, validating, validation, error, onOpenChange, onChange, onValidate, onImport, onSave, onDelete }: MonitorDialogProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [maxIssuesValid, setMaxIssuesValid] = useState(true);
  const [periodValid, setPeriodValid] = useState(true);
  const cronError = draft.scheduleKind === "cron" ? monitorCronError(draft.scheduleValue, t) : undefined;
  const scheduleValues = useRef<Record<TaskTrackerScheduleKind, string>>({ period: "300", cron: DEFAULT_MONITOR_CRON });
  useEffect(() => {
    if (!open) scheduleValues.current = { period: "300", cron: DEFAULT_MONITOR_CRON };
    else scheduleValues.current[draft.scheduleKind] = draft.scheduleValue;
  }, [open, draft.scheduleKind, draft.scheduleValue]);
  const previousEvents = useRef<TaskTrackerEventKind[]>(ALL_EVENTS);
  const eventsEnabled = draft.trackedEvents.length > 0;
  useEffect(() => {
    if (!open) previousEvents.current = ALL_EVENTS;
    else if (draft.trackedEvents.length > 0) previousEvents.current = draft.trackedEvents;
  }, [open, draft.trackedEvents]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? t("taskTracker.dialog.edit") : t("taskTracker.dialog.create")}</DialogTitle><DialogDescription>{t("taskTracker.dialog.description")}</DialogDescription></DialogHeader>
        <DialogBody layout="sections">
          <Card data-info-popover-boundary>
            <CardHeader variant="section" className="flex-row items-center justify-between gap-2 space-y-0 py-2">
              <CardTitle className="text-sm font-semibold leading-tight">{t("taskTracker.dialog.settings")}</CardTitle>
              {!editing ? <>
              <input ref={importInputRef} type="file" accept=".json,application/json" aria-label={t("taskTracker.import.fileLabel")} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} />
              <Button type="button" variant="outline" size="icon" aria-label={t("taskTracker.import.action")} title={t("taskTracker.import.action")} onClick={() => importInputRef.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
              </Button>
              </> : null}
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-3">
                <Label htmlFor="monitor-name" alignment="inline">{t("taskTracker.field.name")}</Label><Input id="monitor-name" className="w-auto min-w-0 max-w-full justify-self-end [field-sizing:content]"
                  value={draft.name} disabled={saving} onChange={(event) => onChange("name", event.target.value)} placeholder={t("taskTracker.field.namePlaceholder")} />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="monitor-enabled" alignment="inline">{t("taskTracker.enabled")}</Label>
                <Switch id="monitor-enabled" size="md" checked={draft.enabled} onCheckedChange={(checked) => onChange("enabled", checked)} disabled={saving} />
              </div>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label id="monitor-max-tracked-issues-label" htmlFor="monitor-max-tracked-issues" alignment="inline">{t("taskTracker.field.maxTrackedIssues")}</Label>
                <ManualNumberField id="monitor-max-tracked-issues" label={t("taskTracker.field.maxTrackedIssues")} labelledBy="monitor-max-tracked-issues-label"
                  value={draft.maxTrackedIssues} min={1} max={MAX_ALLOWED_TRACKED_ISSUES} disabled={saving}
                  errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), whole: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 1, max: MAX_ALLOWED_TRACKED_ISSUES }) }}
                  onChange={(value) => onChange("maxTrackedIssues", value)} onValidityChange={setMaxIssuesValid} />
              </div>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="monitor-schedule-kind" alignment="inline">{t("taskTracker.field.schedule")}</Label>
                <div data-menu-align="end" className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
                  <Select value={draft.scheduleKind} disabled={saving} onValueChange={(value) => {
                    const nextKind = value as TaskTrackerScheduleKind;
                    scheduleValues.current[draft.scheduleKind] = draft.scheduleValue;
                    onChange("scheduleKind", nextKind);
                    onChange("scheduleValue", scheduleValues.current[nextKind]);
                  }}>
                    <SelectTrigger id="monitor-schedule-kind" aria-label={t("taskTracker.field.scheduleMode")}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="period">{t("taskTracker.schedule.period")}</SelectItem><SelectItem value="cron">{t("taskTracker.schedule.cron")}</SelectItem></SelectContent>
                  </Select>
                  <Label id="monitor-interval-label" htmlFor="monitor-schedule-value" className="sr-only">{draft.scheduleKind === "period" ? t("taskTracker.field.interval") : t("taskTracker.field.cron")}</Label>
                  {draft.scheduleKind === "period" ? <MonitorPeriodField seconds={draft.scheduleValue} disabled={saving} t={t} onChange={(value) => onChange("scheduleValue", value)} onValidityChange={setPeriodValid} />
                    : <div className="flex min-w-0 max-w-full items-center gap-2"><FieldValidationHint error={cronError}><Input id="monitor-schedule-value" className="monitor-auto-width-input min-w-0 max-w-full font-mono"
                      style={{ width: `calc(${Math.max(DEFAULT_MONITOR_CRON.length, draft.scheduleValue.length)}ch + var(--monitor-input-padding, 20px) + 2px)` }}
                      value={draft.scheduleValue} disabled={saving} onChange={(event) => onChange("scheduleValue", event.target.value)} placeholder={DEFAULT_MONITOR_CRON} /></FieldValidationHint>
                      <CronActions expression={draft.scheduleValue} disabled={saving} invalid={Boolean(cronError)} onApply={(value) => onChange("scheduleValue", value)} />
                    </div>}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader variant="section" className="flex-row items-center justify-between gap-2 space-y-0 py-2">
              <CardTitle id="monitor-jql-label" className="text-sm font-semibold leading-tight">{t("taskTracker.field.jql")}</CardTitle>
              <Button type="button" variant="outline" size="sm" disabled={saving || validating || !draft.jql.trim()} onClick={onValidate}>{validating ? t("taskTracker.validatingJql") : t("taskTracker.validateJql")}</Button>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <Textarea id="monitor-jql" aria-labelledby="monitor-jql-label" rows={1} className="min-h-8 resize-none py-1 font-mono [field-sizing:content]" value={draft.jql} disabled={saving} onChange={(event) => onChange("jql", event.target.value)} placeholder="project = DEMO AND resolution = Unresolved" />
              {validation ? <p role="status" className="text-sm text-muted-foreground">{t("taskTracker.jqlValid", { count: validation.truncated ? `${validation.count}+` : validation.count })}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader variant="section" className="flex-row items-center justify-between gap-3 space-y-0 py-2.5">
              <CardTitle id="monitor-events-label" className="text-sm font-semibold leading-tight">{t("taskTracker.field.trackEvents")}</CardTitle>
              <Switch size="md" aria-labelledby="monitor-events-label" checked={eventsEnabled} disabled={saving} onCheckedChange={(checked) => {
                if (!checked) previousEvents.current = draft.trackedEvents;
                onChange("trackedEvents", checked ? previousEvents.current : []);
              }} />
            </CardHeader>
            <CardContent className="p-4">
              {ALL_EVENTS.map((event, index) => <div key={event}>
                {index > 0 ? <Separator className="my-3" /> : null}
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`monitor-event-${event}`} alignment="inline">{t(EVENT_LABEL_KEYS[event])}</Label>
                  <Switch id={`monitor-event-${event}`} size="sm" checked={(eventsEnabled ? draft.trackedEvents : previousEvents.current).includes(event)} disabled={saving || !eventsEnabled} onCheckedChange={(checked) => onChange("trackedEvents", checked ? [...draft.trackedEvents, event] : draft.trackedEvents.filter((value) => value !== event))} />
                </div>
              </div>)}
            </CardContent>
          </Card>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button data-dialog-cancel type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("taskTracker.cancel")}</Button>
          {editing ? <Button type="button" variant="outline" actionTone="delete" disabled={saving} title={t("common.delete")} onClick={onDelete}><Trash2 aria-hidden="true" />{t("taskTracker.delete")}</Button> : null}
          <Button type="button" actionTone="success" disabled={saving || !maxIssuesValid || Boolean(cronError) || (draft.scheduleKind === "period" && !periodValid)} onClick={onSave}>{saving ? t("taskTracker.saving") : editing ? t("taskTracker.saveChanges") : t("taskTracker.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
