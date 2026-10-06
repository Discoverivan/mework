import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IntegrationRedacted } from "../shared/contracts/settings";
import type { MyPullRequestPage } from "../shared/contracts/developer";
import type { TaskTrackerMonitor } from "../shared/contracts/task-tracker";
import { APP_EVENT, emitAppEvent } from "./app-events";
import App from "../App";
import { clearPullRequestDisplayPreferencesForTests, usePullRequestQuickFilter } from "../features/developer/display-options";

vi.mock("@tauri-apps/api/core", { spy: true });

const { prefetchDailyWorkspacesMock } = vi.hoisted(() => ({ prefetchDailyWorkspacesMock: vi.fn() }));
vi.mock("../features/daily/cache", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/daily/cache")>(),
  prefetchDailyWorkspaces: prefetchDailyWorkspacesMock,
}));

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
const { devOverlayEnabledMock, getDevOverlayStateMock, addDevMockTaskMock, setDevMockTaskStatusMock, addDevMockPullRequestMock, resetDevMockScenarioMock, getAiSettingsMock, getPullRequestUnreadCountsMock, refreshAuthoredPullRequestsMock, refreshMyPullRequestsMock, refreshAllIntegrationsHealthMock, listTaskTrackerMonitorsMock, setAppBadgeCountMock, nativeThemeMock, onThemeChangedMock, releaseNotesStateMock, listUpdateVersionsMock, loadReleaseNoteVersionMock, markReleaseNotesSeenMock, updaterCheckMock, backgroundUpdateStateMock, beginUpdateCheckMock, recordUpdateCheckResultMock } = vi.hoisted(() => ({
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
    settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } },
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
  listUpdateVersionsMock: vi.fn(),
  loadReleaseNoteVersionMock: vi.fn(),
  markReleaseNotesSeenMock: vi.fn(),
  updaterCheckMock: vi.fn().mockResolvedValue(null),
  backgroundUpdateStateMock: vi.fn().mockResolvedValue({ availableVersion: null, lastCheckedAt: null, status: "idle", revision: 0 }),
  beginUpdateCheckMock: vi.fn().mockResolvedValue({ checkId: 1, snapshot: { availableVersion: null, lastCheckedAt: null, status: "checking", revision: 1 } }),
  recordUpdateCheckResultMock: vi.fn(),
}));

vi.mock("../release-notes", () => ({
  getReleaseNotesState: releaseNotesStateMock,
  listUpdateReleaseNotesVersions: listUpdateVersionsMock,
  loadReleaseNoteVersion: loadReleaseNoteVersionMock,
  prefetchOlderReleaseNotes: vi.fn(),
  markReleaseNotesSeen: markReleaseNotesSeenMock,
  listReleaseNotesVersions: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterCheckMock }));

