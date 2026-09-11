import { IntegrationDependencyGate } from "../features/integrations/IntegrationDependencyGate";
import { InboxPage } from "../features/inbox/InboxPage";
import { CreateTaskPage } from "../features/product/CreateTaskPage";
import { DailyPage } from "../features/daily/DailyPage";
import { MyPullRequestsPage } from "../features/developer/MyPullRequestsPage";
import { PlanningPage } from "../features/planning/PlanningPage";
import { SettingsPage } from "../features/settings/SettingsPage";

export type AppRoute = "inbox" | "product-create-task" | "product-planning" | "product-daily" | "product-daily-presenter" | "developer-pull-requests" | "settings-general" | "settings-integrations" | "settings-projects";

interface AppRoutesProps {
  route: AppRoute;
}

export function AppRoutes({ route }: AppRoutesProps) {
  if (route === "product-create-task") {
    return <CreateTaskPage />;
  }

  if (route === "product-planning") {
    return (
      <IntegrationDependencyGate requirement="jira">
        <PlanningPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "product-daily") {
    return (
      <IntegrationDependencyGate requirement="jira">
        <DailyPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "developer-pull-requests") {
    return (
      <IntegrationDependencyGate requirement="bitbucket">
        <MyPullRequestsPage />
      </IntegrationDependencyGate>
    );
  }

  if (route === "settings-general" || route === "settings-integrations" || route === "settings-projects") {
    const section = route === "settings-general" ? "general" : route === "settings-projects" ? "projects" : "integrations";
    return <SettingsPage section={section} />;
  }

  return (
    <IntegrationDependencyGate requirement="any">
      <InboxPage />
    </IntegrationDependencyGate>
  );
}
