import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { IntegrationRedacted } from "../shared/contracts/settings";
import type { MyPullRequestPage } from "../shared/contracts/developer";
import type { TaskTrackerMonitor } from "../shared/contracts/task-tracker";
import { APP_EVENT, emitAppEvent } from "./app-events";
import App from "../App";

vi.mock("../features/settings/SettingsPage", () => ({
  SettingsPage: ({ section }: { section?: string }) => <h1>{section === "projects" ? "Team settings" : section === "ai" ? "AI settings" : section === "general" ? "General" : "Data integrations"}</h1>,
}));

vi.mock("../features/developer/MyPullRequestsPage", () => ({
  MyPullRequestsPage: () => <h1>Pull requests awaiting your review</h1>,
}));

vi.mock("../features/developer/AuthoredPullRequestsPage", () => ({
  AuthoredPullRequestsPage: () => <h1>Pull requests authored by you</h1>,
}));
const { getAiSettingsMock, getPullRequestUnreadCountsMock, refreshAuthoredPullRequestsMock, refreshMyPullRequestsMock, refreshAllIntegrationsHealthMock, listTaskTrackerMonitorsMock, nativeThemeMock, onThemeChangedMock } = vi.hoisted(() => ({
  getAiSettingsMock: vi.fn().mockResolvedValue({
    settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
    providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["gpt-5.5"] }],
  }),
  getPullRequestUnreadCountsMock: vi.fn().mockResolvedValue({ reviewer: 0, authored: 0 }),
  refreshAuthoredPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  refreshMyPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  refreshAllIntegrationsHealthMock: vi.fn().mockResolvedValue([]),
  listTaskTrackerMonitorsMock: vi.fn().mockResolvedValue([]),
  nativeThemeMock: vi.fn().mockResolvedValue("dark"),
  onThemeChangedMock: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ theme: nativeThemeMock, onThemeChanged: onThemeChangedMock }),
}));

vi.mock("../features/developer/api", () => ({
  getPullRequestUnreadCounts: getPullRequestUnreadCountsMock,
  refreshAuthoredPullRequests: refreshAuthoredPullRequestsMock,
  refreshMyPullRequests: refreshMyPullRequestsMock,
}));

vi.mock("@/shared/contracts/task-tracker", () => ({
  checkTaskTrackerNow: vi.fn(),
  deleteTaskTrackerMonitor: vi.fn(),
  listTaskTrackerMonitors: listTaskTrackerMonitorsMock,
  saveTaskTrackerMonitor: vi.fn(),
  saveTaskTrackerMonitorExport: vi.fn(),
  setTaskTrackerEnabled: vi.fn(),
  validateTaskTrackerJql: vi.fn(),
}));

vi.mock("../features/settings/api", () => ({
  getAiSettings: getAiSettingsMock,
  listIntegrations: vi.fn().mockResolvedValue([
    {
      id: "jira-1",
      kind: "jira",
      baseUrl: "https://jira.example.com",
      accountKey: "account",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    },
    {
      id: "bitbucket-1",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.com",
      accountKey: "account",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    },
  ]),
  refreshAllIntegrationsHealth: refreshAllIntegrationsHealthMock,
}));

function trackerMonitor(id: string, checkpoint: string, changedCount: number): TaskTrackerMonitor {
  return {
    id,
    name: id,
    jql: "project = DEMO",
    scheduleKind: "period",
    scheduleValue: "300",
    trackedEvents: ["newIssues"],
    enabled: true,
    lastSuccessAt: checkpoint,
    currentIssueCount: changedCount,
    changesAfterLastCheck: changedCount,
    maxTrackedIssues: 100,
    exceedsLimit: false,
    issues: Array.from({ length: changedCount }, (_, index) => ({
      key: `DEMO-${index + 1}`,
      summary: `Changed task ${index + 1}`,
      status: "In Progress",
      priority: "High",
      issueUrl: `https://jira.example.invalid/browse/DEMO-${index + 1}`,
      changed: true,
    })),
  };
}

