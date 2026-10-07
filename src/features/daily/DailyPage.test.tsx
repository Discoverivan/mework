import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyPresenterState, DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { generateSprintSummary, loadDailyIssueTransitions, loadDailyWorkspace, openPresenterView, publishPresenterState, refreshDailyWorkspace, subscribePresenterState, transitionDailyIssue } from "./api";
import { clearDailyWorkspaceCacheForTests, prefetchDailyWorkspaces, readDailyWorkspaceCache, refreshDailyWorkspaceCache } from "./cache";
import { DailyPage } from "./DailyPage";

const { openUrlMock, writeTextMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(),
  writeTextMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../planning/api", () => ({ listManagedProjects: vi.fn() }));
vi.mock("./api", () => ({
  generateSprintSummary: vi.fn(),
  loadDailyWorkspace: vi.fn(),
  refreshDailyWorkspace: vi.fn(),
  loadDailyIssueTransitions: vi.fn(),
  transitionDailyIssue: vi.fn(),
  publishPresenterState: vi.fn(),
  openPresenterView: vi.fn(),
  closePresenterView: vi.fn(),
  subscribePresenterState: vi.fn(),
}));

const listManagedProjectsMock = vi.mocked(listManagedProjects);
const generateSprintSummaryMock = vi.mocked(generateSprintSummary);
const loadDailyWorkspaceMock = vi.mocked(loadDailyWorkspace);
const refreshDailyWorkspaceMock = vi.mocked(refreshDailyWorkspace);
const loadDailyIssueTransitionsMock = vi.mocked(loadDailyIssueTransitions);
const transitionDailyIssueMock = vi.mocked(transitionDailyIssue);
const openPresenterViewMock = vi.mocked(openPresenterView);
const publishPresenterStateMock = vi.mocked(publishPresenterState);
const subscribePresenterStateMock = vi.mocked(subscribePresenterState);
let presenterStateListener: ((state: DailyPresenterState) => void) | undefined;

const project: ManagedProject = {
  id: "managed-1",
  integrationId: "jira-1",
  jiraProjectId: "10001",
  name: "Example Project",
  boardId: "42",
  boardName: "Example Project Board",
};

const secondProject: ManagedProject = {
  ...project,
  id: "managed-2",
  jiraProjectId: "10002",
  name: "Second Project",
  boardId: "43",
  boardName: "Second Project Board",
};

const workspace: DailyWorkspace = {
  managedProjectId: project.id,
  projectName: project.name,
  projectKey: "DEMO",
  selectedSprintId: "sprint-1",
  selectedSprintName: "Sprint 42",
  sprintBoardUrl: "https://jira.example.invalid/secure/RapidBoard.jspa?rapidView=42&projectKey=DEMO&sprint=sprint-1",
  sprintBoardUrlsByAssignee: {
    "test-user-a": "https://jira.example.invalid/secure/RapidBoard.jspa?rapidView=42&projectKey=DEMO&sprint=sprint-1&quickFilter=7",
  },
  sprints: [
    { id: "sprint-1", name: "Sprint 42", state: "active", startDate: "2026-09-21T00:00:00.000Z", endDate: "2026-10-05T00:00:00.000Z" },
    { id: "sprint-0", name: "Sprint 41", state: "closed", startDate: "2026-09-07T00:00:00.000Z", endDate: "2026-09-20T00:00:00.000Z" },
    { id: "sprint-future", name: "Sprint 43", state: "future", startDate: "2026-10-06T00:00:00.000Z", endDate: "2026-10-20T00:00:00.000Z" },
  ],
  members: [
    { accountId: "test-user-a", displayName: "Test Member A", alias: "Test Author A", active: true, tags: ["backend"], displayOrder: 1 },
    { accountId: "test-user-b", displayName: "Test Member B", alias: "Test Author B", active: true, tags: ["backend"], displayOrder: 2 },
  ],
  subtasks: [
    {
      id: "subtask-1",
      key: "DEMO-2",
      summary: "Implement API",
      status: "In Progress",
      issueType: "Sub-task",
      storyPoints: 3,
      assigneeAccountId: "test-user-a",
      parentIssueKey: "DEMO-1",
      url: "https://jira.example.invalid/browse/DEMO-2",
      parentUrl: "https://jira.example.invalid/browse/DEMO-1",
    },
    {
      id: "task-2",
      key: "DEMO-3",
      summary: "Coordinate release",
      status: "To Do",
      issueType: "Story",
      assigneeAccountId: "outside-user",
      assigneeDisplayName: "External Member",
      url: "https://jira.example.invalid/browse/DEMO-3",
    },
    {
      id: "task-3",
      key: "DEMO-4",
      summary: "Investigate failure",
      status: "Open",
      issueType: "Bug",
      url: "https://jira.example.invalid/browse/DEMO-4",
    },
  ],
};

describe("DailyPage smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDailyWorkspaceCacheForTests();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    window.location.hash = "";
    listManagedProjectsMock.mockResolvedValue([project]);
    generateSprintSummaryMock.mockResolvedValue({ text: "Sprint progress report" });
    loadDailyWorkspaceMock.mockResolvedValue(workspace);
    refreshDailyWorkspaceMock.mockResolvedValue(workspace.subtasks);
    loadDailyIssueTransitionsMock.mockResolvedValue([
      { id: "transition-review", name: "Send to review", toStatus: "Code Review", requiresFields: false },
      { id: "transition-close", name: "Close issue", toStatus: "Closed", requiresFields: true },
    ]);
    transitionDailyIssueMock.mockResolvedValue(undefined);
    openPresenterViewMock.mockResolvedValue(undefined);
    publishPresenterStateMock.mockResolvedValue(undefined);
    openUrlMock.mockResolvedValue(undefined);
    writeTextMock.mockResolvedValue(undefined);
    presenterStateListener = undefined;
    subscribePresenterStateMock.mockImplementation((listener) => {
      presenterStateListener = listener;
      return () => undefined;
    });
  });

  it("shows a styled loader on the first sprint task visit", async () => {
    let resolveWorkspace: (value: DailyWorkspace) => void = () => undefined;
    loadDailyWorkspaceMock.mockReturnValueOnce(new Promise<DailyWorkspace>((resolve) => {
      resolveWorkspace = resolve;
    }));

    render(<DailyPage />);

    const loader = await screen.findByRole("status", { name: "Loading sprint tasks…" });
    expect(loader).toHaveClass("overflow-hidden");
    expect(loader.querySelector("svg.lucide-refresh-cw")).toBeInTheDocument();

    await act(async () => resolveWorkspace(workspace));
    expect(await screen.findByText("DEMO-2")).toBeInTheDocument();
  });

  it("renders background-preloaded sprint tasks and shares their pending refresh", async () => {
    let resolveWorkspace!: (value: DailyWorkspace) => void;
    loadDailyWorkspaceMock
      .mockResolvedValueOnce(workspace)
      .mockReturnValueOnce(new Promise<DailyWorkspace>((resolve) => { resolveWorkspace = resolve; }));

    await prefetchDailyWorkspaces([project.integrationId]);
    const refreshing = refreshDailyWorkspaceCache(project.id);

    render(<DailyPage />);

    expect(await screen.findByText("DEMO-2")).toBeInTheDocument();
    await waitFor(() => expect(loadDailyWorkspaceMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status", { name: "Loading sprint tasks…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    await act(async () => {
      resolveWorkspace(workspace);
      await refreshing;
    });

    // A background active-sprint response must preserve a newer explicit selection.
    const selectedWorkspace = { ...workspace, selectedSprintId: "sprint-2" };
    loadDailyWorkspaceMock
      .mockReturnValueOnce(new Promise<DailyWorkspace>((resolve) => { resolveWorkspace = resolve; }))
      .mockResolvedValueOnce(selectedWorkspace);
    const prefetching = prefetchDailyWorkspaces([project.integrationId]);
    await waitFor(() => expect(loadDailyWorkspaceMock).toHaveBeenCalledTimes(3));
    await refreshDailyWorkspaceCache(project.id, selectedWorkspace.selectedSprintId);
    resolveWorkspace(workspace);
    await prefetching;
    expect(readDailyWorkspaceCache(project.id)).toEqual(selectedWorkspace);
    expect(readDailyWorkspaceCache(project.id, workspace.selectedSprintId)).toEqual(workspace);
  });

  it("loads the active sprint by default and can select another sprint", async () => {
    render(<DailyPage />);

    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sprint" })).toHaveTextContent("Sprint 42");
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Active sprint: Sprint 42")).not.toBeInTheDocument();
    const aiSummaryButton = screen.getByRole("button", { name: "AI Summary" });
    expect(aiSummaryButton).toHaveClass("h-9", "w-9");
    expect(aiSummaryButton).not.toHaveTextContent("AI Summary");
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    const sprintBoardButton = screen.getByRole("button", { name: "Open sprint board in Jira" });
    const assigneeBoardButton = screen.getByRole("button", { name: "Open sprint board for this assignee in Jira" });
    const presenterButton = screen.getByRole("button", { name: "Presenter view" });
    const createTaskButton = screen.getByRole("button", { name: "Create task for this sprint" });
    expect(createTaskButton).toHaveClass("h-9", "w-9", "app-icon-button");
    expect(createTaskButton).not.toHaveTextContent("Create");
    expect(createTaskButton.querySelector("svg.lucide-plus")).toBeInTheDocument();
    fireEvent.click(sprintBoardButton);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(workspace.sprintBoardUrl));
    fireEvent.click(assigneeBoardButton);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(workspace.sprintBoardUrlsByAssignee["test-user-a"]));
    expect(screen.getByRole("combobox", { name: "Sprint" }).nextElementSibling).toBe(sprintBoardButton);
    expect(screen.getByRole("heading", { name: "Test Author A" }).nextElementSibling).toBe(assigneeBoardButton.parentElement);
    expect(assigneeBoardButton.parentElement).toHaveAttribute("data-tooltip", "Open sprint board for this assignee in Jira");
    fireEvent.click(createTaskButton);
    expect(window.location.hash).toBe("#product/create-task?team=managed-1&sprint=sprint-1&new=1");
    expect(refreshButton).toHaveClass("h-9", "w-9");
    expect(refreshButton).not.toHaveTextContent("Refresh");
    expect(presenterButton).toHaveClass("h-9", "w-9");
    expect(presenterButton).not.toHaveTextContent("Presenter view");
    expect(presenterButton.querySelector("svg.lucide-presentation")).toBeInTheDocument();
    expect(createTaskButton.parentElement).toBe(refreshButton.parentElement);
    expect(refreshButton.parentElement).toBe(presenterButton.parentElement);
    const actionGroup = refreshButton.parentElement;
    if (!actionGroup) {
      throw new Error("Sprint task actions were not rendered in a shared container");
    }
    const actionSeparator = actionGroup.querySelector('[data-orientation="vertical"]');
    if (!actionSeparator) {
      throw new Error("Sprint task actions separator was not rendered");
    }
    const actionItems = Array.from(actionGroup.children);
    expect(actionItems).toEqual([
      aiSummaryButton,
      presenterButton,
      actionSeparator,
      refreshButton,
      createTaskButton,
    ]);
    expect(screen.getByRole("button", { name: /Test Author A/, pressed: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 tasks · 1 in progress · 0 done · 0 backlog")).toBeInTheDocument();
    expect(screen.getByText("DEMO-2")).toBeInTheDocument();
    expect(screen.getByText("SP 3")).toBeInTheDocument();
    const statusButton = screen.getByRole("button", { name: "Change status for DEMO-2 (current: In Progress)" });
    expect(statusButton).not.toHaveAttribute("title");
    fireEvent.focus(statusButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.blur(statusButton);
    fireEvent.pointerDown(statusButton, { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: /Code Review/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "In Progress" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: /Complete required fields in Jira/ })).toHaveAttribute("aria-disabled", "true");
    let completeTransition!: () => void;
    transitionDailyIssueMock.mockReturnValueOnce(new Promise((resolve) => { completeTransition = resolve; }));
    let completeRefresh!: (tasks: DailyWorkspace["subtasks"]) => void;
    refreshDailyWorkspaceMock.mockReturnValueOnce(new Promise((resolve) => { completeRefresh = resolve; }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Code Review/ }));
    await waitFor(() => expect(transitionDailyIssueMock).toHaveBeenCalledWith(
      project.id,
      workspace.selectedSprintId,
      "DEMO-2",
      "transition-review",
      expect.any(String),
    ));
    expect(statusButton).toBeDisabled();
    expect(statusButton).toHaveAttribute("aria-busy", "true");
    expect(statusButton.querySelector(".animate-spin")).toBeInTheDocument();
    await act(async () => { completeTransition(); });
    const savedStatus = await screen.findByRole("button", { name: "Change status for DEMO-2 (current: Code Review)" });
    await waitFor(() => expect(savedStatus).toBeEnabled());
    expect(savedStatus).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("DEMO-2 moved to Code Review.");
    expect(screen.getByText("1 tasks · 0 in progress · 0 done · 0 backlog")).toBeInTheDocument();
    expect(publishPresenterStateMock).toHaveBeenCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({
        subtasks: expect.arrayContaining([expect.objectContaining({ key: "DEMO-2", status: "Code Review" })]),
      }),
    }));
    await act(async () => { completeRefresh(workspace.subtasks.map((task) =>
      task.key === "DEMO-2" ? { ...task, status: "Code Review" } : task,
    )); });
    expect(screen.getByText("Sub-task · Parent DEMO-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "DEMO-2" }));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://jira.example.invalid/browse/DEMO-2"));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for DEMO-2" }), {
      button: 0,
      ctrlKey: false,
    });
    const openParentItem = await screen.findByRole("menuitem", { name: "Open parent DEMO-1" });
    expect(openParentItem).toHaveTextContent("Open parentDEMO-1");
    expect(openParentItem.querySelector(".flex-col")).toBeInTheDocument();
    const menuSeparators = openParentItem.parentElement?.querySelectorAll('[role="separator"]');
    expect(menuSeparators).toHaveLength(2);
    expect(menuSeparators?.[0]).toHaveClass("mx-2", "bg-border");
    expect(menuSeparators?.[1]).toHaveClass("mx-2", "bg-border");
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy key" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("DEMO-2"));
    expect(screen.getByRole("status")).toHaveTextContent("Copied DEMO-2 to the clipboard.");
    expect(screen.getByRole("status")).toHaveClass("fixed");
    expect(screen.getByRole("button", { name: /Other assignees/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unassigned/ })).toBeInTheDocument();

    loadDailyWorkspaceMock.mockResolvedValueOnce({
      ...workspace,
      selectedSprintId: "sprint-0",
      selectedSprintName: "Sprint 41",
      sprintBoardUrl: "https://jira.example.invalid/secure/RapidBoard.jspa?rapidView=42&projectKey=DEMO&sprint=sprint-0",
      sprintBoardUrlsByAssignee: {},
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Sprint" }));
    expect(screen.getByRole("option", { name: "Sprint 43 (Future)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sprints…" }), { target: { value: "41" } });
    expect(screen.getByRole("option", { name: "Sprint 41 (Closed)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Sprint 42 (Active)" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Sprint 41 (Closed)" }));
    await waitFor(() => expect(loadDailyWorkspaceMock).toHaveBeenLastCalledWith("managed-1", "sprint-0"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open sprint board for this assignee in Jira" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Open sprint board for this assignee in Jira" }).parentElement).toHaveAttribute("data-tooltip", "No Jira assignee quick filter is available for this person.");
    fireEvent.click(sprintBoardButton);
    await waitFor(() => expect(openUrlMock).toHaveBeenLastCalledWith("https://jira.example.invalid/secure/RapidBoard.jspa?rapidView=42&projectKey=DEMO&sprint=sprint-0"));

    fireEvent.click(presenterButton);
    await waitFor(() => expect(openPresenterViewMock).toHaveBeenCalledTimes(1));
    expect(publishPresenterStateMock).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Stop presenter view" })).toBeInTheDocument();
  });

  it("generates and displays a weekly AI summary for the selected sprint", async () => {
    render(<DailyPage />);
    await screen.findByRole("heading", { name: "Tasks" });
    fireEvent.click(screen.getByRole("button", { name: "AI Summary" }));
    expect(screen.getByRole("heading", { name: "AI Summary" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sprint" })).toHaveTextContent("Sprint 42");
    fireEvent.click(screen.getByRole("button", { name: "Date range" }));
    const rangeStart = screen.getByRole("button", { name: /28 September/ });
    expect(rangeStart).not.toHaveClass("app-icon-button");
    expect(rangeStart.parentElement).toHaveClass("size-[var(--cell-size)]");
    fireEvent.click(rangeStart);
    fireEvent.click(screen.getByRole("button", { name: /30 September/ }));
    expect(screen.getByRole("button", { name: "Date range" })).toHaveTextContent(/28 Sept 2026 – 30 Sept 2026/);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const result = await screen.findByRole("textbox", { name: "AI summary result" });
    expect(result).toHaveValue("Sprint progress report");
    expect(result).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("combobox", { name: "Preset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Date range" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(generateSprintSummaryMock).toHaveBeenCalledWith({
      managedProjectId: project.id,
      sprintId: workspace.selectedSprintId,
      preset: "weekly",
      period: "2026-09-28 – 2026-09-30",
      customPrompt: "",
      previousResult: undefined,
      action: "generate",
    });
    expect(screen.getByRole("button", { name: "Make shorter" })).toBeInTheDocument();
  });

  it("updates the main Daily selection when Presenter changes the member", async () => {
    render(<DailyPage />);
    await screen.findByRole("heading", { name: "Tasks" });

    act(() => {
      presenterStateListener?.({ workspace, selectedMemberId: "test-user-b" });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /Test Author B/, pressed: true })).toHaveAttribute("aria-pressed", "true"));
  });

  it("ignores a late workspace response for the previously selected project", async () => {
    let resolveFirstWorkspace: (value: DailyWorkspace) => void = () => undefined;
    let resolveSecondWorkspace: (value: DailyWorkspace) => void = () => undefined;
    const firstWorkspaceRequest = new Promise<DailyWorkspace>((resolve) => {
      resolveFirstWorkspace = resolve;
    });
    const secondWorkspaceRequest = new Promise<DailyWorkspace>((resolve) => {
      resolveSecondWorkspace = resolve;
    });
    const secondWorkspace: DailyWorkspace = {
      ...workspace,
      managedProjectId: secondProject.id,
      projectName: secondProject.name,
      projectKey: "SECOND",
      subtasks: [{
        ...workspace.subtasks[0]!,
        id: "second-task",
        key: "SECOND-1",
        summary: "Second project task",
        url: "https://jira.example.invalid/browse/SECOND-1",
      }],
    };
    listManagedProjectsMock.mockResolvedValue([project, secondProject]);
    loadDailyWorkspaceMock
      .mockReturnValueOnce(firstWorkspaceRequest)
      .mockReturnValueOnce(secondWorkspaceRequest);

    render(<DailyPage />);
    await waitFor(() => expect(loadDailyWorkspaceMock).toHaveBeenCalledWith(project.id, undefined));
    fireEvent.click(screen.getByRole("combobox", { name: "Team" }));
    fireEvent.click(screen.getByRole("option", { name: secondProject.name }));
    await waitFor(() => expect(loadDailyWorkspaceMock).toHaveBeenCalledWith(secondProject.id, undefined));

    await act(async () => resolveSecondWorkspace(secondWorkspace));
    expect(await screen.findByText("SECOND-1")).toBeInTheDocument();

    await act(async () => resolveFirstWorkspace(workspace));
    expect(screen.getByText("SECOND-1")).toBeInTheDocument();
    expect(screen.queryByText("DEMO-2")).not.toBeInTheDocument();
  });
});
