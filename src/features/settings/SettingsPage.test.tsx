import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiSettings, listIntegrations, saveAiSettings, saveIntegration, saveOpenAiCompatibleProvider } from "./api";
import { SettingsPage } from "./SettingsPage";

vi.mock("./api", () => ({
  deleteIntegration: vi.fn(),
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
const listIntegrationsMock = vi.mocked(listIntegrations);
const saveAiSettingsMock = vi.mocked(saveAiSettings);
const saveIntegrationMock = vi.mocked(saveIntegration);
const saveOpenAiCompatibleProviderMock = vi.mocked(saveOpenAiCompatibleProvider);

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

const openAiAiSettings = {
  settings: {
    provider: "openai-compatible" as const,
    model: "example-model",
    reasoning: "medium" as const,
    fastMode: false,
  },
  providers: [
    ...codexAiSettings.providers,
    {
      id: "openai-compatible" as const,
      name: "OpenAI-compatible API",
      status: "connected" as const,
      available: true,
      models: ["example-model", "example-fast-model"],
      baseUrl: "https://api.example.invalid/v1",
    },
  ],
};

describe("SettingsPage integrations smoke tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiSettingsMock.mockResolvedValue(codexAiSettings);
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

    fireEvent.change(screen.getByRole("combobox", { name: "AI provider" }), {
      target: { value: "codex-cli" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "gpt-5.5" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "high" },
    });
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
    fireEvent.change(screen.getByRole("combobox", { name: "AI provider" }), {
      target: { value: "openai-compatible" },
    });

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("example-model");
    expect(screen.queryByText("No available model selected.")).not.toBeInTheDocument();
    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "openai-compatible",
      model: "example-model",
      reasoning: "medium",
      fastMode: false,
    }));
  });

  it("configures the OpenAI-compatible API and exposes API models for selection", async () => {
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
    saveOpenAiCompatibleProviderMock.mockResolvedValue(openAiAiSettings);
    render(<SettingsPage section="ai" />);

    expect(await screen.findByRole("group", { name: "OpenAI-compatible API AI provider" })).toHaveTextContent("Not configured");
    fireEvent.click(screen.getByRole("button", { name: "OpenAI-compatible API" }));
    expect(screen.getByRole("heading", { name: "OpenAI-compatible API" })).toBeInTheDocument();
    expect(screen.queryByText("Static models")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add model" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("API URL"), {
      target: { value: "https://api.example.invalid/v1" },
    });
    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "synthetic-token" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Allow insecure TLS/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveOpenAiCompatibleProviderMock).toHaveBeenCalledWith({
      baseUrl: "https://api.example.invalid/v1",
      token: "synthetic-token",
      allowInsecureTls: true,
    }));
    expect(await screen.findByRole("group", { name: "OpenAI-compatible API AI provider" })).toHaveTextContent("Connected");
    expect(screen.queryByLabelText("Token")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "AI provider" })).toHaveTextContent("OpenAI-compatible API");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("example-model");
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

    await screen.findByRole("group", { name: "OpenAI-compatible API AI provider" });
    fireEvent.click(screen.getByRole("button", { name: "OpenAI-compatible API" }));
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
