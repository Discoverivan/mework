import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MyPullRequest,
  MyPullRequestPage,
  PullRequestCommentMatch,
  PullRequestReviewSettings,
  PullRequestReviewState,
} from "@/shared/contracts/developer";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewStates,
  getPullRequestCommentMatches,
  listMyPullRequests,
  markAllPullRequestsRead,
  markPullRequestRead,
  publishPullRequestComment,
  refreshMyPullRequests,
  removePullRequestReviewer,
  savePullRequestReviewSettings,
  searchBitbucketProjects,
  searchBitbucketRepositories,
  searchBitbucketUsers,
  setPullRequestDecision,
  startPullRequestReview,
} from "./api";
import { clearPullRequestDisplayPreferencesForTests } from "./display-options";
import { MyPullRequestsPage } from "./MyPullRequestsPage";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";

vi.mock("../settings/api", () => ({
  getAiSettings: vi.fn(),
}));

vi.mock("./api", () => ({
  getPullRequestReviewSettings: vi.fn(),
  getPullRequestReviewStates: vi.fn(),
  getPullRequestCommentMatches: vi.fn(),
  listMyPullRequests: vi.fn(),
  markAllPullRequestsRead: vi.fn(),
  markPullRequestRead: vi.fn(),
  refreshMyPullRequests: vi.fn(),
  removePullRequestReviewer: vi.fn(),
  savePullRequestReviewSettings: vi.fn(),
  searchBitbucketProjects: vi.fn(),
  searchBitbucketRepositories: vi.fn(),
  searchBitbucketUsers: vi.fn(),
  setPullRequestDecision: vi.fn(),
  publishPullRequestComment: vi.fn(),
  startPullRequestReview: vi.fn(),
}));

const getAiSettingsMock = vi.mocked(getAiSettings);
const getSettingsMock = vi.mocked(getPullRequestReviewSettings);
const getReviewStatesMock = vi.mocked(getPullRequestReviewStates);
const getCommentMatchesMock = vi.mocked(getPullRequestCommentMatches);
const listMyPullRequestsMock = vi.mocked(listMyPullRequests);
const refreshMyPullRequestsMock = vi.mocked(refreshMyPullRequests);
const removeReviewerMock = vi.mocked(removePullRequestReviewer);
const markAllPullRequestsReadMock = vi.mocked(markAllPullRequestsRead);
const markPullRequestReadMock = vi.mocked(markPullRequestRead);
const saveSettingsMock = vi.mocked(savePullRequestReviewSettings);
const searchProjectsMock = vi.mocked(searchBitbucketProjects);
const searchRepositoriesMock = vi.mocked(searchBitbucketRepositories);
const searchUsersMock = vi.mocked(searchBitbucketUsers);
const setDecisionMock = vi.mocked(setPullRequestDecision);
const publishCommentMock = vi.mocked(publishPullRequestComment);
const startReviewMock = vi.mocked(startPullRequestReview);

const emptySettings: PullRequestReviewSettings = {
  projectBlacklist: [],
  projectWhitelist: [],
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
    retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } },
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
  chooseDisplayOption(dialog, "Group by", "Don't group");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
}

