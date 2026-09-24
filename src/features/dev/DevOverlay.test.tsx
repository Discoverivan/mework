import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DevOverlay } from "./DevOverlay";

const { getStateMock, addTaskMock, setStatusMock, addPullRequestMock, resetMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  addTaskMock: vi.fn(),
  setStatusMock: vi.fn(),
  addPullRequestMock: vi.fn(),
  resetMock: vi.fn(),
}));

vi.mock("./api", () => ({
  getDevOverlayState: getStateMock,
  addDevMockTask: addTaskMock,
  setDevMockTaskStatus: setStatusMock,
  addDevMockPullRequest: addPullRequestMock,
  resetDevMockScenario: resetMock,
}));

const scenario = {
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
    getStateMock.mockResolvedValue(scenario);
    addTaskMock.mockResolvedValue(scenario);
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

    fireEvent.click(screen.getByRole("button", { name: "Add authored PR" }));
    await waitFor(() => expect(addPullRequestMock).toHaveBeenCalledWith(true));
  });
});