vi.mock("../components/shared/update-check", () => ({
  checkForAvailableUpdate: () => updaterCheckMock({ timeout: 10_000 }),
  getBackgroundUpdateState: backgroundUpdateStateMock,
  beginUpdateCheck: beginUpdateCheckMock,
  recordUpdateCheckResult: recordUpdateCheckResultMock,
}));

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
    sortKey: "updated",
    sortDirection: "desc",
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
    vi.unstubAllEnvs();
    prefetchDailyWorkspacesMock.mockReset();
    prefetchDailyWorkspacesMock.mockResolvedValue(undefined);
    window.location.hash = "";
    window.localStorage.removeItem("mework.task-tracker.read-checkpoints.v1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    getAiSettingsMock.mockClear();
    getAiSettingsMock.mockResolvedValue({
      settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } },
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
    clearPullRequestDisplayPreferencesForTests();
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
    releaseNotesStateMock.mockResolvedValue({ currentVersion: "0.2.22", pendingFromVersion: null });
    listUpdateVersionsMock.mockReset();
    listUpdateVersionsMock.mockResolvedValue([]);
    loadReleaseNoteVersionMock.mockReset();
    markReleaseNotesSeenMock.mockReset();
    markReleaseNotesSeenMock.mockResolvedValue(undefined);
    updaterCheckMock.mockReset();
    updaterCheckMock.mockResolvedValue(null);
    backgroundUpdateStateMock.mockReset();
    backgroundUpdateStateMock.mockResolvedValue({ availableVersion: null, lastCheckedAt: null, status: "idle", revision: 0 });
    beginUpdateCheckMock.mockReset();
    beginUpdateCheckMock.mockResolvedValue({ checkId: 1, snapshot: { availableVersion: null, lastCheckedAt: null, status: "checking", revision: 1 } });
    recordUpdateCheckResultMock.mockReset();
    recordUpdateCheckResultMock.mockImplementation(async (_checkId: number, availableVersion: string | null, succeeded: boolean) => ({
      accepted: true,
      snapshot: {
        availableVersion: succeeded ? availableVersion : null,
        lastCheckedAt: Date.now(),
        status: succeeded ? availableVersion ? "available" : "current" : "error",
        revision: _checkId + 1,
      },
    }));
  });

  it("shows release notes after an update and records acknowledgement", async () => {
    vi.stubEnv("DEV", false);
    releaseNotesStateMock.mockResolvedValue({ currentVersion: "0.2.22", pendingFromVersion: "0.2.20" });
    listUpdateVersionsMock.mockResolvedValue(["0.2.22", "0.2.21"]);
    loadReleaseNoteVersionMock.mockImplementation(async (version: string) =>
      version === "0.2.22"
        ? { version, markdown: "- Find saved items faster.", language: "en" }
        : { version, markdown: "- Reopen saved items.", language: "en" });
    try {
      render(<App />);

      expect(await screen.findByRole("heading", { name: "What's new" })).toBeInTheDocument();
      expect(screen.getByText("Find saved items faster.")).toBeInTheDocument();
      expect(document.querySelector(".dev-build-banner")).toBeNull();
      expect(screen.queryByText("Reopen saved items.")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Older release" }));
      expect(await screen.findByText("Reopen saved items.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
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

  it("keeps local scenario data in mock mode and reuses the About update check", async () => {
    vi.stubEnv("DEV", true);
    devOverlayEnabledMock.mockResolvedValueOnce(true);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Added" })).toBeInTheDocument();
    expect(screen.getByText("Browse release notes by version from About.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("note", { name: "Development build" })).toBeInTheDocument();
    expect(markReleaseNotesSeenMock).not.toHaveBeenCalled();
    expect(releaseNotesStateMock).not.toHaveBeenCalled();

    const overlayLauncher = await screen.findByRole("button", { name: "Open development scenario" });
    fireEvent.click(overlayLauncher);
    expect(await screen.findByRole("heading", { name: "Development scenario" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pull requests awaiting your review" })).toBeInTheDocument();
    expect(refreshAllIntegrationsHealthMock).not.toHaveBeenCalled();
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(refreshAuthoredPullRequestsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open About mework and check for updates" }));
    expect(await screen.findByRole("heading", { name: "About", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "mework-dev", level: 2 })).toBeInTheDocument();
    const releaseNotesButton = screen.getByRole("button", { name: "Release notes" });
    expect(releaseNotesButton).toHaveTextContent("Release notes");
    expect(releaseNotesButton.querySelector("svg.lucide-notebook-text")).not.toBeNull();
    expect(releaseNotesButton.nextElementSibling).toBe(screen.getByRole("button", { name: "View on GitHub" }));
    fireEvent.click(releaseNotesButton);
    expect(await screen.findByRole("heading", { name: "Release notes" })).toBeInTheDocument();
    expect(await screen.findByText("Browse release notes by version from About.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older release" }));
    expect(await screen.findByRole("heading", { name: "Fixed" })).toBeInTheDocument();
    expect(await screen.findByText("Previously loaded notes remain readable without a network connection.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Removed" })).toBeInTheDocument();
    expect(screen.getByText("Removed an unused example shortcut.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(window.location.hash).toBe("#settings/application-info");
    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open About mework and check for updates" }));
    await waitFor(() => expect(window.location.hash).toBe("#settings/application-info"));
    expect(updaterCheckMock).toHaveBeenCalledOnce();
  });

  it("allows a manual check when the native startup state cannot be read", async () => {
    backgroundUpdateStateMock.mockRejectedValueOnce(new Error("native state unavailable"));
    updaterCheckMock.mockResolvedValue(null);
    render(<App />);

    await screen.findByRole("main", { name: "mework" });
    fireEvent.click(screen.getByRole("link", { name: "About" }));
    const refreshButton = await screen.findByRole("button", { name: "Check for updates" });
    expect(refreshButton).toBeEnabled();
    fireEvent.click(refreshButton);
    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
    expect(updaterCheckMock).toHaveBeenCalledOnce();
  });

  it("shows the startup update and check time in About without a manual refresh", async () => {
    const lastCheckedAt = Date.now();
    backgroundUpdateStateMock.mockResolvedValue({
      availableVersion: "0.2.38",
      lastCheckedAt,
      status: "available",
      revision: 4,
    });
    render(<App />);

    await screen.findByRole("main", { name: "mework" });
    fireEvent.click(screen.getByRole("link", { name: "About" }));
    expect(await screen.findByText("New version 0.2.38 is available")).toBeInTheDocument();
    expect(await screen.findByText(/^Last checked: today,/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download & Install" })).toBeInTheDocument();
    expect(updaterCheckMock).not.toHaveBeenCalled();
    emitAppEvent(APP_EVENT.updateAvailabilityChanged, {
      availableVersion: null,
      lastCheckedAt: lastCheckedAt - 1_000,
      status: "current",
      revision: 3,
    });
    expect(screen.getByText("New version 0.2.38 is available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "General" }));
    await waitFor(() => expect(window.location.hash).toBe("#settings/general"));
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "About" }));
    await waitFor(() => expect(window.location.hash).toBe("#settings/application-info"));
    expect(await screen.findByRole("button", { name: "Download & Install" })).toBeInTheDocument();
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

    const { savePullRequestReviewSettings } = await vi.importActual<typeof import("../features/developer/api")>("../features/developer/api");
    const core = await import("@tauri-apps/api/core");
    const savedFilters = {
      filterMode: "deny" as const,
      projectBlacklist: [],
      projectWhitelist: [],
      repositoryBlacklist: ["DEMO/sample-repository"], creatorBlacklist: [],
      repositoryWhitelist: [], creatorWhitelist: [],
      autoReviewEnabled: false, authoredAutoReviewEnabled: false,
    };
    const invoke = vi.mocked(core.invoke).mockResolvedValue(savedFilters);
    getPullRequestUnreadCountsMock.mockResolvedValue({ reviewer: 1, authored: 3 });
    try {
      await act(async () => { await savePullRequestReviewSettings(savedFilters); });
      expect(invoke).toHaveBeenCalledWith("save_pull_request_review_settings", { settings: savedFilters });
      expect(await screen.findByRole("link", { name: "PRs to review, 1 unread" })).toBeInTheDocument();
      await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(9));
    } finally {
      invoke.mockRestore();
    }

    act(() => {
      emitAppEvent(APP_EVENT.taskTrackerReadStateChanged, {
        monitorId: "badge-monitor",
        checkpoint: "badge-checkpoint",
      });
    });
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(4));
  });

  it("keeps sidebar and app badge counts in sync with saved and changed PR quick filters", async () => {
    window.localStorage.setItem("mework.pull-request-quick-filter.v1.reviewer", "all");
    getPullRequestUnreadCountsMock.mockImplementation(async (request) => ({
      reviewer: request.reviewerPendingOnly ? 1 : 4,
      authored: request.authoredNeedsActionOnly ? 2 : 5,
    }));

    function QuickFilterControls() {
      const [, setReviewerFilter] = usePullRequestQuickFilter("reviewer");
      const [, setAuthoredFilter] = usePullRequestQuickFilter("authored");
      return <>
        <button onClick={() => setReviewerFilter("pending")}>Select pending reviews</button>
        <button onClick={() => setAuthoredFilter("all")}>Select all authored PRs</button>
      </>;
    }

    render(<><App /><QuickFilterControls /></>);
    expect(await screen.findByRole("link", { name: "PRs to review, 4 unread" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Your PRs, 2 unread" })).toBeInTheDocument();
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(6));

    fireEvent.click(screen.getByRole("button", { name: "Select pending reviews" }));
    expect(await screen.findByRole("link", { name: "PRs to review, 1 unread" })).toBeInTheDocument();
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(3));

    fireEvent.click(screen.getByRole("button", { name: "Select all authored PRs" }));
    expect(await screen.findByRole("link", { name: "Your PRs, 5 unread" })).toBeInTheDocument();
    await waitFor(() => expect(setAppBadgeCountMock).toHaveBeenLastCalledWith(6));
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

  it("warms AI settings and sprint tasks without delaying application startup", async () => {
    window.location.hash = "#settings/general";
    getAiSettingsMock.mockImplementationOnce(() => new Promise(() => {}));
    prefetchDailyWorkspacesMock.mockImplementationOnce(() => new Promise(() => {}));
    refreshAllIntegrationsHealthMock.mockResolvedValueOnce([{
      id: "jira-1", kind: "jira", baseUrl: "https://jira.example.invalid",
      enabled: true, healthStatus: "working", capabilities: [],
    }]);
    render(<App />);

    await screen.findByRole("main", { name: "mework" });
    expect(refreshAllIntegrationsHealthMock).toHaveBeenCalledOnce();
    expect(getAiSettingsMock).toHaveBeenCalledOnce();
    expect(prefetchDailyWorkspacesMock).toHaveBeenCalledWith(["jira-1"]);
    expect(screen.queryByRole("status", { name: "Loading mework" })).not.toBeInTheDocument();
  });
});