function pullRequestPage(activity: "new" | "updated" | "read"): MyPullRequestPage {
  return {
    values: [{
      integrationId: "bitbucket-1",
      pullRequestId: "7",
      title: "Example PR",
      state: "OPEN",
      repositorySlug: "sample-repository",
      repositoryName: "Sample repository",
      projectKey: "DEMO",
      sourceBranch: "feature/example",
      targetBranch: "main",
      authorDisplayName: "Example Author",
      myDecision: "not_reviewed",
      activity,
    }],
    total: 1,
    hasMore: false,
  };
}

describe("mework application shell", () => {
  beforeEach(() => {
    window.location.hash = "";
    window.localStorage.removeItem("mework.task-tracker.read-checkpoints.v1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    getAiSettingsMock.mockClear();
    getAiSettingsMock.mockResolvedValue({
      settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
      providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["gpt-5.5"] }],
    });
    getPullRequestUnreadCountsMock.mockReset();
    getPullRequestUnreadCountsMock.mockResolvedValue({ reviewer: 0, authored: 0 });
    refreshAuthoredPullRequestsMock.mockClear();
    refreshAuthoredPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    refreshMyPullRequestsMock.mockClear();
    refreshMyPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    refreshAllIntegrationsHealthMock.mockClear();
    listTaskTrackerMonitorsMock.mockReset();
    listTaskTrackerMonitorsMock.mockResolvedValue([]);
    nativeThemeMock.mockReset();
    nativeThemeMock.mockResolvedValue("dark");
    onThemeChangedMock.mockReset();
    onThemeChangedMock.mockResolvedValue(vi.fn());
  });

  it("keeps the splash visible until integration checks settle", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );

    render(<App />);
    expect(screen.getByRole("status", { name: "Loading mework" })).toBeInTheDocument();

    resolveHealth([]);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading mework" })).not.toBeInTheDocument());
  });

  it("releases the splash after ten seconds even when integration health never responds", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );
    vi.useFakeTimers();
    try {
      const view = render(<App />);
      expect(screen.getByRole("status", { name: "Loading mework" })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
      expect(screen.queryByRole("main", { name: "mework" })).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByRole("main", { name: "mework" })).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Loading mework" })).not.toBeInTheDocument();
      await act(async () => { resolveHealth([{
        id: "bitbucket-1",
        kind: "bitbucket",
        baseUrl: "https://bitbucket.example.com",
        enabled: true,
        healthStatus: "working",
        capabilities: [],
      }]); });
      expect(refreshMyPullRequestsMock).toHaveBeenCalledWith(0, 100);
      expect(screen.getByRole("main", { name: "mework" })).toBeInTheDocument();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the initial Bitbucket refresh before showing the main UI", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    let resolveRefresh!: (value: { values: never[]; total: number; hasMore: boolean }) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );
    refreshMyPullRequestsMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
    );

    render(<App />);
    expect(screen.getByRole("status", { name: "Loading mework" })).toBeInTheDocument();
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("main", { name: "mework" })).not.toBeInTheDocument();

    resolveHealth([{
      id: "bitbucket-1",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.com",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    }]);
    await waitFor(() => expect(refreshMyPullRequestsMock).toHaveBeenCalledWith(0, 100));
    expect(refreshAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100);
    expect(screen.queryByRole("main", { name: "mework" })).not.toBeInTheDocument();

    resolveRefresh({ values: [], total: 0, hasMore: false });
    expect(await screen.findByRole("main", { name: "mework" })).toBeInTheDocument();
  });

  it("opens pull requests awaiting your review by default", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Pull requests awaiting your review" })).toBeInTheDocument();
  });

  it("uses the native window theme for the system theme indicator", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(<App />);

    await screen.findByRole("main", { name: "mework" });
    const themePicker = screen.getByRole("combobox", { name: "Theme" });
    await waitFor(() => expect(themePicker.querySelector("svg.lucide-moon")).not.toBeNull());
    expect(themePicker.querySelector("svg.lucide-sun")).toBeNull();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("opens My Pull Requests from its dedicated hash route", async () => {
    render(<App />);
    await screen.findByRole("main", { name: "mework" });

    window.location.hash = "#developer/my-pull-requests";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByRole("heading", { name: "Pull requests authored by you" })).toBeInTheDocument();
  });

  it("opens AI settings from its dedicated hash route", async () => {
    window.location.hash = "#settings/ai";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "AI settings" })).toBeInTheDocument();
  });

  it("shows unread authored pull requests on the My Pull Requests navigation item", async () => {
    refreshAllIntegrationsHealthMock.mockResolvedValueOnce([{
      id: "bitbucket-1",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.com",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    }]);
    refreshAuthoredPullRequestsMock.mockResolvedValueOnce({
      values: [{ activity: "updated" }],
      total: 1,
      hasMore: false,
    });
    getPullRequestUnreadCountsMock
      .mockResolvedValueOnce({ reviewer: 0, authored: 0 })
      .mockResolvedValueOnce({ reviewer: 0, authored: 1 });

    render(<App />);
    await screen.findByRole("main", { name: "mework" });
    expect(await screen.findByRole("link", { name: "Your PRs, 1 unread" })).toHaveAttribute(
      "href",
      "#developer/my-pull-requests",
    );
    expect(refreshAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100);
  });

  it("shows unread changed tasks aggregated across all task-tracker monitors", async () => {
    window.localStorage.setItem(
      "mework.task-tracker.read-checkpoints.v1",
      JSON.stringify({ "read-monitor": "read-checkpoint" }),
    );
    listTaskTrackerMonitorsMock.mockResolvedValue([
      trackerMonitor("first-monitor", "first-checkpoint", 100),
      trackerMonitor("second-monitor", "second-checkpoint", 1),
      trackerMonitor("read-monitor", "read-checkpoint", 1),
    ]);

    render(<App />);

    const taskTrackerLink = await screen.findByRole("link", { name: "Task tracker, 101 unread" });
    expect(taskTrackerLink).toHaveAttribute("href", "#product/task-tracker");

    act(() => {
      emitAppEvent(APP_EVENT.taskTrackerReadStateChanged, {
        monitorId: "first-monitor",
        checkpoint: "first-checkpoint",
      });
    });
    expect(await screen.findByRole("link", { name: "Task tracker, 1 unread" })).toBe(taskTrackerLink);

    act(() => {
      emitAppEvent(APP_EVENT.taskTrackerUpdated, [
        trackerMonitor("first-monitor", "first-checkpoint", 2),
        trackerMonitor("second-monitor", "next-checkpoint", 2),
        trackerMonitor("read-monitor", "read-checkpoint", 1),
      ]);
    });
    expect(await screen.findByRole("link", { name: "Task tracker, 2 unread" })).toBe(taskTrackerLink);
  });

  it("does not let an older PR cache read overwrite the count after a newer activity event", async () => {
    render(<App />);
    await screen.findByRole("main", { name: "mework" });
    getPullRequestUnreadCountsMock.mockClear();

    let resolveStaleCounts!: (counts: { reviewer: number; authored: number }) => void;
    getPullRequestUnreadCountsMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveStaleCounts = resolve; }),
    );

    act(() => {
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
      emitAppEvent(APP_EVENT.reviewerPullRequestsUpdated, pullRequestPage("read"));
    });
    await waitFor(() => expect(getPullRequestUnreadCountsMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveStaleCounts({ reviewer: 1, authored: 0 });
    });

    const reviewerLink = screen.getByRole("link", { name: /^PRs to review/ });
    expect(reviewerLink).toHaveAccessibleName("PRs to review");
  });

  it("runs integration health checks when the app starts", async () => {
    render(<App />);

    await screen.findByRole("main", { name: "mework" });
    expect(refreshAllIntegrationsHealthMock).toHaveBeenCalledOnce();
    expect(getAiSettingsMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "Loading mework" })).not.toBeInTheDocument();
  });
});
