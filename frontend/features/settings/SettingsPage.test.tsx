import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addAiCliProvider, deleteAiProvider, deleteIntegration, getAiSettings, getCachedAiSettings, inspectAiCliProvider, listIntegrations, refreshAiSettings, saveAiSettings, saveIntegration, saveOpenAiCompatibleProvider } from "./api";
import { SettingsPage } from "./SettingsPage";

vi.mock("./api", () => ({
  deleteIntegration: vi.fn(),
  deleteAiProvider: vi.fn(),
  addAiCliProvider: vi.fn(),
  inspectAiCliProvider: vi.fn(),
  getAiSettings: vi.fn(),
  getCachedAiSettings: vi.fn().mockReturnValue(null),
  listIntegrations: vi.fn(),
  refreshAiSettings: vi.fn(),
  refreshIntegrationHealth: vi.fn(),
  saveAiSettings: vi.fn(),
  saveIntegration: vi.fn(),
  saveOpenAiCompatibleProvider: vi.fn(),
}));

vi.mock("./prompts/api", () => ({
  getCachedPromptSettings: vi.fn().mockReturnValue([]),
  getPromptSettings: vi.fn().mockResolvedValue([]),
  savePromptSettings: vi.fn(),
  saveReviewFixExamples: vi.fn(),
}));

vi.mock("./planning-projects/api", () => ({
  deleteManagedProject: vi.fn(),
  listManagedProjects: vi.fn().mockResolvedValue([]),
  saveManagedProject: vi.fn(),
}));

const getAiSettingsMock = vi.mocked(getAiSettings);
const refreshAiSettingsMock = vi.mocked(refreshAiSettings);
const addAiCliProviderMock = vi.mocked(addAiCliProvider);
const inspectAiCliProviderMock = vi.mocked(inspectAiCliProvider);
const deleteAiProviderMock = vi.mocked(deleteAiProvider);
const deleteIntegrationMock = vi.mocked(deleteIntegration);
const listIntegrationsMock = vi.mocked(listIntegrations);
const saveAiSettingsMock = vi.mocked(saveAiSettings);
const saveIntegrationMock = vi.mocked(saveIntegration);
const saveOpenAiCompatibleProviderMock = vi.mocked(saveOpenAiCompatibleProvider);

function defaultAiSettings() {
  return within(screen.getByRole("region", { name: "Defaults" }));
}

