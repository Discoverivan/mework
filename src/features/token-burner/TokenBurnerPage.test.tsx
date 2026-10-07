import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { TokenBurnerSnapshot } from "@/shared/contracts/token-burner";
import { TokenBurnerPage } from "./TokenBurnerPage";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";

const { snapshotMock, startMock, stopMock, resetMock, repositoriesMock, integrationAvailableMock, aiSettingsMock, saveAiSettingsMock, saveSettingsMock } = vi.hoisted(() => ({
  snapshotMock: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  resetMock: vi.fn(),
  repositoriesMock: vi.fn(),
  integrationAvailableMock: vi.fn(),
  aiSettingsMock: vi.fn(),
  saveAiSettingsMock: vi.fn(),
  saveSettingsMock: vi.fn(),
}));

vi.mock("./api", () => ({
  getTokenBurnerSnapshot: snapshotMock,
  getTokenBurnerSettings: vi.fn(),
  listTokenBurnerRepositories: repositoriesMock,
  isTokenBurnerIntegrationAvailable: integrationAvailableMock,
  saveTokenBurnerSettings: saveSettingsMock,
  startTokenBurner: startMock,
  pauseTokenBurner: vi.fn(),
  resumeTokenBurner: vi.fn(),
  stopTokenBurner: stopMock,
  resetTokenBurnerDailyTarget: resetMock,
}));

vi.mock("@/features/settings/api", () => ({
  getAiSettings: aiSettingsMock,
  saveAiSettings: saveAiSettingsMock,
}));

const initialSnapshot: TokenBurnerSnapshot = {
  settings: { dailyTarget: 2_000_000, delayBetweenRequestsSeconds: 10, repository: null },
  status: "idle",
  tokensUsedToday: 0,
  activeForMs: 0,
  previousSessionInterrupted: false,
  activeIterations: [],
  completedIterations: [],
};

