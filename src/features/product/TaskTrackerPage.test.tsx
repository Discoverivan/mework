import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";

import { TaskTrackerPage } from "./TaskTrackerPage";
import { I18nContext } from "@/i18n/context";
import { ru } from "@/i18n/locales/ru";
import { AppLanguage, APP_LANGUAGE_LOCALES } from "@/i18n/types";
import {
  listTaskTrackerMonitors,
  saveTaskTrackerMonitor,
  saveTaskTrackerMonitorExport,
  validateTaskTrackerJql,
} from "@/shared/contracts/task-tracker";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/shared/contracts/task-tracker", () => ({
  checkTaskTrackerNow: vi.fn(),
  deleteTaskTrackerMonitor: vi.fn(),
  listTaskTrackerMonitors: vi.fn(),
  saveTaskTrackerMonitor: vi.fn(),
  saveTaskTrackerMonitorExport: vi.fn(),
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
  maxTrackedIssues: 100,
  exceedsLimit: false,
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
  vi.mocked(saveTaskTrackerMonitorExport).mockResolvedValue(undefined);
});

describe("TaskTrackerPage", () => {
  it("loads a monitor, filters changed issues, and validates a JQL draft", async () => {
    render(<TaskTrackerPage />);

    expect(await screen.findByRole("heading", { name: "Task tracker" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "DEMO-1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Updated/ })).toBeInTheDocument();
    expect(screen.getByText(/Last update /)).toBeInTheDocument();
    expect(screen.getAllByText("In Progress").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(monitor.jql)).toBeInTheDocument();
    const newMonitorButton = screen.getByRole("button", { name: "Create monitor" });
    expect(newMonitorButton).not.toHaveTextContent("Create monitor");
    expect(newMonitorButton).toHaveAttribute("title", "Create monitor");
    expect(newMonitorButton.closest("header")).toBeInTheDocument();
    expect(newMonitorButton).toHaveClass("h-9", "w-9", "bg-primary");
    const headerActionLabels = ["Export monitor settings", "Check now", "Edit monitor"];
    const headerActionButtons = headerActionLabels.map((label) => screen.getByRole("button", { name: label }));
    headerActionButtons.forEach((button, index) => {
      expect(button).not.toHaveTextContent(headerActionLabels[index]);
      expect(button).toHaveAttribute("title", headerActionLabels[index]);
    });
    expect(Array.from(headerActionButtons[0].parentElement?.querySelectorAll("button") ?? [])).toEqual(headerActionButtons);
    const copyJqlButton = screen.getByRole("button", { name: "Copy JQL" });
    expect(copyJqlButton).toHaveAttribute("title", "Copy JQL");
    expect(copyJqlButton.parentElement?.querySelector("code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit monitor" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" }).parentElement).toHaveClass("mr-auto");
    expect(screen.getByRole("dialog").querySelector("label")?.textContent).toBe("Enabled");
    vi.mocked(validateTaskTrackerJql).mockResolvedValueOnce({ issueCount: 10, truncated: true, issues: monitor.issues });
    fireEvent.click(screen.getByRole("button", { name: "Validate JQL" }));
    await waitFor(() => expect(validateTaskTrackerJql).toHaveBeenCalledWith(monitor.jql));
    expect(screen.getByText("JQL is valid. Issues found: 10+")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Example task");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    const createDialog = screen.getByRole("dialog");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(createDialog.textContent).toContain("Enabled");
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name").closest("[class*='overflow-y-auto']")).toHaveClass("pr-3");
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

  it("imports valid monitor JSON into the create form", async () => {
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([]);
    render(<TaskTrackerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create monitor" }));
    const importButton = screen.getByRole("button", { name: "Import from JSON" });
    expect(importButton).toHaveAttribute("title", "Import from JSON");
    expect(importButton).not.toHaveTextContent("Import from JSON");
    expect(importButton.querySelector("svg")).toBeInTheDocument();
    expect(importButton.parentElement).toHaveClass("mr-auto");
    expect(screen.getByLabelText("Maximum tracked issues")).toHaveValue(100);
    const file = new File([JSON.stringify({
      format: "mework-task-tracker-monitor",
      version: 1,
      monitor: {
        name: "Imported monitor",
        jql: "project = DEMO",
        scheduleKind: "period",
        scheduleValue: "600",
        trackedEvents: ["newIssues", "statusChanges"],
        enabled: true,
        maxTrackedIssues: 250,
      },
    })], "monitor.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import monitor JSON file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Imported monitor"));
    expect(screen.getByLabelText("JQL")).toHaveValue("project = DEMO");
    expect(screen.getByLabelText("Maximum tracked issues")).toHaveValue(250);
    expect(screen.getByLabelText("Schedule")).toHaveValue("period");
    expect(screen.getByLabelText("Seconds")).toHaveValue("600");
    expect(screen.getByRole("checkbox", { name: "New issues" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Removed issues" })).not.toBeChecked();
  });

  it("opens a JSON save dialog and writes the monitor settings to the chosen path", async () => {
    const exportMonitor = { ...monitor, maxTrackedIssues: 100, exceedsLimit: false } as TaskTrackerMonitor;
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([exportMonitor]);
    vi.mocked(save).mockResolvedValue("/tmp/open-tasks.json");

    render(<TaskTrackerPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Export monitor settings" }));

    await waitFor(() => expect(saveTaskTrackerMonitorExport).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({
      title: "Save monitor settings",
      defaultPath: "open-tasks.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    expect(saveTaskTrackerMonitorExport).toHaveBeenCalledWith("/tmp/open-tasks.json", {
      name: "Open tasks",
      jql: monitor.jql,
      scheduleKind: "period",
      scheduleValue: "300",
      trackedEvents: ["newIssues", "removedIssues", "statusChanges", "newComments"],
      enabled: true,
      maxTrackedIssues: 100,
    });
  });

  it("replaces the monitor issue count with a warning and an error panel above its limit", async () => {
    const overLimitMonitor = { ...monitor, exceedsLimit: true, maxTrackedIssues: 100 } as TaskTrackerMonitor;
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([overLimitMonitor]);
    render(<TaskTrackerPage />);

    const tab = await screen.findByRole("tab", { name: /Open tasks/ });
    expect(screen.getByRole("img", { name: "Monitor issue limit exceeded" })).toBeInTheDocument();
    expect(tab).not.toHaveTextContent("1");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("JQL returned more than 100 issues");
    const alertContent = alert.querySelector(".flex.items-start");
    expect(alertContent).toContainElement(alert.querySelector("svg"));
    expect(alertContent).toContainElement(screen.getByText("Too many issues to track"));
    expect(alertContent).toContainElement(screen.getByText(/JQL returned more than 100 issues/));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("uses the selected Russian translation for the section heading", async () => {
    const title = "Трекер задач";
    render(
      <I18nContext.Provider value={{
        language: AppLanguage.Russian,
        locale: APP_LANGUAGE_LOCALES[AppLanguage.Russian],
        themePreference: "system",
        resolvedTheme: "light",
        appearanceSaving: false,
        updateAppearance: async () => { throw new Error("not used"); },
        t: (key, params) => {
          const template = ru[key];
          return params ? template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
          ) : template;
        },
      }}>
        <TaskTrackerPage />
      </I18nContext.Provider>,
    );

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Создать монитор" }));
    expect(screen.getByRole("heading", { name: "Создать монитор" })).toBeInTheDocument();
    expect(screen.getByLabelText("Название")).toBeInTheDocument();
  });

  it("hides monitor tabs until the first monitor exists", async () => {
    vi.mocked(listTaskTrackerMonitors).mockResolvedValue([]);
    render(<TaskTrackerPage />);

    expect(await screen.findByRole("heading", { name: "No monitors yet" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("min-h-72", "border-dashed", "bg-card");
    expect(screen.getByRole("status").querySelector("svg.lucide-radar")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Task tracker monitors" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create monitor" }).closest("header")).toBeInTheDocument();
  });
});
