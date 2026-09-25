import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IntegrationRedacted } from "../shared/contracts/settings";
import type { MyPullRequestPage } from "../shared/contracts/developer";
import type { TaskTrackerMonitor } from "../shared/contracts/task-tracker";
import { APP_EVENT, emitAppEvent } from "./app-events";
import App from "../App";

vi.mock("../features/daily/PresenterView", () => ({
  PresenterView: () => <h1>Daily presenter screen</h1>,
}));

vi.mock("../features/settings/SettingsPage", () => ({
  SettingsPage: ({ section }: { section?: string }) => <h1>{section === "projects" ? "Team settings" : section === "ai" ? "AI settings" : section === "general" ? "General" : "Data integrations"}</h1>,
}));

vi.mock("../features/settings/statistics/StatisticsPage", () => ({
  StatisticsPage: () => <h1>Statistics</h1>,
}));

vi.mock("../features/developer/MyPullRequestsPage", () => ({
  MyPullRequestsPage: () => <h1>Pull requests awaiting your review</h1>,
}));

vi.mock("../features/developer/AuthoredPullRequestsPage", () => ({
  AuthoredPullRequestsPage: () => <h1>Pull requests authored by you</h1>,
}));
const { devOverlayEnabledMock, getDevOverlayStateMock, addDevMockTaskMock, setDevMockTaskStatusMock, addDevMockPullRequestMock, resetDevMockScenarioMock, getAiSettingsMock, getPullRequestUnreadCountsMock, refreshAuthoredPullRequestsMock, refreshMyPullRequestsMock, refreshAllIntegrationsHealthMock, listTaskTrackerMonitorsMock, setAppBadgeCountMock, nativeThemeMock, onThemeChangedMock, releaseNotesStateMock, releaseNotesSinceMock, markReleaseNotesSeenMock, updaterCheckMock } = vi.hoisted(() => ({
  devOverlayEnabledMock: vi.fn().mockResolvedValue(false),
  getDevOverlayStateMock: vi.fn().mockResolvedValue({
    monitors: [],
    reviewerPullRequests: { values: [], total: 0, hasMore: false },
    authoredPullRequests: { values: [], total: 0, hasMore: false },
  }),
  addDevMockTaskMock: vi.fn(),
  setDevMockTaskStatusMock: vi.fn(),
  addDevMockPullRequestMock: vi.fn(),
  resetDevMockScenarioMock: vi.fn(),
  getAiSettingsMock: vi.fn().mockResolvedValue({
    settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
    providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["gpt-5.5"] }],
  }),
  getPullRequestUnreadCountsMock: vi.fn().mockResolvedValue({ reviewer: 0, authored: 0 }),
  refreshAuthoredPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  refreshMyPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  refreshAllIntegrationsHealthMock: vi.fn().mockResolvedValue([]),
  listTaskTrackerMonitorsMock: vi.fn().mockResolvedValue([]),
  setAppBadgeCountMock: vi.fn().mockResolvedValue(undefined),
  nativeThemeMock: vi.fn().mockResolvedValue("dark"),
  onThemeChangedMock: vi.fn().mockResolvedValue(vi.fn()),
  releaseNotesStateMock: vi.fn(),
  releaseNotesSinceMock: vi.fn(),
  markReleaseNotesSeenMock: vi.fn(),
  updaterCheckMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../release-notes", () => ({
  getReleaseNotesState: releaseNotesStateMock,
  releaseNotesSince: releaseNotesSinceMock,
  markReleaseNotesSeen: markReleaseNotesSeenMock,
  allReleaseNotes: () => [],
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterCheckMock }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ theme: nativeThemeMock, onThemeChanged: onThemeChangedMock }),
}));

vi.mock("../features/developer/api", () => ({
  getPullRequestUnreadCounts: getPullRequestUnreadCountsMock,
  refreshAuthoredPullRequests: refreshAuthoredPullRequestsMock,
  refreshMyPullRequests: refreshMyPullRequestsMock,
}));

vi.mock("./app-badge", () => ({
  setAppBadgeCount: setAppBadgeCountMock,
}));

