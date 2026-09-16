import { describe, expect, it } from "vitest";

import type { DailySubtask } from "@/shared/contracts/developer";
import { dailyProgressMetrics, formatStatusTransitionDate } from "./presenterMetrics";

function task(status: string, storyPoints: number): Pick<DailySubtask, "status" | "storyPoints"> {
  return { status, storyPoints };
}

describe("daily presenter metrics", () => {
  it("groups story points into completed, in-progress, and backlog segments", () => {
    expect(dailyProgressMetrics([
      task("Closed", 5),
      task("In Progress", 3),
      task("Ready to Test", 2),
      task("Testing", 1),
      task("Review", 3),
      task("Blocked", 2),
      task("To Do", 4),
    ])).toEqual({
      completedPoints: 5,
      inProgressPoints: 11,
      backlogPoints: 4,
      totalPoints: 20,
      completedPercent: 25,
      inProgressPercent: 55,
      backlogPercent: 20,
    });
  });

  it("formats the Jira transition date as a dotted calendar date", () => {
    expect(formatStatusTransitionDate("2026-09-14T16:32:10.000+0300")).toBe("14.09.2026");
    expect(formatStatusTransitionDate(undefined)).toBeUndefined();
  });
});
