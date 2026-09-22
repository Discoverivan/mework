import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  publishPullRequestComment,
  refreshMyPullRequests,
  savePullRequestReviewSettings,
  searchBitbucketRepositories,
  searchBitbucketUsers,
  setPullRequestDecision,
  startPullRequestReview,
} from "./api";
import { clearPullRequestDisplayPreferencesForTests } from "./display-options";
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
  setPullRequestDecision: vi.fn(),
  publishPullRequestComment: vi.fn(),
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
const setDecisionMock = vi.mocked(setPullRequestDecision);
const publishCommentMock = vi.mocked(publishPullRequestComment);
const startReviewMock = vi.mocked(startPullRequestReview);

const emptySettings: PullRequestReviewSettings = {
  repositoryBlacklist: [],
  creatorBlacklist: [],
  repositoryWhitelist: [],
  creatorWhitelist: [],
  autoReviewEnabled: false,
  authoredAutoReviewEnabled: false,
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
    comments: [
      { severity: "high", file: "src/retry.ts", line: 42, comment: "Guard this operation before retrying." },
      { severity: "medium", file: "src/timeout.ts", line: 18, comment: "Handle the timeout before continuing." },
      { severity: "low", file: "src/logging.ts", line: 7, comment: "Keep the retry context in the diagnostic message." },
    ],
  },
};

