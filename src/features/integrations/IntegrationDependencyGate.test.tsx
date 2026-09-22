import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiSettings, listIntegrations } from "../settings/api";
import { IntegrationDependencyGate } from "./IntegrationDependencyGate";

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

  it("retries a transient AI availability failure before rendering protected content", async () => {
    getAiSettingsMock
      .mockResolvedValueOnce({
        ...connectedAi,
        providers: [{ ...connectedAi.providers[0], status: "unavailable" as const, available: false, models: [] }],
      })
      .mockResolvedValueOnce(connectedAi);

    render(
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        <p>Pull Request Review</p>
      </IntegrationDependencyGate>,
    );

    expect(await screen.findByText("Pull Request Review")).toBeInTheDocument();
    expect(getAiSettingsMock).toHaveBeenCalledTimes(2);
  });

  it("blocks protected content when the selected AI provider is unavailable", async () => {
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
    expect(screen.queryByText("Pull Request Review")).not.toBeInTheDocument();
  });

  it("rechecks blocked content after a background health refresh event", async () => {
    listIntegrationsMock
      .mockResolvedValueOnce([{ ...bitbucket, healthStatus: "unavailable" as const }])
      .mockResolvedValueOnce([bitbucket]);

    render(
      <IntegrationDependencyGate requirement="bitbucket">
        <p>Pull Request Review</p>
      </IntegrationDependencyGate>,
    );

    expect(await screen.findByText("Dependencies required")).toBeInTheDocument();
    window.dispatchEvent(new Event("mework:integrations-health-refreshed"));
    expect(await screen.findByText("Pull Request Review")).toBeInTheDocument();
    expect(listIntegrationsMock).toHaveBeenCalledTimes(2);
  });
});
