import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedProjectsSettings } from "./ManagedProjectsSettings";
import {
  addPlanningTeamMember,
  listPlanningConfiguredTeamMembers,
  listPlanningProjectBoards,
  listTargetSprints,
  previewEpicLinkJql,
  removePlanningTeamMember,
  reorderPlanningTeamMembers,
  searchPlanningTeamMembers,
} from "../../planning/api";
import { deleteManagedProject, listManagedProjects, saveManagedProject } from "./api";

vi.mock("./api", () => ({
  deleteManagedProject: vi.fn(),
  listManagedProjects: vi.fn(),
  saveManagedProject: vi.fn(),
}));
vi.mock("../../planning/api", () => ({
  addPlanningTeamMember: vi.fn(),
  listPlanningConfiguredTeamMembers: vi.fn(),
  listPlanningProjectBoards: vi.fn(),
  listTargetSprints: vi.fn(),
  loadJiraAvatarData: vi.fn(),
  previewEpicLinkJql: vi.fn(),
  removePlanningTeamMember: vi.fn(),
  reorderPlanningTeamMembers: vi.fn(),
  searchPlanningTeamMembers: vi.fn(),
}));

const listProjectsMock = vi.mocked(listManagedProjects);
const saveProjectMock = vi.mocked(saveManagedProject);
const listBoardsMock = vi.mocked(listPlanningProjectBoards);
const listMembersMock = vi.mocked(listPlanningConfiguredTeamMembers);
const listSprintsMock = vi.mocked(listTargetSprints);
const previewMock = vi.mocked(previewEpicLinkJql);

const project = {
  id: "team-1",
  integrationId: "jira-1",
  projectId: "10001",
  projectKey: "COREAPI",
  projectName: "Platform team",
  boardId: "board-1",
  enabled: true,
  epicLinkJql: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  listProjectsMock.mockResolvedValue([project]);
  listBoardsMock.mockResolvedValue([{ id: "board-1", name: "Platform board" }]);
  listMembersMock.mockResolvedValue([]);
  listSprintsMock.mockResolvedValue([
    { id: "sprint-1", boardId: "board-1", name: "Platform Sprint", state: "future", usable: true },
  ]);
  previewMock.mockResolvedValue([{ key: "COREAPI-EPIC-1", summary: "Platform epic" }]);
  saveProjectMock.mockResolvedValue({
    ...project,
    defaultTaskSprintId: "sprint-1",
    defaultTaskSprintName: "Platform Sprint",
    epicLinkJql: "project = COREAPI AND issuetype = Epic",
  });
  vi.mocked(deleteManagedProject).mockResolvedValue(undefined);
  vi.mocked(addPlanningTeamMember).mockResolvedValue({
    accountId: "user-1",
    displayName: "Ivan",
    tags: [],
    active: true,
  });
  vi.mocked(removePlanningTeamMember).mockResolvedValue(undefined);
  vi.mocked(reorderPlanningTeamMembers).mockResolvedValue([]);
  vi.mocked(searchPlanningTeamMembers).mockResolvedValue([]);
});

describe("ManagedProjectsSettings task creation settings", () => {
  it("creates a team through project validation and board selection steps", async () => {
    const validateProjectKey = vi.fn().mockResolvedValue({
      projectId: "10001",
      projectKey: "COREAPI",
      projectName: "Jira project name",
    });
    render(
      <ManagedProjectsSettings
        jiraIntegrations={[{
          id: "jira-1",
          kind: "jira",
          baseUrl: "https://jira.example.invalid",
          enabled: true,
          capabilities: {},
        }]}
        validateProjectKey={validateProjectKey}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add team" }));
    expect(screen.getByRole("textbox", { name: "Team name" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Jira Project Key" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Jira board" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), { target: { value: "Platform team" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Jira Project Key" }), { target: { value: "COREAPI" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("combobox", { name: "Jira board" })).toBeInTheDocument();
    await waitFor(() => expect(validateProjectKey).toHaveBeenCalledWith("COREAPI", "jira-1"));
    await waitFor(() => expect(listBoardsMock).toHaveBeenCalledWith({
      integrationId: "jira-1",
      projectKey: "COREAPI",
    }));

    fireEvent.change(screen.getByRole("combobox", { name: "Jira board" }), { target: { value: "board-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save team" }));
    await waitFor(() => expect(saveProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: "jira-1",
      jiraProjectId: "10001",
      jiraProjectKey: "COREAPI",
      jiraProjectName: "Platform team",
      boardId: "board-1",
    })));
  });

  it("waits for boards before opening step two and allows returning with Back", async () => {
    listProjectsMock.mockResolvedValue([]);
    let resolveBoards: (boards: Array<{ id: string; name: string }>) => void = () => undefined;
    listBoardsMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveBoards = resolve;
    }));
    const validateProjectKey = vi.fn().mockResolvedValue({
      projectId: "10001",
      projectKey: "COREAPI",
      projectName: "Jira project name",
    });
    render(
      <ManagedProjectsSettings
        jiraIntegrations={[{
          id: "jira-1",
          kind: "jira",
          baseUrl: "https://jira.example.invalid",
          enabled: true,
          capabilities: {},
        }]}
        validateProjectKey={validateProjectKey}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add team" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Team name" }), { target: { value: "Platform team" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Jira Project Key" }), { target: { value: "COREAPI" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(validateProjectKey).toHaveBeenCalledWith("COREAPI", "jira-1"));
    expect(screen.queryByRole("combobox", { name: "Jira board" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();

    resolveBoards([{ id: "board-1", name: "Platform board" }]);
    expect(await screen.findByRole("combobox", { name: "Jira board" })).toBeInTheDocument();
    const boardRequestsBeforeBack = listBoardsMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("textbox", { name: "Team name" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Jira board" })).not.toBeInTheDocument();
    expect(listBoardsMock).toHaveBeenCalledTimes(boardRequestsBeforeBack);
  });

  it("checks Epic link JQL and persists sprint and JQL defaults per team", async () => {
    render(
      <ManagedProjectsSettings
        jiraIntegrations={[{
          id: "jira-1",
          kind: "jira",
          baseUrl: "https://jira.example.invalid",
          enabled: true,
          capabilities: {},
        }]}
        validateProjectKey={vi.fn().mockResolvedValue({
          projectId: "10001",
          projectKey: "COREAPI",
          projectName: "Platform team",
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open Platform team project details" }));
    expect(await screen.findByLabelText("Task creation settings")).toBeInTheDocument();
    await waitFor(() => expect(listSprintsMock).toHaveBeenCalledWith("team-1"));

    fireEvent.change(screen.getByLabelText("Default sprint for task creation"), { target: { value: "sprint-1" } });
    fireEvent.change(screen.getByLabelText("Epic link JQL"), {
      target: { value: "project = COREAPI AND issuetype = Epic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("COREAPI-EPIC-1")).toBeInTheDocument();
    expect(screen.getByText("Platform epic")).toBeInTheDocument();
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith({
      managedProjectId: "team-1",
      jql: "project = COREAPI AND issuetype = Epic",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByLabelText("Default Epic link for task creation"), {
      target: { value: "COREAPI-EPIC-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save task creation settings" }));
    await waitFor(() => expect(saveProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "team-1",
      defaultTaskSprintId: "sprint-1",
      defaultTaskSprintName: "Platform Sprint",
      defaultEpicLinkKey: "COREAPI-EPIC-1",
      defaultEpicLinkSummary: "Platform epic",
      epicLinkJql: "project = COREAPI AND issuetype = Epic",
    })));
  });
});
