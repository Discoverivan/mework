import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiSettings, listIntegrations, saveAiSettings, saveIntegration } from "./api";
import { SettingsPage } from "./SettingsPage";

vi.mock("./api", () => ({
  deleteIntegration: vi.fn(),
  getAiSettings: vi.fn(),
  listIntegrations: vi.fn(),
  refreshIntegrationHealth: vi.fn(),
  saveAiSettings: vi.fn(),
  saveIntegration: vi.fn(),
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
    saveAiSettingsMock.mockResolvedValue({
      ...codexAiSettings,
      settings: { ...codexAiSettings.settings, provider: "codex-cli" },
    });
    listIntegrationsMock.mockResolvedValue([]);
    saveIntegrationMock.mockResolvedValue({ status: "saved", integration: jiraIntegration });
  });

  it("does not block data integrations while AI settings are pending", async () => {
    getAiSettingsMock.mockImplementation(() => new Promise(() => {}));
    render(<SettingsPage />);

    expect(screen.getByRole("group", { name: "Codex CLI AI provider" })).toHaveTextContent("Loading…");
    expect(await screen.findByRole("heading", { name: "Data Integrations" })).toBeInTheDocument();
    expect(screen.queryByText("Loading integrations…")).not.toBeInTheDocument();
  });

  it("opens a provider form with URL and write-only personal access token", async () => {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "Integrations" });
    expect(screen.getByText("Settings")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jira" }));

    expect(screen.getByRole("textbox", { name: "Base URL" })).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account key")).not.toBeInTheDocument();
  });

  it("saves a new integration without returning the secret to the UI", async () => {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "Integrations" });
    expect(screen.getByText("Settings")).toBeInTheDocument();
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

  it("shows AI controls above AI and data integration cards and saves Codex settings", async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole("heading", { name: "AI" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Providers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Integrations" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Save AI settings" }));

    await waitFor(() => expect(saveAiSettingsMock).toHaveBeenCalledWith({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
    }));
  });
});
