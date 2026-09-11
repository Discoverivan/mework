import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listIntegrations } from "../settings/api";
import { IntegrationDependencyGate } from "./IntegrationDependencyGate";

vi.mock("../settings/api", () => ({ listIntegrations: vi.fn() }));

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

describe("IntegrationDependencyGate smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIntegrationsMock.mockResolvedValue([bitbucket]);
  });

  it("renders protected content when the required integration is working", async () => {
    render(
      <IntegrationDependencyGate requirement="bitbucket">
        <p>Pull Request Review</p>
      </IntegrationDependencyGate>,
    );

    expect(await screen.findByText("Pull Request Review")).toBeInTheDocument();
  });
});
