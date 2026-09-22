import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { IntegrationRedacted } from "../shared/contracts/settings";
import App from "../App";

vi.mock("../features/settings/SettingsPage", () => ({
  SettingsPage: ({ section }: { section?: string }) => <h1>{section === "projects" ? "Team settings" : section === "ai" ? "AI settings" : section === "general" ? "General" : "Data integrations"}</h1>,
}));

vi.mock("../features/developer/MyPullRequestsPage", () => ({
  MyPullRequestsPage: () => <h1>Pull requests awaiting your review</h1>,
}));

vi.mock("../features/developer/AuthoredPullRequestsPage", () => ({
  AuthoredPullRequestsPage: () => <h1>Pull requests authored by you</h1>,
}));
const { getAiSettingsMock, listAuthoredPullRequestsMock, listMyPullRequestsMock, refreshMyPullRequestsMock, refreshAllIntegrationsHealthMock, nativeThemeMock, onThemeChangedMock } = vi.hoisted(() => ({
  getAiSettingsMock: vi.fn().mockResolvedValue({
    settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
    providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["gpt-5.5"] }],
  }),
  listMyPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  listAuthoredPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  refreshMyPullRequestsMock: vi.fn().mockResolvedValue({ values: [], total: 0, hasMore: false }),
  refreshAllIntegrationsHealthMock: vi.fn().mockResolvedValue([]),
  nativeThemeMock: vi.fn().mockResolvedValue("dark"),
  onThemeChangedMock: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ theme: nativeThemeMock, onThemeChanged: onThemeChangedMock }),
}));

vi.mock("../features/developer/api", () => ({
  listAuthoredPullRequests: listAuthoredPullRequestsMock,
  listMyPullRequests: listMyPullRequestsMock,
  refreshMyPullRequests: refreshMyPullRequestsMock,
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
    {
      id: "bitbucket-1",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.com",
      accountKey: "account",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    },
  ]),
  refreshAllIntegrationsHealth: refreshAllIntegrationsHealthMock,
}));

describe("MeWork application shell", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    getAiSettingsMock.mockClear();
    getAiSettingsMock.mockResolvedValue({
      settings: { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium", fastMode: false },
      providers: [{ id: "codex-cli", name: "Codex CLI", status: "connected", available: true, models: ["gpt-5.5"] }],
    });
    listMyPullRequestsMock.mockClear();
    listMyPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    listAuthoredPullRequestsMock.mockClear();
    listAuthoredPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    refreshMyPullRequestsMock.mockClear();
    refreshMyPullRequestsMock.mockResolvedValue({ values: [], total: 0, hasMore: false });
    refreshAllIntegrationsHealthMock.mockClear();
    nativeThemeMock.mockReset();
    nativeThemeMock.mockResolvedValue("dark");
    onThemeChangedMock.mockReset();
    onThemeChangedMock.mockResolvedValue(vi.fn());
  });

  it("keeps the splash visible until integration checks settle", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );

    render(<App />);
    expect(screen.getByRole("status", { name: "Loading MeWork" })).toBeInTheDocument();

    resolveHealth([]);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading MeWork" })).not.toBeInTheDocument());
  });

  it("waits for the initial Bitbucket refresh before showing the main UI", async () => {
    let resolveHealth!: (value: IntegrationRedacted[]) => void;
    let resolveRefresh!: (value: { values: never[]; total: number; hasMore: boolean }) => void;
    refreshAllIntegrationsHealthMock.mockImplementationOnce(
      () => new Promise<IntegrationRedacted[]>((resolve) => { resolveHealth = resolve; }),
    );
    refreshMyPullRequestsMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
    );

    render(<App />);
    expect(screen.getByRole("status", { name: "Loading MeWork" })).toBeInTheDocument();
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("main", { name: "MeWork" })).not.toBeInTheDocument();

    resolveHealth([{
      id: "bitbucket-1",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.com",
      enabled: true,
      healthStatus: "working",
      capabilities: [],
    }]);
    await waitFor(() => expect(refreshMyPullRequestsMock).toHaveBeenCalledWith(0, 100));
    expect(screen.queryByRole("main", { name: "MeWork" })).not.toBeInTheDocument();

    resolveRefresh({ values: [], total: 0, hasMore: false });
    expect(await screen.findByRole("main", { name: "MeWork" })).toBeInTheDocument();
  });

  it("opens pull requests awaiting your review by default", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Pull requests awaiting your review" })).toBeInTheDocument();
  });

  it("uses the native window theme for the system theme indicator", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(<App />);

    await screen.findByRole("main", { name: "MeWork" });
    const themePicker = screen.getByRole("combobox", { name: "Theme" });
    await waitFor(() => expect(themePicker.querySelector("svg.lucide-moon")).not.toBeNull());
    expect(themePicker.querySelector("svg.lucide-sun")).toBeNull();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("opens My Pull Requests from its dedicated hash route", async () => {
    render(<App />);
    await screen.findByRole("main", { name: "MeWork" });

    window.location.hash = "#developer/my-pull-requests";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByRole("heading", { name: "Pull requests authored by you" })).toBeInTheDocument();
  });

  it("opens AI settings from its dedicated hash route", async () => {
    window.location.hash = "#settings/ai";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "AI settings" })).toBeInTheDocument();
  });

  it("shows unread authored pull requests on the My Pull Requests navigation item", async () => {
    listAuthoredPullRequestsMock.mockResolvedValueOnce({
      values: [{ activity: "updated" }],
      total: 1,
      hasMore: false,
    });

    render(<App />);

    await screen.findByRole("main", { name: "MeWork" });
    expect(await screen.findByRole("link", { name: "Your PRs, 1 unread" })).toHaveAttribute(
      "href",
      "#developer/my-pull-requests",
    );
    expect(refreshMyPullRequestsMock).not.toHaveBeenCalled();
  });

  it("runs integration health checks when the app starts", async () => {
    render(<App />);

    await screen.findByRole("main", { name: "MeWork" });
    expect(refreshAllIntegrationsHealthMock).toHaveBeenCalledOnce();
    expect(getAiSettingsMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "Loading MeWork" })).not.toBeInTheDocument();
  });
});
