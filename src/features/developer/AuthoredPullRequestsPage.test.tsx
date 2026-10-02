import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyPullRequest, MyPullRequestPage, PullRequestReviewSettings, PullRequestReviewState } from "@/shared/contracts/developer";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewStates,
  listAuthoredPullRequests,
  markAllAuthoredPullRequestsRead,
  markAuthoredPullRequestRead,
  refreshAuthoredPullRequests,
  savePullRequestReviewSettings,
  startPullRequestReview,
} from "./api";
import { clearPullRequestDisplayPreferencesForTests } from "./display-options";
import { AuthoredPullRequestsPage } from "./AuthoredPullRequestsPage";

vi.mock("../settings/api", () => ({ getAiSettings: vi.fn() }));
vi.mock("./api", () => ({
  getPullRequestReviewSettings: vi.fn(),
  getPullRequestReviewStates: vi.fn(),
  getPullRequestCommentMatches: vi.fn().mockResolvedValue({ matches: [] }),
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
const getReviewStatesMock = vi.mocked(getPullRequestReviewStates);
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

async function renderFlatPage() {
  render(<AuthoredPullRequestsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Options" }));
  const dialog = screen.getByRole("dialog", { name: "Options" });
  chooseDisplayOption(dialog, "Group by", "Don't group");
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
}

function chooseDisplayOption(dialog: HTMLElement, label: string, option: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("AuthoredPullRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPullRequestDisplayPreferencesForTests();
    getAiSettingsMock.mockResolvedValue(aiSettings);
    getReviewSettingsMock.mockResolvedValue(reviewSettings);
    saveReviewSettingsMock.mockImplementation(async (settings) => settings);
    listAuthoredPullRequestsMock.mockResolvedValue(page);
    refreshAuthoredPullRequestsMock.mockResolvedValue(page);
    markAllAuthoredPullRequestsReadMock.mockResolvedValue({ markedCount: 1 });
    markAuthoredPullRequestReadMock.mockResolvedValue(true);
    getReviewStatesMock.mockResolvedValue({});
    startReviewMock.mockResolvedValue(completedReview);
  });

  it("persists display options across remounts", async () => {
    const firstRender = render(<AuthoredPullRequestsPage />);
    await screen.findByRole("region", { name: "DEMO project" });

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const firstDialog = screen.getByRole("dialog", { name: "Options" });
    chooseDisplayOption(firstDialog, "Sort order", "Recently updated last");
    fireEvent.click(within(firstDialog).getByRole("switch", { name: "Expand groups by default" }));
    chooseDisplayOption(firstDialog, "Group by", "Don't group");
    fireEvent.click(within(firstDialog).getByRole("button", { name: "Apply" }));
    firstRender.unmount();

    render(<AuthoredPullRequestsPage />);
    await screen.findByRole("heading", { name: "Owned pull request" });
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const secondDialog = screen.getByRole("dialog", { name: "Options" });
    expect(within(secondDialog).getByRole("combobox", { name: "Sort order" })).toHaveTextContent("Recently updated last");
    expect(within(secondDialog).getByRole("combobox", { name: "Group by" })).toHaveTextContent("Don't group");
    expect(within(secondDialog).queryByRole("switch", { name: "Expand groups by default" })).not.toBeInTheDocument();
  });

  it("loads authored open PRs and shows review counters/action state", async () => {
    await renderFlatPage();

    expect(await screen.findByRole("heading", { name: "Owned pull request" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pull requests authored by you" })).toBeInTheDocument();
    expect(screen.getByLabelText("Approved: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs work: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Comments: 4")).toBeInTheDocument();
    expect(screen.getByText("Needs action", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI verdict: Needs work")).toHaveTextContent("Needs work");
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Mark as viewed" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    expect(refreshButton).toHaveClass("h-9");
    expect(refreshButton).not.toHaveTextContent("Refresh");
    expect(screen.getByRole("button", { name: "Mark all as read" })).toHaveClass("h-9");
    expect(screen.getByRole("button", { name: "Mark all as read" })).not.toHaveTextContent("Mark all as read");
    expect(screen.getByRole("button", { name: "Mark all as read" }).parentElement).toBe(refreshButton.parentElement);
    const status = screen.getByText("1 authored pull request").closest<HTMLElement>(".page-header-description");
    expect(status).not.toBeNull();
    expect(within(status!).getByText("Updated just now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show pull request details" }));
    expect(screen.getByText("Pull request details")).toBeInTheDocument();
    expect(screen.getByText("Every 5 minutes")).toBeInTheDocument();
    expect(listAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100);
    expect(refreshAuthoredPullRequestsMock).not.toHaveBeenCalled();
  });

  it("refreshes authored PRs when the local cache has never been synchronized", async () => {
    listAuthoredPullRequestsMock.mockResolvedValueOnce({
      values: [],
      total: 0,
      hasMore: false,
    });

    await renderFlatPage();

    expect(await screen.findByRole("heading", { name: "Owned pull request" })).toBeInTheDocument();
    expect(refreshAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100);
    expect(screen.queryByText("No open pull requests authored by you.")).not.toBeInTheDocument();
  });

  it("groups authored pull requests by project and can show the flat list", async () => {
    listAuthoredPullRequestsMock.mockResolvedValueOnce({
      ...page,
      values: [
        authoredPullRequest,
        {
          ...authoredPullRequest,
          pullRequestId: "43",
          title: "Owned tools change",
          projectKey: "TOOLS",
          latestCommit: "owned-commit-2",
          needsAction: false,
          reviewSummary: { approved: 1, needsWork: 0, comments: 0 },
        },
      ],
      total: 2,
    });

    const view = render(<AuthoredPullRequestsPage />);

    const demoGroup = await screen.findByRole("region", { name: "DEMO project" });
    const quickFilter = screen.getByRole("combobox", { name: "Your pull request quick filters" });
    expect(quickFilter).toHaveTextContent("Needs action");
    expect(screen.queryByRole("region", { name: "TOOLS project" })).not.toBeInTheDocument();
    fireEvent.click(quickFilter);
    fireEvent.click(screen.getByRole("option", { name: "All" }));
    expect(within(demoGroup).getByText("sample-repository", { exact: false })).not.toHaveTextContent("DEMO/");
    expect(screen.getByRole("region", { name: "TOOLS project" })).toBeInTheDocument();
    expect(within(demoGroup).queryByRole("heading", { name: "Owned pull request" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const displayOptions = screen.getByRole("dialog", { name: "Options" });
    const grouping = within(displayOptions).getByRole("combobox", { name: "Group by" });
    const expandProjects = within(displayOptions).getByRole("switch", { name: "Expand groups by default" });
    expect(grouping).toHaveTextContent("Project");
    fireEvent.click(expandProjects);
    expect(within(screen.getByRole("region", { name: "DEMO project" })).queryByRole("heading", { name: "Owned pull request" })).not.toBeInTheDocument();
    chooseDisplayOption(displayOptions, "Group by", "Don't group");
    expect(within(displayOptions).queryByRole("switch", { name: "Expand groups by default" })).not.toBeInTheDocument();

    expect(screen.getByRole("region", { name: "DEMO project" })).toBeInTheDocument();

    fireEvent.click(within(displayOptions).getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("region", { name: "DEMO project" })).not.toBeInTheDocument();
    expect(screen.getByText("DEMO/sample-repository", { exact: false })).toBeInTheDocument();
    expect(quickFilter).toHaveTextContent("All");
    fireEvent.click(quickFilter);
    fireEvent.click(screen.getByRole("option", { name: "Needs action" }));
    expect(screen.getByRole("heading", { name: "Owned pull request" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Owned tools change" })).not.toBeInTheDocument();
    fireEvent.click(quickFilter);
    fireEvent.click(screen.getByRole("option", { name: "All" }));
    view.unmount();
    render(<AuthoredPullRequestsPage />);
    expect(await screen.findByRole("combobox", { name: "Your pull request quick filters" })).toHaveTextContent("All");
  });

  it("marks an authored PR read before opening shared review results without reviewer actions", async () => {
    await renderFlatPage();

    fireEvent.click(await screen.findByRole("button", { name: "View AI review results" }));

    await waitFor(() => expect(markAuthoredPullRequestReadMock).toHaveBeenCalledWith(
      "bitbucket-owned",
      "DEMO/sample-repository/42",
      "owned-commit-1",
    ));
    expect(await screen.findByRole("heading", { name: "AI summary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Needs work" })).not.toBeInTheDocument();
  });

  it("marks all authored PRs read from the compact header action", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Owned pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    await waitFor(() => expect(markAllAuthoredPullRequestsReadMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menuitem", { name: "Mark as viewed" })).not.toBeInTheDocument();
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

    await renderFlatPage();
    await screen.findByRole("heading", { name: "Owned pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("UPDATED")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Mark as viewed" })).toBeInTheDocument();
  });

  it("persists the independent authored AI auto-review toggle", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Owned pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const toggle = screen.getByRole("switch", { name: "AI auto-review" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(saveReviewSettingsMock).not.toHaveBeenCalled();
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(saveReviewSettingsMock).toHaveBeenCalledWith({
      ...reviewSettings,
      authoredAutoReviewEnabled: true,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByRole("switch", { name: "AI auto-review" })).toBeChecked();
  });

  it("refreshes authored PRs from the toolbar", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Owned pull request" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(refreshAuthoredPullRequestsMock).toHaveBeenCalledWith(0, 100));
  });
});
