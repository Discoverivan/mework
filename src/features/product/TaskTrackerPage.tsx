import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, Check, CheckCheck, ChevronDown, ChevronUp, Copy, Download, ExternalLink, Pencil, Plus, Radar, RefreshCw, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";

import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n, type I18nContextValue } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  checkTaskTrackerNow,
  deleteTaskTrackerMonitor,
  listTaskTrackerMonitors,
  saveTaskTrackerMonitor,
  saveTaskTrackerMonitorExport,
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
type SortKey = "issue" | "summary" | "status" | "updated" | "change";
type SortDirection = "asc" | "desc";
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

function statusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (["done", "closed", "resolved"].some((value) => normalized.includes(value))) return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (["progress", "review", "testing"].some((value) => normalized.includes(value))) return "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-300";
  if (["todo", "to do", "open", "backlog"].some((value) => normalized.includes(value))) return "border-transparent bg-muted text-muted-foreground";
  return "border-transparent bg-secondary text-secondary-foreground";
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
  const [viewedChanges, setViewedChanges] = useState<Record<string, string | null>>({});
  const [readChanges, setReadChanges] = useState<Record<string, string | null>>(() => loadTaskTrackerReadCheckpoints());
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [jqlCopied, setJqlCopied] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("issue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const monitorsRevision = useRef(0);

  const activeMonitor = monitors.find((monitor) => monitor.id === activeId) ?? monitors[0];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeMonitor) return;
    setViewedChanges((current) => ({ ...current, [activeMonitor.id]: activeMonitor.lastSuccessAt ?? null }));
  }, [activeMonitor?.id, activeMonitor?.lastSuccessAt]);

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
  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
    setPage(1);
  }

  function openFilters() {
    setFilterDraftSearch(search);
    setFilterDraftStatus(statusFilter);
    setFilterDraftChange(changeFilter);
    setFilterDraftOnlyChanged(onlyChanged);
    setFiltersOpen(true);
  }

  function applyFilters() {
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
    setViewedChanges((current) => ({ ...current, [activeMonitor.id]: checkpoint }));
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
          <Button
            type="button"
            size="icon"
            actionTone="add"
            className="h-9 w-9"
            aria-label={t("taskTracker.createMonitor")}
            title={t("taskTracker.createMonitor")}
            onClick={openCreate}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        )}
      />

      {pageError ? <Alert variant="destructive"><AlertTitle>{t("taskTracker.unavailable")}</AlertTitle><AlertDescription>{pageError}</AlertDescription></Alert> : null}

      {monitors.length > 0 ? <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-border pb-2" role="tablist" aria-label={t("taskTracker.monitors")}>
        {monitors.map((monitor) => (
          <button
            key={monitor.id}
            type="button"
            role="tab"
            aria-selected={activeMonitor?.id === monitor.id}
            onClick={() => selectMonitor(monitor.id)}
            className={`flex min-w-40 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${activeMonitor?.id === monitor.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          >
            <span className="min-w-0 flex-1 truncate">{monitor.name}</span>
            {monitor.exceedsLimit ? <AlertTriangle role="img" aria-label={t("taskTracker.issueLimitExceeded")} className="size-4 shrink-0 text-destructive" /> : <span className="text-xs opacity-75">{monitor.currentIssueCount}</span>}
            {monitor.changesAfterLastCheck > 0 && viewedChanges[monitor.id] !== (monitor.lastSuccessAt ?? null) ? <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" /> : null}
          </button>
        ))}
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
                  <code className="block min-w-0 truncate rounded bg-muted px-3 py-2 pr-12 font-mono text-xs" title={activeMonitor.jql}>{activeMonitor.jql}</code>
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
                <Button type="button" variant="outline" size="icon" actionTone="edit" aria-label={t("taskTracker.dialog.edit")} title={t("taskTracker.dialog.edit")} onClick={() => openEdit(activeMonitor)}><Pencil className="size-4" aria-hidden="true" /></Button>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={openFilters}><SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />{t("taskTracker.filters")}{activeFilterBadges.length > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">{activeFilterBadges.length}</span> : null}</Button>
              {activeFilterBadges.map((filter) => <div key={filter.key} className="inline-flex max-w-[24rem] items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-sm"><span className="truncate">{filter.label}</span><button type="button" className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground" aria-label={t("taskTracker.removeFilter", { filter: filter.label })} title={t("taskTracker.removeFilter", { filter: filter.label })} onClick={() => removeFilter(filter.key)}><X className="size-3.5" aria-hidden="true" /></button></div>)}
            </div>
            <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0 whitespace-nowrap" disabled={changesRead || !activeMonitor.issues.some((issue) => issue.changed)} onClick={markAllRead}><CheckCheck className="mr-2 size-4" aria-hidden="true" />{t("taskTracker.markAllRead")}</Button>
          </div>

          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("taskTracker.filterDialog")}</DialogTitle><DialogDescription>{t("taskTracker.filterDescription")}</DialogDescription></DialogHeader>
              <DialogBody>
                <div className="space-y-4">
                  <div><Label htmlFor="task-tracker-search">{t("taskTracker.search")}</Label><Input id="task-tracker-search" className="mt-1" value={filterDraftSearch} onChange={(event) => setFilterDraftSearch(event.target.value)} placeholder={t("taskTracker.searchPlaceholder")} /></div>
                  <div><Label htmlFor="task-tracker-status">{t("taskTracker.status")}</Label><select id="task-tracker-status" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={filterDraftStatus} onChange={(event) => setFilterDraftStatus(event.target.value)}><option value="all">{t("taskTracker.allStatuses")}</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
                  <div><Label htmlFor="task-tracker-change">{t("taskTracker.changeType")}</Label><select id="task-tracker-change" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={filterDraftChange} onChange={(event) => setFilterDraftChange(event.target.value as FilterChange)}><option value="all">{t("taskTracker.allChangeTypes")}</option><option value="new">{changeLabel("new", t)}</option><option value="status">{changeLabel("status", t)}</option><option value="comment">{changeLabel("comment", t)}</option><option value="removed">{changeLabel("removed", t)}</option></select></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filterDraftOnlyChanged} onChange={(event) => setFilterDraftOnlyChanged(event.target.checked)} />{t("taskTracker.onlyChanged")}</label>
                </div>
              </DialogBody>
              <DialogFooter className="sm:justify-between"><Button type="button" variant="outline" onClick={clearFilterDraft} disabled={!filterDraftSearch.trim() && filterDraftStatus === "all" && filterDraftChange === "all" && !filterDraftOnlyChanged}>{t("taskTracker.clearFilters")}</Button><Button type="button" onClick={applyFilters}>{t("taskTracker.apply")}</Button></DialogFooter>
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
                {visibleIssues.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{t("taskTracker.noMatchingIssues")}</td></tr> : null}
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
      <td className="px-4 py-3 align-top"><Badge className={statusBadgeClass(issue.status)}>{issue.status || t("taskTracker.unknown")}</Badge></td>
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

function MonitorDialog({ t, open, editing, draft, saving, validating, validation, error, onOpenChange, onChange, onValidate, onImport, onSave, onDelete }: MonitorDialogProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? t("taskTracker.dialog.edit") : t("taskTracker.dialog.create")}</DialogTitle><DialogDescription>{t("taskTracker.dialog.description")}</DialogDescription></DialogHeader>
        <DialogBody className="pr-3">
          <div className="space-y-4">
            <div className="flex items-center gap-3"><Switch checked={draft.enabled} onCheckedChange={(checked) => onChange("enabled", checked)} /><Label alignment="inline">{t("taskTracker.enabled")}</Label></div>
            <div><Label htmlFor="monitor-name">{t("taskTracker.field.name")}</Label><Input id="monitor-name" className="mt-1" value={draft.name} onChange={(event) => onChange("name", event.target.value)} placeholder={t("taskTracker.field.namePlaceholder")} /></div>
            <div>
              <Label htmlFor="monitor-jql">JQL</Label>
              <textarea id="monitor-jql" className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" value={draft.jql} onChange={(event) => onChange("jql", event.target.value)} placeholder="project = DEMO AND resolution = Unresolved" />
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={validating || !draft.jql.trim()} onClick={onValidate}>{validating ? t("taskTracker.validatingJql") : t("taskTracker.validateJql")}</Button>
              {validation ? <p className="mt-2 text-sm text-muted-foreground">{t("taskTracker.jqlValid", { count: validation.truncated ? `${validation.count}+` : validation.count })}</p> : null}
            </div>
            <div><Label htmlFor="monitor-max-tracked-issues">{t("taskTracker.field.maxTrackedIssues")}</Label><Input id="monitor-max-tracked-issues" type="number" min={1} max={MAX_ALLOWED_TRACKED_ISSUES} step={1} className="mt-1" value={draft.maxTrackedIssues} onChange={(event) => onChange("maxTrackedIssues", Number(event.target.value))} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="monitor-schedule-kind">{t("taskTracker.field.schedule")}</Label><select id="monitor-schedule-kind" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.scheduleKind} onChange={(event) => onChange("scheduleKind", event.target.value as TaskTrackerScheduleKind)}><option value="period">{t("taskTracker.schedule.period")}</option><option value="cron">{t("taskTracker.schedule.cron")}</option></select></div><div><Label htmlFor="monitor-schedule-value">{draft.scheduleKind === "period" ? t("taskTracker.field.seconds") : t("taskTracker.field.cron")}</Label><Input id="monitor-schedule-value" className="mt-1" value={draft.scheduleValue} onChange={(event) => onChange("scheduleValue", event.target.value)} placeholder={draft.scheduleKind === "period" ? "300" : "*/10 * * * *"} /></div></div>
            <fieldset><legend className="text-sm font-medium">{t("taskTracker.field.trackEvents")}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{ALL_EVENTS.map((event) => <label key={event} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.trackedEvents.includes(event)} onChange={(change) => onChange("trackedEvents", change.target.checked ? [...draft.trackedEvents, event] : draft.trackedEvents.filter((value) => value !== event))} />{t(EVENT_LABEL_KEYS[event])}</label>)}</div></fieldset>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          </div>
        </DialogBody>
        <DialogFooter className="flex-row justify-between gap-2">
          <div className="mr-auto flex items-center gap-2">
            {!editing ? <>
              <input ref={importInputRef} type="file" accept=".json,application/json" aria-label={t("taskTracker.import.fileLabel")} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} />
              <Button type="button" variant="outline" size="icon" aria-label={t("taskTracker.import.action")} title={t("taskTracker.import.action")} onClick={() => importInputRef.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
              </Button>
            </> : <Button type="button" variant="ghost" actionTone="delete" className="text-muted-foreground hover:bg-transparent hover:text-destructive" title={t("taskTracker.deleteMonitor", { name: draft.name })} onClick={onDelete}><Trash2 className="mr-2 size-4" aria-hidden="true" />{t("taskTracker.delete")}</Button>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("taskTracker.cancel")}</Button>
            <Button type="button" disabled={saving} onClick={onSave}>{saving ? t("taskTracker.saving") : editing ? t("taskTracker.saveChanges") : t("taskTracker.create")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
