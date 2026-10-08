import type { DailySubtask } from "@/shared/contracts/developer";
import { dailyStatusTone } from "./status";

export type DailyProgressCategory = "backlog" | "progress" | "done";

export interface DailyProgressMetrics {
  completedPoints: number;
  inProgressPoints: number;
  backlogPoints: number;
  totalPoints: number;
  completedPercent: number;
  inProgressPercent: number;
  backlogPercent: number;
}

export function dailyProgressCategory(status: string): DailyProgressCategory {
  const tone = dailyStatusTone(status);
  if (tone === "done") return "done";
  if (tone === "backlog") return "backlog";
  return "progress";
}

export function dailyProgressMetrics(
  tasks: Pick<DailySubtask, "status" | "storyPoints">[],
): DailyProgressMetrics {
  const points = tasks.reduce((metrics, task) => {
    const storyPoints = task.storyPoints ?? 0;
    const category = dailyProgressCategory(task.status);
    if (category === "done") metrics.completedPoints += storyPoints;
    else if (category === "backlog") metrics.backlogPoints += storyPoints;
    else metrics.inProgressPoints += storyPoints;
    return metrics;
  }, { completedPoints: 0, inProgressPoints: 0, backlogPoints: 0 });
  const totalPoints = points.completedPoints + points.inProgressPoints + points.backlogPoints;
  const percent = (value: number) => totalPoints > 0 ? Math.round((value / totalPoints) * 100) : 0;

  return {
    ...points,
    totalPoints,
    completedPercent: percent(points.completedPoints),
    inProgressPercent: percent(points.inProgressPoints),
    backlogPercent: percent(points.backlogPoints),
  };
}

export function formatStatusTransitionDate(value?: string): string | undefined {
  const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) return undefined;
  return `${day}.${month}.${year}`;
}
