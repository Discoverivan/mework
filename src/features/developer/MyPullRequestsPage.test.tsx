import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MyPullRequest,
  MyPullRequestPage,
  PullRequestReviewSettings,
  PullRequestReviewState,
} from "@/shared/contracts/developer";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewState,
  listMyPullRequests,
  markAllPullRequestsRead,
  markPullRequestRead,
  refreshMyPullRequests,
  savePullRequestReviewSettings,
  searchBitbucketRepositories,
  searchBitbucketUsers,
  startPullRequestReview,
} from "./api";
import { MyPullRequestsPage } from "./MyPullRequestsPage";

vi.mock("../settings/api", () => ({
  getAiSettings: vi.fn(),
}));

vi.mock("./api", () => ({
  getPullRequestReviewSettings: vi.fn(),
  getPullRequestReviewState: vi.fn(),
  listMyPullRequests: vi.fn(),
  markAllPullRequestsRead: vi.fn(),
  markPullRequestRead: vi.fn(),
  refreshMyPullRequests: vi.fn(),
  savePullRequestReviewSettings: vi.fn(),
  searchBitbucketRepositories: vi.fn(),
  searchBitbucketUsers: vi.fn(),
  startPullRequestReview: vi.fn(),
}));

const getAiSettingsMock = vi.mocked(getAiSettings);
const getSettingsMock = vi.mocked(getPullRequestReviewSettings);
const getReviewStateMock = vi.mocked(getPullRequestReviewState);
const listMyPullRequestsMock = vi.mocked(listMyPullRequests);
const refreshMyPullRequestsMock = vi.mocked(refreshMyPullRequests);
const markAllPullRequestsReadMock = vi.mocked(markAllPullRequestsRead);
const markPullRequestReadMock = vi.mocked(markPullRequestRead);
const saveSettingsMock = vi.mocked(savePullRequestReviewSettings);
const searchRepositoriesMock = vi.mocked(searchBitbucketRepositories);
const searchUsersMock = vi.mocked(searchBitbucketUsers);
const startReviewMock = vi.mocked(startPullRequestReview);

const emptySettings: PullRequestReviewSettings = {
  repositoryBlacklist: [],
  creatorBlacklist: [],
  repositoryWhitelist: [],
  creatorWhitelist: [],
  autoReviewEnabled: false,
};

const pullRequests: MyPullRequest[] = [
  {
    integrationId: "bitbucket-1",
    pullRequestId: "7",
    title: "Example pull request",
    state: "OPEN",
    repositorySlug: "sample-repository",
    repositoryName: "Sample Repository",
    projectKey: "DEMO",
    sourceBranch: "feature/provider",
    targetBranch: "main",
    authorDisplayName: "Test Author A",
    updatedDate: 1760001000000,
    latestCommit: "commit-7",
    url: "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/7",
    myDecision: "needs_work",
    activity: "new",
  },
  {
    integrationId: "bitbucket-1",
    pullRequestId: "7",
    title: "Example documentation change",
    state: "OPEN",
    repositorySlug: "docs",
    repositoryName: "Docs",
    projectKey: "DEMO",
    sourceBranch: "docs/integrations",
    targetBranch: "main",
    authorDisplayName: "Test Author B",
    updatedDate: 1760000000000,
    latestCommit: "commit-8",
    myDecision: "approved",
    activity: "updated",
  },
];

const thirdPullRequest: MyPullRequest = {
  ...pullRequests[0],
  pullRequestId: "9",
  title: "Parallel review example",
  latestCommit: "commit-9",
  url: "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/9",
};

const anotherPullRequest: MyPullRequest = {
  ...thirdPullRequest,
  pullRequestId: "10",
  title: "Second parallel review example",
  latestCommit: "commit-10",
  url: "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/10",
};

const firstPage: MyPullRequestPage = {
  values: pullRequests,
  total: pullRequests.length,
  hasMore: false,
  lastUpdatedAt: Date.now(),
};

const aiSettingsConnected: AiSettingsPageData = {
  settings: {
    provider: "codex-cli",
    model: "gpt-5.5",
    reasoning: "medium",
    fastMode: false,
  },
  providers: [{
    id: "codex-cli",
    name: "Codex CLI",
    status: "connected",
    available: true,
    models: ["gpt-5.5"],
  }],
};

