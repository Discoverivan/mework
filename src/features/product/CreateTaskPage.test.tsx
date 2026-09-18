import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("shows an inviting empty state before the first task is created", async () => {
    render(<CreateTaskPage />);

    expect(await screen.findByRole("heading", { name: "No tasks yet" })).toBeInTheDocument();
    expect(screen.getByText("Your created Jira tasks will appear here.")).toBeInTheDocument();
    expect(screen.getByText("Start by describing a task and let AI prepare the draft for you.")).toBeInTheDocument();
    expect(document.querySelector(".create-task-empty-icon svg.lucide-clipboard-list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create your first task" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe your task")).toBeInTheDocument();
  });

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
    const skeleton = screen.getByRole("article", { name: "AI is thinking" });
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.querySelector("svg.lucide-sparkles")).toBeInTheDocument();
    expect(generateMock).toHaveBeenCalledWith("Let admins filter events by actor and date.");

    resolveDraft?.({ summary: "Add audit filters", description: "Allow filtering by actor and date." });
    const draft = await screen.findByRole("article", { name: "Editable Jira task draft" });
    expect(draft.querySelector("svg.lucide-pencil")).toBeInTheDocument();
    expect(screen.getByLabelText("Task drafts")).toHaveClass("create-task-card-columns");
    expect(screen.getByLabelText("Task drafts").querySelectorAll(".create-task-card-column")).toHaveLength(2);
    expect(screen.getByLabelText("Summary")).toHaveValue("Add audit filters");
    expect(screen.getByLabelText("Description")).toHaveValue("Allow filtering by actor and date.");
    expect(screen.getByLabelText("Issue type")).toBeEnabled();
    expect(screen.getByLabelText("Issue type")).toHaveClass("h-10");
    expect(screen.getByLabelText("Epic link")).toBeDisabled();
    expect(screen.getByLabelText("Epic link")).toHaveClass("h-10", "px-2");
    await waitFor(() => expect(screen.getByLabelText("Assignee")).toBeEnabled());
    expect(screen.getByLabelText("Sprint")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Assignee"));
    expect(await screen.findByRole("option", { name: "Unassigned" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Unassigned" }));
  });

  it("improves the draft description with additional context", async () => {
    generateMock
      .mockResolvedValueOnce({ summary: "Initial summary", description: "Initial description" })
      .mockResolvedValueOnce({ summary: "Ignored summary", description: "Improved description" });
    render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Create task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(await screen.findByLabelText("Description")).toHaveValue("Initial description");
    fireEvent.click(screen.getByRole("button", { name: "Improve with AI" }));
    expect(screen.getByRole("heading", { name: "Improve description with AI" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/mention the affected API/), { target: { value: "Mention the audit actor and date filters." } });
    fireEvent.click(screen.getByRole("button", { name: "Improve description" }));

    await waitFor(() => expect(screen.getByLabelText("Description")).toHaveValue("Improved description"));
    expect(screen.getByLabelText("Summary")).toHaveValue("Initial summary");
    expect(generateMock).toHaveBeenNthCalledWith(2, expect.stringContaining("Additional context from the user:\nMention the audit actor and date filters."));
    expect(screen.queryByRole("heading", { name: "Improve description with AI" })).not.toBeInTheDocument();
  });
  it("closes the improve dialog and locks description while AI is working", async () => {
    let resolveImprovement: ((value: { summary: string; description: string }) => void) | undefined;
    generateMock
      .mockResolvedValueOnce({ summary: "Initial summary", description: "Initial description" })
      .mockReturnValueOnce(new Promise((resolve) => { resolveImprovement = resolve; }));
    render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Create task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(await screen.findByLabelText("Description")).toHaveValue("Initial description");
    fireEvent.click(screen.getByRole("button", { name: "Improve with AI" }));
    fireEvent.change(screen.getByPlaceholderText(/mention the affected API/), { target: { value: "Add acceptance criteria." } });
    fireEvent.click(screen.getByRole("button", { name: "Improve description" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Improve description with AI" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByText("Improving…")).toBeInTheDocument();

    resolveImprovement?.({ summary: "Ignored summary", description: "Improved description" });
    await waitFor(() => expect(screen.getByLabelText("Description")).toHaveValue("Improved description"));
    expect(screen.getByLabelText("Description")).toBeEnabled();
  });
  it("shows an AI provider error when draft generation fails", async () => {
    generateMock.mockRejectedValue(new Error("OpenAI-compatible API authorization failed during task generation"));
    render(<CreateTaskPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value: "Create an audit filter" } });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenAI-compatible API authorization failed during task generation",
    );
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
    fireEvent.click(screen.getByLabelText("Issue type"));
    fireEvent.click(await screen.findByRole("option", { name: "Spike" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({
      managedProjectId: "team-1",
      issueType: "Spike",
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
      issueType: "Task",
      summary: "Edited summary",
      description: "Initial description",
      epicLink: undefined,
      assignee: "user-1",
      sprint: undefined,
      storyPoints: undefined,
    }));
    const createdCard = await screen.findByRole("article", { name: "Created Jira task COREAPI-101" });
    expect(createdCard.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edited summary" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in Jira/ })).toHaveAttribute("href", "https://jira.example.invalid/browse/COREAPI-101");
  });

  it("restores persisted task cards by creation date", async () => {
    window.localStorage.setItem("mework.create-task.state.v1", JSON.stringify({
      version: 2,
      selectedTeamId: "team-1",
      cards: [
        {
          id: "newer",
          createdAt: 200,
          prompt: "Newer task",
          teamId: "team-1",
          issueType: "Task",
          summary: "Newer summary",
          description: "Newer description",
          epicLink: "",
          assignee: "__unassigned__",
          sprint: "",
          storyPoints: "",
          status: "ready",
        },
        {
          id: "older",
          createdAt: 100,
          prompt: "Older task",
          teamId: "team-1",
          issueType: "Task",
          summary: "Older summary",
          description: "Older description",
          epicLink: "",
          assignee: "__unassigned__",
          sprint: "",
          storyPoints: "",
          status: "ready",
        },
      ],
    }));
    render(<CreateTaskPage />);

    const taskDrafts = screen.getByLabelText("Task drafts");
    expect(await within(taskDrafts).findByDisplayValue("Older summary")).toBeInTheDocument();
    expect(within(taskDrafts).getAllByLabelText("Summary").map((input) => (input as HTMLInputElement).value)).toEqual([
      "Older summary",
      "Newer summary",
    ]);
  });
  it("keeps task cards in creation order when a draft becomes created", async () => {
    generateMock
      .mockResolvedValueOnce({ summary: "First summary", description: "First description" })
      .mockResolvedValueOnce({ summary: "Second summary", description: "Second description" });
    createMock.mockResolvedValue({ id: "10001", key: "COREAPI-201", url: "https://jira.example.invalid/browse/COREAPI-201" });
    render(<CreateTaskPage />);

    const submitPrompt = (value: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Create task" }));
      fireEvent.change(screen.getByPlaceholderText("Describe your task"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));
    };
    submitPrompt("First task");
    submitPrompt("Second task");

    const taskDrafts = screen.getByLabelText("Task drafts");
    await waitFor(() => expect(within(taskDrafts).getAllByRole("article", { name: "Editable Jira task draft" })).toHaveLength(2));
    const firstCard = within(taskDrafts).getAllByRole("article", { name: "Editable Jira task draft" })[0];
    fireEvent.click(within(firstCard).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(within(taskDrafts).getByRole("article", { name: "Created Jira task COREAPI-201" })).toBeInTheDocument());
    expect(within(taskDrafts).getAllByRole("article")[0]).toHaveAccessibleName("Created Jira task COREAPI-201");
    expect(within(taskDrafts).getAllByRole("article")[1]).toHaveAccessibleName("Editable Jira task draft");
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