describe("TokenBurnerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoriesMock.mockResolvedValue([{ key: "integration-id/DEMO/example-repo", name: "Example Project / Example Repository" }]);
    integrationAvailableMock.mockResolvedValue(true);
    aiSettingsMock.mockResolvedValue({
      settings: { provider: "codex-cli", providerInstanceId: null, model: "example-codex-model", reasoning: "medium", fastMode: false, tokenBurner: null, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } },
      providers: [{ id: "codex-cli", instanceId: null, name: "Codex CLI", status: "connected", available: true, models: ["example-codex-model"] }],
    });
    snapshotMock.mockResolvedValue(initialSnapshot);
    startMock.mockResolvedValue({
      ...initialSnapshot,
      status: "running",
      sessionStartedAt: Date.now(),
    });
    resetMock.mockResolvedValue(initialSnapshot);
    saveSettingsMock.mockImplementation(async (settings) => settings);
    saveAiSettingsMock.mockImplementation(async (settings) => ({ ...(await aiSettingsMock()), settings }));
  });

  it("opens as soon as the local snapshot loads without waiting for repositories or AI settings", async () => {
    let completeIntegration!: (available: boolean) => void;
    let completeRepositories!: (repositories: { key: string; name: string }[]) => void;
    integrationAvailableMock.mockReturnValueOnce(new Promise((resolve) => { completeIntegration = resolve; }));
    repositoriesMock.mockReturnValueOnce(new Promise((resolve) => { completeRepositories = resolve; }));
    aiSettingsMock.mockReturnValue(new Promise(() => {}));
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByRole("heading", { name: "Model-testing" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Model-testing")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking Bitbucket connection and loading repositories…");
    expect(screen.queryByText("Connect a working Bitbucket integration to load assigned pull requests.")).not.toBeInTheDocument();
    await act(async () => { completeIntegration(true); });
    expect(screen.getByRole("status")).toHaveTextContent("Checking Bitbucket connection and loading repositories…");
    await act(async () => { completeRepositories([{ key: "integration-id/DEMO/example-repo", name: "Example Project / Example Repository" }]); });
    await waitFor(() => expect(screen.queryByText("Checking Bitbucket connection and loading repositories…")).not.toBeInTheDocument());
  });

  it("explains when no assigned open pull requests are available", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "no_prs" });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText("No assigned open pull requests match this repository filter.")).toBeInTheDocument();
    expect(screen.getByText("No matching assigned open PRs")).toBeInTheDocument();
  });

  it("shows active search progress before the first pull request is selected", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "running", activeForMs: 300_000 });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText("Finding the next pull request…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Active for 5m")).toBeInTheDocument();
    act(() => emitAppEvent(APP_EVENT.tokenBurnerChanged, {
      ...initialSnapshot,
      status: "running",
      activeIterations: [{
        id: "active-review",
        pullRequestId: "8",
        pullRequestTitle: "Example review",
        repositoryName: "Example Repository",
        repositoryKey: "DEMO/example-repo",
        perspective: "Correctness & regressions",
        status: "running",
        phase: "reviewing_code",
        totalTokens: 0,
        usageKnown: false,
      }],
    }));
    const runningStatuses = screen.getAllByText("Running");
    expect(runningStatuses).toHaveLength(2);
    for (const running of runningStatuses) {
      expect(running).toHaveClass("model-testing-status", "text-primary");
      expect(running).toHaveClass("border-transparent");
      expect(running.querySelector("svg")).toHaveClass("size-4", "animate-spin");
    }
    fireEvent.focus(runningStatuses[0]);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows unknown usage and an interrupted review after Stop", async () => {
    const iteration = {
      id: "stopped-review", pullRequestId: "8", pullRequestTitle: "Example review",
      repositoryName: "Example Repository", repositoryKey: "DEMO/example-repo",
      perspective: "Correctness & regressions", totalTokens: 0, usageKnown: false,
    };
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "running", activeIterations: [{ ...iteration, status: "running", phase: "reviewing_code" }] });
    stopMock.mockResolvedValue({ ...initialSnapshot, completedIterations: [{ ...iteration, status: "failed", phase: "interrupted" }] });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Usage unknown")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Review interrupted" })).toBeInTheDocument();
    expect(stopMock).toHaveBeenCalledOnce();
  });

  it("opens saved errors from the info button and toasts each new failure once", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "error", error: "Bitbucket credential is missing" });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    const info = await screen.findByRole("button", { name: "Model-testing error details" });
    expect(screen.queryByRole("button", { name: "Paused due to errors" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Bitbucket credential is missing/)).not.toBeInTheDocument();
    fireEvent.click(info);
    expect(screen.getByText("Bitbucket credential is missing")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    act(() => emitAppEvent(APP_EVENT.tokenBurnerChanged, { ...initialSnapshot, status: "running", sessionStartedAt: 1 }));
    const failed = { ...initialSnapshot, status: "error" as const, sessionStartedAt: 1, error: "Example provider failure" };
    act(() => { emitAppEvent(APP_EVENT.tokenBurnerChanged, failed); emitAppEvent(APP_EVENT.tokenBurnerChanged, failed); });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Model-testing could not continue: Example provider failure");
    fireEvent.click(screen.getByRole("button", { name: "Model-testing error details" }));
    expect(screen.getByText("Example provider failure")).toBeInTheDocument();
  });

  it("keeps the live failure received while the initial snapshot is loading", async () => {
    let resolveSnapshot!: (snapshot: TokenBurnerSnapshot) => void;
    snapshotMock.mockReturnValue(new Promise<TokenBurnerSnapshot>((resolve) => { resolveSnapshot = resolve; }));
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    const failed = { ...initialSnapshot, status: "error" as const, sessionStartedAt: 1, error: "Example live failure" };
    await act(async () => {
      emitAppEvent(APP_EVENT.tokenBurnerChanged, failed);
      resolveSnapshot(initialSnapshot);
    });

    expect(screen.getByText("Paused due to errors")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Example live failure");
    fireEvent.click(screen.getByRole("button", { name: "Model-testing error details" }));
    expect(screen.getByText("Example live failure")).toBeInTheDocument();
  });

  it("revalidates Bitbucket after configuration changes and reopening without retrying AI", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "error", error: "Previous provider failure" });
    integrationAvailableMock.mockResolvedValue(false);
    const page = render(<I18nProvider><TokenBurnerPage /></I18nProvider>);
    const retry = await screen.findByRole("button", { name: "Retry" });
    await waitFor(() => expect(integrationAvailableMock).toHaveBeenCalled());
    expect(retry).toBeDisabled();

    integrationAvailableMock.mockResolvedValue(true);
    act(() => { emitAppEvent(APP_EVENT.integrationsChanged); emitAppEvent(APP_EVENT.integrationsChanged); });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(repositoriesMock).toHaveBeenCalledOnce();
    page.unmount();
    integrationAvailableMock.mockResolvedValue(false);
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);
    await waitFor(() => expect(integrationAvailableMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled());
    expect(startMock).not.toHaveBeenCalled();
  });

  it("resets the displayed daily progress without changing the target", async () => {
    snapshotMock.mockResolvedValue({
      ...initialSnapshot,
      status: "target_reached",
      tokensUsedToday: 2_000_000,
      completedIterations: [{
        id: "history-1",
        pullRequestId: "7",
        pullRequestTitle: "Synthetic review",
        repositoryName: "History Repo",
        repositoryKey: "PROJECT/history-repo",
        perspective: "Bugs & edge cases",
        status: "completed",
        phase: "completed",
        totalTokens: 500,
        usageKnown: true,
      }],
    });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText(/History Repo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset daily progress" }));
    expect(screen.getByText("This permanently deletes all Model-testing run history. Overall AI token statistics will remain unchanged.")).toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset and clear history" }));

    await waitFor(() => expect(resetMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Daily target" })).toHaveAttribute("aria-valuenow", "0"));
    expect(screen.getByText(/^0 \/ /)).toBeInTheDocument();
    expect(screen.queryByText(/History Repo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Daily target (tokens)")).toHaveValue("2");
  });

  it("does not allow resetting daily progress during an active session", async () => {
    snapshotMock.mockResolvedValue({
      ...initialSnapshot,
      status: "running",
      tokensUsedToday: 100,
    });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByRole("button", { name: "Reset daily progress" })).toBeDisabled();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("saves a scaled token target and a manual delay in canonical units", async () => {
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settingsPanel = screen.getByLabelText("Daily target (tokens)").closest("div.rounded-lg.border");
    expect(settingsPanel).toContainElement(screen.getByRole("textbox", { name: "Delay between reviews" }));
    expect(settingsPanel?.querySelectorAll('[data-orientation="horizontal"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("combobox", { name: "Scale" }));
    fireEvent.click(screen.getByRole("option", { name: "Thousands" }));
    fireEvent.change(screen.getByLabelText("Daily target (tokens)"), { target: { value: "1.001" } });
    const delay = screen.getByRole("textbox", { name: "Delay between reviews" });
    fireEvent.change(delay, { target: { value: "oops" } });
    expect(delay).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(delay, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Unit" }));
    fireEvent.click(screen.getByRole("option", { name: "Minutes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({ ...initialSnapshot.settings, dailyTarget: 1001, delayBetweenRequestsSeconds: 180 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument());
  });

  it("saves shared AI configuration with status notices and starts a background review session", async () => {
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByRole("heading", { name: "Model-testing" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "AI provider" })).toHaveTextContent("Use defaults");
    const activity = screen.getByRole("heading", { name: "Activity" }).closest(".rounded-lg.border");
    expect(activity).toContainElement(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("No pull request is being analyzed right now.").parentElement).toHaveClass("rounded-md", "border", "p-4");
    const repository = screen.getByRole("combobox", { name: "Repository" });
    await waitFor(() => expect(repository).toBeEnabled());
    fireEvent.click(repository);
    expect(screen.getByRole("button", { name: "Example Project / Example Repository" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search by project or repository name" }), { target: { value: "example repository" } });
    fireEvent.click(screen.getByRole("button", { name: "Example Project / Example Repository" }));
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({ ...initialSnapshot.settings, repository: "integration-id/DEMO/example-repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Daily target (tokens)")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveFocus();
    expect(screen.getByLabelText("Delay between reviews")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Daily target (tokens)"), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Daily target (tokens)"), { target: { value: "2" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByLabelText("Maximum tokens per request")).not.toBeInTheDocument();
    expect(screen.queryByText("Review depth")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    let completeAiSave!: () => void;
    saveAiSettingsMock.mockImplementation(async (settings) => {
      const data = await aiSettingsMock();
      return new Promise((resolve) => { completeAiSave = () => resolve({ ...data, settings }); });
    });
    fireEvent.click(screen.getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Codex CLI" }));
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("example-codex-model");
    expect(screen.getByRole("combobox", { name: "Reasoning" })).toHaveTextContent("medium");
    fireEvent.click(screen.getByRole("combobox", { name: "Mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Fast" }));
    fireEvent.change(screen.getByLabelText("Retries"), { target: { value: "2" } });
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      tokenBurner: { provider: "codex-cli", model: "example-codex-model", reasoning: "medium", fastMode: true },
      retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: 2, sprintSummary: null } },
    }));
    await act(async () => completeAiSave());
    expect(screen.getByRole("status")).toHaveTextContent("AI settings saved. They apply to new runs.");
    await waitFor(() => expect(screen.queryByText("AI settings saved. They apply to new runs.")).not.toBeInTheDocument(), { timeout: 3500 });

    // A provider refresh carries persisted settings, including a freshly decoded profile.
    const savedAi = saveAiSettingsMock.mock.calls[0][0];
    fireEvent.click(screen.getByRole("combobox", { name: "Mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Normal" }));
    act(() => emitAppEvent(APP_EVENT.aiSettingsChanged, {
      settings: { ...savedAi, tokenBurner: { ...savedAi.tokenBurner }, retries: { ...savedAi.retries, default: 1 } },
      providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["example-codex-model"] }],
    }));
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent("Normal");
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledTimes(2));
    expect(saveAiSettingsMock.mock.calls[1][0]).toMatchObject({ tokenBurner: { fastMode: false }, retries: { default: 1 } });
    await act(async () => completeAiSave());

    // Retain the draft after a transient save failure and let the user retry it directly.
    saveAiSettingsMock.mockRejectedValueOnce(new Error("Example save failure"));
    fireEvent.click(screen.getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Use defaults" }));
    const retrySave = await screen.findByRole("button", { name: "Retry saving" });
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    saveAiSettingsMock.mockImplementation(async (settings) => ({ ...(await aiSettingsMock()), settings }));
    fireEvent.click(retrySave);
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledTimes(4));
    expect(saveAiSettingsMock.mock.calls[3][0]).toMatchObject({ tokenBurner: null, retries: { default: 1, actions: { tokenBurner: null } } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledOnce());
  }, 10_000);
});
