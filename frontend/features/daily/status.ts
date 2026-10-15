export type DailyStatusTone = "backlog" | "progress" | "done";

const COMPLETED_STATUSES = new Set([
  "done",
  "closed",
  "resolved",
  "complete",
  "completed",
  "released",
  "in release",
]);

const NOT_STARTED_STATUSES = new Set([
  "new",
  "to do",
  "open",
  "backlog",
  "sprint backlog",
  "selected for development",
  "not started",
]);

export function dailyStatusTone(status: string, statusCategory?: string | null): DailyStatusTone {
  const normalized = status.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const category = statusCategory?.trim().toLowerCase();

  if (COMPLETED_STATUSES.has(normalized) || category === "done") return "done";
  if (NOT_STARTED_STATUSES.has(normalized) || category === "new") return "backlog";
  if (category === "indeterminate" || normalized.length > 0) return "progress";
  return "backlog";
}

export function dailyStatusBadgeClass(status: string, statusCategory?: string | null): string {
  const normalized = status.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (normalized === "in release") return "border-transparent bg-success/10 text-success";

  switch (dailyStatusTone(status, statusCategory)) {
    case "done":
      return "border-transparent bg-success/20 text-success";
    case "progress":
      return "border-transparent bg-chart-1/15 text-chart-1";
    case "backlog":
      return "border-transparent bg-muted text-muted-foreground";
  }
}
