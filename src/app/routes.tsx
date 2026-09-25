import { IntegrationDependencyGate } from "../features/integrations/IntegrationDependencyGate";
import { CreateTaskPage } from "../features/product/CreateTaskPage";
import { TaskTrackerPage } from "../features/product/TaskTrackerPage";
import { DailyPage } from "../features/daily/DailyPage";
import { MyPullRequestsPage } from "../features/developer/MyPullRequestsPage";
import { AuthoredPullRequestsPage } from "../features/developer/AuthoredPullRequestsPage";
import { CommandBoardPage } from "../features/developer/CommandBoardPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { StatisticsPage } from "../features/settings/statistics/StatisticsPage";
import { ConfluenceSearchPage } from "../features/confluence/ConfluenceSearchPage";

export type AppRoute =
  | "product-create-task"
  | "product-task-tracker"
  | "product-daily"
  | "product-daily-presenter"
  | "product-confluence-search"
  | "developer-pull-requests"
  | "developer-my-pull-requests"
  | "developer-command-board"
  | "settings-general"
  | "settings-ai"
  | "settings-integrations"
  | "settings-projects"
  | "settings-statistics";

interface AppRoutesProps {
  route: AppRoute;
  updateCheckRequest?: number;
  mockMode?: boolean;
}

export function AppRoutes({ route, updateCheckRequest = 0, mockMode = false }: AppRoutesProps) {
  if (mockMode) {
    if (route === "product-task-tracker") return <TaskTrackerPage mockMode />;
    if (route === "developer-pull-requests") return <MyPullRequestsPage />;
    if (route === "developer-my-pull-requests") return <AuthoredPullRequestsPage />;
  }

  if (route === "product-create-task") {
    const page = <CreateTaskPage />;
    return mockMode ? page : (
      <IntegrationDependencyGate requirement="jira" requireAiProvider>
        {page}
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-task-tracker") {
    const page = <TaskTrackerPage />;
    return mockMode ? page : (
      <IntegrationDependencyGate requirement="jira">
        {page}
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-daily") {
    const page = <DailyPage />;
    return mockMode ? page : (
      <IntegrationDependencyGate requirement="jira" requireAiProvider>
        {page}
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-confluence-search") {
    const page = <ConfluenceSearchPage />;
    return mockMode ? page : (
      <IntegrationDependencyGate requirement="confluence">
        {page}
      </IntegrationDependencyGate>
    );
  }

  if (route === "developer-pull-requests") {
    const page = <MyPullRequestsPage />;
    return mockMode ? page : (
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        {page}
      </IntegrationDependencyGate>
    );
  }

  if (route === "developer-my-pull-requests") {
    const page = <AuthoredPullRequestsPage />;
    return mockMode ? page : (
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        {page}
      </IntegrationDependencyGate>
    );
  }
  if (route === "developer-command-board") return <CommandBoardPage />;
  if (route === "settings-statistics") return <StatisticsPage />;
  if (route === "settings-general" || route === "settings-ai" || route === "settings-integrations" || route === "settings-projects") {
    const section = route === "settings-general" ? "general" : route === "settings-ai" ? "ai" : route === "settings-projects" ? "projects" : "integrations";
    return <SettingsPage section={section} updateCheckRequest={updateCheckRequest} />;
  }

  return <SettingsPage section="integrations" />;
}
