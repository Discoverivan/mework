import { IntegrationDependencyGate } from "../features/integrations/IntegrationDependencyGate";
import { CreateTaskPage } from "../features/product/CreateTaskPage";
import { TaskTrackerPage } from "../features/product/TaskTrackerPage";
import { DailyPage } from "../features/daily/DailyPage";
import { MyPullRequestsPage } from "../features/developer/MyPullRequestsPage";
import { AuthoredPullRequestsPage } from "../features/developer/AuthoredPullRequestsPage";
import { CommandBoardPage } from "../features/developer/CommandBoardPage";
import { SettingsPage } from "../features/settings/SettingsPage";
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
  | "settings-projects";

interface AppRoutesProps {
  route: AppRoute;
  updateCheckRequest?: number;
}

export function AppRoutes({ route, updateCheckRequest = 0 }: AppRoutesProps) {
  if (route === "product-create-task") {
    return (
      <IntegrationDependencyGate requirement="jira" requireAiProvider>
        <CreateTaskPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-task-tracker") {
    return (
      <IntegrationDependencyGate requirement="jira">
        <TaskTrackerPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-daily") {
    return (
      <IntegrationDependencyGate requirement="jira" requireAiProvider>
        <DailyPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-confluence-search") {
    return (
      <IntegrationDependencyGate requirement="confluence">
        <ConfluenceSearchPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "developer-pull-requests") {
    return (
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        <MyPullRequestsPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "developer-my-pull-requests") {
    return (
      <IntegrationDependencyGate requirement="bitbucket" requireAiProvider>
        <AuthoredPullRequestsPage />
      </IntegrationDependencyGate>
    );
  }
  if (route === "developer-command-board") {
    return <CommandBoardPage />;
  }
  if (route === "settings-general" || route === "settings-ai" || route === "settings-integrations" || route === "settings-projects") {
    const section = route === "settings-general" ? "general" : route === "settings-ai" ? "ai" : route === "settings-projects" ? "projects" : "integrations";
    return <SettingsPage section={section} updateCheckRequest={updateCheckRequest} />;
  }

  return <SettingsPage section="integrations" />;
}