vi.mock("../features/dev/api", () => ({
  devOverlayEnabled: devOverlayEnabledMock,
  getDevOverlayState: getDevOverlayStateMock,
  addDevMockTask: addDevMockTaskMock,
  setDevMockTaskStatus: setDevMockTaskStatusMock,
  addDevMockPullRequest: addDevMockPullRequestMock,
  resetDevMockScenario: resetDevMockScenarioMock,
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
    devOverlayEnabledMock.mockReset();
    devOverlayEnabledMock.mockResolvedValue(false);
    getDevOverlayStateMock.mockReset();
    getDevOverlayStateMock.mockResolvedValue({
      monitors: [],
      reviewerPullRequests: { values: [], total: 0, hasMore: false },
      authoredPullRequests: { values: [], total: 0, hasMore: false },
    });
    addDevMockTaskMock.mockReset();
    setDevMockTaskStatusMock.mockReset();
    addDevMockPullRequestMock.mockReset();
    resetDevMockScenarioMock.mockReset();
    getPullRequestUnreadCountsMock.mockReset();
    getPullRequestUnreadCountsMock.mockResolvedValue({ reviewer: 0, authored: 0 });
    refreshAuthoredPullRequestsMock.mockClear();
    refreshAuthoredPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    refreshMyPullRequestsMock.mockClear();
    refreshMyPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    refreshAllIntegrationsHealthMock.mockClear();
    listTaskTrackerMonitorsMock.mockReset();
    listTaskTrackerMonitorsMock.mockResolvedValue([]);
    setAppBadgeCountMock.mockReset();
    setAppBadgeCountMock.mockResolvedValue(undefined);
    nativeThemeMock.mockReset();
    nativeThemeMock.mockResolvedValue("dark");
    onThemeChangedMock.mockReset();
    onThemeChangedMock.mockResolvedValue(vi.fn());
    releaseNotesStateMock.mockReset();
    releaseNotesStateMock.mockResolvedValue({ currentVersion: "0.2.22", lastSeenVersion: "0.2.22" });
    releaseNotesSinceMock.mockReset();
    releaseNotesSinceMock.mockReturnValue([]);
    markReleaseNotesSeenMock.mockReset();
    markReleaseNotesSeenMock.mockResolvedValue(undefined);
    updaterCheckMock.mockReset();
    updaterCheckMock.mockResolvedValue(null);
  });

  it("shows release notes after an update and records acknowledgement", async () => {
    vi.stubEnv("DEV", false);
    releaseNotesStateMock.mockResolvedValue({ currentVersion: "0.2.22", lastSeenVersion: "0.2.21" });
    releaseNotesSinceMock.mockReturnValue([
      { version: "0.2.22", entries: [{ en: "Find saved items faster.", ru: "Быстрее находите сохранённое." }] },
    ]);
    try {
      render(<App />);

      expect(await screen.findByRole("heading", { name: "What's new in mework" })).toBeInTheDocument();
      expect(screen.getByText("Find saved items faster.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
      await waitFor(() => expect(markReleaseNotesSeenMock).toHaveBeenCalledOnce());
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the splash visible until integration checks settle", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );

    render(<App />);
    expect(screen.getByRole("status", { name: "Loading mework" })).toBeInTheDocument();
    await waitFor(() => expect(refreshAllIntegrationsHealthMock).toHaveBeenCalledOnce());

    await act(async () => { resolveHealth([]); });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading mework" })).not.toBeInTheDocument());
  });

  it("uses only local scenario data when explicit mock mode is enabled", async () => {
    devOverlayEnabledMock.mockResolvedValueOnce(true);

    render(<App />);

    const overlayLauncher = await screen.findByRole("button", { name: "Open development scenario" });
    fireEvent.click(overlayLauncher);
    expect(await screen.findByRole("heading", { name: "Development scenario" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pull requests awaiting your review" })).toBeInTheDocument();
    expect(refreshAllIntegrationsHealthMock).not.toHaveBeenCalled();
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(refreshAuthoredPullRequestsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open About mework and check for updates" }));
    expect(await screen.findByRole("heading", { name: "About mework" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#settings/application-info");
    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open About mework and check for updates" }));
    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledTimes(2));
  });

  it("keeps the daily presenter available in mock mode", async () => {
    devOverlayEnabledMock.mockResolvedValueOnce(true);
    window.location.hash = "#product/daily/presenter";

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Daily presenter screen" })).toBeInTheDocument();
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
    await waitFor(() => expect(refreshAllIntegrationsHealthMock).toHaveBeenCalledOnce());
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("main", { name: "mework" })).not.toBeInTheDocument();

    await act(async () => {
      resolveHealth([{
        id: "bitbucket-1",
        kind: "bitbucket",
        baseUrl: "https://bitbucket.example.com",
        enabled: true,
        healthStatus: "working",
        capabilities: [],
      }]);
    });
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

  it("opens Statistics from its dedicated hash route", async () => {
    window.location.hash = "#settings/statistics";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Statistics" })).toBeInTheDocument();
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

  it("sets the app icon badge to the sum of all sidebar unread counts", async () => {
    getPullRequestUnreadCountsMock.mockResolvedValue({ reviewer: 2, authored: 3 });
    listTaskTrackerMonitorsMock.mockResolvedValue([
      trackerMonitor("badge-monitor", "badge-checkpoint", 5),
    ]);

    render(<App />);

    expect(await screen.findByRole("link", { name: "PRs to review, 2 unread" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Your PRs, 3 unread" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Task tracker, 5 unread" })).toBeInTheDocument();
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(10));

    getPullRequestUnreadCountsMock.mockResolvedValue({ reviewer: 4, authored: 3 });
    act(() => emitAppEvent(APP_EVENT.pullRequestActivityChanged));
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(12));

    act(() => {
      emitAppEvent(APP_EVENT.taskTrackerReadStateChanged, {
        monitorId: "badge-monitor",
        checkpoint: "badge-checkpoint",
      });
    });
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(7));
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