async function renderFlatPage() {
  render(<MyPullRequestsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Options" }));
  const dialog = screen.getByRole("dialog", { name: "Options" });
  fireEvent.click(within(dialog).getByRole("switch", { name: "Group by project" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
}

describe("MyPullRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPullRequestDisplayPreferencesForTests();
    listMyPullRequestsMock.mockResolvedValue(firstPage);
    refreshMyPullRequestsMock.mockResolvedValue(firstPage);
    getAiSettingsMock.mockResolvedValue(aiSettingsConnected);
    getSettingsMock.mockResolvedValue(emptySettings);
    getReviewStateMock.mockResolvedValue(null);
    markPullRequestReadMock.mockResolvedValue({ integrationId: "bitbucket-1", pullRequestId: "7", activity: "read" });
    markAllPullRequestsReadMock.mockResolvedValue({ markedCount: 2 });
    startReviewMock.mockResolvedValue(runningReview);
    setDecisionMock.mockResolvedValue({ integrationId: "bitbucket-1", pullRequestId: "7", myDecision: "approved" });
    publishCommentMock.mockResolvedValue({ commentId: 11 });
    saveSettingsMock.mockImplementation(async (settings) => settings);
    searchRepositoriesMock.mockResolvedValue([{
      projectKey: "DEMO",
      projectName: "Example Project",
      repositorySlug: "sample-repository",
      repositoryName: "Sample Repository",
    }]);
    searchUsersMock.mockResolvedValue([{ name: "test-author-a", displayName: "Test Author A", slug: "test-author-a" }]);
  });

  it("persists display options across remounts", async () => {
    const firstRender = render(<MyPullRequestsPage />);
    await screen.findByRole("region", { name: "DEMO project" });

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const firstDialog = screen.getByRole("dialog", { name: "Options" });
    fireEvent.change(within(firstDialog).getByRole("combobox", { name: "Sort order" }), { target: { value: "oldest" } });
    fireEvent.click(within(firstDialog).getByRole("switch", { name: "Expand project groups by default" }));
    fireEvent.click(within(firstDialog).getByRole("switch", { name: "Group by project" }));
    fireEvent.click(within(firstDialog).getByRole("button", { name: "Done" }));
    firstRender.unmount();

    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const secondDialog = screen.getByRole("dialog", { name: "Options" });
    expect(within(secondDialog).getByRole("combobox", { name: "Sort order" })).toHaveValue("oldest");
    expect(within(secondDialog).getByRole("switch", { name: "Group by project" })).not.toBeChecked();
    expect(within(secondDialog).getByRole("switch", { name: "Expand project groups by default" })).toBeChecked();
  });

  it("loads the complete list and marks one PR read with its latest commit", async () => {
    await renderFlatPage();

    expect(await screen.findByRole("heading", { name: "Example pull request" })).toBeInTheDocument();
    const status = screen.getByText("2 review requests").closest<HTMLElement>(".page-header-description");
    expect(status).not.toBeNull();
    expect(within(status!).getByText("Updated just now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show pull request details" }));
    expect(screen.getByText("Pull request details")).toBeInTheDocument();
    expect(screen.getByText("Every 5 minutes")).toBeInTheDocument();
    expect(listMyPullRequestsMock).toHaveBeenCalledWith(0, 100);
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(screen.getByText("NEW")).toHaveAttribute("title", "New pull request you haven't viewed yet");
    expect(screen.getByText("UPDATED")).toHaveAttribute("title", "Updated since you last viewed it");
    expect(screen.getByText("sample-repository", { exact: false }).closest("p")).toHaveTextContent("DEMO/");
    expect(screen.getByText("NEW").closest(".pr-review-card-meta")).toBeInTheDocument();
    expect(screen.getByText("UPDATED").closest(".pr-review-card-meta")).toBeInTheDocument();
    const updateButton = screen.getByRole("button", { name: "Update now" });
    expect(updateButton).toHaveClass("h-9");
    expect(updateButton.querySelector("svg.lucide-refresh-cw")).not.toBeNull();
    expect(updateButton).not.toHaveTextContent("Update now");
    const readAllButton = screen.getByRole("button", { name: "Mark all as read" });
    expect(readAllButton).toHaveClass("h-9");
    expect(readAllButton).not.toHaveTextContent("Mark all as read");
    expect(readAllButton.parentElement).toBe(updateButton.parentElement);
    const permanentFiltersButton = screen.getByRole("button", { name: "Filters" });
    expect(permanentFiltersButton).toHaveClass("h-9");
    expect(permanentFiltersButton).not.toHaveTextContent("Filters");
    expect(within(permanentFiltersButton.parentElement!).getAllByRole("button")[0]).toBe(permanentFiltersButton);
    expect(permanentFiltersButton.parentElement).toHaveClass("ml-auto");
    expect(readAllButton.parentElement).toBe(permanentFiltersButton.parentElement);
    const toolbarButtons = within(readAllButton.parentElement!).getAllByRole("button");
    expect(toolbarButtons).toEqual([
      permanentFiltersButton,
      screen.getByRole("button", { name: "Options" }),
      updateButton,
      readAllButton,
    ]);
    expect(toolbarButtons[toolbarButtons.length - 1]).toBe(readAllButton);
    expect(screen.getByText("Test Author A")).toHaveClass("font-normal");
    expect(screen.getByRole("img", { name: "Needs work" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Approved" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Example pull request" }).closest(".border-l-blue-500")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read" })).not.toBeInTheDocument();
  });

  it("filters the list to pull requests pending my review", async () => {
    const pendingPullRequest = { ...pullRequests[0], myDecision: "not_reviewed" as const, title: "Pending example pull request" };
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [pendingPullRequest, pullRequests[1]],
    });

    await renderFlatPage();
    expect(await screen.findByRole("heading", { name: "Pending example pull request" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Pending your review" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "Pending your review" }));

    expect(screen.getByRole("tab", { name: "Pending your review" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Pending example pull request" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Example documentation change" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Review pending" })).toBeInTheDocument();
  });

  it("groups pull requests by Bitbucket project", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [
        pullRequests[0],
        pullRequests[1],
        { ...thirdPullRequest, projectKey: "TOOLS", title: "Tools project change" },
      ],
    });

    render(<MyPullRequestsPage />);

    const demoGroup = await screen.findByRole("region", { name: "DEMO project" });
    const toolsGroup = screen.getByRole("region", { name: "TOOLS project" });
    expect(within(demoGroup).getByText("2 pull requests")).toBeInTheDocument();
    expect(within(toolsGroup).getByText("1 pull request")).toBeInTheDocument();
    expect(within(demoGroup).queryByRole("heading", { name: "Example pull request" })).not.toBeInTheDocument();
    expect(within(toolsGroup).queryByRole("heading", { name: "Tools project change" })).not.toBeInTheDocument();
    expect(within(demoGroup).getByRole("button", { name: "Expand DEMO project" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(within(demoGroup).getByRole("button", { name: "Expand DEMO project" }));
    expect(within(demoGroup).getByText("sample-repository", { exact: false })).not.toHaveTextContent("DEMO/");
    expect(within(demoGroup).getByRole("heading", { name: "Example documentation change" })).toBeInTheDocument();
    expect(within(demoGroup).getByRole("heading", { name: "Example pull request" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const displayOptions = screen.getByRole("dialog", { name: "Options" });
    const sortOrder = within(displayOptions).getByRole("combobox", { name: "Sort order" });
    const groupByProject = within(displayOptions).getByRole("switch", { name: "Group by project" });
    const expandProjects = within(displayOptions).getByRole("switch", { name: "Expand project groups by default" });
    expect(sortOrder).toHaveValue("newest");
    expect(within(demoGroup).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Example pull request",
      "Example documentation change",
    ]);
    fireEvent.change(sortOrder, { target: { value: "oldest" } });
    expect(within(demoGroup).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Example documentation change",
      "Example pull request",
    ]);
    expect(groupByProject).toBeChecked();
    expect(expandProjects).toBeEnabled();
    expect(expandProjects).not.toBeChecked();
    fireEvent.click(expandProjects);
    expect(within(screen.getByRole("region", { name: "TOOLS project" })).getByRole("heading", { name: "Tools project change" })).toBeInTheDocument();
    fireEvent.click(expandProjects);
    expect(within(screen.getByRole("region", { name: "DEMO project" })).queryByRole("heading", { name: "Example pull request" })).not.toBeInTheDocument();
    fireEvent.click(groupByProject);
    expect(expandProjects).toBeDisabled();

    expect(screen.queryByRole("region", { name: "DEMO project" })).not.toBeInTheDocument();
    expect(screen.getByText("DEMO/sample-repository", { exact: false })).toBeInTheDocument();
  });

  it("does not block pull requests while AI settings are pending", async () => {
    getAiSettingsMock.mockImplementation(() => new Promise(() => {}));
    await renderFlatPage();

    expect(await screen.findByRole("heading", { name: "Example pull request" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading pull request review" })).not.toBeInTheDocument();
  });

  it("opens filters and applies a creator filter after saving", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Creator filters" }), { target: { value: "Test Author A" } });
    await waitFor(() => expect(searchUsersMock).toHaveBeenCalledWith("Test Author A"));
    fireEvent.click(screen.getByRole("button", { name: "Test Author A (test-author-a)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save filters" }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      repositoryBlacklist: [],
      creatorBlacklist: ["Test Author A"],
      repositoryWhitelist: [],
      creatorWhitelist: [],
      autoReviewEnabled: false,
      authoredAutoReviewEnabled: false,
    }));
    expect(await screen.findByRole("heading", { name: "Example documentation change" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Example pull request" })).not.toBeInTheDocument();
  });

  it("supports separate blacklist and whitelist tabs at the same time", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("tab", { name: "Blacklist" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Whitelist" })).toHaveAttribute("aria-selected", "false");
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
      authoredAutoReviewEnabled: false,
    }));
  });

  it("persists the AI auto-review toggle from options", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const toggle = screen.getByRole("switch", { name: "AI auto-review" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      repositoryBlacklist: [],
      creatorBlacklist: [],
      repositoryWhitelist: [],
      creatorWhitelist: [],
      autoReviewEnabled: true,
      authoredAutoReviewEnabled: false,
    }));
    expect(toggle).toBeChecked();
  });

  it("opens the PR and marks its current snapshot read", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    expect(screen.queryByRole("link", { name: "Open in web" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: "Example pull request" })[0]);
    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith("bitbucket-1", "DEMO", "sample-repository", "7", "commit-7"));
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Example pull request");
  });

  it("marks a pull request viewed from the card eye action", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    expect(screen.getAllByRole("button", { name: "Mark as viewed" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Mark as viewed" })[0]!);

    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith(
      "bitbucket-1",
      "DEMO",
      "sample-repository",
      "7",
      "commit-7",
    ));
    expect(screen.getAllByRole("button", { name: "Mark as viewed" })).toHaveLength(1);
  });

  it("marks all persisted PR snapshots read", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(markAllPullRequestsReadMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
    expect(screen.queryByText("UPDATED")).not.toBeInTheDocument();
  });

  it("starts an AI review with the complete PR payload and shows AI review…", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getAllByRole("button", { name: "AI review" })[0]);
    await waitFor(() => expect(startReviewMock).toHaveBeenCalledWith(expect.objectContaining(pullRequests[0])));
    expect(await screen.findByRole("button", { name: "AI review…" })).toBeDisabled();
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

    await renderFlatPage();
    await screen.findByRole("heading", { name: "Parallel review example" });
    const reviewButtons = screen.getAllByRole("button", { name: "AI review" });
    expect(reviewButtons).toHaveLength(3);
    reviewButtons.forEach((button) => fireEvent.click(button));

    await waitFor(() => expect(startReviewMock).toHaveBeenCalledTimes(3));
    expect(screen.getAllByRole("button", { name: "AI review…" })).toHaveLength(3);
    resolvers.forEach((resolve) => resolve(runningReview));
  });

  it("shows a green AI verdict badge for an approved review", async () => {
    const approvedReview: PullRequestReviewState = {
      ...completedReview,
      result: { ...completedReview.result!, verdict: "ok" },
    };
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: approvedReview }, pullRequests[1]],
    });

    await renderFlatPage();

    expect(await screen.findByRole("button", { name: "Review results" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI verdict: Approved")).toHaveClass("border-emerald-300");
    expect(screen.getByText("AI verdict · Approved")).toBeInTheDocument();
    const reviewResultsButton = screen.getByRole("button", { name: "Review results" });
    const completedCard = reviewResultsButton.closest(".rounded-lg");
    expect(completedCard).not.toBeNull();
    expect(within(completedCard as HTMLElement).getByRole("button", { name: "Mark as viewed" }).parentElement)
      .toBe(reviewResultsButton.parentElement);
  });
  it("reconciles a completed review when the completion event was missed", async () => {
    getReviewStateMock.mockResolvedValue(completedReview);
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getAllByRole("button", { name: "AI review" })[0]);
    expect(await screen.findByRole("button", { name: "Review results" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Review results" })).not.toBeInTheDocument();
    expect(getReviewStateMock).toHaveBeenCalled();
  });

  it("opens persisted review results and can restart the review", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });
    await renderFlatPage();
    await screen.findByRole("button", { name: "Review results" });
    expect(screen.getByText("AI verdict · Needs work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review results" }));
    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith("bitbucket-1", "DEMO", "sample-repository", "7", "commit-7"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Example pull request" }).closest(".border-l-transparent")).toBeInTheDocument());
    const dialog = await screen.findByRole("dialog", { name: "Review results" });
    expect(dialog).toHaveTextContent("DEMO/sample-repository #7");
    expect(dialog).toHaveTextContent("Example pull request");
    expect(dialog).toHaveTextContent("Test Author A");
    expect(dialog).toHaveTextContent("Needs work");
    expect(dialog).toHaveTextContent("AI summary");
    expect(screen.getByText("Coordinates an example background refresh lifecycle.")).toHaveClass("text-foreground");
    expect(screen.getByText("The change can lose data when the retry races with shutdown.")).toHaveClass("text-foreground");
    expect(dialog).toHaveTextContent("AI comments");
    expect(screen.getByText("Blocker (0)").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("High (1)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Medium (1)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Low (1)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("src/retry.ts:42")).toBeInTheDocument();
    expect(screen.getByText("src/timeout.ts:18")).toBeInTheDocument();
    expect(screen.getByText("src/logging.ts:7")).toBeInTheDocument();
    expect(screen.getByText("Guard this operation before retrying.")).toBeInTheDocument();
    expect(screen.getByText("Blocker (0)")).toHaveClass("text-rose-800");
    expect(screen.getByText("High (1)")).toHaveClass("text-orange-800");
    const publishButton = screen.getByRole("button", { name: "Publish comment for src/retry.ts" });
    expect(publishButton).not.toBeDisabled();
    expect(publishButton).toHaveClass("h-7", "px-2", "text-xs");
    expect(publishButton.querySelector("svg")).toHaveClass("size-3.5");
    expect(publishButton.parentElement).toHaveClass("flex", "items-start", "justify-between");
    expect(screen.getAllByRole("button", { name: /Publish comment for/ })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Open in browser" })).toHaveAttribute("href", pullRequests[0].url);
    fireEvent.click(publishButton);
    expect(publishCommentMock).not.toHaveBeenCalled();
    const commentDialog = await screen.findByRole("dialog", { name: "Edit review comment" });
    expect(within(commentDialog).getByLabelText("Review comment")).toHaveValue("Guard this operation before retrying.");
    fireEvent.change(within(commentDialog).getByLabelText("Review comment"), {
      target: { value: "Guard this operation before retrying before the next attempt." },
    });
    fireEvent.click(within(commentDialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(publishCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: "bitbucket-1", pullRequestId: "7", latestCommit: "commit-7" }),
      { ...completedReview.result!.comments[0], comment: "Guard this operation before retrying before the next attempt." },
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit review comment" })).not.toBeInTheDocument());
    await waitFor(() => expect(publishButton).toHaveTextContent("Published"));
    expect(publishButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Re-run review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs work" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Needs work" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveClass("bg-emerald-600");
    expect(screen.getByRole("button", { name: "Approve" }).querySelector("svg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(setDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ integrationId: "bitbucket-1", pullRequestId: "7", latestCommit: "commit-7" }), "approve"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review results" })).not.toBeInTheDocument());
    const firstCard = screen.getByRole("heading", { name: "Example pull request" }).closest("[class*='border-l-']");
    expect(firstCard?.querySelector('[aria-label="Approved"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review results" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "Review results" });
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "Re-run review" }));
    await waitFor(() => expect(startReviewMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7", activity: "read" })));
    expect(await screen.findByRole("button", { name: "AI review…" })).toBeDisabled();
  });

  it("updates the list decision when needs work is submitted", async () => {
    const needsWorkStatus = { integrationId: "bitbucket-1", pullRequestId: "7", myDecision: "needs_work" as const };
    setDecisionMock.mockResolvedValue(needsWorkStatus);
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });

    await renderFlatPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review results" }));
    fireEvent.click(screen.getByRole("button", { name: "Needs work" }));

    await waitFor(() => expect(setDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7" }), "needs_work"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review results" })).not.toBeInTheDocument());
    const firstCard = screen.getByRole("heading", { name: "Example pull request" }).closest("[class*='border-l-']");
    expect(firstCard?.querySelector('[aria-label="Needs work"]')).toBeInTheDocument();
  });

  it("disables AI review when no AI provider is selected", async () => {
    getAiSettingsMock.mockResolvedValueOnce({
      ...aiSettingsConnected,
      settings: { ...aiSettingsConnected.settings, provider: null },
    });
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    expect(screen.getAllByRole("button", { name: "AI review" })[0]).toBeDisabled();
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
    await renderFlatPage();
    await screen.findByRole("button", { name: "Review results" });

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "AI review" })[0]).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Review results" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "AI review" })[0]).not.toBeDisabled();
  });
});
