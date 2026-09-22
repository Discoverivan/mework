import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { AppShell, type AppSection } from "./components/layout/AppShell";
import { SplashScreen } from "./components/shared/SplashScreen";
import { UpdateBanner } from "./components/shared/UpdateBanner";
import { AppRoutes, type AppRoute } from "./app/routes";
import { PresenterView } from "./features/daily/PresenterView";
import { listAuthoredPullRequests, listMyPullRequests, refreshMyPullRequests } from "./features/developer/api";
import type { MyPullRequestPage } from "./shared/contracts/developer";
import type { IntegrationRedacted } from "./shared/contracts/settings";
import { refreshAllIntegrationsHealth } from "./features/settings/api";
import { INTEGRATIONS_HEALTH_REFRESHED_EVENT } from "./features/settings/health-events";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n/context";
import "./App.css";
import "./presenter.css";
import "./daily-status.css";

const PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT = "pull_request_review_activity_changed";
const AUTHORED_PULL_REQUESTS_UPDATED_EVENT = "my_pull_requests_updated";

function routeFromHash(hash: string): AppRoute {
  if (hash === "#product/create-task" || hash.startsWith("#product/create-task?")) return "product-create-task";
  if (hash === "#product/daily") return "product-daily";
  if (hash === "#product/daily/presenter") return "product-daily-presenter";
  if (hash === "#developer/pull-requests") return "developer-pull-requests";
  if (hash === "#developer/my-pull-requests") return "developer-my-pull-requests";
  if (hash === "#developer/command-board") return "developer-command-board";
  if (hash === "#settings/general") return "settings-general";
  if (hash === "#settings/ai") return "settings-ai";
  if (hash === "#settings/projects") return "settings-projects";
  if (hash === "#settings" || hash === "#settings/integrations") return "settings-integrations";
  return "developer-pull-requests";
}

function unreadCount(page: MyPullRequestPage): number {
  return page.values.filter((pullRequest) => pullRequest.activity !== "read").length;
}

function AppContent() {
  const { appearanceSaving, themePreference, updateAppearance } = useI18n();
  const initialRoute = routeFromHash(typeof window !== "undefined" ? window.location.hash : "");
  const [appVersion, setAppVersion] = useState<string | undefined>(() =>
    import.meta.env.DEV ? "dev" : undefined
  );
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [ready, setReady] = useState(false);
  const [unreadPullRequestCount, setUnreadPullRequestCount] = useState(0);
  const [unreadAuthoredPullRequestCount, setUnreadAuthoredPullRequestCount] = useState(0);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    void getVersion().then(setAppVersion).catch(() => {
      // Leave the release version hidden when the Tauri app plugin is unavailable.
    });
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<IntegrationRedacted[]>("integrations_health_refreshed", (event) => {
      window.dispatchEvent(
        new CustomEvent(INTEGRATIONS_HEALTH_REFRESHED_EVENT, { detail: event.payload }),
      );
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => {
      // The event bridge is unavailable in non-Tauri test environments.
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      let integrations: Awaited<ReturnType<typeof refreshAllIntegrationsHealth>> = [];
      try {
        integrations = await refreshAllIntegrationsHealth();
        if (!active) return;
        window.dispatchEvent(
          new CustomEvent(INTEGRATIONS_HEALTH_REFRESHED_EVENT, { detail: integrations }),
        );
      } catch {
        // The route gate will show the dependency error after the splash settles.
      }

      if (active && integrations.some((integration) =>
        integration.kind === "bitbucket"
          && integration.enabled
          && integration.healthStatus === "working"
      )) {
        const [reviewerResult, authoredResult] = await Promise.allSettled([
          refreshMyPullRequests(0, 100),
          listAuthoredPullRequests(0, 100),
        ]);
        if (!active) return;
        if (reviewerResult.status === "fulfilled") {
          setUnreadPullRequestCount(unreadCount(reviewerResult.value));
        }
        if (authoredResult.status === "fulfilled") {
          setUnreadAuthoredPullRequestCount(unreadCount(authoredResult.value));
        }
      }

      if (active) setReady(true);
    };

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlistenReviewer: (() => void) | undefined;
    let unlistenAuthored: (() => void) | undefined;

    const applyReviewerPage = (page: MyPullRequestPage) => {
      if (active) setUnreadPullRequestCount(unreadCount(page));
    };
    const applyAuthoredPage = (page: MyPullRequestPage) => {
      if (active) setUnreadAuthoredPullRequestCount(unreadCount(page));
    };
    const refreshCachedCount = async () => {
      const [reviewerResult, authoredResult] = await Promise.allSettled([
        listMyPullRequests(0, 100),
        listAuthoredPullRequests(0, 100),
      ]);
      if (!active) return;
      if (reviewerResult.status === "fulfilled") applyReviewerPage(reviewerResult.value);
      if (authoredResult.status === "fulfilled") applyAuthoredPage(authoredResult.value);
    };

    void refreshCachedCount();
    const onActivityChanged = () => void refreshCachedCount();
    window.addEventListener(PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT, onActivityChanged);
    void listen<MyPullRequestPage>("pull_request_review_updated", (event) => applyReviewerPage(event.payload))
      .then((cleanup) => {
        if (active) unlistenReviewer = cleanup;
        else cleanup();
      })
      .catch(() => {
        // The event bridge is unavailable in non-Tauri test environments.
      });
    void listen<MyPullRequestPage>(AUTHORED_PULL_REQUESTS_UPDATED_EVENT, (event) => applyAuthoredPage(event.payload))
      .then((cleanup) => {
        if (active) unlistenAuthored = cleanup;
        else cleanup();
      })
      .catch(() => {
        // The event bridge is unavailable in non-Tauri test environments.
      });

    return () => {
      active = false;
      window.removeEventListener(PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT, onActivityChanged);
      unlistenReviewer?.();
      unlistenAuthored?.();
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(section: AppSection) {
    setRoute(section);
  }

  if (route === "product-daily-presenter") {
    return <PresenterView />;
  }

  return (
    <>
      {ready ? (
        <AppShell
          themePreference={themePreference}
          themeChanging={appearanceSaving}
          onThemeChange={(theme) => {
            void updateAppearance({ themePreference: theme }).catch(() => undefined);
          }}
          version={appVersion}
          onNavigate={navigate}
          activeSection={route}
          unreadPullRequestCount={unreadPullRequestCount}
          unreadAuthoredPullRequestCount={unreadAuthoredPullRequestCount}
        >
          <AppRoutes route={route} />
        </AppShell>
      ) : null}
      <SplashScreen visible={!ready} />
      <UpdateBanner enabled={ready && !import.meta.env.DEV} />
    </>
  );
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;
