import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addAiCliProvider, deleteAiProvider, deleteIntegration, getAiSettings, getCachedAiSettings, inspectAiCliProvider, listIntegrations, refreshAiSettings, saveAiActionSettings, saveIntegration, saveOpenAiCompatibleProvider } from "./api";
import { getPromptSettings } from "./prompts/api";
import { copyAiSection } from "./action-settings-drafts";
import type { AiSettings, PromptSettings } from "@/shared/contracts/settings";
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
  saveAiActionSettings: vi.fn(),
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
const saveAiActionSettingsMock = vi.mocked(saveAiActionSettings);

async function saveSection(name: string) {
  const button = within(screen.getByRole("region", { name })).getByRole("button", { name: "Save" });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => { fireEvent.click(button); });
}
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
    vi.mocked(getPromptSettings).mockResolvedValue([]);
    getAiSettingsMock.mockResolvedValue(codexAiSettings);
    refreshAiSettingsMock.mockResolvedValue(codexAiSettings);
    addAiCliProviderMock.mockResolvedValue(codexAiSettings);
    inspectAiCliProviderMock.mockResolvedValue(codexAiSettings.providers[0]);
    saveAiActionSettingsMock.mockImplementation(async (_scope, settings) => ({ ai: { ...codexAiSettings, settings }, prompt: null }));
    listIntegrationsMock.mockResolvedValue([]);
    deleteIntegrationMock.mockResolvedValue(undefined);
    saveIntegrationMock.mockResolvedValue({ status: "saved", integration: jiraIntegration });
  });

  it("stages, cancels and saves a review section without saving neighboring drafts", async () => {
    const providers = [
      { id: "codex-cli" as const, name: "Codex CLI", status: "connected" as const, available: true, models: ["example-review-model"] },
      { id: "claude-code-cli" as const, name: "Claude Code CLI", status: "connected" as const, available: true, models: ["example-arbiter-model"] },
    ];
    let persisted: AiSettings = { ...codexAiSettings.settings, provider: "codex-cli", model: "example-review-model" };
    let persistedPrompt: PromptSettings = {
      action: "pullRequestReview", instructions: "Review example defects.", defaultInstructions: "Review example defects.",
      instructionsHash: "example-hash", protectedRules: "Use the supplied example diff.", customized: false, includeFixExamples: false,
    };
    let persistedArbiterPrompt: PromptSettings = { ...persistedPrompt, action: "reviewArbiter", instructions: "Verify example findings.", defaultInstructions: "Verify example findings." };
    getAiSettingsMock.mockResolvedValue({ providers, settings: persisted });
    vi.mocked(getPromptSettings).mockResolvedValue([persistedPrompt, persistedArbiterPrompt]);
    saveAiActionSettingsMock.mockImplementation(async (scope, settings, prompt) => {
      persisted = copyAiSection(persisted, settings, scope);
      if (prompt) persistedPrompt = { ...persistedPrompt, instructions: prompt.instructions ?? persistedPrompt.defaultInstructions, customized: prompt.instructions !== null, includeFixExamples: prompt.includeFixExamples };
      if (prompt && scope === "pullRequestReview") persistedArbiterPrompt = { ...persistedArbiterPrompt, instructions: prompt.arbiterInstructions ?? persistedArbiterPrompt.defaultInstructions, customized: prompt.arbiterInstructions != null };
      return { ai: { providers, settings: persisted }, prompt: prompt ? persistedPrompt : null, arbiterPrompt: scope === "pullRequestReview" ? persistedArbiterPrompt : null };
    });
    const view = render(<SettingsPage section="ai" />);
    const mode = within(await screen.findByRole("radiogroup", { name: "Review mode" }));
    const review = within(screen.getByRole("region", { name: "Pull request review" }));
    const reviewHeader = screen.getByRole("heading", { name: "Pull request review" }).closest("header");
    expect(within(reviewHeader!).getByRole("radiogroup", { name: "Review mode" })).toBeInTheDocument();
    await screen.findByRole("combobox", { name: "Suggest fixes" });
    fireEvent.click(mode.getByRole("radio", { name: "Review with arbiter" }));
    fireEvent.click(review.getByRole("button", { name: "Cancel" }));
    expect(mode.getByRole("radio", { name: "Single review" })).toBeChecked();
    fireEvent.click(mode.getByRole("radio", { name: "Review with arbiter" }));
    const count = within(screen.getByRole("region", { name: "Independent reviewers" })).getByRole("textbox", { name: "Independent reviews" });
    fireEvent.change(count, { target: { value: "" } });
    expect(review.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(count, { target: { value: "9" } });
    expect(review.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(within(screen.getByRole("region", { name: "Arbiter" })).getByRole("combobox", { name: "AI provider" }));
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Use defaults");
    fireEvent.click(screen.getByRole("option", { name: /Claude Code CLI/ }));
    fireEvent.change(within(screen.getByRole("region", { name: "Arbiter" })).getByRole("textbox", { name: "Retries" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Suggest fixes" }));
    fireEvent.click(screen.getByRole("option", { name: "Enabled" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Independent reviewers" })).getByRole("combobox", { name: "Instructions" }));
    fireEvent.click(screen.getByRole("option", { name: "Custom" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Your instructions"), { target: { value: "Check concrete example defects." } });
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    const arbiter = within(screen.getByRole("region", { name: "Arbiter" }));
    fireEvent.click(arbiter.getByRole("combobox", { name: "Instructions" }));
    fireEvent.click(screen.getByRole("option", { name: "Custom" }));
    const arbiterDialog = within(screen.getByRole("dialog"));
    expect(arbiterDialog.getByRole("heading", { name: "Arbiter" })).toBeInTheDocument();
    fireEvent.change(arbiterDialog.getByLabelText("Your instructions"), { target: { value: "Verify example defects independently." } });
    fireEvent.click(arbiterDialog.getByRole("button", { name: "Apply" }));
    fireEvent.click(defaultAiSettings().getByRole("combobox", { name: "Reasoning" }));
    fireEvent.click(screen.getByRole("option", { name: "high" }));
    const task = within(screen.getByRole("region", { name: "Task creation" }));
    fireEvent.click(task.getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(screen.getByRole("option", { name: /Claude Code CLI/ }));
    expect(saveAiActionSettingsMock).not.toHaveBeenCalled();
    await saveSection("Pull request review");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("pullRequestReview", expect.objectContaining({
      reviewArbitration: { enabled: true, reviewCount: 9 }, reviewArbiter: expect.objectContaining({ model: "example-arbiter-model" }),
      retries: expect.objectContaining({ actions: expect.objectContaining({ reviewArbiter: 3 }) }),
    }), { instructions: "Check concrete example defects.", includeFixExamples: true, arbiterInstructions: "Verify example defects independently." }));
    await waitFor(() => expect(review.getByRole("button", { name: "Save" })).toBeDisabled());
    expect(persisted.reasoning).toBe("medium");
    expect(persisted.taskCreation ?? null).toBeNull();
    expect(task.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(defaultAiSettings().getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(task.getByRole("button", { name: "Cancel" }));
    fireEvent.click(defaultAiSettings().getByRole("button", { name: "Cancel" }));
    expect(task.getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Use defaults");
    expect(defaultAiSettings().getByRole("combobox", { name: "Reasoning" })).toHaveTextContent("medium");
    view.unmount();
    getAiSettingsMock.mockResolvedValue({ providers, settings: persisted });
    vi.mocked(getPromptSettings).mockResolvedValue([persistedPrompt, persistedArbiterPrompt]);
    render(<SettingsPage section="ai" />);
    expect(within(await screen.findByRole("radiogroup", { name: "Review mode" })).getByRole("radio", { name: "Review with arbiter" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Independent reviews" })).toHaveValue("9");
    expect(screen.getByRole("combobox", { name: "Arbiter model" })).toHaveTextContent("example-arbiter-model");
    expect(await screen.findByRole("combobox", { name: "Suggest fixes" })).toHaveTextContent("Enabled");
    expect(within(screen.getByRole("region", { name: "Arbiter" })).getByRole("combobox", { name: "Instructions" })).toHaveTextContent("Custom");
    expect(within(screen.getByRole("region", { name: "Arbiter" })).getByRole("textbox", { name: "Retries" })).toHaveValue("3");
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

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
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saves an edit to a synthetic integration in mock mode", async () => {
    const mockJira = { ...jiraIntegration, id: "mock-jira", baseUrl: "http://127.0.0.1:18372/jira/", credentialRef: "mock://mock-jira/no-credential" };
    listIntegrationsMock.mockResolvedValueOnce([mockJira]);
    saveIntegrationMock.mockResolvedValueOnce({ status: "saved", integration: { ...mockJira, allowInsecureTls: true } });
    render(<SettingsPage mockMode />);

    const card = within(await screen.findByRole("group", { name: "Jira integration" }));
    fireEvent.click(card.getByRole("button", { name: "Edit Jira integration" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow insecure TLS connection" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveIntegrationMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "mock-jira",
      baseUrl: "http://127.0.0.1:18372/jira/",
      allowInsecureTls: true,
    })));
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

    await saveSection("Task creation");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("taskCreation", expect.objectContaining({
      provider: "codex-cli",
      taskCreation: {
        provider: "claude-code-cli",
        model: "sonnet",
        reasoning: "medium",
        fastMode: false,
      },
    }), null));
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

    await saveSection("Sprint tasks / AI Summary");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("sprintSummary", expect.objectContaining({
      sprintSummary: {
        provider: "claude-code-cli",
        model: "sonnet",
        reasoning: "medium",
        fastMode: false,
      },
    }), null));
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
    await saveSection("Defaults");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("default", expect.objectContaining({
      provider: "openai-compatible",
      model: "example-model",
      reasoning: "medium",
      fastMode: false,
      retries: codexAiSettings.settings.retries,
    }), null));
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
    await saveSection("Defaults");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("default", expect.objectContaining({
      provider: "claude-code-cli",
      model: "sonnet",
      reasoning: "medium",
      fastMode: false,
      retries: codexAiSettings.settings.retries,
    }), null));
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
    await saveSection("Defaults");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("default", expect.objectContaining({ provider: "open-code-cli", model: "example/sample-model" }), null));
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
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByLabelText("Token")).not.toBeInTheDocument());
    }
    expect(screen.getAllByRole("group", { name: "OpenAI-compatible API AI provider" })).toHaveLength(2);
    selectAiProviderGroup("CLI");
    expect(screen.getByText("No CLI providers added yet.")).toBeInTheDocument();
    selectAiProviderGroup("API");
    selectAiProvider("OpenAI-compatible API · https://two.example.invalid/v1");
    await saveSection("Defaults");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("default", expect.objectContaining({
      provider: "openai-compatible",
      providerInstanceId: second.instanceId,
      model: "example-model",
      reasoning: "medium",
      fastMode: false,
    }), null));
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
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

    await saveSection("Model-testing");
    await waitFor(() => expect(saveAiActionSettingsMock).toHaveBeenCalledWith("tokenBurner", expect.objectContaining({
      provider: null,
      tokenBurner: expect.objectContaining({ provider: "codex-cli", model: "example-codex-model" }),
    }), null));
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(
      "Unable to configure OpenAI-compatible API: OpenAI-compatible API authorization failed",
    )).toBeInTheDocument();
  });
});
