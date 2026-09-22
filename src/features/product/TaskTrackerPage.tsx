import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CheckCheck, ChevronDown, ChevronUp, Copy, ExternalLink, Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2, X } from "lucide-react";

import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { PageHeader } from "@/components/shared/PageHeader";
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
  validateTaskTrackerJql,
} from "@/shared/contracts/task-tracker";
import type {
  TaskTrackerChangeKind,
  TaskTrackerEventKind,
  TaskTrackerIssue,
  TaskTrackerMonitor,
  TaskTrackerMonitorInput,
  TaskTrackerScheduleKind,
} from "@/shared/contracts/task-tracker";

const ALL_EVENTS: Array<{ value: TaskTrackerEventKind; label: string }> = [
  { value: "newIssues", label: "New issues" },
  { value: "removedIssues", label: "Removed issues" },
  { value: "statusChanges", label: "Status changes" },
  { value: "newComments", label: "New comments" },
];

const CHANGE_LABELS: Record<TaskTrackerChangeKind, string> = {
  new: "New",
  status: "Status",
  comment: "Comment",
  removed: "Removed",
};

type MonitorDraft = TaskTrackerMonitorInput;

type FilterChange = "all" | TaskTrackerChangeKind;
type SortKey = "issue" | "summary" | "status" | "updated" | "change";
type SortDirection = "asc" | "desc";
type ActiveFilterKey = "search" | "status" | "change" | "onlyChanged";

function emptyDraft(): MonitorDraft {
  return {
    name: "",
    jql: "",
    scheduleKind: "period",
    scheduleValue: "300",
    trackedEvents: ALL_EVENTS.map((event) => event.value),
    enabled: true,
  };
}

function errorMessage(reason: unknown): string {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (typeof reason === "object" && reason !== null && "message" in reason && typeof reason.message === "string") {
    return reason.message;
  }
  return "Task Tracker operation failed.";
}

function formatRelativeTime(value: string, now: number): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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

