import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listIntegrations } from "@/features/settings/api";
import { listManagedProjects } from "@/features/settings/planning-projects/api";
import { searchConfluence } from "./api";
import { ConfluenceSearchPage } from "./ConfluenceSearchPage";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/settings/api", () => ({ listIntegrations: vi.fn() }));
vi.mock("@/features/settings/planning-projects/api", () => ({ listManagedProjects: vi.fn() }));
vi.mock("./api", () => ({ searchConfluence: vi.fn() }));

const listIntegrationsMock = vi.mocked(listIntegrations);
const searchConfluenceMock = vi.mocked(searchConfluence);
const listManagedProjectsMock = vi.mocked(listManagedProjects);

describe("ConfluenceSearchPage smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listIntegrationsMock.mockResolvedValue([{
      id: "confluence-1",
      kind: "confluence",
      baseUrl: "https://confluence.example.invalid",
      enabled: true,
      healthStatus: "working",
      capabilities: { deployment: "data_center" },
    }]);
    listManagedProjectsMock.mockResolvedValue([{
      id: "team-1",
      integrationId: "jira-1",
      projectId: "10001",
      projectKey: "DEMO",
      projectName: "Example team",
      confluenceSpace: {
        integrationId: "confluence-1",
        spaceId: "20001",
        spaceKey: "DOCS",
        spaceName: "Example team space",
      },
      enabled: true,
      epicLinkJql: "",
    }]);
    searchConfluenceMock.mockResolvedValue({
      integrationId: "confluence-1",
      results: [{
        id: "10001",
        title: "Example release notes",
        contentType: "page",
        spaceName: "Example space",
        excerpt: "A synthetic search result.",
        url: "https://confluence.example.invalid/pages/viewpage.action?pageId=10001",
        lastModified: "2026-09-20T12:00:00.000Z",
      }],
    });
  });

  it("searches the connected Confluence integration and renders a page result", async () => {
    render(<ConfluenceSearchPage />);

    await waitFor(() => expect(listIntegrationsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Search query" }), {
      target: { value: "release notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(searchConfluenceMock).toHaveBeenCalledWith("confluence-1", "release notes", 20, "DOCS"));
    expect(await screen.findByText("Example release notes")).toBeInTheDocument();
    expect(screen.getByText("A synthetic search result.")).toBeInTheDocument();
  });
});
