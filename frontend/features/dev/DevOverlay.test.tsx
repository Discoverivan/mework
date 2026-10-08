import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DevOverlay } from "./DevOverlay";

const { getStateMock, addTaskMock, addSubtaskMock, setStatusMock, addPullRequestMock, resetMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  addTaskMock: vi.fn(),
  addSubtaskMock: vi.fn(),
  setStatusMock: vi.fn(),
  addPullRequestMock: vi.fn(),
  resetMock: vi.fn(),
}));

vi.mock("./api", () => ({
  getDevOverlayState: getStateMock,
  addDevMockTask: addTaskMock,
  addDevMockSubtask: addSubtaskMock,
  setDevMockTaskStatus: setStatusMock,
  addDevMockPullRequest: addPullRequestMock,
  resetDevMockScenario: resetMock,
}));

const scenario = {
  parentIssues: [
    { key: "MOCK-101", summary: "MOCK DATA · Example task" },
    { key: "MOCK-102", summary: "MOCK DATA · Another example" },
  ],
  assignees: [
    { id: "mock-user-a", displayName: "Engineer A" },
    { id: "mock-user-b", displayName: "Engineer B" },
  ],
  sprints: [
    { id: "1", name: "Current sprint", state: "active" },
    { id: "2", name: "Next sprint", state: "future" },
  ],
  monitors: [{
    id: "mock-task-tracker",
    name: "MOCK DATA — Sample tasks",
    jql: "project = MOCK",
    scheduleKind: "period",
    scheduleValue: "300",
    trackedEvents: ["statusChanges"],
    enabled: true,
    currentIssueCount: 2,
    changesAfterLastCheck: 1,
    maxTrackedIssues: 100,
    exceedsLimit: false,
    issues: [
      { key: "MOCK-101", summary: "MOCK DATA · Example task", status: "In Progress", priority: "Medium", issueUrl: "https://example.invalid/browse/MOCK-101", changed: true },
      { key: "MOCK-102", summary: "MOCK DATA · Another example", status: "To Do", priority: "Medium", issueUrl: "https://example.invalid/browse/MOCK-102", changed: false },
    ],
  }],
  reviewerPullRequests: { values: [], total: 0, hasMore: false },
  authoredPullRequests: { values: [], total: 0, hasMore: false },
};

describe("DevOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    getStateMock.mockResolvedValue(scenario);
    addTaskMock.mockResolvedValue(scenario);
    addSubtaskMock.mockResolvedValue(scenario);
    setStatusMock.mockResolvedValue(scenario);
    addPullRequestMock.mockResolvedValue(scenario.reviewerPullRequests);
    resetMock.mockResolvedValue(scenario);
  });

  it("starts as a compact translucent launcher and expands the mock controls on click", async () => {
    render(<I18nProvider><DevOverlay /></I18nProvider>);

    const launcher = await screen.findByRole("button", { name: "Open development scenario" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    expect(launcher).toHaveClass("bg-card/50", "opacity-70");
    expect(screen.queryByLabelText("Mock task summary")).not.toBeInTheDocument();

    fireEvent.click(launcher);

    expect(await screen.findByText("MOCK DATA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Mock task summary")).toBeInTheDocument();
    expect(document.getElementById("dev-mock-controls")).toHaveClass("overflow-y-auto");
    expect(screen.queryByLabelText("Subtask summary")).not.toBeInTheDocument();
  });

  it("runs local task and pull-request scenario actions through native commands", async () => {
    render(<I18nProvider><DevOverlay /></I18nProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Open development scenario" }));
    expect(await screen.findByText("MOCK DATA")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mock task summary"), {
      target: { value: "Example mock task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Jira task" }));
    await waitFor(() => expect(addTaskMock).toHaveBeenCalledWith("Example mock task"));

    fireEvent.change(screen.getByRole("combobox", { name: "Select mock task" }), {
      target: { value: "MOCK-102" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Mock task status" }), {
      target: { value: "Done" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set status" }));
    await waitFor(() => expect(setStatusMock).toHaveBeenCalledWith("MOCK-102", "Done"));

    fireEvent.click(screen.getByRole("button", { name: "Create subtask" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subtask summary"), {
      target: { value: "Validate sample behavior" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Parent task" }));
    fireEvent.click(await screen.findByRole("option", { name: /MOCK-102/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    fireEvent.click(await screen.findByRole("option", { name: "Engineer B" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Sprint" }));
    fireEvent.click(await screen.findByRole("option", { name: "Future" }));
    fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
    await waitFor(() => expect(addSubtaskMock).toHaveBeenCalledWith({
      parentIssueKey: "MOCK-102",
      summary: "Validate sample behavior",
      assigneeId: "mock-user-b",
      sprintId: "2",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Pull requests" }));
    fireEvent.click(screen.getByRole("button", { name: "Add authored PR" }));
    await waitFor(() => expect(addPullRequestMock).toHaveBeenCalledWith(true));
  });
});
