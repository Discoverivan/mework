import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { TokenBurnerSnapshot } from "@/shared/contracts/token-burner";
import { TokenBurnerPage } from "./TokenBurnerPage";

const { snapshotMock, startMock, resetMock, repositoriesMock, integrationAvailableMock, aiSettingsMock } = vi.hoisted(() => ({
  snapshotMock: vi.fn(),
  startMock: vi.fn(),
  resetMock: vi.fn(),
  repositoriesMock: vi.fn(),
  integrationAvailableMock: vi.fn(),
  aiSettingsMock: vi.fn(),
}));

vi.mock("./api", () => ({
  getTokenBurnerSnapshot: snapshotMock,
  getTokenBurnerSettings: vi.fn(),
  listTokenBurnerRepositories: repositoriesMock,
  isTokenBurnerIntegrationAvailable: integrationAvailableMock,
  saveTokenBurnerSettings: vi.fn(),
  startTokenBurner: startMock,
  pauseTokenBurner: vi.fn(),
  resumeTokenBurner: vi.fn(),
  stopTokenBurner: vi.fn(),
  resetTokenBurnerDailyTarget: resetMock,
}));

vi.mock("@/features/settings/api", () => ({
  getAiSettings: aiSettingsMock,
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
      settings: { provider: "codex-cli", providerInstanceId: null, model: "example-codex-model", reasoning: "medium", fastMode: false, tokenBurner: null },
      providers: [{ id: "codex-cli", instanceId: null, name: "Codex CLI", status: "connected", available: true, models: ["example-codex-model"] }],
    });
    snapshotMock.mockResolvedValue(initialSnapshot);
    startMock.mockResolvedValue({
      ...initialSnapshot,
      status: "running",
      sessionStartedAt: Date.now(),
    });
    resetMock.mockResolvedValue(initialSnapshot);
  });

  it("opens as soon as the local snapshot loads without waiting for repositories or AI settings", async () => {
    integrationAvailableMock.mockReturnValue(new Promise(() => {}));
    aiSettingsMock.mockReturnValue(new Promise(() => {}));
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByRole("heading", { name: "Model-testing" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Model-testing")).not.toBeInTheDocument();
  });

  it("explains when no assigned open pull requests are available", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "no_prs" });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText("No assigned open pull requests match this repository filter.")).toBeInTheDocument();
    expect(screen.getByText("No matching assigned open PRs")).toBeInTheDocument();
  });

  it("shows active search progress before the first pull request is selected", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "running" });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText("Finding the next pull request…")).toBeInTheDocument();
  });

  it("surfaces failures persisted by a background session", async () => {
    snapshotMock.mockResolvedValue({ ...initialSnapshot, status: "error", error: "Bitbucket credential is missing" });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText(/Bitbucket credential is missing/)).toBeInTheDocument();
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
      }],
    });
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByText(/History Repo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset daily progress" }));
    expect(screen.getByText("This permanently deletes all Model-testing run history. Overall AI token statistics will remain unchanged.")).toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset and clear history" }));

    await waitFor(() => expect(resetMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("0")).toBeInTheDocument();
    expect(screen.queryByText(/History Repo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Daily target (tokens)")).toHaveValue(2_000_000);
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

  it("uses the selected Codex CLI model and starts a background review session", async () => {
    render(<I18nProvider><TokenBurnerPage /></I18nProvider>);

    expect(await screen.findByRole("heading", { name: "Model-testing" })).toBeInTheDocument();
    expect(screen.getByText("Codex CLI")).toBeInTheDocument();
    expect(screen.getByText("example-codex-model")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Daily target (tokens)")).toBeInTheDocument();
    expect(screen.getByLabelText("Delay between reviews (seconds)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum tokens per request")).not.toBeInTheDocument();
    expect(screen.queryByText("Review depth")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(window.location.hash).toBe("#settings/ai?focus=token-burner");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledOnce());
  });
});
