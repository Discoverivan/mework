import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTaskPage } from "./CreateTaskPage";
import { createJiraTask, generateTaskDraft, listJiraTaskTeamMembers } from "./create-task-api";
import { listManagedProjects, listTargetSprints, loadJiraAvatarData, previewEpicLinkJql } from "../planning/api";

vi.mock("./create-task-api", () => ({
  createJiraTask: vi.fn(),
  generateTaskDraft: vi.fn(),
  listJiraTaskTeamMembers: vi.fn(),
}));
vi.mock("../planning/api", () => ({
  listManagedProjects: vi.fn(),
  listTargetSprints: vi.fn(),
  loadJiraAvatarData: vi.fn(),
  previewEpicLinkJql: vi.fn(),
}));

const listMembersMock = vi.mocked(listJiraTaskTeamMembers);
const listTeamsMock = vi.mocked(listManagedProjects);
const listSprintsMock = vi.mocked(listTargetSprints);
const avatarMock = vi.mocked(loadJiraAvatarData);
const epicPreviewMock = vi.mocked(previewEpicLinkJql);
const generateMock = vi.mocked(generateTaskDraft);
const createMock = vi.mocked(createJiraTask);

const secondTeam = {
  id: "team-2",
  integrationId: "jira-2",
  jiraProjectId: "10002",
  name: "Payments team",
  boardId: "board-2",
  boardName: "Payments board",
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  listTeamsMock.mockResolvedValue([{
    id: "team-1",
    integrationId: "jira-1",
    jiraProjectId: "10001",
    name: "Platform team",
    boardId: "board-1",
    boardName: "Platform board",
  }]);
  listMembersMock.mockResolvedValue([
    { id: "user-1", displayName: "Ivan", active: true },
    { id: "user-2", displayName: "Inactive", active: false },
  ]);
  listSprintsMock.mockResolvedValue([
    { id: "sprint-1", boardId: "board-1", name: "Platform Sprint", state: "active", usable: true },
  ]);
  avatarMock.mockResolvedValue(null);
  epicPreviewMock.mockResolvedValue([]);
  createMock.mockResolvedValue({ id: "10001", key: "COREAPI-101", url: "https://jira.example.invalid/browse/COREAPI-101" });
});

