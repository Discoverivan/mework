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
  projectKey: "DEMO",
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
  previewMock.mockResolvedValue([{ key: "DEMO-EPIC-1", summary: "Example epic" }]);
  saveProjectMock.mockResolvedValue({
    ...project,
    defaultTaskSprintId: "sprint-1",
    defaultTaskSprintName: "Platform Sprint",
    epicLinkJql: "project = DEMO AND issuetype = Epic",
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
  it("explains why the Confluence field is unavailable while editing a team", async () => {
    render(
      <ManagedProjectsSettings
        jiraIntegrations={[{
          id: "jira-1",
          kind: "jira",
          baseUrl: "https://jira.example.invalid",
          enabled: true,
          capabilities: {},
        }]}
        validateProjectKey={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit Platform team" }));

    const confluenceField = screen.getByRole("textbox", { name: "Confluence space" });
    const hint = screen.getByText("Configure and enable Confluence to select a team space.");
    expect(confluenceField).toBeDisabled();
    expect(confluenceField).toHaveAttribute("aria-describedby", hint.id);
  });

  it("creates a team through project validation and board selection steps", async () => {
    const validateProjectKey = vi.fn().mockResolvedValue({
      projectId: "10001",
      projectKey: "DEMO",
      projectName: "Jira project name",
    });
    const resolveConfluenceSpace = vi.fn().mockResolvedValue({
      integrationId: "confluence-1",
      spaceId: "20001",
      spaceKey: "DOCS",
      spaceName: "Example team space",
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
        confluenceIntegrations={[{
          id: "confluence-1",
          kind: "confluence",
          baseUrl: "https://confluence.example.invalid",
          enabled: true,
          capabilities: {},
        }]}
        validateProjectKey={validateProjectKey}
        resolveConfluenceSpace={resolveConfluenceSpace}
      />,
    );

    const editTeamButton = await screen.findByRole("button", { name: "Edit Platform team" });
    expect(editTeamButton.querySelector("svg.lucide-pencil")).not.toBeNull();
    const deleteTeamButton = screen.getByRole("button", { name: "Delete Platform team" });
    expect(deleteTeamButton.querySelector("svg.lucide-trash-2")).not.toBeNull();
    const addTeamButton = await screen.findByRole("button", { name: "Add team" });
    expect(addTeamButton.querySelector("svg.lucide-plus")).not.toBeNull();
    expect(addTeamButton).not.toHaveTextContent("Add team");
    expect(addTeamButton.closest("header")).toHaveClass("page-header");
    expect(screen.getByText("Configure Jira teams, boards, members, and task creation defaults.")).toBeInTheDocument();
    fireEvent.click(addTeamButton);
    expect(screen.queryByRole("textbox", { name: "Team name" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Jira project key" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Confluence space" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Jira board" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Jira project key" }), { target: { value: "DEMO" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Confluence space" }), { target: { value: "DOCS" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("combobox", { name: "Jira board" })).toBeInTheDocument();
    await waitFor(() => expect(validateProjectKey).toHaveBeenCalledWith("DEMO", "jira-1"));
    await waitFor(() => expect(resolveConfluenceSpace).toHaveBeenCalledWith("DOCS", "confluence-1"));
    await waitFor(() => expect(listBoardsMock).toHaveBeenCalledWith({
      integrationId: "jira-1",
      projectKey: "DEMO",
    }));

    fireEvent.change(screen.getByRole("combobox", { name: "Jira board" }), { target: { value: "board-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save team" }));
    await waitFor(() => expect(saveProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: "jira-1",
      jiraProjectId: "10001",
      jiraProjectKey: "DEMO",
      jiraProjectName: "Jira project name",
      confluenceSpace: {
        integrationId: "confluence-1",
        spaceId: "20001",
        spaceKey: "DOCS",
        spaceName: "Example team space",
      },
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
      projectKey: "DEMO",
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
    fireEvent.change(screen.getByRole("textbox", { name: "Jira project key" }), { target: { value: "DEMO" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(validateProjectKey).toHaveBeenCalledWith("DEMO", "jira-1"));
    expect(screen.queryByRole("combobox", { name: "Jira board" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();

    resolveBoards([{ id: "board-1", name: "Platform board" }]);
    expect(await screen.findByRole("combobox", { name: "Jira board" })).toBeInTheDocument();
    const boardRequestsBeforeBack = listBoardsMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("textbox", { name: "Jira project key" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Jira board" })).not.toBeInTheDocument();
    expect(listBoardsMock).toHaveBeenCalledTimes(boardRequestsBeforeBack);
  });

  it("checks Epic link JQL and persists sprint and JQL defaults per team", async () => {
    listMembersMock.mockResolvedValue([{
      accountId: "user-1",
      displayName: "Example Member",
      tags: ["backend"],
      active: true,
    }]);
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
          projectKey: "DEMO",
          projectName: "Platform team",
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open Platform team project details" }));
    expect(await screen.findByLabelText("Task creation settings")).toBeInTheDocument();
    const editMemberButton = await screen.findByRole("button", { name: "Edit Example Member" });
    expect(editMemberButton.querySelector("svg.lucide-pencil")).not.toBeNull();
    const deleteMemberButton = screen.getByRole("button", { name: "Delete Example Member" });
    expect(deleteMemberButton.querySelector("svg.lucide-trash-2")).not.toBeNull();
    await waitFor(() => expect(listSprintsMock).toHaveBeenCalledWith("team-1"));

    fireEvent.change(screen.getByLabelText("Default sprint for task creation"), { target: { value: "sprint-1" } });
    fireEvent.change(screen.getByLabelText("Epic link JQL"), {
      target: { value: "project = DEMO AND issuetype = Epic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("DEMO-EPIC-1")).toBeInTheDocument();
    expect(screen.getByText("Example epic")).toBeInTheDocument();
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith({
      managedProjectId: "team-1",
      jql: "project = DEMO AND issuetype = Epic",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByLabelText("Default Epic link for task creation"), {
      target: { value: "DEMO-EPIC-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save task creation settings" }));
    await waitFor(() => expect(saveProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "team-1",
      defaultTaskSprintId: "sprint-1",
      defaultTaskSprintName: "Platform Sprint",
      defaultEpicLinkKey: "DEMO-EPIC-1",
      defaultEpicLinkSummary: "Example epic",
      epicLinkJql: "project = DEMO AND issuetype = Epic",
    })));
  });
});
