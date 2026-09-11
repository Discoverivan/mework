import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AiSettingsPageData, IntegrationRedacted } from "../shared/contracts/settings";
import App from "../App";

vi.mock("../features/settings/SettingsPage", () => ({
  SettingsPage: ({ section }: { section?: string }) => <h1>{section === "projects" ? "Team settings" : "Integrations"}</h1>,
}));

vi.mock("../features/planning/PlanningPage", () => ({
  PlanningPage: () => <h1>Planning</h1>,
}));

const { getAiSettingsMock, refreshAllIntegrationsHealthMock } = vi.hoisted(() => ({
  getAiSettingsMock: vi.fn().mockResolvedValue({
    settings: { provider: null, model: "", reasoning: "medium", fastMode: false },
    providers: [],
  }),
  refreshAllIntegrationsHealthMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("../features/settings/api", () => ({
  getAiSettings: getAiSettingsMock,
  listIntegrations: vi.fn().mockResolvedValue([
    {
      id: "jira-1",
      kind: "jira",
      baseUrl: "https://jira.example.com",
      accountKey: "account",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    },
  ]),
  refreshAllIntegrationsHealth: refreshAllIntegrationsHealthMock,
}));

describe("Mework application shell", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    getAiSettingsMock.mockClear();
    getAiSettingsMock.mockResolvedValue({
      settings: { provider: null, model: "", reasoning: "medium", fastMode: false },
      providers: [],
    });
    refreshAllIntegrationsHealthMock.mockClear();
  });

  it("keeps the splash visible until integration and AI checks settle", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    let resolveAi!: (value: AiSettingsPageData) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );
    getAiSettingsMock.mockImplementationOnce(
      () => new Promise<AiSettingsPageData>((resolve) => { resolveAi = resolve; }),
    );

    render(<App />);
    expect(screen.getByRole("status", { name: "Loading Mework" })).toBeInTheDocument();

    resolveHealth([]);
    await Promise.resolve();
    expect(screen.getByRole("status", { name: "Loading Mework" })).toBeInTheDocument();

    resolveAi({
      settings: { provider: null, model: "", reasoning: "medium", fastMode: false },
      providers: [],
    });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading Mework" })).not.toBeInTheDocument());
  });

  it("runs integration health checks when the app starts", async () => {
    render(<App />);

    await screen.findByRole("main", { name: "Mework" });
    expect(refreshAllIntegrationsHealthMock).toHaveBeenCalledOnce();
    expect(getAiSettingsMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "Loading Mework" })).not.toBeInTheDocument();
  });

});