describe("CreateTaskPage", () => {
  it("opens the compact AI description modal", async () => {
    render(<CreateTaskPage />);

    expect(screen.getByRole("heading", { name: "Create task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create task" })).toHaveClass("h-9");
    expect(await screen.findByLabelText("Team")).toBeInTheDocument();
    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith("team-1"));
    expect(screen.queryByText("Product", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe your task")).toBeInTheDocument();
  });

  it("shows an AI skeleton before rendering editable draft fields", async () => {
    let resolveDraft: ((value: { summary: string; description: string }) => void) | undefined;
    generateMock.mockReturnValue(new Promise((resolve) => { resolveDraft = resolve; }));
    render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Let admins filter events by actor and date." } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "AI is thinking" })).toBeInTheDocument();
    expect(generateMock).toHaveBeenCalledWith("Let admins filter events by actor and date.");

    resolveDraft?.({ summary: "Add audit filters", description: "Allow filtering by actor and date." });
    expect(await screen.findByRole("article", { name: "Editable Jira task draft" })).toBeInTheDocument();
    expect(screen.getByLabelText("Task drafts")).toHaveClass("xl:grid-cols-2");
    expect(screen.getByLabelText("Summary")).toHaveValue("Add audit filters");
    expect(screen.getByLabelText("Description")).toHaveValue("Allow filtering by actor and date.");
    expect(screen.getByLabelText("Epic link")).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText("Assignee")).toBeEnabled());
    expect(screen.getByLabelText("Sprint")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Assignee"));
    expect(await screen.findByRole("option", { name: "Unassigned" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Unassigned" }));
  });

  it("restores task draft state after leaving and returning to the section", async () => {
    generateMock.mockResolvedValue({ summary: "Persisted summary", description: "Persisted description" });
    const firstRender = render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Persist this task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));
    expect(await firstRender.findByDisplayValue("Persisted summary")).toBeInTheDocument();
    firstRender.unmount();

    render(<CreateTaskPage />);
    expect(await screen.findByDisplayValue("Persisted summary")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Persisted description")).toBeInTheDocument();
  });

  it("reloads team members and sprints when the header team changes", async () => {
    listTeamsMock.mockResolvedValue([
      {
        id: "team-1",
        integrationId: "jira-1",
        jiraProjectId: "10001",
        name: "Platform team",
        boardId: "board-1",
        boardName: "Platform board",
      },
      secondTeam,
    ]);
    render(<CreateTaskPage />);
    await waitFor(() => expect(listMembersMock).toHaveBeenCalledWith("team-1"));

    fireEvent.click(screen.getByLabelText("Team"));
    fireEvent.click(await screen.findByRole("option", { name: "Payments team" }));

    await waitFor(() => {
      expect(listMembersMock).toHaveBeenCalledWith("team-2");
      expect(listSprintsMock).toHaveBeenCalledWith("team-2");
    });
  });

  it("keeps multiple AI draft cards independent while they are generating", async () => {
    const resolvers: Array<(value: { summary: string; description: string }) => void> = [];
    generateMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    render(<CreateTaskPage />);

    const submitPrompt = (value: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Create task" }));
      fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));
    };
    submitPrompt("First task");
    submitPrompt("Second task");

    expect(screen.getAllByRole("article", { name: "AI is thinking" })).toHaveLength(2);
    expect(screen.getAllByText("Preparing editable task fields", { exact: true })).toHaveLength(2);
    expect(screen.getAllByText("Summary", { exact: true })).toHaveLength(2);
    expect(screen.getAllByText("Description", { exact: true })).toHaveLength(2);
    expect(generateMock).toHaveBeenNthCalledWith(1, "First task");
    expect(generateMock).toHaveBeenNthCalledWith(2, "Second task");

    resolvers[1]?.({ summary: "Second summary", description: "Second description" });
    expect((await screen.findAllByRole("article", { name: "Editable Jira task draft" }))).toHaveLength(1);
    expect(screen.getByDisplayValue("Second summary")).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: "AI is thinking" })).toHaveLength(1);

    resolvers[0]?.({ summary: "First summary", description: "First description" });
    expect(await screen.findByDisplayValue("First summary")).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: "Editable Jira task draft" })).toHaveLength(2);
  });

  it("uses team task defaults and renders Epic candidates with assignee avatar", async () => {
    listTeamsMock.mockResolvedValue([{
      id: "team-1",
      integrationId: "jira-1",
      jiraProjectId: "10001",
      name: "Platform team",
      boardId: "board-1",
      boardName: "Platform board",
      defaultTaskSprintId: "sprint-1",
      defaultTaskSprintName: "Platform Sprint",
      defaultEpicLinkKey: "COREAPI-EPIC-1",
      defaultEpicLinkSummary: "Platform epic",
      epicLinkJql: "project = COREAPI AND issuetype = Epic",
    }]);
    listMembersMock.mockResolvedValue([{ id: "user-1", displayName: "Ivan Petrov", avatarUrl: "/secure/avatar/ivan", active: true }]);
    epicPreviewMock.mockResolvedValue([{ key: "COREAPI-EPIC-1", summary: "Platform epic" }]);
    avatarMock.mockResolvedValue("data:image/png;base64,synthetic");
    generateMock.mockResolvedValue({ summary: "Initial summary", description: "Initial description" });
    render(<CreateTaskPage />);

    await waitFor(() => expect(epicPreviewMock).toHaveBeenCalledWith({
      managedProjectId: "team-1",
      jql: "project = COREAPI AND issuetype = Epic",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Create task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));
    expect(await screen.findByRole("article", { name: "Editable Jira task draft" })).toBeInTheDocument();
    expect(screen.getByText("COREAPI-EPIC-1 — Platform epic")).toBeInTheDocument();

    expect(screen.getByText("Platform Sprint")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Epic link"));
    expect(await screen.findByRole("option", { name: "COREAPI-EPIC-1 — Platform epic" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "COREAPI-EPIC-1 — Platform epic" }));
    fireEvent.click(screen.getByLabelText("Assignee"));
    expect(await screen.findByRole("option", { name: "Ivan Petrov" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Ivan Petrov" }));
    await waitFor(() => expect(document.querySelector('img[src="data:image/png;base64,synthetic"]')).toBeInTheDocument());
    expect(avatarMock).toHaveBeenCalledWith("team-1", "/secure/avatar/ivan");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Story points"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({
      managedProjectId: "team-1",
      summary: "Initial summary",
      description: "Initial description",
      epicLink: "COREAPI-EPIC-1",
      assignee: "user-1",
      sprint: "sprint-1",
      storyPoints: "5",
    }));
  });

  it("edits assignee and creates the Jira task, or deletes the draft", async () => {
    generateMock.mockResolvedValue({ summary: "Initial summary", description: "Initial description" });
    render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Create task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(await screen.findByRole("article", { name: "Editable Jira task draft" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Edited summary" } });
    await waitFor(() => expect(screen.getByLabelText("Assignee")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(await screen.findByRole("option", { name: "Ivan" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith({
      managedProjectId: "team-1",
      summary: "Edited summary",
      description: "Initial description",
      epicLink: undefined,
      assignee: "user-1",
      sprint: undefined,
      storyPoints: undefined,
    }));
    expect(await screen.findByText("COREAPI-101")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in Jira/ })).toHaveAttribute("href", "https://jira.example.invalid/browse/COREAPI-101");
  });

  it("deletes the editable draft without a Jira mutation", async () => {
    generateMock.mockResolvedValue({ summary: "Initial summary", description: "Initial description" });
    render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Create task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(await screen.findByRole("article", { name: "Editable Jira task draft" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    expect(screen.queryByRole("article", { name: "Editable Jira task draft" })).not.toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
