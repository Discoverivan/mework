import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyPullRequest, MyPullRequestPage, PullRequestReviewSettings, PullRequestReviewState } from "@/shared/contracts/developer";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewState,
  listAuthoredPullRequests,
  markAllAuthoredPullRequestsRead,
  markAuthoredPullRequestRead,
  refreshAuthoredPullRequests,
  savePullRequestReviewSettings,
  startPullRequestReview,
} from "./api";
import { AuthoredPullRequestsPage } from "./AuthoredPullRequestsPage";

vi.mock("../settings/api", () => ({ getAiSettings: vi.fn() }));
vi.mock("./api", () => ({
  getPullRequestReviewSettings: vi.fn(),
  getPullRequestReviewState: vi.fn(),
  listAuthoredPullRequests: vi.fn(),
  markAllAuthoredPullRequestsRead: vi.fn(),
  markAuthoredPullRequestRead: vi.fn(),
  refreshAuthoredPullRequests: vi.fn(),
  savePullRequestReviewSettings: vi.fn(),
  startPullRequestReview: vi.fn(),
}));

const getAiSettingsMock = vi.mocked(getAiSettings);
const getReviewSettingsMock = vi.mocked(getPullRequestReviewSettings);
const listAuthoredPullRequestsMock = vi.mocked(listAuthoredPullRequests);
const markAllAuthoredPullRequestsReadMock = vi.mocked(markAllAuthoredPullRequestsRead);
const markAuthoredPullRequestReadMock = vi.mocked(markAuthoredPullRequestRead);
const refreshAuthoredPullRequestsMock = vi.mocked(refreshAuthoredPullRequests);
const saveReviewSettingsMock = vi.mocked(savePullRequestReviewSettings);
const getReviewStateMock = vi.mocked(getPullRequestReviewState);
const startReviewMock = vi.mocked(startPullRequestReview);

const aiSettings: AiSettingsPageData = {
  settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
  providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["gpt-5.5"] }],
};

const reviewSettings: PullRequestReviewSettings = {
  repositoryBlacklist: [],
  creatorBlacklist: [],
  repositoryWhitelist: [],
  creatorWhitelist: [],
  autoReviewEnabled: false,
  authoredAutoReviewEnabled: false,
};

const completedReview: PullRequestReviewState = {
  runId: "run-owned-1",
  status: "completed",
  reviewedCommit: "owned-commit-1",
  error: null,
  startedAt: 1,
  finishedAt: 2,
  result: {
    verdict: "needs_changes",
    description: "The authored pull request changes the refresh lifecycle.",
    summary: "The refresh path needs a shutdown guard.",
    comments: [{ severity: "high", file: "src/refresh.ts", line: 12, comment: "Guard shutdown before retrying." }],
  },
};

const authoredPullRequest: MyPullRequest = {
  integrationId: "bitbucket-owned",
  pullRequestId: "42",
  title: "Owned pull request",
  state: "OPEN",
  repositorySlug: "sample-repository",
  repositoryName: "Sample Repository",
  projectKey: "DEMO",
  sourceBranch: "feature/owned",
  targetBranch: "main",
  authorDisplayName: "Current User",
  updatedDate: Date.now(),
  latestCommit: "owned-commit-1",
  url: "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/42",
  myDecision: "not_reviewed",
  activity: "new",
  reviewSummary: { approved: 2, needsWork: 1, comments: 4 },
  needsAction: true,
  review: completedReview,
};

const page: MyPullRequestPage = {
  values: [authoredPullRequest],
  total: 1,
  hasMore: false,
  lastUpdatedAt: Date.now(),
};

describe("AuthoredPullRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiSettingsMock.mockResolvedValue(aiSettings);
    getReviewSettingsMock.mockResolvedValue(reviewSettings);
    saveReviewSettingsMock.mockImplementation(async (settings) => settings);
    listAuthoredPullRequestsMock.mockResolvedValue(page);
    refreshAuthoredPullRequestsMock.mockResolvedValue(page);
    markAllAuthoredPullRequestsReadMock.mockResolvedValue({ markedCount: 1 });
    markAuthoredPullRequestReadMock.mockResolvedValue(true);
    getReviewStateMock.mockResolvedValue(null);
    startReviewMock.mockResolvedValue(completedReview);
  });

  it("loads authored open PRs and shows review counters/action state", async () => {
    render(<AuthoredPullRequestsPage />);

    expect(await screen.findByRole("heading", { name: "Owned pull request" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My Pull Requests" })).toBeInTheDocument();
    expect(screen.getByLabelText("Approved: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs work: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Comments: 4")).toBeInTheDocument();
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText("AI Verdict · Needs work")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as viewed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update now" })).toHaveClass("h-9");
    expect(screen.getByRole("button", { name: "Read all" })).toHaveClass("h-9");
    expect(screen.getByRole("button", { name: "Read all" })).not.toHaveTextContent("Read all");
    expect(screen.getByText(/Last updated: just now · Next update: in 5 min/)).toBeInTheDocument();
    expect(listAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100);
    expect(refreshAuthoredPullRequestsMock).not.toHaveBeenCalled();
  });

  it("marks an authored PR read before opening shared review results without reviewer actions", async () => {
    render(<AuthoredPullRequestsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "View results" }));

    await waitFor(() => expect(markAuthoredPullRequestReadMock).toHaveBeenCalledWith(
      "bitbucket-owned",
      "DEMO/sample-repository/42",
      "owned-commit-1",
    ));
    expect(await screen.findByRole("heading", { name: "AI Summary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as viewed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Needs Work" })).not.toBeInTheDocument();
  });

  it("marks all authored PRs read from the compact header action", async () => {
    render(<AuthoredPullRequestsPage />);
    await screen.findByRole("heading", { name: "Owned pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Read all" }));

    await waitFor(() => expect(markAllAuthoredPullRequestsReadMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Mark as viewed" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read all" })).toBeDisabled();
  });

  it("marks a read PR unread when a review activity update arrives with the same commit", async () => {
    listAuthoredPullRequestsMock.mockResolvedValueOnce({
      ...page,
      values: [{ ...authoredPullRequest, activity: "read" }],
    });
    refreshAuthoredPullRequestsMock.mockResolvedValueOnce({
      ...page,
      values: [{ ...authoredPullRequest, activity: "updated" }],
    });

    render(<AuthoredPullRequestsPage />);
    await screen.findByRole("heading", { name: "Owned pull request" });
    expect(screen.queryByRole("button", { name: "Mark as viewed" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));

    expect(await screen.findByRole("button", { name: "Mark as viewed" })).toBeInTheDocument();
    expect(screen.getByText("UPDATED")).toBeInTheDocument();
  });

  it("persists the independent authored AI auto-review toggle", async () => {
    render(<AuthoredPullRequestsPage />);
    await screen.findByRole("heading", { name: "Owned pull request" });

    const toggle = screen.getByRole("checkbox", { name: "AI auto-review authored pull requests" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => expect(saveReviewSettingsMock).toHaveBeenCalledWith({
      ...reviewSettings,
      authoredAutoReviewEnabled: true,
    }));
    expect(toggle).toBeChecked();
  });

  it("refreshes authored PRs from the toolbar", async () => {
    render(<AuthoredPullRequestsPage />);
    await screen.findByRole("heading", { name: "Owned pull request" });
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(refreshAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100));
  });
});
