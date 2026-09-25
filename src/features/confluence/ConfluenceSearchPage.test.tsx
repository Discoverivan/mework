import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
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

    const scope = await screen.findByRole("combobox", { name: "Search scope" });
    expect(screen.getByRole("heading", { name: "Knowledge search" })).toBeInTheDocument();
    expect(screen.getByText("Search scope").closest("label")).toHaveClass("pl-1");
    expect(screen.getByText("Search query").closest("label")).toHaveClass("pl-1");
    expect(scope).toHaveClass("appearance-none", "pr-9");
    expect(scope.nextElementSibling).toHaveClass("right-2");
    fireEvent.change(screen.getByRole("textbox", { name: "Search query" }), {
      target: { value: "release notes" },
    });
    const searchButton = screen.getByRole("button", { name: "Search" });
    expect(searchButton).toHaveAttribute("title", "Search");
    expect(searchButton).not.toHaveTextContent("Search");
    fireEvent.click(searchButton);

    await waitFor(() => expect(searchConfluenceMock).toHaveBeenCalledWith("confluence-1", "release notes", 20, "DOCS"));
    expect(await screen.findByText("Example release notes")).toBeInTheDocument();
    expect(screen.getByText("A synthetic search result.")).toBeInTheDocument();
    const openPageButton = screen.getByRole("button", { name: "Open page" });
    expect(openPageButton).toHaveAttribute("title", "Open page");
    expect(openPageButton).not.toHaveTextContent("Open page");
    fireEvent.click(openPageButton);
    expect(openUrl).toHaveBeenCalledWith("https://confluence.example.invalid/pages/viewpage.action?pageId=10001");
  });

  it("shows a structured integration error message", async () => {
    searchConfluenceMock.mockRejectedValue({
      code: "permission_denied",
      message: "Confluence access was denied",
      retryable: false,
      details: { provider: "confluence", operation: "search", method: "GET", endpoint: "/rest/api/search", httpStatus: 403 },
    });
    render(<ConfluenceSearchPage />);
    await screen.findByRole("combobox", { name: "Search scope" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search query" }), { target: { value: "release notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Unable to search Confluence: Confluence access was denied/)).toBeInTheDocument();
  });
});
