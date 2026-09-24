import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addAiCliProvider, deleteAiProvider, getAiSettings, inspectAiCliProvider, listIntegrations, saveAiSettings, saveIntegration, saveOpenAiCompatibleProvider } from "./api";
import { SettingsPage } from "./SettingsPage";

vi.mock("./api", () => ({
  deleteIntegration: vi.fn(),
  deleteAiProvider: vi.fn(),
  addAiCliProvider: vi.fn(),
  inspectAiCliProvider: vi.fn(),
  getAiSettings: vi.fn(),
  listIntegrations: vi.fn(),
  refreshIntegrationHealth: vi.fn(),
  saveAiSettings: vi.fn(),
  saveIntegration: vi.fn(),
  saveOpenAiCompatibleProvider: vi.fn(),
}));

vi.mock("./planning-projects/api", () => ({
  deleteManagedProject: vi.fn(),
  listManagedProjects: vi.fn().mockResolvedValue([]),
  saveManagedProject: vi.fn(),
}));

const getAiSettingsMock = vi.mocked(getAiSettings);
const addAiCliProviderMock = vi.mocked(addAiCliProvider);
const inspectAiCliProviderMock = vi.mocked(inspectAiCliProvider);
const deleteAiProviderMock = vi.mocked(deleteAiProvider);
const listIntegrationsMock = vi.mocked(listIntegrations);
const saveAiSettingsMock = vi.mocked(saveAiSettings);
const saveIntegrationMock = vi.mocked(saveIntegration);
const saveOpenAiCompatibleProviderMock = vi.mocked(saveOpenAiCompatibleProvider);

function selectAiProvider(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "AI provider" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

function selectAiProviderGroup(name: "CLI" | "API") {
  fireEvent.click(screen.getByRole("combobox", { name: "Provider types" }));
  fireEvent.click(screen.getByRole("option", { name }));
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
    getAiSettingsMock.mockResolvedValue(codexAiSettings);
    addAiCliProviderMock.mockResolvedValue(codexAiSettings);
    inspectAiCliProviderMock.mockResolvedValue(codexAiSettings.providers[0]);
    saveAiSettingsMock.mockImplementation(async (settings) => ({ ...codexAiSettings, settings }));
    listIntegrationsMock.mockResolvedValue([]);
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
    const jiraButton = screen.getByRole("button", { name: "Jira" });
    expect(jiraButton).toHaveClass("cursor-pointer", "hover:bg-accent/50");
    fireEvent.click(jiraButton);

    expect(screen.getByRole("textbox", { name: "Base URL" })).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account key")).not.toBeInTheDocument();
  });

  it("saves a new integration without returning the secret to the UI", async () => {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "Data integrations" });
    expect(screen.queryByText("Settings", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jira" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://jira.example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "test-jira-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save integration" }));

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

  it("shows AI controls above integration cards and saves Codex settings automatically", async () => {
    render(<SettingsPage section="ai" />);

    expect(await screen.findByRole("heading", { name: "AI settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI providers" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Data integrations" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Codex CLI AI provider" })).toHaveTextContent("Connected");

    selectAiProvider("Codex CLI");
    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "gpt-5.5" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning" }));
    fireEvent.click(screen.getByRole("option", { name: "high" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Fast mode" }));
    expect(screen.queryByRole("button", { name: "Save AI settings" })).not.toBeInTheDocument();

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
    }));
  });

  it("selects the only available model when an AI provider is chosen", async () => {
    getAiSettingsMock.mockResolvedValue({
      settings: {
        provider: null,
        model: "",
        reasoning: "medium",
        fastMode: false,
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
    fireEvent.click(screen.getByRole("combobox", { name: "AI provider" }));
    const selectedOption = screen.getByRole("option", { name: "Not selected" });
    expect(selectedOption).toHaveAttribute("data-state", "checked");
    expect(selectedOption.querySelector("svg.lucide-check")).toBeNull();
    expect(screen.getByTestId("ai-provider-group-separator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "OpenAI-compatible API · https://api.example.invalid/v1" }));

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("example-model");
    expect(screen.queryByText("No available model selected.")).not.toBeInTheDocument();
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "openai-compatible",
      model: "example-model",
      reasoning: "medium",
      fastMode: false,
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
    expect(screen.getByRole("button", { name: "Add CLI provider" })).toBeDisabled();
    selectAiProvider("Claude Code CLI");
    expect(screen.queryByRole("combobox", { name: "Reasoning" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Fast mode" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "sonnet" }));
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "claude-code-cli",
      model: "sonnet",
      reasoning: "medium",
      fastMode: false,
    }));
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
    };
    getAiSettingsMock.mockResolvedValue({ settings, providers: [provider] });
    saveOpenAiCompatibleProviderMock.mockResolvedValue({ settings, providers: [{ ...provider, baseUrl: "https://new.example.invalid/v1" }] });
    deleteAiProviderMock.mockResolvedValue({ settings: { ...settings, provider: null, providerInstanceId: null, model: "" }, providers: [] });
    render(<SettingsPage section="ai" />);

    expect(await screen.findByRole("combobox", { name: "Provider types" })).toHaveTextContent("API");
    fireEvent.click(screen.getByRole("button", { name: "Edit https://old.example.invalid/v1" }));
    fireEvent.change(screen.getByLabelText("API URL"), { target: { value: "https://new.example.invalid/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveOpenAiCompatibleProviderMock).toHaveBeenCalledWith({
      id: provider.instanceId,
      baseUrl: "https://new.example.invalid/v1",
      token: "",
      allowInsecureTls: false,
    }));
    await screen.findByRole("button", { name: "Delete https://new.example.invalid/v1" });
    fireEvent.click(screen.getByRole("button", { name: "Delete https://new.example.invalid/v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAiProviderMock).toHaveBeenCalledWith("openai-compatible", provider.instanceId));
    expect(await screen.findByRole("heading", { name: "No AI providers yet" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Not selected");
  });

  it("removes a CLI provider and enables adding it again", async () => {
    const cleared = { provider: null, model: "", reasoning: "medium" as const, fastMode: false };
    deleteAiProviderMock.mockResolvedValue({ settings: cleared, providers: [] });
    inspectAiCliProviderMock
      .mockResolvedValueOnce({ ...codexAiSettings.providers[0], status: "not_found", available: false, models: [], message: "Codex CLI was not found" })
      .mockResolvedValueOnce(codexAiSettings.providers[0]);
    render(<SettingsPage section="ai" />);

    await screen.findByRole("group", { name: "Codex CLI AI provider" });
    fireEvent.click(screen.getByRole("button", { name: "Delete Codex CLI" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAiProviderMock).toHaveBeenCalledWith("codex-cli", undefined));
    expect(await screen.findByRole("heading", { name: "No AI providers yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add CLI provider" }));
    expect(await screen.findByText("Codex CLI was not found on this computer.")).toBeInTheDocument();
    expect(screen.queryByText("CLI not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addAiCliProviderMock).toHaveBeenCalledWith("codex-cli"));
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