const runningReview: PullRequestReviewState = {
  runId: "run-1",
  status: "running",
  reviewedCommit: "commit-7",
  result: null,
  error: null,
  startedAt: 1,
  finishedAt: null,
};

const completedReview: PullRequestReviewState = {
  runId: "run-1",
  status: "completed",
  reviewedCommit: "commit-7",
  error: null,
  startedAt: 1,
  finishedAt: 2,
  result: {
    verdict: "needs_changes",
    description: "Coordinates an example background refresh lifecycle.",
    summary: "The change can lose data when the retry races with shutdown.",
    comments: [{ severity: "high", file: "src/retry.ts", line: 42, comment: "Guard this operation before retrying." }],
  },
};

describe("MyPullRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMyPullRequestsMock.mockResolvedValue(firstPage);
    refreshMyPullRequestsMock.mockResolvedValue(firstPage);
    getAiSettingsMock.mockResolvedValue(aiSettingsConnected);
    getSettingsMock.mockResolvedValue(emptySettings);
    getReviewStateMock.mockResolvedValue(null);
    markPullRequestReadMock.mockResolvedValue({ integrationId: "bitbucket-1", pullRequestId: "7", activity: "read" });
    markAllPullRequestsReadMock.mockResolvedValue({ markedCount: 2 });
    startReviewMock.mockResolvedValue(runningReview);
    saveSettingsMock.mockImplementation(async (settings) => settings);
    searchRepositoriesMock.mockResolvedValue([{
      projectKey: "DEMO",
      projectName: "Example Project",
      repositorySlug: "sample-repository",
      repositoryName: "Sample Repository",
    }]);
    searchUsersMock.mockResolvedValue([{ name: "test-author-a", displayName: "Test Author A", slug: "test-author-a" }]);
  });

  it("loads the complete list and marks one PR read with its latest commit", async () => {
    render(<MyPullRequestsPage />);

    expect(await screen.findByRole("heading", { name: "Example pull request" })).toBeInTheDocument();
    expect(screen.getByText(/Last updated: just now · Next update: in 5 min/)).toHaveAttribute("title", "Next update: in 5 min");
    expect(listMyPullRequestsMock).toHaveBeenCalledWith(0, 100);
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.getByText("UPDATED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read" })).not.toBeInTheDocument();
  });

  it("does not block pull requests while AI settings are pending", async () => {
    getAiSettingsMock.mockImplementation(() => new Promise(() => {}));
    render(<MyPullRequestsPage />);

    expect(await screen.findByRole("heading", { name: "Example pull request" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading pull request review" })).not.toBeInTheDocument();
  });

  it("opens permanent filters and applies a creator filter after saving", async () => {
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Permanent filters" }));
    expect(screen.getByRole("dialog", { name: "Permanent PR filters" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Creator filters" }), { target: { value: "Test Author A" } });
    await waitFor(() => expect(searchUsersMock).toHaveBeenCalledWith("Test Author A"));
    fireEvent.click(screen.getByRole("button", { name: "Test Author A (test-author-a)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save filters" }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      repositoryBlacklist: [],
      creatorBlacklist: [],
      repositoryWhitelist: [],
      creatorWhitelist: ["Test Author A"],
      autoReviewEnabled: false,
    }));
    expect(await screen.findByRole("heading", { name: "Example pull request" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Example documentation change" })).not.toBeInTheDocument();
  });

  it("supports separate blacklist and whitelist tabs at the same time", async () => {
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Permanent filters" }));
    expect(screen.getByRole("tab", { name: "Whitelist" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Blacklist" }));
    expect(screen.getByRole("tab", { name: "Blacklist" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "Creator filters" }), { target: { value: "Test Author A" } });
    await waitFor(() => expect(searchUsersMock).toHaveBeenCalledWith("Test Author A"));
    fireEvent.click(screen.getByRole("button", { name: "Test Author A (test-author-a)" }));

    fireEvent.click(screen.getByRole("tab", { name: "Whitelist" }));
    expect(screen.getByRole("tab", { name: "Whitelist" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Test Author A", { selector: "li span" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save filters" }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      repositoryBlacklist: [],
      creatorBlacklist: ["Test Author A"],
      repositoryWhitelist: [],
      creatorWhitelist: [],
      autoReviewEnabled: false,
    }));
  });

  it("persists the AI auto-review toggle from the page header", async () => {
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    const toggle = screen.getByRole("checkbox", { name: "AI auto-review" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      repositoryBlacklist: [],
      creatorBlacklist: [],
      repositoryWhitelist: [],
      creatorWhitelist: [],
      autoReviewEnabled: true,
    }));
    expect(toggle).toBeChecked();
  });

  it("opens the PR and marks its current snapshot read", async () => {
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    expect(screen.queryByRole("link", { name: "Open PR" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: "Example pull request" })[0]);
    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith("bitbucket-1", "DEMO", "sample-repository", "7", "commit-7"));
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Example documentation change");
  });

  it("marks all persisted PR snapshots read", async () => {
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Read all" }));
    await waitFor(() => expect(markAllPullRequestsReadMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
    expect(screen.queryByText("UPDATED")).not.toBeInTheDocument();
  });

  it("starts an AI review with the complete PR payload and shows Reviewing", async () => {
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getAllByRole("button", { name: "PR Review" })[0]);
    await waitFor(() => expect(startReviewMock).toHaveBeenCalledWith(expect.objectContaining(pullRequests[0])));
    expect(await screen.findByRole("button", { name: "Reviewing" })).toBeDisabled();
  });

  it("starts three AI reviews concurrently without replacing their pending state", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [pullRequests[0], thirdPullRequest, anotherPullRequest],
      total: 3,
    });
    const resolvers: Array<(review: PullRequestReviewState | PromiseLike<PullRequestReviewState>) => void> = [];
    startReviewMock.mockImplementation(() => new Promise<PullRequestReviewState>((resolve) => {
      resolvers.push(resolve);
    }));

    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Parallel review example" });
    const reviewButtons = screen.getAllByRole("button", { name: "PR Review" });
    expect(reviewButtons).toHaveLength(3);
    reviewButtons.forEach((button) => fireEvent.click(button));

    await waitFor(() => expect(startReviewMock).toHaveBeenCalledTimes(3));
    expect(screen.getAllByRole("button", { name: "Reviewing" })).toHaveLength(3);
    resolvers.forEach((resolve) => resolve(runningReview));
  });

  it("reconciles a completed review when the completion event was missed", async () => {
    getReviewStateMock.mockResolvedValue(completedReview);
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getAllByRole("button", { name: "PR Review" })[0]);
    expect(await screen.findByRole("button", { name: "Review Results" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Review results" })).not.toBeInTheDocument();
    expect(getReviewStateMock).toHaveBeenCalled();
  });

  it("opens persisted review results and can restart the review", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });
    render(<MyPullRequestsPage />);
    await screen.findByRole("button", { name: "Review Results" });

    fireEvent.click(screen.getByRole("button", { name: "Review Results" }));
    const dialog = await screen.findByRole("dialog", { name: "Review results" });
    expect(dialog).toHaveTextContent("Needs changes");
    expect(dialog).toHaveTextContent("Coordinates an example background refresh lifecycle.");
    expect(screen.getByText("Blocker (0)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("High (1)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Medium (0)").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Low (0)").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("src/retry.ts:42")).toBeInTheDocument();
    expect(screen.getByText("Guard this operation before retrying.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute("href", pullRequests[0].url);

    fireEvent.click(screen.getByRole("button", { name: "Restart review" }));
    await waitFor(() => expect(startReviewMock).toHaveBeenCalledWith(expect.objectContaining(pullRequests[0])));
    expect(await screen.findByRole("button", { name: "Reviewing" })).toBeDisabled();
  });

  it("disables PR Review when no AI provider is selected", async () => {
    getAiSettingsMock.mockResolvedValueOnce({
      ...aiSettingsConnected,
      settings: { ...aiSettingsConnected.settings, provider: null },
    });
    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });

    expect(screen.getAllByRole("button", { name: "PR Review" })[0]).toBeDisabled();
  });

  it("does not keep a saved review result after the PR commit changes", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });
    refreshMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], latestCommit: "commit-9" }, pullRequests[1]],
    });
    render(<MyPullRequestsPage />);
    await screen.findByRole("button", { name: "Review Results" });

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "PR Review" })[0]).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Review Results" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "PR Review" })[0]).not.toBeDisabled();
  });
});
