import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  Element.prototype.scrollIntoView = vi.fn();
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
  it("keeps team details mounted during collapse and opens them again", async () => {
    const { container } = render(<ManagedProjectsSettings jiraIntegrations={[{
      id: "jira-1", kind: "jira", baseUrl: "https://jira.example.invalid", enabled: true, capabilities: {},
    }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Platform team project details" }));
    await screen.findByRole("combobox", { name: "Default sprint" });
    const reveal = container.querySelector(".team-settings-reveal")!;
    expect(reveal).toHaveAttribute("data-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide Platform team project details" }));
    expect(reveal).toBeInTheDocument();
    expect(reveal).toHaveAttribute("data-expanded", "false");
    expect(reveal.firstElementChild).toHaveAttribute("inert");
    expect(screen.queryByRole("combobox", { name: "Default sprint" })).not.toBeInTheDocument();
    await waitFor(() => expect(reveal).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open Platform team project details" }));
    expect(await screen.findByRole("combobox", { name: "Default sprint" })).toBeInTheDocument();
  });

  it("confirms removal of a member and team after allowing cancellation", async () => {
    listMembersMock.mockResolvedValue([{
      accountId: "user-1", displayName: "Example Member", tags: ["backend"], active: true,
    }]);
    render(<ManagedProjectsSettings jiraIntegrations={[{
      id: "jira-1", kind: "jira", baseUrl: "https://jira.example.invalid", enabled: true, capabilities: {},
    }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Platform team project details" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Example Member" }));
    let confirmation = within(await screen.findByRole("dialog", { name: "Remove team member" }));
    fireEvent.click(confirmation.getByRole("button", { name: "Cancel" }));
    expect(removePlanningTeamMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Example Member" }));
    confirmation = within(await screen.findByRole("dialog", { name: "Remove team member" }));
    fireEvent.click(confirmation.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(removePlanningTeamMember).toHaveBeenCalledWith("team-1", "user-1");
    expect(screen.queryByRole("button", { name: "Delete Example Member" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Platform team" }));
    confirmation = within(await screen.findByRole("dialog", { name: "Delete team" }));
    fireEvent.click(confirmation.getByRole("button", { name: "Cancel" }));
    expect(deleteManagedProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Platform team" }));
    confirmation = within(await screen.findByRole("dialog", { name: "Delete team" }));
    fireEvent.click(confirmation.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteManagedProject).toHaveBeenCalledWith("team-1");
    expect(screen.queryByRole("button", { name: "Delete Platform team" })).not.toBeInTheDocument();
  });

  it("shows the saved board and saves or closes editing without waiting for board choices", async () => {
    render(
      <ManagedProjectsSettings
        jiraIntegrations={[{
          id: "jira-1",
          kind: "jira",
          baseUrl: "https://jira.example.invalid",
          enabled: true,
          capabilities: {},
        }]}
        validateProjectKey={vi.fn().mockResolvedValue({ projectId: project.projectId, projectKey: project.projectKey, projectName: project.projectName })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit Platform team" }));

    const confluenceField = screen.getByRole("textbox", { name: "Confluence space" });
    const hint = screen.getByText("Configure and enable Confluence to select a team space.");
    expect(confluenceField).toBeDisabled();
    expect(confluenceField).toHaveAttribute("aria-describedby", hint.id);
    expect(screen.getByRole("combobox", { name: "Jira board" })).toHaveTextContent(/board-1|Platform board/);
    listBoardsMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("combobox", { name: "Jira board" }));
    expect(await screen.findByText("Loading Jira boards for this project…")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("option", { name: "Loading Jira boards…" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveProjectMock).toHaveBeenCalledWith(expect.objectContaining({ boardId: "board-1" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit Platform team" }));
    listBoardsMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("combobox", { name: "Jira board" }));
    expect(await screen.findByText("Loading Jira boards for this project…")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("option", { name: "Loading Jira boards…" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Platform team" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    expect(addTeamButton).toHaveTextContent("Create");
    expect(addTeamButton.closest("header")).toHaveClass("page-header");
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

    fireEvent.click(screen.getByRole("combobox", { name: "Jira board" }));
    fireEvent.click(screen.getByRole("option", { name: "Platform board (board-1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    expect(await screen.findByRole("combobox", { name: "Default sprint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Platform team project details" })).toHaveAttribute("aria-expanded", "true");
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
    saveProjectMock.mockResolvedValue({
      ...project,
      defaultTaskSprintId: "sprint-1",
      defaultTaskSprintName: "Platform Sprint",
      defaultEpicLinkKey: "DEMO-EPIC-1",
      defaultEpicLinkSummary: "Example epic",
      epicLinkJql: "project = DEMO AND issuetype = Epic",
    });
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
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const editMemberButton = await screen.findByRole("button", { name: "Edit Example Member" });
    expect(editMemberButton.querySelector("svg.lucide-pencil")).not.toBeNull();
    const deleteMemberButton = screen.getByRole("button", { name: "Delete Example Member" });
    expect(deleteMemberButton.querySelector("svg.lucide-trash-2")).not.toBeNull();
    await waitFor(() => expect(listSprintsMock).toHaveBeenCalledWith("team-1"));

    fireEvent.click(screen.getByRole("combobox", { name: "Default sprint" }));
    fireEvent.click(screen.getByRole("option", { name: "Platform Sprint" }));
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
    fireEvent.click(screen.getByRole("combobox", { name: "Default epic" }));
    fireEvent.click(screen.getByRole("option", { name: /DEMO-EPIC-1/ }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "team-1",
      defaultTaskSprintId: "sprint-1",
      defaultTaskSprintName: "Platform Sprint",
      defaultEpicLinkKey: "DEMO-EPIC-1",
      defaultEpicLinkSummary: "Example epic",
      epicLinkJql: "project = DEMO AND issuetype = Epic",
    })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Epic link JQL"), {
      target: { value: "project = DEMO" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Default sprint" }));
    fireEvent.click(screen.getByRole("option", { name: "No default sprint" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Epic link JQL")).toHaveValue("project = DEMO AND issuetype = Epic");
    expect(screen.getByRole("combobox", { name: "Default sprint" })).toHaveTextContent("Platform Sprint");
    expect(screen.getByRole("combobox", { name: "Default epic" })).toHaveTextContent("Example epic");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Edit Example Member" }));
    const memberForm = within(await screen.findByRole("dialog"));
    expect(memberForm.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(memberForm.getByLabelText("Alias (optional)"), { target: { value: "Example Alias" } });
    expect(memberForm.getByRole("button", { name: "Save" })).toBeEnabled();
    vi.mocked(addPlanningTeamMember).mockResolvedValue({
      accountId: "user-1", displayName: "Example Member", alias: "Example Alias", tags: ["backend"], active: true,
    });
    fireEvent.click(memberForm.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Example Alias")).toBeInTheDocument();
  });
});
