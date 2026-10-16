import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyMyTasksDto, DailySprintStatsDto, DailyTeamWorkspaceDto } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { loadDailyMyTasks, loadDailySprintStats, loadDailyTeamWorkspace } from "./api";
import { clearDailyWorkspaceCacheForTests, prefetchDailyWorkspaces } from "./cache";
import { DailyPage } from "./DailyPage";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../planning/api", () => ({ listManagedProjects: vi.fn() }));
vi.mock("./api", () => ({
  generateSprintSummary: vi.fn(), loadDailyWorkspace: vi.fn(), refreshDailyWorkspace: vi.fn(),
  loadDailyMyTasks: vi.fn(), loadDailyTeamWorkspace: vi.fn(), loadDailySprintStats: vi.fn(),
  loadDailyIssueTransitions: vi.fn(), transitionDailyIssue: vi.fn(), publishPresenterState: vi.fn(),
  openPresenterView: vi.fn(), closePresenterView: vi.fn(), subscribePresenterState: vi.fn(() => () => undefined),
}));

const project: ManagedProject = { id: "managed-1", integrationId: "jira-1", jiraProjectId: "10001", name: "Example Project", boardId: "42", boardName: "Example Board" };
const myTasks: DailyMyTasksDto = {
  managedProjectId: project.id, projectName: project.name, projectKey: "DEMO", selectedSprintId: "sprint-1", selectedSprintName: "Sprint 42", currentUserAccountId: "test-user-a",
  currentUserMember: { accountId: "test-user-a", displayName: "Test Member", active: true, tags: [] },
  sprints: [{ id: "sprint-1", name: "Sprint 42", state: "active", startDate: "2026-10-02T12:00:00", endDate: "2026-10-15T12:00:00" }],
  subtasks: [{ id: "task-1", key: "DEMO-1", summary: "Example task", status: "In Progress", issueType: "Task", assigneeAccountId: "test-user-a", url: "https://jira.example.invalid/browse/DEMO-1" }],
};
const team: DailyTeamWorkspaceDto = { ...myTasks, sprintBoardUrl: "https://jira.example.invalid/board", sprintBoardUrlsByAssignee: {}, members: [{ accountId: "test-user-a", displayName: "Test Member", active: true, tags: [] }] };
const stats: DailySprintStatsDto = {
  availability: "available", originalTaskCount: 1, completedOriginalTaskCount: 0, originalStoryPoints: 3, completedOriginalStoryPoints: 0,
  addedTaskCount: 0, completedAddedTaskCount: 0, addedStoryPoints: 0, completedAddedStoryPoints: 0, scopeAvailability: "available",
  issuesWithIncompleteScopeHistory: [], issuesWithUnavailableStatus: [], issuesWithoutScopeStoryPoints: [], scopeIssues: [],
  statusBreakdown: [
    { category: "todo", taskCount: 1, storyPoints: 3 },
    { category: "inProgress", taskCount: 0, storyPoints: 0 },
    { category: "done", taskCount: 0, storyPoints: 0 },
    { category: "unknown", taskCount: 0, storyPoints: 0 },
  ],
  issuesWithoutStoryPoints: [],
};
const listProjectsMock = vi.mocked(listManagedProjects);
const myTasksMock = vi.mocked(loadDailyMyTasks);
const teamMock = vi.mocked(loadDailyTeamWorkspace);
const statsMock = vi.mocked(loadDailySprintStats);

beforeEach(() => {
  vi.clearAllMocks(); clearDailyWorkspaceCacheForTests();
  listProjectsMock.mockResolvedValue([project]);
  myTasksMock.mockResolvedValue(myTasks);
  teamMock.mockResolvedValue(team);
  statsMock.mockResolvedValue(stats);
});

