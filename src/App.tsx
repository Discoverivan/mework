import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AppShell, type AppSection } from "./components/layout/AppShell";
import { SplashScreen } from "./components/shared/SplashScreen";
import { UpdateBanner } from "./components/shared/UpdateBanner";
import { AppRoutes, type AppRoute } from "./app/routes";
import { PresenterView } from "./features/daily/PresenterView";
import { listAuthoredPullRequests, listMyPullRequests, refreshMyPullRequests } from "./features/developer/api";
import type { MyPullRequestPage } from "./shared/contracts/developer";
import { refreshAllIntegrationsHealth } from "./features/settings/api";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n/context";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { startNativeEventBridge } from "@/app/native-event-bridge";
import "./App.css";
import "./presenter.css";
import "./daily-status.css";

function routeFromHash(hash: string): AppRoute {
  if (hash === "#product/create-task" || hash.startsWith("#product/create-task?")) return "product-create-task";
  if (hash === "#product/task-tracker") return "product-task-tracker";
  if (hash === "#product/daily") return "product-daily";
  if (hash === "#product/daily/presenter") return "product-daily-presenter";
  if (hash === "#product/confluence-search") return "product-confluence-search";
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
    let stopBridge: (() => void) | undefined;
    void startNativeEventBridge().then((cleanup) => {
      if (active) stopBridge = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      stopBridge?.();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      let integrations: Awaited<ReturnType<typeof refreshAllIntegrationsHealth>> = [];
      try {
        integrations = await refreshAllIntegrationsHealth();
        if (!active) return;
        emitAppEvent(APP_EVENT.integrationsHealthRefreshed, integrations);
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
    const unsubscribeActivity = subscribeAppEvent(
      APP_EVENT.pullRequestActivityChanged,
      () => void refreshCachedCount(),
    );
    const unsubscribeReviewer = subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, applyReviewerPage);
    const unsubscribeAuthored = subscribeAppEvent(APP_EVENT.authoredPullRequestsUpdated, applyAuthoredPage);

    return () => {
      active = false;
      unsubscribeActivity();
      unsubscribeReviewer();
      unsubscribeAuthored();
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
