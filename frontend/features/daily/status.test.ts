import { describe, expect, it } from "vitest";
import { dailyStatusBadgeClass, dailyStatusTone } from "./status";

describe("daily status colors", () => {
  it("uses gray for new work, blue for active work, and green for completed work", () => {
    expect(dailyStatusTone("Open", "new")).toBe("backlog");
    expect(dailyStatusTone("Ready to Test", "indeterminate")).toBe("progress");
    expect(dailyStatusTone("In Release", "indeterminate")).toBe("done");
    expect(dailyStatusTone("Closed", "done")).toBe("done");
    expect(dailyStatusBadgeClass("Closed", "done")).toContain("bg-success/20");
    expect(dailyStatusBadgeClass("In Release", "indeterminate")).toContain("bg-success/10");
    expect(dailyStatusBadgeClass("In Progress", "indeterminate")).toContain("text-chart-1");
  });
});
