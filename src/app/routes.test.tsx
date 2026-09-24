import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AppRoutes } from "./routes";

vi.mock("../features/integrations/IntegrationDependencyGate", () => ({
  IntegrationDependencyGate: ({ children }: { children: React.ReactNode }) => <div data-testid="integration-gate">{children}</div>,
}));
vi.mock("../features/product/CreateTaskPage", () => ({ CreateTaskPage: () => <div>Create task screen</div> }));
vi.mock("../features/product/TaskTrackerPage", () => ({ TaskTrackerPage: () => <div>Task Tracker screen</div> }));
vi.mock("../features/daily/DailyPage", () => ({ DailyPage: () => <div>Daily screen</div> }));
vi.mock("../features/confluence/ConfluenceSearchPage", () => ({ ConfluenceSearchPage: () => <div>Confluence screen</div> }));
vi.mock("../features/developer/MyPullRequestsPage", () => ({ MyPullRequestsPage: () => <div>Reviewer pull requests screen</div> }));
vi.mock("../features/developer/AuthoredPullRequestsPage", () => ({ AuthoredPullRequestsPage: () => <div>Authored pull requests screen</div> }));
vi.mock("../features/developer/CommandBoardPage", () => ({ CommandBoardPage: () => <div>Command Board screen</div> }));
vi.mock("../features/settings/SettingsPage", () => ({ SettingsPage: ({ section }: { section: string }) => <div>{section} settings screen</div> }));

function renderRoutes(route: Parameters<typeof AppRoutes>[0]["route"]) {
  return render(<I18nProvider><AppRoutes route={route} mockMode /></I18nProvider>);
}

describe("AppRoutes mock mode", () => {
  it("makes every application screen accessible in mock mode without integration gates", () => {
    const cases = [
      ["product-create-task", "Create task screen"],
      ["product-task-tracker", "Task Tracker screen"],
      ["product-daily", "Daily screen"],
      ["product-confluence-search", "Confluence screen"],
      ["developer-pull-requests", "Reviewer pull requests screen"],
      ["developer-my-pull-requests", "Authored pull requests screen"],
      ["developer-command-board", "Command Board screen"],
      ["settings-general", "general settings screen"],
      ["settings-ai", "ai settings screen"],
      ["settings-integrations", "integrations settings screen"],
      ["settings-projects", "projects settings screen"],
    ] as const;

    for (const [route, expectedScreen] of cases) {
      const { unmount } = renderRoutes(route);
      expect(screen.getByText(expectedScreen), `${route} should be accessible`).toBeInTheDocument();
      expect(screen.queryByTestId("integration-gate")).not.toBeInTheDocument();
      unmount();
    }
  });
});
