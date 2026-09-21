import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyPresenterState, DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { loadDailyWorkspace, openPresenterView, publishPresenterState, subscribePresenterState } from "./api";
import { DailyPage } from "./DailyPage";

const { openUrlMock, writeTextMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(),
  writeTextMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../planning/api", () => ({ listManagedProjects: vi.fn() }));
vi.mock("./api", () => ({
  loadDailyWorkspace: vi.fn(),
  publishPresenterState: vi.fn(),
  openPresenterView: vi.fn(),
  closePresenterView: vi.fn(),
  subscribePresenterState: vi.fn(),
}));

const listManagedProjectsMock = vi.mocked(listManagedProjects);
const loadDailyWorkspaceMock = vi.mocked(loadDailyWorkspace);
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
  sprints: [
    { id: "sprint-1", name: "Sprint 42", state: "active" },
    { id: "sprint-0", name: "Sprint 41", state: "closed" },
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    window.location.hash = "";
    listManagedProjectsMock.mockResolvedValue([project]);
    loadDailyWorkspaceMock.mockResolvedValue(workspace);
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

  it("loads the active sprint by default and can select another sprint", async () => {
    render(<DailyPage />);

    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sprint" })).toHaveTextContent("Sprint 42");
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Active sprint: Sprint 42")).not.toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    const presenterButton = screen.getByRole("button", { name: "Presenter view" });
    const createTaskButton = screen.getByRole("button", { name: "Create task for this sprint" });
    expect(createTaskButton.querySelector("svg.lucide-plus")).toBeInTheDocument();
    fireEvent.click(createTaskButton);
    expect(window.location.hash).toBe("#product/create-task?team=managed-1&sprint=sprint-1");
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
      presenterButton,
      actionSeparator,
      refreshButton,
      createTaskButton,
    ]);
    expect(screen.getByRole("button", { name: /Test Author A/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 tasks · 1 in progress · 0 done · 0 backlog")).toBeInTheDocument();
    expect(screen.getByText("DEMO-2")).toBeInTheDocument();
    expect(screen.getByText("SP 3")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toHaveClass("daily-status-progress");
    expect(screen.getByText("Sub-task · Parent DEMO-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "DEMO-2" }));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://jira.example.invalid/browse/DEMO-2"));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for DEMO-2" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByRole("menuitem", { name: "Open parent DEMO-1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy key" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("DEMO-2"));
    expect(screen.getByRole("status")).toHaveTextContent("Copied DEMO-2 to the clipboard.");
    expect(screen.getByRole("button", { name: /Other assignees/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unassigned/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Sprint" }));
    fireEvent.click(screen.getByRole("option", { name: "Sprint 41 (Closed)" }));
    await waitFor(() => expect(loadDailyWorkspaceMock).toHaveBeenLastCalledWith("managed-1", "sprint-0"));

    fireEvent.click(presenterButton);
    await waitFor(() => expect(openPresenterViewMock).toHaveBeenCalledTimes(1));
    expect(publishPresenterStateMock).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Stop presenter view" })).toBeInTheDocument();
  });

  it("updates the main Daily selection when Presenter changes the member", async () => {
    render(<DailyPage />);
    await screen.findByRole("heading", { name: "Tasks" });

    act(() => {
      presenterStateListener?.({ workspace, selectedMemberId: "test-user-b" });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /Test Author B/ })).toHaveAttribute("aria-pressed", "true"));
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