function selectAiProvider(name: string) {
  fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "AI provider" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

function selectAiProviderGroup(name: "CLI" | "API") {
  fireEvent.click(screen.getByRole("combobox", { name: "Provider types" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

async function selectIntegrationToAdd(name: string) {
  const addButton = screen.getByRole("button", { name: "Add data integration" });
  await waitFor(() => expect(addButton).toBeEnabled());
  fireEvent.pointerDown(addButton, { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

const jiraIntegration = {
  id: "jira-1",
  kind: "jira" as const,
  baseUrl: "https://jira.example.com",
  accountKey: "jira-account",
  enabled: true,
  credentialRef: "credential-ref-jira",
  capabilities: ["issues", "projects"],
  healthStatus: "working" as const,
  accountDisplayName: "Test User",
  allowInsecureTls: false,
};

const codexAiSettings = {
  settings: {
    provider: null,
    model: "gpt-5.5",
    reasoning: "medium" as const,
    fastMode: false,
    retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } },
  },
  providers: [{
    id: "codex-cli" as const,
    name: "Codex CLI",
    status: "connected" as const,
    available: true,
    models: ["gpt-6-astra", "gpt-5.5"],
    version: "codex-cli 0.142.5",
  }],
};

describe("SettingsPage integrations smoke tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCachedAiSettings).mockReturnValue(null);
    getAiSettingsMock.mockResolvedValue(codexAiSettings);
    refreshAiSettingsMock.mockResolvedValue(codexAiSettings);
    addAiCliProviderMock.mockResolvedValue(codexAiSettings);
    inspectAiCliProviderMock.mockResolvedValue(codexAiSettings.providers[0]);
    saveAiSettingsMock.mockImplementation(async (settings) => ({ ...codexAiSettings, settings }));
    listIntegrationsMock.mockResolvedValue([]);
    deleteIntegrationMock.mockResolvedValue(undefined);
    saveIntegrationMock.mockResolvedValue({ status: "saved", integration: jiraIntegration });
  });

  it("does not block data integrations while AI settings are pending", async () => {
    getAiSettingsMock.mockImplementation(() => new Promise(() => {}));
    render(<SettingsPage />);

    expect(screen.queryByRole("group", { name: "Codex CLI AI provider" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Data integrations" })).toBeInTheDocument();
    expect(screen.queryByText("Loading integrations…")).not.toBeInTheDocument();
  });

  it("opens a provider form with URL and write-only personal access token", async () => {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "Data integrations" });
    expect(screen.queryByText("Settings", { exact: true })).not.toBeInTheDocument();
    await selectIntegrationToAdd("Jira");

    expect(screen.getByRole("textbox", { name: "Base URL" })).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves a new integration without returning the secret to the UI", async () => {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "Data integrations" });
    expect(screen.queryByText("Settings", { exact: true })).not.toBeInTheDocument();
    await selectIntegrationToAdd("Jira");
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://jira.example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "test-jira-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveIntegrationMock).toHaveBeenCalledWith({
        kind: "jira",
        baseUrl: "https://jira.example.invalid",
        allowInsecureTls: false,
        secret: "test-jira-token",
      });
    });
    expect(screen.queryByText("test-jira-token")).not.toBeInTheDocument();
  });

  it("offers only unconfigured data integrations and disables adding when all are configured", async () => {
    const bitbucketIntegration = { ...jiraIntegration, id: "bitbucket-1", kind: "bitbucket" as const, baseUrl: "https://bitbucket.example.invalid" };
    const confluenceIntegration = { ...jiraIntegration, id: "confluence-1", kind: "confluence" as const, baseUrl: "https://confluence.example.invalid" };
    listIntegrationsMock.mockResolvedValueOnce([jiraIntegration]);
    const { unmount } = render(<SettingsPage />);

    await screen.findByRole("group", { name: "Jira integration" });
    const addButton = screen.getByRole("button", { name: "Add data integration" });
    fireEvent.pointerDown(addButton, { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menuitem", { name: "Jira" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Bitbucket" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Confluence" })).toBeInTheDocument();
    unmount();

    listIntegrationsMock.mockResolvedValueOnce([jiraIntegration, bitbucketIntegration, confluenceIntegration]);
    render(<SettingsPage />);
    await screen.findByRole("group", { name: "Confluence integration" });
    expect(screen.getByRole("button", { name: "Add data integration" })).toBeDisabled();
  });

  it("removes a configured data integration from its card", async () => {
    listIntegrationsMock.mockResolvedValueOnce([jiraIntegration]);
    render(<SettingsPage />);

    await screen.findByRole("group", { name: "Jira integration" });
    const deleteButton = screen.getByRole("button", { name: "Delete Jira integration" });
    expect(deleteButton).toHaveAttribute("data-action-tone", "delete");
    fireEvent.click(deleteButton);
    expect(screen.getByText("Delete the Jira integration? You can add it again later.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete integration" }));

    await waitFor(() => expect(deleteIntegrationMock).toHaveBeenCalledWith({ id: "jira-1" }));
    expect(screen.queryByRole("group", { name: "Jira integration" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add data integration" })).toBeEnabled();
  });

  it("opens editing from the configured integration's pencil button", async () => {
    listIntegrationsMock.mockResolvedValueOnce([jiraIntegration]);
    render(<SettingsPage />);

    const card = within(await screen.findByRole("group", { name: "Jira integration" }));
    expect(card.queryByRole("button", { name: "Jira" })).not.toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: "Edit Jira integration" }));

    expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://jira.example.com");
    expect(screen.getByLabelText("Personal access token")).toHaveValue("");
    expect(screen.getByLabelText("Personal access token")).toHaveAttribute("placeholder", "••••••••");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saves an edit to a synthetic integration in mock mode", async () => {
    const mockJira = { ...jiraIntegration, id: "mock-jira", baseUrl: "http://127.0.0.1:18372/jira/", credentialRef: "mock://mock-jira/no-credential" };
    listIntegrationsMock.mockResolvedValueOnce([mockJira]);
    saveIntegrationMock.mockResolvedValueOnce({ status: "saved", integration: { ...mockJira, allowInsecureTls: true } });
    render(<SettingsPage mockMode />);

    const card = within(await screen.findByRole("group", { name: "Jira integration" }));
    fireEvent.click(card.getByRole("button", { name: "Edit Jira integration" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow insecure TLS connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveIntegrationMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "mock-jira",
      baseUrl: "http://127.0.0.1:18372/jira/",
      allowInsecureTls: true,
    })));
  });

  it("saves independent retry settings for each AI action and defaults", async () => {
    let completeSave!: (value: Awaited<ReturnType<typeof saveAiSettings>>) => void;
    saveAiSettingsMock.mockImplementationOnce(() => new Promise((resolve) => { completeSave = resolve; }));
    const profile = { provider: "codex-cli" as const, model: "gpt-5.5", reasoning: "medium" as const, fastMode: false };
    getAiSettingsMock.mockResolvedValueOnce({
      ...codexAiSettings,
      settings: {
        ...codexAiSettings.settings,
        taskCreation: profile,
        pullRequestReview: profile,
        retries: { default: 0, actions: { taskCreation: 0, pullRequestReview: 0, tokenBurner: null, sprintSummary: null } },
      },
    });
    render(<SettingsPage section="ai" />);
    await screen.findByRole("group", { name: "Codex CLI AI provider" });
    const defaults = defaultAiSettings();
    expect(defaults.getByRole("textbox", { name: "Retries" })).toHaveValue("0");
    const retriesHeading = defaults.getByText("Retries", { selector: "span" });
    expect(retriesHeading).toHaveAttribute("data-tooltip", "Additional attempts after temporary provider errors (0–10).");
    fireEvent.click(retriesHeading);
    expect(defaults.getByRole("textbox", { name: "Retries" })).not.toHaveFocus();
    for (const action of ["Task creation", "Pull request review"]) {
      expect(within(screen.getByRole("region", { name: action })).getByRole("textbox", { name: "Retries" })).toHaveValue("0");
    }
    for (const action of ["Model-testing", "Sprint tasks / AI Summary"]) {
      expect(within(screen.getByRole("region", { name: action })).queryByRole("textbox", { name: "Retries" })).not.toBeInTheDocument();
    }

    const review = within(screen.getByRole("region", { name: "Pull request review" }));
    review.getByRole("textbox", { name: "Retries" }).focus();
    fireEvent.change(review.getByRole("textbox", { name: "Retries" }), { target: { value: "11" } });
    expect(review.getByRole("textbox", { name: "Retries" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Retries: the number must be between 0 and 10.");
    expect(review.getByRole("textbox", { name: "Retries" })).toHaveFocus();
    expect(saveAiSettingsMock).not.toHaveBeenCalled();
    fireEvent.change(review.getByRole("textbox", { name: "Retries" }), { target: { value: "2" } });
    expect(review.getByRole("textbox", { name: "Retries" })).toHaveValue("2");
    expect(review.getByRole("textbox", { name: "Retries" })).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      retries: expect.objectContaining({ actions: expect.objectContaining({ pullRequestReview: 2 }) }),
    })), { timeout: 2_000 });
    expect(review.getByRole("textbox", { name: "Retries" })).toBeDisabled();
    expect(defaults.getByRole("textbox", { name: "Retries" })).toBeEnabled();
    expect(defaults.getByRole("combobox", { name: "AI provider" })).toBeEnabled();
    const taskCreation = within(screen.getByRole("region", { name: "Task creation" }));
    expect(taskCreation.getByRole("combobox", { name: "AI provider" })).toBeEnabled();
    fireEvent.change(taskCreation.getByRole("textbox", { name: "Retries" }), { target: { value: "3" } });
    expect(saveAiSettingsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      completeSave({ ...codexAiSettings, settings: saveAiSettingsMock.mock.calls[0][0] });
    });
    expect(taskCreation.getByRole("textbox", { name: "Retries" })).toHaveValue("3");
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      retries: expect.objectContaining({ actions: expect.objectContaining({ pullRequestReview: 2, taskCreation: 3 }) }),
    })));
    expect(saveAiSettingsMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(review.getByRole("textbox", { name: "Retries" })).toBeEnabled());
    fireEvent.click(review.getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Use defaults" }));
    expect(review.queryByRole("textbox", { name: "Retries" })).not.toBeInTheDocument();
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      pullRequestReview: null,
      retries: expect.objectContaining({ actions: expect.objectContaining({ pullRequestReview: null, taskCreation: 3 }) }),
    })));
    fireEvent.change(defaults.getByRole("textbox", { name: "Retries" }), { target: { value: "4" } });
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      retries: expect.objectContaining({ default: 4, actions: expect.objectContaining({ pullRequestReview: null, taskCreation: 3 }) }),
    })));
    expect(taskCreation.getByRole("textbox", { name: "Retries" })).toHaveValue("3");
  });

  it("shows initial AI loading in a toast and immediately displays the cache on re-entry", async () => {
    const cached = { ...codexAiSettings, settings: { ...codexAiSettings.settings, provider: "codex-cli" as const } };
    let completeLoad!: (value: typeof cached) => void;
    getAiSettingsMock.mockImplementationOnce(() => new Promise((resolve) => { completeLoad = resolve; }));
    const view = render(<SettingsPage section="ai" />);
    const loadingNotice = screen.getByText(/^Loading AI settings/);
    expect(screen.getByRole("region", { name: "Action settings" })).not.toContainElement(loadingNotice);
    await act(async () => { completeLoad(cached); });
    await waitFor(() => expect(defaultAiSettings().getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Codex CLI"));
    view.unmount();
    vi.mocked(getCachedAiSettings).mockReturnValue(cached);
    getAiSettingsMock.mockResolvedValue(cached);
    render(<SettingsPage section="ai" />);
    expect(defaultAiSettings().getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Codex CLI");
    expect(screen.queryByText(/^Loading AI settings/)).not.toBeInTheDocument();
    await act(async () => {});
  });

  it("shows AI controls above integration cards and saves Codex settings automatically", async () => {
    let completeSave!: (value: Awaited<ReturnType<typeof saveAiSettings>>) => void;
    saveAiSettingsMock.mockImplementationOnce(() => new Promise((resolve) => { completeSave = resolve; }));
    render(<SettingsPage section="ai" />);

    expect(await screen.findByRole("heading", { name: "AI settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI providers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI providers" }).compareDocumentPosition(
      screen.getByRole("heading", { name: "Defaults" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const actions = within(screen.getByRole("region", { name: "Action settings" }));
    expect(actions.getByRole("region", { name: "Defaults" })).toBeInTheDocument();
    expect(actions.getByRole("heading", { name: "Defaults" }).compareDocumentPosition(
      actions.getByRole("heading", { name: "Pull request review" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Customize AI behavior for each action.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Data integrations" })).not.toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Codex CLI AI provider" })).toHaveTextContent("Connected");

    selectAiProvider("Codex CLI");
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "gpt-5.5" }));
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Reasoning" }));
    fireEvent.click(screen.getByRole("option", { name: "high" }));
    fireEvent.click(defaultAiSettings().getByText("Mode", { selector: "label" }));
    expect(defaultAiSettings().getByRole("combobox", { name: "Mode" })).toHaveAttribute("aria-expanded", "false");
    expect(defaultAiSettings().getByRole("combobox", { name: "Mode" })).toHaveTextContent("Normal");
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Fast" }));
    expect(screen.queryByRole("button", { name: "Save AI settings" })).not.toBeInTheDocument();

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
      retries: codexAiSettings.settings.retries,
    }));
    const savingNotice = await screen.findByRole("status");
    expect(savingNotice).toHaveTextContent("Saving");
    expect(screen.getByRole("region", { name: "Action settings" })).not.toContainElement(savingNotice);
    completeSave({ ...codexAiSettings, settings: saveAiSettingsMock.mock.calls[0][0] });
    const notice = await screen.findByText("AI settings saved. They apply to new runs.");
    expect(notice).toHaveTextContent("AI settings saved. They apply to new runs.");
    expect(screen.getByRole("region", { name: "Action settings" })).not.toContainElement(notice);
  });

  it("saves an activity-specific provider and model override", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      settings: { ...codexAiSettings.settings, provider: "codex-cli" },
      providers: [
        ...codexAiSettings.providers,
        { id: "claude-code-cli", name: "Claude Code CLI", status: "connected", available: true, models: ["sonnet"] },
      ],
    });
    render(<SettingsPage section="ai" />);

    await screen.findByRole("heading", { name: "AI settings" });
    const providerSelector = within(screen.getByRole("region", { name: "Task creation" })).getByRole("combobox", { name: "AI provider" });
    fireEvent.click(providerSelector);
    fireEvent.click(screen.getByRole("option", { name: "Claude Code CLI" }));

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex-cli",
      taskCreation: {
        provider: "claude-code-cli",
        model: "sonnet",
        reasoning: "medium",
        fastMode: false,
      },
    })));
    expect(await screen.findByText("AI settings saved. They apply to new runs.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Action settings" })).not.toContainElement(screen.getByText("AI settings saved. They apply to new runs."));
  });

  it("saves a provider and model override for Sprint tasks / AI Summary", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      settings: { ...codexAiSettings.settings, provider: "codex-cli" },
      providers: [
        ...codexAiSettings.providers,
        { id: "claude-code-cli", name: "Claude Code CLI", status: "connected", available: true, models: ["sonnet"] },
      ],
    });
    render(<SettingsPage section="ai" />);

    await screen.findByRole("heading", { name: "AI settings" });
    const summary = within(screen.getByRole("region", { name: "Sprint tasks / AI Summary" }));
    fireEvent.click(summary.getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Claude Code CLI" }));

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      sprintSummary: {
        provider: "claude-code-cli",
        model: "sonnet",
        reasoning: "medium",
        fastMode: false,
      },
    })));
  });

  it("restores a configured action when saving inherited settings fails", async () => {
    getAiSettingsMock.mockResolvedValueOnce({
      ...codexAiSettings,
      settings: {
        ...codexAiSettings.settings,
        taskCreation: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
      },
    });
    saveAiSettingsMock.mockRejectedValueOnce(new Error("Synthetic save failure"));
    render(<SettingsPage section="ai" />);

    await screen.findByRole("region", { name: "Task creation" });
    fireEvent.click(within(screen.getByRole("region", { name: "Task creation" })).getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Use defaults" }));

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalled());
    expect(await within(screen.getByRole("region", { name: "Task creation" })).findByText(
      "Unable to save AI settings: Synthetic save failure",
    )).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Task creation" })).getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Codex CLI");
  });

  it("refreshes an AI provider and displays its updated models", async () => {
    refreshAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      providers: [{ ...codexAiSettings.providers[0], models: ["gpt-6-astra", "example-new-model"] }],
    });
    render(<SettingsPage section="ai" />);

    const provider = within(await screen.findByRole("group", { name: "Codex CLI AI provider" }));
    expect(provider.getByText("0.142.5")).toBeInTheDocument();
    expect(provider.queryByText("codex-cli 0.142.5")).not.toBeInTheDocument();
    fireEvent.click(provider.getByRole("button", { name: "Refresh Codex CLI configuration" }));

    await waitFor(() => expect(refreshAiSettingsMock).toHaveBeenCalledOnce());
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Codex CLI" }));
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Model" }));
    expect(screen.getByRole("option", { name: "example-new-model" })).toBeInTheDocument();
  });

  it("shows an activity-specific save error in its own block", async () => {
    saveAiSettingsMock.mockRejectedValue(new Error("Synthetic save failure"));
    render(<SettingsPage section="ai" focusActivity="token-burner" />);

    await screen.findByRole("heading", { name: "AI settings" });
    const activity = within(screen.getByRole("region", { name: "Model-testing" }));
    fireEvent.click(activity.getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex CLI/ }));
    fireEvent.click(activity.getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "gpt-5.5" }));

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalled());
    expect(await activity.findByText("Unable to save AI settings: Synthetic save failure")).toBeInTheDocument();
    expect(defaultAiSettings().queryByText("Unable to save AI settings: Synthetic save failure")).not.toBeInTheDocument();
  });

  it("selects the only available model when an AI provider is chosen", async () => {
    getAiSettingsMock.mockResolvedValue({
      settings: {
        provider: null,
        model: "",
        reasoning: "medium",
        fastMode: false,
        retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } },
      },
      providers: [
        codexAiSettings.providers[0],
        {
          id: "openai-compatible" as const,
          name: "OpenAI-compatible API",
          status: "connected" as const,
          available: true,
          models: ["example-model"],
          baseUrl: "https://api.example.invalid/v1",
        },
      ],
    });
    render(<SettingsPage section="ai" />);

    await screen.findByRole("heading", { name: "AI settings" });
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "AI provider" }));
    const selectedOption = screen.getByRole("option", { name: "Not selected" });
    expect(selectedOption).toHaveAttribute("data-state", "checked");
    expect(selectedOption.querySelector("svg.lucide-check")).toBeNull();
    expect(screen.getByTestId("ai-provider-cli-group-label")).toHaveTextContent("CLI");
    expect(screen.getByTestId("ai-provider-api-group-label")).toHaveTextContent("API");
    fireEvent.click(selectedOption);
    const action = within(screen.getByRole("region", { name: "Task creation" }));
    fireEvent.click(action.getByRole("combobox", { name: "AI provider" }));
    const inheritedOption = screen.getByRole("option", { name: "Use defaults" });
    expect(inheritedOption).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("ai-provider-cli-group-label")).toHaveTextContent("CLI");
    expect(screen.getByTestId("ai-provider-api-group-label")).toHaveTextContent("API");
    fireEvent.click(inheritedOption);
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: "OpenAI-compatible API · https://api.example.invalid/v1" }));

    expect(defaultAiSettings().getByRole("combobox", { name: "Model" })).toHaveTextContent("example-model");
    expect(screen.queryByText("No available model selected.")).not.toBeInTheDocument();
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "openai-compatible",
      model: "example-model",
      reasoning: "medium",
      fastMode: false,
      retries: codexAiSettings.settings.retries,
    }));
  });

  it("selects Claude Code CLI without Codex-only controls", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      providers: [
        ...codexAiSettings.providers,
        {
          id: "claude-code-cli",
          name: "Claude Code CLI",
          status: "connected",
          available: true,
          models: ["sonnet", "opus", "haiku"],
        },
      ],
    });
    render(<SettingsPage section="ai" />);

    await screen.findByRole("group", { name: "Claude Code CLI AI provider" });
    expect(screen.getByRole("button", { name: "Add CLI provider" })).toBeEnabled();
    selectAiProvider("Claude Code CLI");
    expect(defaultAiSettings().queryByRole("combobox", { name: "Reasoning" })).not.toBeInTheDocument();
    expect(defaultAiSettings().queryByRole("combobox", { name: "Mode" })).not.toBeInTheDocument();
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "sonnet" }));
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "claude-code-cli",
      model: "sonnet",
      reasoning: "medium",
      fastMode: false,
      retries: codexAiSettings.settings.retries,
    }));
  });

  it("lists OpenCode after Claude Code and saves its reported model", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      providers: [...codexAiSettings.providers, {
        id: "open-code-cli", name: "OpenCode CLI", status: "connected", available: true, models: ["example/sample-model"],
      }, {
        id: "claude-code-cli", name: "Claude Code CLI", status: "connected", available: true, models: ["example-model"],
      }],
    });
    render(<SettingsPage section="ai" />);
    const opencode = await screen.findByRole("group", { name: "OpenCode CLI AI provider" });
    expect(screen.getByRole("group", { name: "Claude Code CLI AI provider" }).compareDocumentPosition(opencode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    selectAiProvider("OpenCode CLI");
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ provider: "open-code-cli", model: "example/sample-model" })));
  });

  it("shows model validation at the Pi field and saves a corrected selection", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      providers: [...codexAiSettings.providers, {
        id: "pi-cli", name: "Pi CLI", status: "connected", available: true, models: ["example/sample-model", "example/updated-model"],
      }],
    });
    saveAiSettingsMock.mockRejectedValueOnce({ message: "Selected AI model is invalid", scope: "default", field: "model" });
    render(<SettingsPage section="ai" />);
    await screen.findByRole("group", { name: "Pi CLI AI provider" });
    selectAiProvider("Pi CLI");
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "example/sample-model" }));
    const model = defaultAiSettings().getByRole("combobox", { name: "Model" });
    await waitFor(() => expect(model).toHaveAttribute("aria-invalid", "true"));
    expect(model).toHaveClass("border-destructive");
    expect(await screen.findByRole("alert")).toHaveTextContent("This model is unavailable.");
    expect(defaultAiSettings().queryByText(/Unable to save AI settings/)).not.toBeInTheDocument();

    fireEvent.click(model);
    fireEvent.click(screen.getByRole("option", { name: "example/updated-model" }));
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "pi-cli", model: "example/updated-model" })));
    expect(model).toHaveAttribute("aria-invalid", "false");
  });

  it("shows the prefilled Hermes CLI as missing in mock mode", async () => {
    const hermes = { id: "hermes-cli" as const, name: "Hermes CLI", status: "not_found" as const, available: false, models: [], message: "Hermes CLI was not found on this computer" };
    const claude = { id: "claude-code-cli" as const, name: "Claude Code CLI", status: "not_found" as const, available: false, models: [], message: "Claude Code CLI was not found on this computer" };
    const pi = { id: "pi-cli" as const, name: "Pi CLI", status: "not_found" as const, available: false, models: [], message: "settings.pi.notFound" };
    getAiSettingsMock.mockResolvedValue({ ...codexAiSettings, providers: [...codexAiSettings.providers, claude, { id: "open-code-cli", name: "OpenCode CLI", status: "not_found", available: false, models: [] }, hermes, pi] });
    render(<SettingsPage section="ai" mockMode />);

    const provider = within(await screen.findByRole("group", { name: "Hermes CLI AI provider" }));
    expect(provider.getByText("Hermes CLI was not found on this computer")).toBeInTheDocument();
    expect(provider.getByText("CLI not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add CLI provider" })).toBeDisabled();
  });

  it("adds multiple OpenAI-compatible APIs and selects one instance", async () => {
    getAiSettingsMock.mockResolvedValue({ ...codexAiSettings, providers: [] });
    const first = {
      id: "openai-compatible" as const,
      instanceId: "example-instance-one",
      name: "OpenAI-compatible API",
      status: "connected" as const,
      available: true,
      models: ["example-model"],
      baseUrl: "https://one.example.invalid/v1",
    };
    const second = { ...first, instanceId: "example-instance-two", baseUrl: "https://two.example.invalid/v1" };
    saveOpenAiCompatibleProviderMock
      .mockResolvedValueOnce({ settings: codexAiSettings.settings, providers: [first] })
      .mockResolvedValueOnce({ settings: codexAiSettings.settings, providers: [first, second] });
    render(<SettingsPage section="ai" />);

    expect(await screen.findByRole("heading", { name: "No AI providers yet" })).toBeInTheDocument();
    selectAiProviderGroup("API");
    const addProvider = screen.getByRole("button", { name: "Add API provider" });
    expect(addProvider).toHaveTextContent(/^$/);
    expect(addProvider.querySelector("svg.lucide-plus")).toBeInTheDocument();
    for (const url of [first.baseUrl, second.baseUrl]) {
      fireEvent.click(screen.getByRole("button", { name: "Add API provider" }));
      fireEvent.change(screen.getByLabelText("API URL"), { target: { value: url } });
      fireEvent.change(screen.getByLabelText("Token"), { target: { value: "synthetic-token" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByLabelText("Token")).not.toBeInTheDocument());
    }
    expect(screen.getAllByRole("group", { name: "OpenAI-compatible API AI provider" })).toHaveLength(2);
    selectAiProviderGroup("CLI");
    expect(screen.getByText("No CLI providers added yet.")).toBeInTheDocument();
    selectAiProviderGroup("API");
    selectAiProvider("OpenAI-compatible API · https://two.example.invalid/v1");
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "openai-compatible",
      providerInstanceId: second.instanceId,
      model: "example-model",
      reasoning: "medium",
      fastMode: false,
      retries: codexAiSettings.settings.retries,
    }));
  });

  it("edits an API without replacing its token and removes the selected provider", async () => {
    const provider = {
      id: "openai-compatible" as const,
      instanceId: "example-instance",
      name: "OpenAI-compatible API",
      status: "connected" as const,
      available: true,
      models: ["example-model"],
      baseUrl: "https://old.example.invalid/v1",
    };
    const settings = {
      provider: "openai-compatible" as const,
      providerInstanceId: provider.instanceId,
      model: "example-model",
      reasoning: "medium" as const,
      fastMode: false,
      retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } },
    };
    getAiSettingsMock.mockResolvedValue({ settings, providers: [provider] });
    saveOpenAiCompatibleProviderMock.mockResolvedValue({ settings, providers: [{ ...provider, name: "Team API", baseUrl: "https://new.example.invalid/v1" }] });
    deleteAiProviderMock.mockResolvedValue({ settings: { ...settings, provider: null, providerInstanceId: null, model: "" }, providers: [] });
    render(<SettingsPage section="ai" />);

    expect(await screen.findByRole("combobox", { name: "Provider types" })).toHaveTextContent("API");
    fireEvent.click(screen.getByRole("button", { name: "Edit https://old.example.invalid/v1" }));
    expect(screen.getByLabelText("Token")).toHaveValue("");
    expect(screen.getByLabelText("Token")).toHaveAttribute("placeholder", "••••••••");
    expect(screen.getByText(/Token saved in the operating system keyring/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Alias"), { target: { value: "Team API" } });
    fireEvent.change(screen.getByLabelText("API URL"), { target: { value: "https://new.example.invalid/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveOpenAiCompatibleProviderMock).toHaveBeenCalledWith({
      id: provider.instanceId,
      baseUrl: "https://new.example.invalid/v1",
      alias: "Team API",
      token: "",
      allowInsecureTls: false,
    }));
    await screen.findByRole("button", { name: "Delete https://new.example.invalid/v1" });
    fireEvent.click(screen.getByRole("button", { name: "Delete https://new.example.invalid/v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAiProviderMock).toHaveBeenCalledWith("openai-compatible", provider.instanceId));
    expect(await screen.findByRole("heading", { name: "No AI providers yet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Defaults" })).toBeInTheDocument();
    expect(defaultAiSettings().getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Not selected");
  });

  it("shows a pending CLI row until adding finishes", async () => {
    const pi = { id: "pi-cli" as const, name: "Pi CLI", status: "connected" as const, available: true, models: ["example/sample-model"] };
    const saved = { ...codexAiSettings, providers: [pi] };
    let finishAdding!: (value: typeof saved) => void;
    getAiSettingsMock.mockResolvedValue({ ...codexAiSettings, providers: [] });
    inspectAiCliProviderMock.mockImplementation(async (id) => ({ ...pi, id }));
    addAiCliProviderMock.mockImplementation(() => new Promise((resolve) => { finishAdding = resolve; }));
    render(<SettingsPage section="ai" />);

    await screen.findByRole("heading", { name: "No AI providers yet" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add CLI provider" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pi CLI" }));

    const pending = screen.getByRole("group", { name: "Pi CLI AI provider" });
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(within(pending).getByRole("status")).toHaveTextContent("Adding…");
    expect(pending.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(within(pending).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No AI providers yet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add CLI provider" })).toBeDisabled();
    expect(addAiCliProviderMock).toHaveBeenCalledWith("pi-cli");

    await act(async () => finishAdding(saved));

    const connected = screen.getByRole("group", { name: "Pi CLI AI provider" });
    expect(connected).not.toHaveAttribute("aria-busy");
    expect(within(connected).getByRole("button", { name: "Delete Pi CLI" })).toBeEnabled();
    expect(screen.queryByText("Adding…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add CLI provider" })).toBeEnabled();
  });

  it("keeps CLI providers in product order and explains unavailable ones", async () => {
    const cleared = { provider: null, model: "", reasoning: "medium" as const, fastMode: false, retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } } };
    deleteAiProviderMock.mockResolvedValue({ settings: cleared, providers: [] });
    let codexAvailable = false;
    inspectAiCliProviderMock.mockImplementation(async (id) => id === "claude-code-cli" || (id === "codex-cli" && codexAvailable)
      ? { ...codexAiSettings.providers[0], id, name: id === "codex-cli" ? "Codex CLI" : "Claude Code CLI" }
      : { ...codexAiSettings.providers[0], id, name: id === "codex-cli" ? "Codex CLI" : "Hermes CLI", status: "not_found", available: false, models: [], message: "CLI was not found" });
    render(<SettingsPage section="ai" />);

    await screen.findByRole("group", { name: "Codex CLI AI provider" });
    fireEvent.click(screen.getByRole("button", { name: "Delete Codex CLI" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAiProviderMock).toHaveBeenCalledWith("codex-cli", undefined));
    expect(await screen.findByRole("heading", { name: "No AI providers yet" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add CLI provider" }), { button: 0, ctrlKey: false });
    const available = await screen.findByRole("menuitem", { name: "Claude Code CLI" });
    const unavailable = screen.getByRole("menuitem", { name: "Codex CLI: Codex CLI was not found on this computer." });
    expect(available).toBeEnabled();
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    expect(unavailable.parentElement).toHaveAttribute("data-tooltip", "Codex CLI was not found on this computer.");
    expect(unavailable.compareDocumentPosition(available) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const retry = screen.getByRole("menuitem", { name: "Check again: Codex CLI" });
    fireEvent.focus(retry);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Check again: Codex CLI");
    codexAvailable = true;
    fireEvent.click(retry);
    const refreshed = await screen.findByRole("menuitem", { name: "Codex CLI" });
    expect(refreshed).toBeEnabled();
    fireEvent.click(refreshed);
    await waitFor(() => expect(addAiCliProviderMock).toHaveBeenCalledWith("codex-cli"));
  });

  it("opens and saves the Model-testing CLI override independently of the default AI provider", async () => {
    const settings = {
      provider: null,
      model: "",
      reasoning: "medium" as const,
      fastMode: false,
      taskCreation: null,
      pullRequestReview: null,
      tokenBurner: null,
      retries: { default: 0, actions: { taskCreation: null, pullRequestReview: null, tokenBurner: null, sprintSummary: null } },
    };
    getAiSettingsMock.mockResolvedValue({
      settings,
      providers: [{
        id: "codex-cli",
        name: "Codex CLI",
        status: "connected",
        available: true,
        models: ["example-codex-model"],
      }],
    });
    render(<SettingsPage section="ai" focusActivity="token-burner" />);

    await screen.findByRole("heading", { name: "AI settings" });
    expect(screen.getByRole("heading", { name: "Model-testing" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Action settings" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "Model-testing" })).getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex CLI/ }));

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: null,
      tokenBurner: expect.objectContaining({ provider: "codex-cli", model: "example-codex-model" }),
    })));
  });

  it("keeps safe OpenAI-compatible authorization errors readable", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      providers: [
        ...codexAiSettings.providers,
        {
          id: "openai-compatible" as const,
          name: "OpenAI-compatible API",
          status: "not_configured" as const,
          available: false,
          models: [],
        },
      ],
    });
    saveOpenAiCompatibleProviderMock.mockRejectedValue(
      new Error("OpenAI-compatible API authorization failed"),
    );
    render(<SettingsPage section="ai" />);

    await screen.findByRole("heading", { name: "AI settings" });
    selectAiProviderGroup("API");
    fireEvent.click(screen.getByRole("button", { name: "Add API provider" }));
    fireEvent.change(screen.getByLabelText("API URL"), {
      target: { value: "https://api.example.invalid/v1" },
    });
    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "synthetic-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(
      "Unable to configure OpenAI-compatible API: OpenAI-compatible API authorization failed",
    )).toBeInTheDocument();
  });
});
