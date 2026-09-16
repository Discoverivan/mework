import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyPresenterState } from "@/shared/contracts/developer";
import { PresenterView } from "./PresenterView";
import { readNativePresenterState, readPresenterState, subscribePresenterState } from "./api";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock("./api", () => ({
  closePresenterView: vi.fn(),
  loadJiraAvatarData: vi.fn(),
  publishPresenterState: vi.fn(),
  readNativePresenterState: vi.fn(),
  readPresenterState: vi.fn(),
  refreshDailyWorkspace: vi.fn(),
  subscribePresenterState: vi.fn(),
}));

const state: DailyPresenterState = {
  selectedMemberId: "test-user-a",
  workspace: {
    managedProjectId: "managed-1",
    projectName: "Example Project",
    projectKey: "DEMO",
    activeSprintId: "sprint-1",
    activeSprintName: "Sprint 42",
    members: [{
      accountId: "test-user-a",
      displayName: "Test Member A",
      active: true,
      tags: [],
      displayOrder: 1,
    }],
    subtasks: [
      {
        id: "subtask-1",
        key: "DEMO-1",
        summary: "Closed task",
        status: "Closed",
        storyPoints: 5,
        statusTransitionAt: "2026-09-14T16:32:10.000+0300",
        assigneeAccountId: "test-user-a",
      },
      {
        id: "subtask-2",
        key: "DEMO-2",
        summary: "Ready to test task",
        status: "Ready to Test",
        storyPoints: 2,
        assigneeAccountId: "test-user-a",
      },
      {
        id: "subtask-3",
        key: "DEMO-3",
        summary: "Backlog task",
        status: "To Do",
        storyPoints: 3,
        assigneeAccountId: "test-user-a",
      },
    ],
  },
};

const readPresenterStateMock = vi.mocked(readPresenterState);
const readNativePresenterStateMock = vi.mocked(readNativePresenterState);
const subscribePresenterStateMock = vi.mocked(subscribePresenterState);

describe("PresenterView progress smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readPresenterStateMock.mockReturnValue(state);
    readNativePresenterStateMock.mockResolvedValue(null);
    subscribePresenterStateMock.mockReturnValue(() => undefined);
  });

  it("renders colored story-point segments, status badges, and transition date", async () => {
    const { container } = render(<PresenterView />);

    expect(await screen.findByRole("heading", { name: "Test Member A" })).toBeInTheDocument();
    const progressBadges = container.querySelector(".daily-presenter-progress-badges");
    expect(progressBadges).not.toBeNull();
    expect(progressBadges).toHaveTextContent("Closed");
    expect(progressBadges).toHaveTextContent("In progress");
    expect(progressBadges).toHaveTextContent("In backlog");
    expect(screen.getByText("14.09.2026")).toBeInTheDocument();

    const track = container.querySelector(".daily-presenter-progress-track");
    expect(track).not.toBeNull();
    expect(track?.querySelector(".daily-presenter-progress-segment-closed")).toHaveStyle({ width: "50%" });
    expect(track?.querySelector(".daily-presenter-progress-segment-progress")).toHaveStyle({ width: "20%" });
    expect(track?.querySelector(".daily-presenter-progress-segment-backlog")).toHaveStyle({ width: "30%" });
  });
});