describe("DailyPage data loading and actions", () => {
  it("prefetches only minimal My Tasks for the healthy Jira projects", async () => {
    await prefetchDailyWorkspaces([project.integrationId]);
    expect(myTasksMock).toHaveBeenCalledWith(project.id, undefined);
    expect(teamMock).not.toHaveBeenCalled();
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("loads minimal My Tasks on entry and lazily loads each other tab only when opened", async () => {
    render(<DailyPage />);
    expect(await screen.findByText("DEMO-1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Test Member" })).toBeInTheDocument();
    for (const tabName of ["My Tasks", "Team Tasks", "Sprint Stats"]) {
      expect(screen.getByRole("tab", { name: tabName }).querySelector("svg")).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: project.name })).not.toBeInTheDocument();
    expect(myTasksMock).toHaveBeenCalledWith(project.id, undefined);
    expect(teamMock).not.toHaveBeenCalled();
    expect(statsMock).not.toHaveBeenCalled();
    const actions = screen.getByRole("tablist").parentElement?.querySelector(".daily-workspace-actions");
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Refresh"]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(myTasksMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    teamMock.mockResolvedValueOnce({
      ...team,
      members: team.members.map((member) => ({ ...member, accountId: member.accountId.toUpperCase() })),
    });
    fireEvent.click(screen.getByRole("tab", { name: "Team Tasks" }));
    await waitFor(() => expect(teamMock).toHaveBeenCalledTimes(1));
    const teamActions = screen.getByRole("tablist").parentElement?.querySelector(".daily-workspace-actions");
    expect(within(teamActions as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["AI Summary", "Presenter view", "Refresh"]);
    expect(await screen.findByRole("region", { name: "Selected member tasks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "My Tasks" }));
    expect(screen.getByRole("heading", { name: "Test Member" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: project.name })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(1));
    const statsActions = screen.getByRole("tablist").parentElement?.querySelector(".daily-workspace-actions");
    expect(within(statsActions as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Refresh"]);
    const plannedMetric = screen.getByRole("group", { name: "Planned" });
    const summaryCard = plannedMetric.closest('[data-slot="card"]');
    expect(summaryCard).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Sprint Overview" })).toBeInTheDocument();
    expect(screen.getByText("02.10.2026 – 15.10.2026")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: "Current sprint scope by status: 0 SP done, 0 SP in progress, 3 SP to do. Planned scope is 3 of 3 SP." });
    expect(chart.closest('[data-slot="card"]')).toBe(summaryCard);
    expect(screen.queryByRole("heading", { name: "Planned scope completion" })).not.toBeInTheDocument();
    expect(screen.queryByText("237 SP in current scope")).not.toBeInTheDocument();
    expect(chart.querySelectorAll(".daily-scope-meter-segment")).toHaveLength(3);
    expect(within(summaryCard as HTMLElement).getByText("Done · 0 SP")).toBeInTheDocument();
    expect(within(summaryCard as HTMLElement).getByText("To do · 3 SP")).toBeInTheDocument();
    expect(chart.querySelector(".daily-scope-meter-target")).toBeNull();
    expect(chart.querySelector(".daily-scope-meter-axis")).toBeNull();
  });

  it("renders and sorts the four-column tasks table", async () => {
    statsMock.mockResolvedValueOnce({
      ...stats,
      addedTaskCount: 2,
      addedStoryPoints: 2,
      scopeIssues: [
        { key: "DEMO-10", summary: "Example closed task", status: "Closed", statusCategory: "done", storyPoints: 3, addedAfterStart: false },
        { key: "DEMO-11", summary: "Example release task", status: "In Release", statusCategory: "indeterminate", storyPoints: 1, addedAfterStart: true },
        { key: "DEMO-12", summary: "Example pending task", status: "To Do", statusCategory: "new", storyPoints: 2, addedAfterStart: true },
      ],
      statusBreakdown: [
        { category: "todo", taskCount: 1, storyPoints: 2 },
        { category: "inProgress", taskCount: 1, storyPoints: 1 },
        { category: "done", taskCount: 1, storyPoints: 2 },
        { category: "unknown", taskCount: 0, storyPoints: 0 },
      ],
    });
    render(<DailyPage />);
    await screen.findByText("DEMO-1");
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));

    const table = await screen.findByRole("table", { name: "Tasks" });
    expect(screen.getByText("02.10.2026 – 15.10.2026")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Key", "Summary", "Status", "SP"]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Closed")).toHaveClass("bg-success/20");
    expect(within(table).getByText("In Release")).toHaveClass("bg-success/10");
    expect(within(table).getByText("Example release task")).toHaveClass("whitespace-normal");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(within(headers[3] as HTMLElement).getByRole("button", { name: "SP" }));
    expect(headers[3]).toHaveAttribute("aria-sort", "ascending");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent?.match(/DEMO-\d+/)?.[0])).toEqual(["DEMO-11", "DEMO-12", "DEMO-10"]);
    fireEvent.click(within(headers[3] as HTMLElement).getByRole("button", { name: "SP" }));
    expect(headers[3]).toHaveAttribute("aria-sort", "descending");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent?.match(/DEMO-\d+/)?.[0])).toEqual(["DEMO-10", "DEMO-12", "DEMO-11"]);
  });

  it("keeps a pending stats request alive and reuses it when returning to the tab", async () => {
    let resolveStats!: (value: DailySprintStatsDto) => void;
    statsMock.mockReturnValueOnce(new Promise((resolve) => { resolveStats = resolve; }));
    render(<DailyPage />);
    await screen.findByText("DEMO-1");
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status", { name: "Loading sprint stats…" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Planned" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "My Tasks" }));
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));
    expect(screen.getByRole("status", { name: "Loading sprint stats…" })).toBeInTheDocument();
    expect(statsMock).toHaveBeenCalledTimes(1);
    resolveStats({
      ...stats,
      completedOriginalTaskCount: 1,
      completedOriginalStoryPoints: 2,
      addedTaskCount: 1,
      completedAddedTaskCount: 1,
      addedStoryPoints: 4,
      completedAddedStoryPoints: 4,
      statusBreakdown: [
        { category: "todo", taskCount: 0, storyPoints: 0 },
        { category: "inProgress", taskCount: 1, storyPoints: 1 },
        { category: "done", taskCount: 2, storyPoints: 6 },
        { category: "unknown", taskCount: 0, storyPoints: 0 },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading sprint stats…" })).not.toBeInTheDocument());
    expect(await screen.findByRole("group", { name: "Planned" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Closure" })).toHaveTextContent("200%");
    const chart = screen.getByRole("img", { name: "Current sprint scope by status: 6 SP done, 1 SP in progress, 0 SP to do. Planned scope is 3 of 7 SP." });
    expect(chart.querySelector(".daily-scope-meter-segment:first-child")).toHaveStyle({ width: `${(6 / 7) * 100}%`, backgroundColor: "var(--success)" });
    expect(chart.querySelector(".daily-scope-meter-segment:nth-child(2)")).toHaveStyle({ width: `${(1 / 7) * 100}%`, backgroundColor: "var(--chart-1)" });
    expect(chart.querySelector(".daily-scope-meter-target")).toHaveStyle({ left: `${(3 / 7) * 100}%` });
    expect(screen.getByText("Done · 6 SP")).toBeInTheDocument();
    expect(chart.querySelector(".daily-scope-meter-axis")).toBeNull();
  });

  it("places the Plan marker at zero when planned SP is zero and additions exist", async () => {
    statsMock.mockResolvedValueOnce({
      ...stats,
      originalStoryPoints: 0,
      completedOriginalStoryPoints: 0,
      addedStoryPoints: 4,
      completedAddedStoryPoints: 2,
      statusBreakdown: [
        { category: "todo", taskCount: 0, storyPoints: 0 },
        { category: "inProgress", taskCount: 1, storyPoints: 2 },
        { category: "done", taskCount: 1, storyPoints: 2 },
        { category: "unknown", taskCount: 0, storyPoints: 0 },
      ],
    });
    render(<DailyPage />);
    await screen.findByText("DEMO-1");
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));
    const chart = await screen.findByRole("img", {
      name: "Current sprint scope by status: 2 SP done, 2 SP in progress, 0 SP to do. Planned scope is 0 of 4 SP.",
    });
    expect(chart.querySelector(".daily-scope-meter-target")).toHaveStyle({ left: "0%" });
    expect(screen.queryByText("4 SP in current scope")).not.toBeInTheDocument();
  });

  it("keeps My Tasks empty until the first response arrives", async () => {
    let resolveTasks!: (value: DailyMyTasksDto) => void;
    myTasksMock.mockReturnValueOnce(new Promise((resolve) => { resolveTasks = resolve; }));
    render(<DailyPage />);
    await waitFor(() => expect(myTasksMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status", { name: "Loading sprint tasks…" })).toBeInTheDocument();
    expect(screen.queryByText("DEMO-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    resolveTasks(myTasks);
    expect(await screen.findByText("DEMO-1")).toBeInTheDocument();
  });

  it("shows a centered loader on Team Tasks until its first response", async () => {
    let resolveTeam!: (value: DailyTeamWorkspaceDto) => void;
    teamMock.mockReturnValueOnce(new Promise((resolve) => { resolveTeam = resolve; }));
    render(<DailyPage />);
    await screen.findByText("DEMO-1");
    fireEvent.click(screen.getByRole("tab", { name: "Team Tasks" }));
    await waitFor(() => expect(teamMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status", { name: "Loading sprint tasks…" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected member tasks" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Presenter view" })).toBeDisabled();
    resolveTeam(team);
    await waitFor(() => expect(screen.getByRole("button", { name: "Presenter view" })).toBeEnabled());
    expect(screen.getByRole("region", { name: "Selected member tasks" })).toBeInTheDocument();
  });

  it("replaces incomplete Sprint Stats with a detailed retry state", async () => {
    statsMock.mockResolvedValueOnce({
      ...stats,
      availability: "partial",
      scopeAvailability: "partial",
      issuesWithIncompleteScopeHistory: ["DEMO-1"],
    });
    render(<DailyPage />);
    await screen.findByText("DEMO-1");
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));
    expect(await screen.findByText("Unable to load complete sprint statistics.")).toBeInTheDocument();
    expect(screen.getByText(/sprint membership history could not be read for: DEMO-1/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Planned" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("group", { name: "Planned" })).toBeInTheDocument();
  });

  it("confirms Team Tasks refresh and only refreshes the active section", async () => {
    render(<DailyPage />);
    await screen.findByText("DEMO-1");
    fireEvent.click(screen.getByRole("tab", { name: "Team Tasks" }));
    await waitFor(() => expect(teamMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(teamMock).toHaveBeenCalledTimes(2));
    expect(myTasksMock).toHaveBeenCalledTimes(1);
    expect(statsMock).not.toHaveBeenCalled();
    const teamActions = screen.getByRole("tablist").parentElement?.querySelector(".daily-workspace-actions");
    expect(within(teamActions as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["AI Summary", "Presenter view", "Refresh"]);
    expect(screen.getByRole("button", { name: "Presenter view" })).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "Sprint Stats" }));
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(1));
    const statsActions = screen.getByRole("tablist").parentElement?.querySelector(".daily-workspace-actions");
    expect(within(statsActions as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Refresh"]);
    let resolveStatsRefresh!: (value: DailySprintStatsDto) => void;
    statsMock.mockReturnValueOnce(new Promise((resolve) => { resolveStatsRefresh = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Refreshing Jira data may take a while. Progress will be shown on the page.")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status", { name: "Loading sprint stats…" })).toBeInTheDocument();
    const closureMetric = screen.getByRole("group", { name: "Closure" });
    expect(closureMetric).toHaveTextContent("0%");
    expect(closureMetric).toHaveTextContent("0 / 3 SP");
    expect(within(closureMetric).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(closureMetric.querySelector('svg[role="img"]')).toBeNull();
    expect(screen.getByRole("group", { name: "Planned" })).toBeInTheDocument();
    resolveStatsRefresh(stats);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading sprint stats…" })).not.toBeInTheDocument());
    expect(teamMock).toHaveBeenCalledTimes(2);
    expect(myTasksMock).toHaveBeenCalledTimes(1);
  });
});
