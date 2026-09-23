import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiSettings, listIntegrations } from "../settings/api";
import { IntegrationDependencyGate } from "./IntegrationDependencyGate";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";

vi.mock("../settings/api", () => ({
  getAiSettings: vi.fn(),
  listIntegrations: vi.fn(),
}));

const getAiSettingsMock = vi.mocked(getAiSettings);
const listIntegrationsMock = vi.mocked(listIntegrations);

const bitbucket = {
  id: "bitbucket-1",
  kind: "bitbucket" as const,
  baseUrl: "https://bitbucket.example.com",
  accountKey: "account",
  enabled: true,
  healthStatus: "working" as const,
  capabilities: [],
};

const connectedAi = {
  settings: { provider: "codex-cli" as const, model: "sample-model", reasoning: "medium" as const, fastMode: false },
  providers: [{ id: "codex-cli" as const, name: "Codex CLI", status: "connected" as const, available: true, models: ["sample-model"] }],
};

describe("IntegrationDependencyGate smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIntegrationsMock.mockResolvedValue([bitbucket]);
    getAiSettingsMock.mockResolvedValue(connectedAi);
  });

  it("links to AI settings when an AI dependency check fails", async () => {
    getAiSettingsMock.mockResolvedValue({
      ...connectedAi,
      providers: [{ ...connectedAi.providers[0], status: "unavailable" as const, available: false, models: [] }],
    });

    render(
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        <p>Pull Request Review</p>
      </IntegrationDependencyGate>,
    );

    expect(await screen.findByText("Unable to check dependencies")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Data integrations" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI settings" })).toHaveAttribute("href", "#settings/ai");
    expect(getAiSettingsMock).toHaveBeenCalledTimes(2);

    getAiSettingsMock.mockResolvedValue(connectedAi);
    emitAppEvent(APP_EVENT.aiSettingsChanged, connectedAi);
    expect(await screen.findByText("Pull Request Review")).toBeInTheDocument();
  });

  it("shows both settings links when integration and AI are unavailable", async () => {
    listIntegrationsMock.mockResolvedValue([{ ...bitbucket, healthStatus: "unavailable" as const }]);
    getAiSettingsMock.mockResolvedValue({
      settings: { provider: null, model: "", reasoning: "medium", fastMode: false },
      providers: [],
    });

    render(
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        <p>Pull Request Review</p>
      </IntegrationDependencyGate>,
    );

    expect(await screen.findByText("Dependencies required")).toBeInTheDocument();
    expect(screen.getByText(/connected AI provider with an available model/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data integrations" })).toHaveAttribute("href", "#settings/integrations");
    expect(screen.getByRole("link", { name: "AI settings" })).toHaveAttribute("href", "#settings/ai");
    expect(screen.queryByText("Pull Request Review")).not.toBeInTheDocument();
  });

  it("links to integrations after its check fails and rechecks on a health event", async () => {
    listIntegrationsMock
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce([bitbucket]);

    render(
      <IntegrationDependencyGate requirement="bitbucket">
        <p>Pull Request Review</p>
      </IntegrationDependencyGate>,
    );

    expect(await screen.findByText("Unable to check dependencies")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data integrations" })).toHaveAttribute("href", "#settings/integrations");
    expect(screen.queryByRole("link", { name: "AI settings" })).not.toBeInTheDocument();
    emitAppEvent(APP_EVENT.integrationsHealthRefreshed, [bitbucket]);
    expect(await screen.findByText("Pull Request Review")).toBeInTheDocument();
    expect(listIntegrationsMock).toHaveBeenCalledTimes(2);
  });
});
