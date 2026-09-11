import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyPresenterState, DailyWorkspace } from "@/shared/contracts/developer";
import type { ManagedProject } from "@/shared/contracts/planning";
import { listManagedProjects } from "../planning/api";
import { loadDailyWorkspace, openPresenterView, publishPresenterState, subscribePresenterState } from "./api";
import { DailyPage } from "./DailyPage";

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

const workspace: DailyWorkspace = {
  managedProjectId: project.id,
  projectName: project.name,
  projectKey: "DEMO",
  activeSprintId: "sprint-1",
  activeSprintName: "Sprint 42",
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
      storyPoints: 3,
      assigneeAccountId: "test-user-a",
      parentIssueKey: "DEMO-1",
    },
  ],
};

describe("DailyPage smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listManagedProjectsMock.mockResolvedValue([project]);
    loadDailyWorkspaceMock.mockResolvedValue(workspace);
    openPresenterViewMock.mockResolvedValue(undefined);
    publishPresenterStateMock.mockResolvedValue(undefined);
    presenterStateListener = undefined;
    subscribePresenterStateMock.mockImplementation((listener) => {
      presenterStateListener = listener;
      return () => undefined;
    });
  });

  it("loads a configured team and shows the selected member's active-sprint sub-task", async () => {
    render(<DailyPage />);

    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Active sprint: Sprint 42")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Test Author A/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 tasks · 1 in progress · 0 done · 0 backlog")).toBeInTheDocument();
    expect(screen.getByText("DEMO-2")).toBeInTheDocument();
    expect(screen.getByText("SP 3")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toHaveClass("daily-status-progress");

    const presenterButton = screen.getByRole("button", { name: "Presenter view" });
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
});
