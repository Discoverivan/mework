import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";

export const TASK_TRACKER_READ_CHECKPOINTS_KEY = "mework.task-tracker.read-checkpoints.v1";

export interface TaskTrackerReadCheckpoints {
  [monitorId: string]: string | null;
}

export interface TaskTrackerReadStateChanged {
  monitorId: string;
  checkpoint: string | null;
}

export function loadTaskTrackerReadCheckpoints(): TaskTrackerReadCheckpoints {
  try {
    const raw = localStorage.getItem(TASK_TRACKER_READ_CHECKPOINTS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string | null] =>
        typeof entry[1] === "string" || entry[1] === null,
      ),
    );
  } catch {
    return {};
  }
}

export function saveTaskTrackerReadCheckpoint(
  monitorId: string,
  checkpoint: string | null,
): TaskTrackerReadCheckpoints {
  const next = { ...loadTaskTrackerReadCheckpoints(), [monitorId]: checkpoint };
  try {
    localStorage.setItem(TASK_TRACKER_READ_CHECKPOINTS_KEY, JSON.stringify(next));
  } catch {
    // Keep the current session responsive if browser storage is unavailable.
  }
  return next;
}

export function countUnreadTaskTrackerIssues(
  monitors: TaskTrackerMonitor[],
  checkpoints: TaskTrackerReadCheckpoints = loadTaskTrackerReadCheckpoints(),
): number {
  return monitors.reduce((total, monitor) => {
    const checkpoint = monitor.lastSuccessAt ?? null;
    const hasReadCheckpoint = Object.prototype.hasOwnProperty.call(checkpoints, monitor.id);
    if (hasReadCheckpoint && checkpoints[monitor.id] === checkpoint) return total;
    return total + monitor.issues.filter((issue) => issue.changed).length;
  }, 0);
}
