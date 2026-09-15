import { IntegrationDependencyGate } from "../features/integrations/IntegrationDependencyGate";
import { CreateTaskPage } from "../features/product/CreateTaskPage";
import { DailyPage } from "../features/daily/DailyPage";
import { MyPullRequestsPage } from "../features/developer/MyPullRequestsPage";
import { AuthoredPullRequestsPage } from "../features/developer/AuthoredPullRequestsPage";
import { CommandBoardPage } from "../features/developer/CommandBoardPage";
import { SettingsPage } from "../features/settings/SettingsPage";

export type AppRoute =
  | "product-create-task"
  | "product-daily"
  | "product-daily-presenter"
  | "developer-pull-requests"
  | "developer-my-pull-requests"
  | "developer-command-board"
  | "settings-general"
  | "settings-integrations"
  | "settings-projects";

interface AppRoutesProps {
  route: AppRoute;
}

export function AppRoutes({ route }: AppRoutesProps) {
  if (route === "product-create-task") {
    return (
      <IntegrationDependencyGate requirement="jira" requireAiProvider>
        <CreateTaskPage />
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
  if (route === "settings-general" || route === "settings-integrations" || route === "settings-projects") {
    const section = route === "settings-general" ? "general" : route === "settings-projects" ? "projects" : "integrations";
    return <SettingsPage section={section} />;
  }

  return <SettingsPage section="integrations" />;
}
