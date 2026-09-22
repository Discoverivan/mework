import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskTrackerPage } from "./TaskTrackerPage";
import {
  listTaskTrackerMonitors,
  saveTaskTrackerMonitor,
  validateTaskTrackerJql,
} from "@/shared/contracts/task-tracker";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/shared/contracts/task-tracker", () => ({
  checkTaskTrackerNow: vi.fn(),
  deleteTaskTrackerMonitor: vi.fn(),
  listTaskTrackerMonitors: vi.fn(),
  saveTaskTrackerMonitor: vi.fn(),
  setTaskTrackerEnabled: vi.fn(),
  validateTaskTrackerJql: vi.fn(),
}));

const monitor: TaskTrackerMonitor = {
  id: "monitor-1",
  name: "Open tasks",
  jql: "project = DEMO AND resolution = Unresolved",
  scheduleKind: "period" as const,
  scheduleValue: "300",
  trackedEvents: ["newIssues", "removedIssues", "statusChanges", "newComments"],
  enabled: true,
  lastSuccessAt: "2026-09-22T10:00:00Z",
  nextCheckAt: Date.parse("2026-09-22T10:05:00Z"),
  currentIssueCount: 1,
  changesAfterLastCheck: 1,
  lastError: null,
  issues: [{
    key: "DEMO-1",
    summary: "Example task",
    status: "In Progress",
    priority: "High",
    assignee: "Example User",
    updated: "2026-09-22T10:00:00Z",
    issueUrl: "https://jira.example.invalid/browse/DEMO-1",
    changed: true,
    lastChange: { kind: "status" as const, description: "Status changed: To Do → In Progress.", detectedAt: "2026-09-22T10:00:00Z" },
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTaskTrackerMonitors).mockResolvedValue([monitor]);
  vi.mocked(validateTaskTrackerJql).mockResolvedValue({ issueCount: 1, truncated: false, issues: monitor.issues });
  vi.mocked(saveTaskTrackerMonitor).mockResolvedValue(monitor);
});

describe("TaskTrackerPage", () => {
  it("loads a monitor, filters changed issues, and validates a JQL draft", async () => {
    render(<TaskTrackerPage />);

    expect(await screen.findByRole("heading", { name: "Task Tracker" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "DEMO-1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Updated/ })).toBeInTheDocument();
    expect(screen.getByText(/Last update /)).toBeInTheDocument();
    expect(screen.getAllByText("In Progress").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(monitor.jql)).toBeInTheDocument();
    const copyJqlButton = screen.getByRole("button", { name: "Copy JQL" });
    expect(copyJqlButton.parentElement?.querySelector("code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("label")?.textContent).toBe("Enabled");
    vi.mocked(validateTaskTrackerJql).mockResolvedValueOnce({ issueCount: 10, truncated: true, issues: monitor.issues });
    fireEvent.click(screen.getByRole("button", { name: "Validate JQL" }));
    await waitFor(() => expect(validateTaskTrackerJql).toHaveBeenCalledWith(monitor.jql));
    expect(screen.getByText("JQL valid, found issues: 10+")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Example task");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "New monitor" }));
    const createDialog = screen.getByRole("dialog");
    expect(createDialog.querySelector("label")?.textContent).toBe("Name");
    expect(createDialog.textContent).not.toContain("Enabled");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Only changed" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText("Only changed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByText("Only changed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DEMO-1" })).toBeInTheDocument();
  });

  it("applies filter changes only after Apply and removes a filter chip with its close button", async () => {
    render(<TaskTrackerPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "no-match" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "DEMO-1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "no-match" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("button", { name: "DEMO-1" })).not.toBeInTheDocument();
    expect(screen.getByText("Search: no-match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Search: no-match" }));
    expect(screen.queryByText("Search: no-match")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DEMO-1" })).toBeInTheDocument();
  });

  it("shows and clears an unread tab indicator when selecting a monitor", async () => {
    const unreadMonitor: TaskTrackerMonitor = {
      ...monitor,
      id: "monitor-2",
      name: "Recently changed",
      lastSuccessAt: "2026-09-22T11:00:00Z",
      changesAfterLastCheck: 1,
    };
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([monitor, unreadMonitor]);
    render(<TaskTrackerPage />);

    const tab = await screen.findByRole("tab", { name: /Recently changed/ });
    expect(tab.querySelector(".bg-blue-500")).toBeInTheDocument();
    fireEvent.click(tab);
    expect(tab.querySelector(".bg-blue-500")).not.toBeInTheDocument();
  });

  it("marks changed rows as read without changing the change history", async () => {
    render(<TaskTrackerPage />);
    const issueButton = await screen.findByRole("button", { name: "DEMO-1" });
    expect(issueButton.querySelector(".bg-blue-500")).toBeInTheDocument();
    const markReadButton = screen.getByRole("button", { name: "Mark all as read" });
    fireEvent.click(markReadButton);
    expect(issueButton.querySelector(".bg-blue-500")).not.toBeInTheDocument();
    expect(markReadButton).toBeDisabled();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });

  it("sorts changed issues before unchanged issues and then by the selected header", async () => {
    const sortableMonitor: TaskTrackerMonitor = {
      ...monitor,
      currentIssueCount: 3,
      issues: [
        { ...monitor.issues[0], key: "DEMO-2", summary: "Alpha summary", changed: false, lastChange: null },
        { ...monitor.issues[0], key: "DEMO-1", summary: "Zeta summary", changed: true },
        { ...monitor.issues[0], key: "DEMO-3", summary: "Alpha changed summary", changed: true },
      ],
    };
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([sortableMonitor]);
    render(<TaskTrackerPage />);

    const rows = () => screen.getAllByRole("row").slice(1);
    expect((await screen.findByRole("button", { name: "DEMO-1" }))).toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent("DEMO-1");
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    expect(rows()[0]).toHaveTextContent("DEMO-3");
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    expect(rows()[0]).toHaveTextContent("DEMO-1");
  });

  it("hides monitor tabs until the first monitor exists", async () => {
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([]);
    render(<TaskTrackerPage />);

    expect(await screen.findByRole("heading", { name: "No monitors yet" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Task Tracker monitors" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create monitor" })).toHaveLength(1);
  });
});
