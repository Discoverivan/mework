import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveIntegration } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("settings integration API smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({ id: "jira-1", kind: "jira", baseUrl: "https://jira.example.com" });
  });

  it("sends the typed integration save request without expecting a secret response", async () => {
    const result = await saveIntegration({
      kind: "jira",
      baseUrl: "https://jira.example.com",
      secret: "write-only-secret",
      enabled: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("integration_save", {
      request: {
        kind: "jira",
        baseUrl: "https://jira.example.com",
        secret: "write-only-secret",
        enabled: true,
      },
    });
    expect(result).not.toHaveProperty("secret");
  });
});