function chooseDisplayOption(dialog: HTMLElement, label: string, option: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("MyPullRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPullRequestDisplayPreferencesForTests();
    window.localStorage.setItem("mework.pull-request-quick-filter.v1.reviewer", "all");
    listMyPullRequestsMock.mockResolvedValue(firstPage);
    refreshMyPullRequestsMock.mockResolvedValue(firstPage);
    getAiSettingsMock.mockResolvedValue(aiSettingsConnected);
    getSettingsMock.mockResolvedValue(emptySettings);
    getReviewStatesMock.mockResolvedValue({});
    getCommentMatchesMock.mockResolvedValue({ matches: [] });
    markPullRequestReadMock.mockResolvedValue({ integrationId: "bitbucket-1", pullRequestId: "7", activity: "read" });
    markAllPullRequestsReadMock.mockResolvedValue({ markedCount: 2 });
    startReviewMock.mockResolvedValue(runningReview);
    setDecisionMock.mockResolvedValue({ integrationId: "bitbucket-1", pullRequestId: "7", myDecision: "approved" });
    publishCommentMock.mockResolvedValue({ commentId: 11 });
    removeReviewerMock.mockResolvedValue(undefined);
    saveSettingsMock.mockImplementation(async (settings) => settings);
    searchProjectsMock.mockResolvedValue([{ integrationId: "bitbucket-1", projectKey: "DEMO", projectName: "Example Project" }]);
    searchRepositoriesMock.mockResolvedValue([{
      projectKey: "DEMO",
      projectName: "Example Project",
      repositorySlug: "sample-repository",
      repositoryName: "Sample Repository",
    }]);
    searchUsersMock.mockResolvedValue([{ name: "test-author-a", displayName: "Test Author A", slug: "test-author-a" }]);
  });

  it("defaults to pending review and remembers the chosen quick filter", async () => {
    clearPullRequestDisplayPreferencesForTests();
    window.localStorage.setItem("mework.pull-request-display-options.v1.reviewer", JSON.stringify({ grouping: "none" }));
    listMyPullRequestsMock.mockResolvedValue({ ...firstPage, values: [{ ...pullRequests[0], myDecision: "not_reviewed" }, pullRequests[1]] });
    const firstRender = render(<MyPullRequestsPage />);
    expect(await screen.findByRole("combobox", { name: "Pull request quick filters" })).toHaveTextContent("Pending your review");
    expect(await screen.findByRole("heading", { name: "Example pull request" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Example documentation change" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Pull request quick filters" }));
    fireEvent.click(screen.getByRole("option", { name: "All" }));
    firstRender.unmount();
    render(<MyPullRequestsPage />);
    expect(await screen.findByRole("combobox", { name: "Pull request quick filters" })).toHaveTextContent("All");
    expect(await screen.findByRole("heading", { name: "Example documentation change" })).toBeInTheDocument();
  });

  it("persists display options across remounts", async () => {
    const firstRender = render(<MyPullRequestsPage />);
    await screen.findByRole("region", { name: "DEMO project" });

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const firstDialog = screen.getByRole("dialog", { name: "Options" });
    chooseDisplayOption(firstDialog, "Sort order", "Recently updated last");
    fireEvent.click(within(firstDialog).getByRole("switch", { name: "Expand groups by default" }));
    chooseDisplayOption(firstDialog, "Group by", "Don't group");
    fireEvent.click(within(firstDialog).getByRole("button", { name: "Save" }));
    firstRender.unmount();

    render(<MyPullRequestsPage />);
    await screen.findByRole("heading", { name: "Example pull request" });
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const secondDialog = screen.getByRole("dialog", { name: "Options" });
    expect(within(secondDialog).getByRole("combobox", { name: "Sort order" })).toHaveTextContent("Recently updated last");
    expect(within(secondDialog).getByRole("combobox", { name: "Group by" })).toHaveTextContent("Don't group");
    expect(within(secondDialog).queryByRole("switch", { name: "Expand groups by default" })).not.toBeInTheDocument();
    chooseDisplayOption(secondDialog, "Group by", "Project");
    fireEvent.click(within(secondDialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(within(screen.getByRole("dialog", { name: "Options" })).getByRole("combobox", { name: "Group by" })).toHaveTextContent("Don't group");
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
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    expect(refreshButton).toHaveClass("h-9");
    expect(refreshButton.querySelector("svg.lucide-refresh-cw")).not.toBeNull();
    expect(refreshButton).not.toHaveTextContent("Refresh");
    const readAllButton = screen.getByRole("button", { name: "Mark all as read" });
    expect(readAllButton).toHaveClass("h-9");
    expect(readAllButton).not.toHaveTextContent("Mark all as read");
    expect(readAllButton.parentElement).toBe(refreshButton.parentElement);
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
      refreshButton,
      readAllButton,
    ]);
    expect(toolbarButtons[toolbarButtons.length - 1]).toBe(readAllButton);
    expect(screen.getByText("Test Author A")).toHaveClass("font-normal");
    expect(screen.getByRole("img", { name: "Needs work" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Approved" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Example pull request" }).closest(".border-l-blue-500")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read" })).not.toBeInTheDocument();
  });

  it("does not count pull requests excluded by permanent filters", async () => {
    getSettingsMock.mockResolvedValueOnce({
      ...emptySettings,
      projectBlacklist: [],
      projectWhitelist: [],
      repositoryBlacklist: ["DEMO/sample-repository"],
    });

    await renderFlatPage();

    expect(await screen.findByRole("heading", { name: "Example documentation change" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Example pull request" })).not.toBeInTheDocument();
    expect(screen.getByText("1 review request")).toBeInTheDocument();
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
    const quickFilter = screen.getByRole("combobox", { name: "Pull request quick filters" });
    expect(quickFilter).toHaveTextContent("All");

    fireEvent.click(quickFilter);
    fireEvent.click(screen.getByRole("option", { name: "Pending your review" }));

    expect(quickFilter).toHaveTextContent("Pending your review");
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
    expect(within(displayOptions).getByRole("button", { name: "Save" })).toBeDisabled();
    const grouping = within(displayOptions).getByRole("combobox", { name: "Group by" });
    const displaySection = sortOrder.closest(".rounded-lg.border");
    expect(displaySection).toBe(grouping.closest(".rounded-lg.border"));
    expect(displaySection?.querySelector('[data-orientation="horizontal"]')).toBeInTheDocument();
    const expandProjects = within(displayOptions).getByRole("switch", { name: "Expand groups by default" });
    expect(sortOrder).toHaveTextContent("Recently updated first");
    expect(within(demoGroup).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Example pull request",
      "Example documentation change",
    ]);
    chooseDisplayOption(displayOptions, "Sort order", "Recently updated last");
    expect(within(displayOptions).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(within(demoGroup).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Example pull request",
      "Example documentation change",
    ]);
    expect(grouping).toHaveTextContent("Project");
    expect(expandProjects).toBeEnabled();
    expect(expandProjects).not.toBeChecked();
    fireEvent.click(expandProjects);
    expect(within(screen.getByRole("region", { name: "TOOLS project" })).queryByRole("heading", { name: "Tools project change" })).not.toBeInTheDocument();
    chooseDisplayOption(displayOptions, "Group by", "Person (PR author)");
    expect(screen.queryByRole("region", { name: "Pull requests by Test Author A" })).not.toBeInTheDocument();
    expect(within(displayOptions).getByRole("switch", { name: "Expand groups by default" })).toBeInTheDocument();
    fireEvent.click(within(displayOptions).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("region", { name: "Pull requests by Test Author A" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pull requests by Test Author B" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const secondOptions = screen.getByRole("dialog", { name: "Options" });
    chooseDisplayOption(secondOptions, "Group by", "Don't group");
    expect(within(secondOptions).queryByRole("switch", { name: "Expand groups by default" })).not.toBeInTheDocument();
    fireEvent.click(within(secondOptions).getByRole("button", { name: "Save" }));

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
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add author filter" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Creator filters" }), { target: { value: "Test Author A" } });
    await waitFor(() => expect(searchUsersMock).toHaveBeenCalledWith("Test Author A"));
    fireEvent.click(screen.getByRole("button", { name: "Test Author A (test-author-a)" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      projectBlacklist: [],
      projectWhitelist: [],
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

  it("supports separate Deny and Allow filters in minimal style", async () => {
    document.documentElement.dataset.buttonStyle = "quiet";
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("radio", { name: "Deny" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Allow" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add author filter" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Creator filters" }), { target: { value: "Test Author A" } });
    await waitFor(() => expect(searchUsersMock).toHaveBeenCalledWith("Test Author A"));
    fireEvent.click(await screen.findByRole("button", { name: "Test Author A (test-author-a)" }));

    fireEvent.click(screen.getByRole("radio", { name: "Allow" }));
    expect(screen.getByRole("radio", { name: "Allow" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Deny" })).not.toBeChecked();
    expect(screen.queryByText("Test Author A", { selector: "li span" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add project filter" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project filters" }), { target: { value: "Example Project" } });
    fireEvent.click(await screen.findByRole("button", { name: "DEMO (Example Project)" }));
    fireEvent.click(screen.getByRole("button", { name: "Add repository filter" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository filters" }), { target: { value: "sample-repository" } });
    await waitFor(() => expect(searchRepositoriesMock).toHaveBeenCalledWith("sample-repository"));
    fireEvent.click(await screen.findByRole("button", { name: /DEMO\/sample-repository/ }));
    expect(screen.queryByRole("textbox", { name: "Repository filters" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Allow repository filter DEMO/sample-repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      projectBlacklist: [],
      projectWhitelist: ["DEMO"],
      repositoryBlacklist: [],
      creatorBlacklist: ["Test Author A"],
      repositoryWhitelist: [],
      creatorWhitelist: [],
      autoReviewEnabled: false,
      authoredAutoReviewEnabled: false,
    }));
    delete document.documentElement.dataset.buttonStyle;
  });

  it("persists the AI auto-review toggle from options", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const toggle = screen.getByRole("switch", { name: "AI auto-review" });
    expect(toggle).toHaveClass("h-[22px]", "w-10");
    expect(screen.getByText("AI auto-review", { selector: "label" })).toHaveClass("text-sm", "font-semibold", "leading-tight");
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("app-action-text", "hover:text-primary");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("app-action-text", "hover:text-primary");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith({
      projectBlacklist: [],
      projectWhitelist: [],
      repositoryBlacklist: [],
      creatorBlacklist: [],
      repositoryWhitelist: [],
      creatorWhitelist: [],
      autoReviewEnabled: true,
      authoredAutoReviewEnabled: false,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByRole("switch", { name: "AI auto-review" })).toBeChecked();
  });

  it("opens the PR and marks its current snapshot read", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    expect(screen.queryByRole("link", { name: "Open in web" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: "Example pull request" })[0]);
    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith("bitbucket-1", "DEMO", "sample-repository", "7", "commit-7"));
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Example pull request");
  });

  it("marks a pull request viewed from the card action", async () => {
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    const moreActionsButton = screen.getAllByRole("button", { name: "More actions" })[0]!;
    fireEvent.pointerDown(moreActionsButton, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as viewed" }));

    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith(
      "bitbucket-1",
      "DEMO",
      "sample-repository",
      "7",
      "commit-7",
    ));
    fireEvent.pointerDown(moreActionsButton, { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menuitem", { name: "Mark as viewed" })).not.toBeInTheDocument();
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

    const startButton = screen.getAllByRole("button", { name: "Start AI review" })[0];
    expect(startButton).toHaveAttribute("title", "Start AI review");
    expect(startButton.querySelector("svg.lucide-sparkles")).toBeInTheDocument();
    fireEvent.click(startButton);
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
    const reviewButtons = screen.getAllByRole("button", { name: "Start AI review" });
    expect(reviewButtons).toHaveLength(3);
    reviewButtons.forEach((button) => fireEvent.click(button));

    await waitFor(() => expect(startReviewMock).toHaveBeenCalledTimes(3));
    expect(screen.getAllByRole("button", { name: "AI review…" })).toHaveLength(3);
    resolvers.forEach((resolve) => resolve(runningReview));
  });

  it("opens AI review errors and allows retrying the review", async () => {
    let resolveReview!: (review: PullRequestReviewState) => void;
    startReviewMock.mockImplementationOnce(() => new Promise<PullRequestReviewState>((resolve) => {
      resolveReview = resolve;
    }));
    const failedReview: PullRequestReviewState = {
      runId: "run-failed-example",
      instructionsChanged: true,
      status: "failed",
      reviewedCommit: "commit-7",
      result: null,
      error: "Example review failure details",
      startedAt: 1,
      finishedAt: 2,
      execution: { provider: "codex-cli", providerName: "Codex CLI", providerInstanceId: null, model: "example-failed-model", reasoning: "high", mode: "normal" },
    };
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: failedReview }, pullRequests[1]],
    });

    await renderFlatPage();
    const rerunButton = await screen.findByRole("button", { name: "Re-run review" });
    expect(rerunButton).toHaveClass("h-5", "w-3.5");
    expect(rerunButton.parentElement).toBe(screen.getByText("AI review error"));
    expect(screen.getByText("AI review error")).toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: "AI review error" }).querySelector("svg.lucide-sparkles")).toHaveClass("text-destructive");
    fireEvent.click(screen.getByRole("button", { name: "Show review details" }));
    let failureDetails = await screen.findByRole("dialog", { name: "Review details" });
    expect(failureDetails).toHaveTextContent("Review ended:");
    expect(failureDetails).toHaveTextContent("Codex CLI");
    expect(failureDetails).toHaveTextContent("example-failed-model");
    expect(failureDetails).toHaveTextContent("Instructions changed");
    fireEvent.click(screen.getByRole("button", { name: "Show review details" }));
    fireEvent.click(await screen.findByRole("button", { name: "AI review error" }));

    let dialog = await screen.findByRole("dialog", { name: "AI review results" });
    expect(within(dialog).getByText("Example review failure details")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["", "Retry review", "Close"]);
    expect(within(dialog).getByRole("link", { name: "Open in browser" })).toHaveAttribute("href", pullRequests[0].url);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show review details" }));
    failureDetails = await screen.findByRole("dialog", { name: "Review details" });
    expect(failureDetails).toHaveTextContent("example-failed-model");
    expect(failureDetails.querySelector("time")).toHaveAttribute("dateTime", new Date(failedReview.finishedAt!).toISOString());
    fireEvent.click(within(dialog).getByRole("button", { name: "Show review details" }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI review results" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI review error" }));
    dialog = await screen.findByRole("dialog", { name: "AI review results" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry review" }));
    await waitFor(() => expect(startReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: pullRequests[0].integrationId,
      pullRequestId: pullRequests[0].pullRequestId,
    })));
    expect(screen.getByRole("button", { name: "AI review…" }).querySelector("svg.lucide-sparkles")).toHaveClass("text-primary");
    expect(screen.getByText("AI review in progress")).toHaveAttribute("role", "status");
    expect(screen.queryByText("AI review error")).not.toBeInTheDocument();
    resolveReview(runningReview);
  });

  it("excludes a repository from the PR actions menu", async () => {
    await renderFlatPage();
    const card = (await screen.findByRole("heading", { name: "Example pull request" })).closest("[class*='border-l-']") as HTMLElement;
    fireEvent.pointerDown(within(card).getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Exclude repository" }));
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      projectBlacklist: [],
      projectWhitelist: [],
      repositoryBlacklist: ["DEMO/sample-repository"],
    })));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Example pull request" })).not.toBeInTheDocument());
  });

  it("confirms removal of the current reviewer from the PR actions menu", async () => {
    await renderFlatPage();
    const card = (await screen.findByRole("heading", { name: "Example pull request" })).closest("[class*='border-l-']") as HTMLElement;
    fireEvent.pointerDown(within(card).getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove me as reviewer" }));
    expect(removeReviewerMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove reviewer" }));
    await waitFor(() => expect(removeReviewerMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7" }), expect.any(String)));
  });

  it("publishes review decisions concurrently for different pull requests", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });
    let finishDecision!: () => void;
    let finishOtherDecision!: () => void;
    setDecisionMock.mockImplementationOnce(() => new Promise((resolve) => {
      finishDecision = () => resolve({ integrationId: "bitbucket-1", pullRequestId: "7", myDecision: "approved" });
    })).mockImplementationOnce(() => new Promise((resolve) => {
      finishOtherDecision = () => resolve({ integrationId: "bitbucket-1", pullRequestId: "7", myDecision: "needs_work" });
    }));
    await renderFlatPage();
    const card = (await screen.findByRole("heading", { name: "Example pull request" })).closest("[class*='border-l-']") as HTMLElement;
    fireEvent.pointerDown(within(card).getByRole("button", { name: "Review decision" }), { button: 0, ctrlKey: false });
    expect(setDecisionMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Approve" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(setDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7" }), "approve"));
    expect(within(card).getByRole("button", { name: "Review decision" })).toBeDisabled();
    // The same PR number in a different repository is an independent action.
    const otherCard = screen.getByRole("heading", { name: "Example documentation change" }).closest("[class*='border-l-']") as HTMLElement;
    const otherDecisionButton = within(otherCard).getByRole("button", { name: "Review decision" });
    expect(otherDecisionButton).not.toBeDisabled();
    fireEvent.pointerDown(otherDecisionButton, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Needs work" }));
    await waitFor(() => expect(setDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ repositorySlug: "docs", pullRequestId: "7" }), "needs_work",
    ));
    expect(otherDecisionButton).toBeDisabled();
    finishOtherDecision();
    await waitFor(() => expect(otherDecisionButton).not.toBeDisabled());
    expect(within(card).getByRole("button", { name: "Review decision" })).toBeDisabled();
    fireEvent.click(within(card).getByRole("button", { name: "AI review results" }));
    const dialog = await screen.findByRole("dialog", { name: "AI review results" });
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Needs work" })).toBeDisabled();
    const invalidateCounts = vi.fn();
    const unsubscribeCounts = subscribeAppEvent(APP_EVENT.pullRequestActivityChanged, invalidateCounts);
    finishDecision();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Needs work" })).not.toBeDisabled());
    expect(invalidateCounts).toHaveBeenCalledOnce();
    unsubscribeCounts();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Review decision" }).querySelector("svg.lucide-circle-check")).toBeInTheDocument());
  });

  it("shows an approved AI verdict and a message when the review has no comments", async () => {
    const approvedReview: PullRequestReviewState = {
      ...completedReview,
      result: { ...completedReview.result!, verdict: "ok", comments: [] },
    };
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: approvedReview }, pullRequests[1]],
    });

    await renderFlatPage();

    expect(await screen.findByRole("button", { name: "AI review results" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI verdict: Approved")).toHaveClass("text-success");
    expect(screen.getByLabelText("AI verdict: Approved")).toHaveTextContent("Approved");
    const reviewResultsButton = screen.getByRole("button", { name: "AI review results" });
    expect(reviewResultsButton.querySelector("svg.lucide-sparkles")).toHaveClass("text-success");
    const completedCard = reviewResultsButton.closest(".rounded-lg");
    expect(completedCard).not.toBeNull();
    expect(within(completedCard as HTMLElement).getByRole("button", { name: "More actions" }).parentElement)
      .toBe(reviewResultsButton.parentElement);
    fireEvent.click(reviewResultsButton);
    const dialog = await screen.findByRole("dialog", { name: "AI review results" });
    expect(within(dialog).getByText("The AI review has no comments.")).toBeInTheDocument();
    expect(dialog.querySelector("details")).toBeNull();
  });
  it("reconciles a completed review when the completion event was missed", async () => {
    getReviewStatesMock.mockResolvedValue({
      "bitbucket-1:DEMO:sample-repository:7": completedReview,
    });
    await renderFlatPage();
    await screen.findByRole("heading", { name: "Example pull request" });

    fireEvent.click(screen.getAllByRole("button", { name: "Start AI review" })[0]);
    expect(await screen.findByRole("button", { name: "AI review results" }, { timeout: 7_000 })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "AI review results" })).not.toBeInTheDocument();
    expect(getReviewStatesMock).toHaveBeenCalled();
  }, 8_000);

  it("opens persisted review results and can restart the review", async () => {
    const markdownReview: PullRequestReviewState = {
      ...completedReview,
      finishedAt: Date.now() - 5 * 60_000,
      execution: { provider: "codex-cli", providerName: "Codex CLI", providerInstanceId: null, model: "example-review-model", reasoning: "high", mode: "fast" },
      result: {
        ...completedReview.result!,
        summary: `${completedReview.result!.summary}\n\n- **Check shutdown order**\n- Keep \`retry\` guarded`,
        comments: completedReview.result!.comments.map((comment, index) => index === 1
          ? { ...comment, file: `src://${comment.file}`, comment: `${comment.comment}\n\n1. Check the timer\n2. Retry safely` }
          : { ...comment, file: `dst://${comment.file}` }),
      },
    };
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: markdownReview }, pullRequests[1]],
    });
    await renderFlatPage();
    await screen.findByRole("button", { name: "AI review results" });
    expect(screen.getByLabelText("AI verdict: Needs work")).toHaveTextContent("Needs work");
    expect(screen.getByRole("button", { name: "Show review details" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI review results" }));
    await waitFor(() => expect(markPullRequestReadMock).toHaveBeenCalledWith("bitbucket-1", "DEMO", "sample-repository", "7", "commit-7"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Example pull request" }).closest(".border-l-transparent")).toBeInTheDocument());
    const dialog = await screen.findByRole("dialog", { name: "AI review results" });
    expect(dialog).toHaveTextContent("DEMO/sample-repository #7");
    expect(dialog).toHaveTextContent("Example pull request");
    expect(dialog).toHaveTextContent("Test Author A");
    expect(dialog).toHaveTextContent("Needs work");
    expect(dialog).toHaveTextContent("AI summary");
    expect(dialog).not.toHaveTextContent("Review completed:");
    const verdictBadge = within(dialog).getByLabelText("AI verdict: Needs work");
    fireEvent.click(within(verdictBadge).getByRole("button", { name: "Show review details" }));
    const reviewDetails = await screen.findByRole("dialog", { name: "Review details" });
    expect(reviewDetails).toHaveTextContent("Review completed:");
    expect(within(reviewDetails).getByText(/5m ago/)).toHaveAttribute("dateTime", new Date(markdownReview.finishedAt!).toISOString());
    expect(reviewDetails.querySelector("time")?.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    const aiConfiguration = within(reviewDetails).getByLabelText("AI configuration used for this review");
    expect(aiConfiguration).toHaveTextContent("Codex CLI");
    expect(aiConfiguration).toHaveTextContent("example-review-model");
    expect(aiConfiguration).toHaveTextContent("AI provider: Codex CLI");
    expect(aiConfiguration).toHaveTextContent("Reasoning: high");
    expect(aiConfiguration).toHaveTextContent("Mode: Fast");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show review details" }));
    expect(screen.getByText("Coordinates an example background refresh lifecycle.")).toHaveClass("text-foreground");
    expect(screen.getByText("The change can lose data when the retry races with shutdown.")).toHaveClass("text-foreground");
    expect(dialog).toHaveTextContent("AI comments");
    expect(screen.getByText("Check shutdown order").tagName).toBe("STRONG");
    expect(screen.getByText("Check shutdown order").closest("li")?.parentElement?.tagName).toBe("UL");
    expect(screen.getByText("Check the timer").closest("li")?.parentElement?.tagName).toBe("OL");
    expect(screen.queryByText("Blocker (0)")).not.toBeInTheDocument();
    expect(screen.getByText("High (1)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Medium (1)").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Low (1)").closest("details")).toHaveAttribute("open");
    const findingLocation = screen.getByRole("link", { name: "src/retry.ts:42" });
    expect(findingLocation).toHaveAttribute("href", `${pullRequests[0].url}/diff#src/retry.ts?t=42`);
    expect(findingLocation).toHaveAttribute("target", "_blank");
    expect(findingLocation).toHaveClass("text-sm", "font-medium", "font-mono", "text-primary");
    expect(findingLocation.querySelector("wbr")).toBeInTheDocument();
    expect(within(findingLocation).getByText("retry.ts:42")).toHaveClass("inline-block");
    expect(screen.getByRole("link", { name: "src/timeout.ts:18" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/logging.ts:7" })).toBeInTheDocument();
    expect(screen.getByText("Guard this operation before retrying.")).toBeInTheDocument();
    expect(screen.getByText("High (1)").closest("summary")).toHaveClass("text-destructive", "bg-destructive/10");
    const mediumSection = screen.getByText("Medium (1)").closest("details");
    expect(mediumSection).toHaveClass("border-warning/40");
    expect(mediumSection?.querySelector("summary")).toHaveClass("bg-warning/10", "text-warning");
    expect(mediumSection?.querySelector("summary")?.nextElementSibling).toHaveClass("bg-background", "text-foreground");
    const publishButton = screen.getByRole("button", { name: "Publish comment for src/retry.ts" });
    await waitFor(() => expect(publishButton).not.toBeDisabled());
    expect(publishButton).toHaveClass("app-action-text", "h-9");
    expect(publishButton.parentElement).toHaveClass("flex", "items-center", "gap-2");
    expect(publishButton).toHaveAttribute("data-action-tone", "neutral");
    expect(publishButton).toHaveAttribute("title", "Publish");
    expect(publishButton).toHaveTextContent("Publish");
    expect(screen.getAllByRole("button", { name: /Publish comment for/ })).toHaveLength(3);
    const openInBrowser = screen.getByRole("link", { name: "Open in browser" });
    expect(openInBrowser).toHaveAttribute("href", pullRequests[0].url);
    expect(openInBrowser).toHaveAttribute("title", "Open in browser");
    expect(openInBrowser).toHaveClass("app-action-text", "h-9");
    expect(screen.getByRole("button", { name: "Re-run review" })).toHaveClass("app-action-text", "h-9");
    expect(openInBrowser).toHaveTextContent("Open in browser");
    fireEvent.keyDown(publishButton, { key: "ArrowDown" });
    expect(publishCommentMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit and send…" }));
    const commentDialog = await screen.findByRole("dialog", { name: "Edit review comment" });
    expect(within(commentDialog).getByLabelText("Review comment")).toHaveValue("Guard this operation before retrying.");
    fireEvent.change(within(commentDialog).getByLabelText("Review comment"), {
      target: { value: "Guard this operation before retrying before the next attempt." },
    });
    fireEvent.click(within(commentDialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(publishCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: "bitbucket-1", pullRequestId: "7", latestCommit: "commit-7" }),
      { ...markdownReview.result!.comments[0], comment: "Guard this operation before retrying before the next attempt." },
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit review comment" })).not.toBeInTheDocument());
    await waitFor(() => expect(publishButton).toHaveAttribute("title", "Published"));
    expect(publishButton).toBeDisabled();
    const nextPublishButton = screen.getByRole("button", { name: "Publish comment for src/timeout.ts" });
    fireEvent.keyDown(nextPublishButton, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Send as is" }));
    await waitFor(() => expect(publishCommentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pullRequestId: "7", latestCommit: "commit-7" }),
      markdownReview.result!.comments[1],
    ));
    await waitFor(() => expect(nextPublishButton).toBeDisabled());
    expect(screen.getByRole("button", { name: "Re-run review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs work" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Needs work" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveClass("text-foreground", "hover:text-success");
    expect(screen.getByRole("button", { name: "Approve" }).querySelector("svg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(setDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ integrationId: "bitbucket-1", pullRequestId: "7", latestCommit: "commit-7" }), "approve"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI review results" })).not.toBeInTheDocument());
    const firstCard = screen.getByRole("heading", { name: "Example pull request" }).closest("[class*='border-l-']");
    expect(firstCard?.querySelector('[aria-label="Approved"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI review results" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "AI review results" });
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "Re-run review" }));
    await waitFor(() => expect(startReviewMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7", activity: "read" })));
    expect(await screen.findByRole("button", { name: "AI review…" })).toBeDisabled();
  });

  it("links a covered finding and publishes a missing clarification as a reply", async () => {
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });
    let finishComparison!: (value: { matches: PullRequestCommentMatch[] }) => void;
    getCommentMatchesMock.mockImplementation(() => new Promise((resolve) => { finishComparison = resolve; }));
    let finishPublication!: (value: { commentId: number }) => void;
    publishCommentMock.mockImplementation(() => new Promise((resolve) => { finishPublication = resolve; }));
    publishCommentMock.mockRejectedValueOnce(new Error("Discussion changed"));
    await renderFlatPage();
    fireEvent.click(await screen.findByRole("button", { name: "AI review results" }));
    for (const comment of completedReview.result!.comments) {
      expect(screen.getByRole("status", { name: `Comment status for ${comment.file}` })).toHaveTextContent("Checking…");
      expect(screen.queryByRole("button", { name: `Publish comment for ${comment.file}` })).not.toBeInTheDocument();
    }
    finishComparison({ matches: [
      { index: 1, commentId: 11, coverage: "full", addition: "" },
      { index: 0, commentId: 12, parentCommentId: 11, coverage: "partial", addition: "Wait for pending requests before shutdown." },
    ] });
    const existing = await screen.findByRole("link", { name: "Existing comment for src/timeout.ts" });
    expect(screen.getByRole("status", { name: "Comment status for src/timeout.ts" })).toHaveTextContent("Already discussed");
    expect(screen.getByRole("status", { name: "Comment status for src/retry.ts" })).toHaveTextContent("Partially covered");
    expect(screen.getByRole("button", { name: "Publish comment for src/logging.ts" })).toBeEnabled();
    expect(existing).toHaveAttribute("href", `${pullRequests[0].url}/overview?commentId=11`);
    expect(screen.queryByRole("button", { name: "Publish comment for src/timeout.ts" })).not.toBeInTheDocument();
    const duplicateStatus = screen.getByRole("status", { name: "Comment status for src/timeout.ts" });
    expect(duplicateStatus).toHaveAttribute("title", "An existing discussion already fully covers this finding.");
    expect(screen.queryByText("An existing discussion already fully covers this finding.")).not.toBeInTheDocument();
    const duplicateCard = existing.closest("li")!;
    expect(duplicateCard.lastElementChild).toContainElement(duplicateStatus);
    expect(duplicateCard.lastElementChild).toHaveClass("justify-end");
    expect(duplicateCard.lastElementChild).toContainElement(existing);
    expect(duplicateCard.firstElementChild).toContainElement(screen.getByRole("link", { name: "src/timeout.ts:18" }));
    const partialStatus = screen.getByRole("status", { name: "Comment status for src/retry.ts" });
    expect(partialStatus.closest("li")!.lastElementChild).toContainElement(screen.getByRole("link", { name: "Existing comment for src/retry.ts" }));
    expect(screen.getByRole("link", { name: "Existing comment for src/retry.ts" })).toHaveAttribute("href", `${pullRequests[0].url}/overview?commentId=12`);
    const publishClarification = screen.getByRole("button", { name: "Publish comment for src/retry.ts" });
    expect(publishClarification).toHaveClass("app-action-text", "h-9");
    expect(publishClarification).toHaveAttribute("data-action-tone", "neutral");
    expect(publishClarification).toHaveAttribute("title", "Publish clarification");
    expect(publishClarification).toHaveTextContent("Publish clarification");
    expect(publishClarification.querySelector(".lucide-send")).toBeInTheDocument();
    fireEvent.click(publishClarification);
    const editor = await screen.findByRole("dialog", { name: "Publish clarification" });
    expect(within(editor).getByLabelText("Review comment")).toHaveValue("Wait for pending requests before shutdown.");
    expect(publishCommentMock).not.toHaveBeenCalled();
    getCommentMatchesMock.mockResolvedValue({ matches: [
      { index: 1, commentId: 11, coverage: "full", addition: "" },
      { index: 0, commentId: 22, parentCommentId: 21, coverage: "partial", addition: "Wait for pending requests before shutdown." },
    ] });
    fireEvent.click(within(editor).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(publishCommentMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7" }), {
      ...completedReview.result!.comments[0], comment: "Wait for pending requests before shutdown.", parentCommentId: 11,
    }));
    await waitFor(() => expect(within(editor).getByRole("button", { name: "Send" })).toBeDisabled());
    expect(within(editor).getByText("The matching discussion changed. Cancel this editor and reopen the comment action to review and confirm the updated destination.")).toBeInTheDocument();
    expect(within(editor).getByLabelText("Review comment")).toHaveValue("Wait for pending requests before shutdown.");
    expect(publishCommentMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish comment for src/retry.ts" }));
    const updatedEditor = await screen.findByRole("dialog", { name: "Publish clarification" });
    fireEvent.click(within(updatedEditor).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(publishCommentMock).toHaveBeenLastCalledWith(expect.objectContaining({ pullRequestId: "7" }), {
      ...completedReview.result!.comments[0], comment: "Wait for pending requests before shutdown.", parentCommentId: 21,
    }));
    expect(screen.getByText("Publishing…", { selector: "span" })).toHaveAttribute("aria-label", "Comment status for src/retry.ts");
    finishPublication({ commentId: 13 });
    await waitFor(() => expect(screen.getByRole("status", { name: "Comment status for src/retry.ts" })).toHaveTextContent("Published"));
    expect(getCommentMatchesMock).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: "bitbucket-1", projectKey: "DEMO", repositorySlug: "sample-repository",
      pullRequestId: "7", comments: completedReview.result!.comments,
    }));
  });

  it("updates the list decision when needs work is submitted", async () => {
    const needsWorkStatus = { integrationId: "bitbucket-1", pullRequestId: "7", myDecision: "needs_work" as const };
    setDecisionMock.mockResolvedValue(needsWorkStatus);
    listMyPullRequestsMock.mockResolvedValueOnce({
      ...firstPage,
      values: [{ ...pullRequests[0], review: completedReview }, pullRequests[1]],
    });

    await renderFlatPage();
    fireEvent.click(await screen.findByRole("button", { name: "AI review results" }));
    fireEvent.click(screen.getByRole("button", { name: "Needs work" }));

    await waitFor(() => expect(setDecisionMock).toHaveBeenCalledWith(expect.objectContaining({ pullRequestId: "7" }), "needs_work"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI review results" })).not.toBeInTheDocument());
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

    expect(screen.getAllByRole("button", { name: "Start AI review" })[0]).toBeDisabled();
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
    await screen.findByRole("button", { name: "AI review results" });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Start AI review" })[0]).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "AI review results" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Start AI review" })[0]).not.toBeDisabled();
  });
});