export function TaskTrackerPage() {
  const [monitors, setMonitors] = useState<TaskTrackerMonitor[]>([]);
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
  const [readChanges, setReadChanges] = useState<Record<string, string | null>>({});
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

  async function loadMonitors(showSpinner = true) {
    const revision = monitorsRevision.current + 1;
    monitorsRevision.current = revision;
    if (showSpinner) setRefreshing(true);
    try {
      const next = await listTaskTrackerMonitors();
      if (monitorsRevision.current !== revision) return;
      setMonitors(next);
      setActiveId((current) => current && next.some((monitor) => monitor.id === current) ? current : next[0]?.id);
      setPageError(undefined);
    } catch (reason) {
      if (monitorsRevision.current === revision) setPageError(errorMessage(reason));
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
      setMonitors(updatedMonitors);
      setActiveId((current) => current && updatedMonitors.some((monitor) => monitor.id === current) ? current : updatedMonitors[0]?.id);
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
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return [...filteredIssues].sort((left, right) => {
      if (left.changed !== right.changed) return left.changed ? -1 : 1;
      const value = (issue: TaskTrackerIssue): string => {
        if (sortKey === "issue") return issue.key;
        if (sortKey === "summary") return issue.summary;
        if (sortKey === "status") return issue.status;
        if (sortKey === "updated") return issue.updated ?? "";
        return issue.lastChange ? CHANGE_LABELS[issue.lastChange.kind] : "";
      };
      const comparison = collator.compare(value(left), value(right));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredIssues, sortDirection, sortKey]);

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
    setReadChanges((current) => ({ ...current, [activeMonitor.id]: checkpoint }));
    setViewedChanges((current) => ({ ...current, [activeMonitor.id]: checkpoint }));
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
    });
    setValidation(undefined);
    setDialogError(undefined);
    setDialogOpen(true);
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
      setDialogError(errorMessage(reason));
    } finally {
      setValidating(false);
    }
  }

  async function saveMonitor() {
    setSaving(true);
    setDialogError(undefined);
    try {
      const saved = await saveTaskTrackerMonitor(draft);
      setMonitors((current) => {
        const exists = current.some((monitor) => monitor.id === saved.id);
        return exists ? current.map((monitor) => monitor.id === saved.id ? saved : monitor) : [...current, saved];
      });
      setActiveId(saved.id);
      setDialogOpen(false);
    } catch (reason) {
      setDialogError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function removeMonitor(monitor: TaskTrackerMonitor) {
    if (!window.confirm(`Delete monitor “${monitor.name}”?`)) return;
    try {
      await deleteTaskTrackerMonitor(monitor.id);
      const next = monitors.filter((item) => item.id !== monitor.id);
      setMonitors(next);
      setActiveId(next[0]?.id);
    } catch (reason) {
      setPageError(errorMessage(reason));
    }
  }

  async function checkNow() {
    if (!activeMonitor) return;
    setChecking(true);
    setPageError(undefined);
    try {
      const updated = await checkTaskTrackerNow(activeMonitor.id);
      setMonitors((current) => current.map((monitor) => monitor.id === updated.id ? updated : monitor));
    } catch (reason) {
      setPageError(errorMessage(reason));
      await loadMonitors(false);
    } finally {
      setChecking(false);
    }
  }

  const statuses = statusValues(activeMonitor?.issues ?? []);
  const activeFilterBadges: Array<{ key: ActiveFilterKey; label: string }> = [
    ...(search.trim() ? [{ key: "search" as const, label: `Search: ${search.trim()}` }] : []),
    ...(statusFilter !== "all" ? [{ key: "status" as const, label: `Status: ${statusFilter}` }] : []),
    ...(changeFilter !== "all" ? [{ key: "change" as const, label: `Change: ${CHANGE_LABELS[changeFilter]}` }] : []),
    ...(onlyChanged ? [{ key: "onlyChanged" as const, label: "Only changed" }] : []),
  ];
  const changesRead = activeMonitor ? readChanges[activeMonitor.id] === (activeMonitor.lastSuccessAt ?? null) : false;

  if (loading) {
    return <div role="status" className="space-y-4"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task Tracker"
        titleId="task-tracker-title"
        description="Monitor Jira issues with independent JQL schedules and desktop notifications."
      />

      {pageError ? <Alert variant="destructive"><AlertTitle>Task Tracker unavailable</AlertTitle><AlertDescription>{pageError}</AlertDescription></Alert> : null}

      {monitors.length > 0 ? <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto border-b border-border pb-2" role="tablist" aria-label="Task Tracker monitors">
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
              <span className="text-xs opacity-75">{monitor.currentIssueCount}</span>
              {monitor.changesAfterLastCheck > 0 && viewedChanges[monitor.id] !== (monitor.lastSuccessAt ?? null) ? <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={openCreate}><Plus className="mr-2 size-4" aria-hidden="true" />New monitor</Button>
      </div> : null}

      {!activeMonitor ? (
        <section className="rounded-lg border border-dashed border-border p-10 text-center">
          <h2 className="text-lg font-semibold">No monitors yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Create a monitor to start tracking Jira issues from a JQL query.</p>
          <Button type="button" className="mt-4" onClick={openCreate}><Plus className="mr-2 size-4" aria-hidden="true" />Create monitor</Button>
        </section>
      ) : (
        <section className="space-y-4" aria-labelledby="active-monitor-title">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 items-center gap-3">
                <h2 id="active-monitor-title" className="shrink-0 text-xl font-semibold">{activeMonitor.name}</h2>
                <Badge className={activeMonitor.enabled ? "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-transparent bg-muted text-muted-foreground"}>{activeMonitor.enabled ? "Enabled" : "Disabled"}</Badge>
                <Badge variant="secondary">Last update {formatRelativeTime(activeMonitor.lastSuccessAt ?? "", now)}</Badge>
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <code className="block min-w-0 truncate rounded bg-muted px-3 py-2 pr-12 font-mono text-xs" title={activeMonitor.jql}>{activeMonitor.jql}</code>
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2" aria-label={jqlCopied ? "JQL copied" : "Copy JQL"} title={jqlCopied ? "JQL copied" : "Copy JQL"} onClick={() => void copyJql()}>{jqlCopied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}</Button>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => void checkNow()}><RefreshCw className={`mr-2 size-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />{checking ? "Checking…" : "Check now"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => openEdit(activeMonitor)}><Pencil className="mr-2 size-4" aria-hidden="true" />Edit</Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${activeMonitor.name}`} title={`Delete ${activeMonitor.name}`} onClick={() => void removeMonitor(activeMonitor)}><Trash2 className="size-4 text-destructive" aria-hidden="true" /></Button>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={openFilters}><SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />Filters{activeFilterBadges.length > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">{activeFilterBadges.length}</span> : null}</Button>
              {activeFilterBadges.map((filter) => <div key={filter.key} className="inline-flex max-w-[24rem] items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-sm"><span className="truncate">{filter.label}</span><button type="button" className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground" aria-label={`Remove ${filter.label}`} title={`Remove ${filter.label}`} onClick={() => removeFilter(filter.key)}><X className="size-3.5" aria-hidden="true" /></button></div>)}
            </div>
            <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0 whitespace-nowrap" disabled={changesRead || !activeMonitor.issues.some((issue) => issue.changed)} onClick={markAllRead}><CheckCheck className="mr-2 size-4" aria-hidden="true" />Mark all as read</Button>
          </div>

          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Filters</DialogTitle><DialogDescription>Choose which issues to show in the table.</DialogDescription></DialogHeader>
              <DialogBody>
                <div className="space-y-4">
                  <div><Label htmlFor="task-tracker-search">Search</Label><Input id="task-tracker-search" className="mt-1" value={filterDraftSearch} onChange={(event) => setFilterDraftSearch(event.target.value)} placeholder="Issue, summary, or assignee" /></div>
                  <div><Label htmlFor="task-tracker-status">Status</Label><select id="task-tracker-status" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={filterDraftStatus} onChange={(event) => setFilterDraftStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
                  <div><Label htmlFor="task-tracker-change">Change type</Label><select id="task-tracker-change" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={filterDraftChange} onChange={(event) => setFilterDraftChange(event.target.value as FilterChange)}><option value="all">All change types</option><option value="new">New</option><option value="status">Status</option><option value="comment">Comment</option><option value="removed">Removed</option></select></div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filterDraftOnlyChanged} onChange={(event) => setFilterDraftOnlyChanged(event.target.checked)} />Only changed</label>
                </div>
              </DialogBody>
              <DialogFooter className="sm:justify-between"><Button type="button" variant="outline" onClick={clearFilterDraft} disabled={!filterDraftSearch.trim() && filterDraftStatus === "all" && filterDraftChange === "all" && !filterDraftOnlyChanged}>Clear filters</Button><Button type="button" onClick={applyFilters}>Apply</Button></DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr><SortableHeader label="Issue" sortKey="issue" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} className="w-40 min-w-40 whitespace-nowrap" /><SortableHeader label="Summary" sortKey="summary" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /><SortableHeader label="Status" sortKey="status" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /><SortableHeader label="Updated" sortKey="updated" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /><SortableHeader label="Change" sortKey="change" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} /></tr></thead>
              <tbody className="divide-y divide-border">
                {visibleIssues.map((issue) => <IssueRow key={issue.key} issue={issue} now={now} unread={issue.changed && !changesRead} />)}
                {visibleIssues.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No matching issues.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Showing {filteredIssues.length} issues</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
              <span>Page {currentPage} of {pageCount}</span>
              <Button type="button" variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button>
            </div>
          </div>
        </section>
      )}

      <MonitorDialog
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
        onSave={() => void saveMonitor()}
      />
      <div className="sr-only" aria-live="polite">{refreshing ? "Refreshing monitors" : ""}</div>
    </div>
  );
}

function IssueRow({ issue, now, unread }: { issue: TaskTrackerIssue; now: number; unread: boolean }) {
  return (
    <tr className={unread ? changeClass(issue.lastChange?.kind) : undefined}>
      <td className="w-40 min-w-40 whitespace-nowrap px-4 py-3 align-top"><button type="button" className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary hover:underline" onClick={() => void openUrl(issue.issueUrl)}>{unread ? <span className="size-2 shrink-0 rounded-full bg-blue-500" aria-hidden="true" /> : null}{issue.key}<ExternalLink className="size-3 shrink-0" aria-hidden="true" /></button></td>
      <td className="max-w-[34rem] px-4 py-3 align-top">{issue.summary}</td>
      <td className="px-4 py-3 align-top"><Badge className={statusBadgeClass(issue.status)}>{issue.status || "Unknown"}</Badge></td>
      <td className="whitespace-nowrap px-4 py-3 align-top">{formatRelativeTime(issue.updated ?? "", now)}</td>
      <td className="px-4 py-3 align-top">{issue.lastChange ? <Badge className={changeBadgeClass(issue.lastChange.kind)}>{CHANGE_LABELS[issue.lastChange.kind]}</Badge> : <span className="text-muted-foreground">—</span>}</td>
    </tr>
  );
}

interface MonitorDialogProps {
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
  onSave: () => void;
}

function MonitorDialog({ open, editing, draft, saving, validating, validation, error, onOpenChange, onChange, onValidate, onSave }: MonitorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit monitor" : "Create monitor"}</DialogTitle><DialogDescription>Define the Jira JQL, polling schedule, and changes this monitor should track.</DialogDescription></DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {editing ? <div className="flex items-center gap-3"><Switch checked={draft.enabled} onCheckedChange={(checked) => onChange("enabled", checked)} /><Label>Enabled</Label></div> : null}
            <div><Label htmlFor="monitor-name">Name</Label><Input id="monitor-name" className="mt-1" value={draft.name} onChange={(event) => onChange("name", event.target.value)} placeholder="Open platform tasks" /></div>
            <div><Label htmlFor="monitor-jql">JQL</Label><textarea id="monitor-jql" className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" value={draft.jql} onChange={(event) => onChange("jql", event.target.value)} placeholder="project = DEMO AND resolution = Unresolved" /><Button type="button" variant="outline" size="sm" className="mt-2" disabled={validating || !draft.jql.trim()} onClick={onValidate}>{validating ? "Validating…" : "Validate JQL"}</Button>{validation ? <p className="mt-2 text-sm text-muted-foreground">JQL valid, found issues: {validation.truncated ? `${validation.count}+` : validation.count}</p> : null}</div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="monitor-schedule-kind">Schedule</Label><select id="monitor-schedule-kind" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.scheduleKind} onChange={(event) => onChange("scheduleKind", event.target.value as TaskTrackerScheduleKind)}><option value="period">Period</option><option value="cron">Cron</option></select></div><div><Label htmlFor="monitor-schedule-value">{draft.scheduleKind === "period" ? "Seconds" : "Cron expression"}</Label><Input id="monitor-schedule-value" className="mt-1" value={draft.scheduleValue} onChange={(event) => onChange("scheduleValue", event.target.value)} placeholder={draft.scheduleKind === "period" ? "300" : "*/10 * * * *"} /></div></div>
            <fieldset><legend className="text-sm font-medium">Track events</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{ALL_EVENTS.map((event) => <label key={event.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.trackedEvents.includes(event.value)} onChange={(change) => onChange("trackedEvents", change.target.checked ? [...draft.trackedEvents, event.value] : draft.trackedEvents.filter((value) => value !== event.value))} />{event.label}</label>)}</div></fieldset>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          </div>
        </DialogBody>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" disabled={saving} onClick={onSave}>{saving ? "Saving…" : editing ? "Save changes" : "Create monitor"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
