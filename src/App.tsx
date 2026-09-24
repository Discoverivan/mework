import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AppShell, type AppSection } from "./components/layout/AppShell";
import { SplashScreen } from "./components/shared/SplashScreen";
import { UpdateBanner } from "./components/shared/UpdateBanner";
import { getBackgroundUpdateVersion } from "./components/shared/update-check";
import { AppRoutes, type AppRoute } from "./app/routes";
import { PresenterView } from "./features/daily/PresenterView";
import { DevOverlay } from "./features/dev/DevOverlay";
import { devOverlayEnabled } from "./features/dev/api";
import { getPullRequestUnreadCounts, refreshAuthoredPullRequests, refreshMyPullRequests } from "./features/developer/api";
import { listTaskTrackerMonitors } from "@/shared/contracts/task-tracker";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";
import { countUnreadTaskTrackerIssues, loadTaskTrackerReadCheckpoints, type TaskTrackerReadCheckpoints } from "./features/product/task-tracker-read-state";
import { refreshAllIntegrationsHealth } from "./features/settings/api";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n/context";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { startNativeEventBridge } from "@/app/native-event-bridge";
import "./App.css";
import "./presenter.css";
import "./daily-status.css";

const STARTUP_SPLASH_TIMEOUT_MS = 10_000;

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

function AppContent() {
  const { appearanceSaving, themePreference, updateAppearance } = useI18n();
  const initialRoute = routeFromHash(typeof window !== "undefined" ? window.location.hash : "");
  const [appVersion, setAppVersion] = useState<string | undefined>(() =>
    import.meta.env.DEV ? "dev" : undefined
  );
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [ready, setReady] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const [mockModeLoaded, setMockModeLoaded] = useState(false);
  const [unreadPullRequestCount, setUnreadPullRequestCount] = useState(0);
  const [unreadAuthoredPullRequestCount, setUnreadAuthoredPullRequestCount] = useState(0);
  const [taskTrackerMonitors, setTaskTrackerMonitors] = useState<TaskTrackerMonitor[]>([]);
  const [taskTrackerReadCheckpoints, setTaskTrackerReadCheckpoints] = useState<TaskTrackerReadCheckpoints>(
    () => loadTaskTrackerReadCheckpoints(),
  );
  const unreadTaskTrackerCount = countUnreadTaskTrackerIssues(taskTrackerMonitors, taskTrackerReadCheckpoints);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [updateCheckRequest, setUpdateCheckRequest] = useState(0);
  const [pendingUpdateCheck, setPendingUpdateCheck] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    void getVersion().then(setAppVersion).catch(() => {
      // Leave the release version hidden when the Tauri app plugin is unavailable.
    });
  }, []);

  useEffect(() => {
    let active = true;
    let stopBridge: (() => void) | undefined;
    const unsubscribeUpdateAvailability = subscribeAppEvent(
      APP_EVENT.updateAvailabilityChanged,
      (version) => {
        if (active) setAvailableUpdateVersion(version);
      },
    );
    void startNativeEventBridge().then((cleanup) => {
      if (!active) {
        cleanup();
        return;
      }
      stopBridge = cleanup;
    });
    return () => {
      active = false;
      unsubscribeUpdateAvailability();
      stopBridge?.();
    };
  }, []);

  useEffect(() => {
    if (!mockModeLoaded || mockMode) return;
    let active = true;
    void getBackgroundUpdateVersion()
      .then((version) => {
        if (active) setAvailableUpdateVersion(version);
      })
      .catch(() => {
        // The background result is optional; manual settings checks remain available.
      });
    return () => {
      active = false;
    };
  }, [mockMode, mockModeLoaded]);

  useEffect(() => {
    let active = true;
    const splashDeadline = window.setTimeout(() => {
      if (active) setReady(true);
    }, STARTUP_SPLASH_TIMEOUT_MS);

    const initialize = async () => {
      let isMockMode = false;
      if (import.meta.env.DEV) {
        try {
          isMockMode = await devOverlayEnabled();
        } catch {
          // Browser-only development falls back to the normal integration flow.
        }
      }
      if (!active) return;
      setMockMode(isMockMode);
      setMockModeLoaded(true);
      if (isMockMode) {
        window.clearTimeout(splashDeadline);
        setReady(true);
        return;
      }

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
        await Promise.allSettled([
          refreshMyPullRequests(0, 100),
          refreshAuthoredPullRequests(0, 100),
        ]);
        if (active) emitAppEvent(APP_EVENT.pullRequestActivityChanged);
      }

      if (active) {
        window.clearTimeout(splashDeadline);
        setReady(true);
      }
    };

    void initialize();
    return () => {
      active = false;
      window.clearTimeout(splashDeadline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let refreshRevision = 0;

    const refreshCachedCount = async () => {
      const revision = ++refreshRevision;
      try {
        const counts = await getPullRequestUnreadCounts();
        if (!active || revision !== refreshRevision) return;
        setUnreadPullRequestCount(counts.reviewer);
        setUnreadAuthoredPullRequestCount(counts.authored);
      } catch {
        // Keep the last known counts when the cached native read is temporarily unavailable.
      }
    };
    const invalidateCount = () => void refreshCachedCount();

    const unsubscribeActivity = subscribeAppEvent(APP_EVENT.pullRequestActivityChanged, invalidateCount);
    const unsubscribeReviewer = subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, invalidateCount);
    const unsubscribeAuthored = subscribeAppEvent(APP_EVENT.authoredPullRequestsUpdated, invalidateCount);
    void refreshCachedCount();

    return () => {
      active = false;
      refreshRevision += 1;
      unsubscribeActivity();
      unsubscribeReviewer();
      unsubscribeAuthored();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const applyMonitors = (monitors: TaskTrackerMonitor[]) => {
      revision += 1;
      setTaskTrackerMonitors(monitors);
    };
    const loadMonitors = async () => {
      const requestRevision = ++revision;
      try {
        const monitors = await listTaskTrackerMonitors();
        if (active && requestRevision === revision) setTaskTrackerMonitors(monitors);
      } catch {
        // The sidebar count is optional; Task Tracker reports its own loading errors.
      }
    };
    const unsubscribeMonitors = subscribeAppEvent(APP_EVENT.taskTrackerUpdated, applyMonitors);
    const unsubscribeReadState = subscribeAppEvent(APP_EVENT.taskTrackerReadStateChanged, ({ monitorId, checkpoint }) => {
      setTaskTrackerReadCheckpoints((current) => ({ ...current, [monitorId]: checkpoint }));
    });
    void loadMonitors();

    return () => {
      active = false;
      revision += 1;
      unsubscribeMonitors();
      unsubscribeReadState();
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (route !== "settings-general" || !pendingUpdateCheck) return;
    setPendingUpdateCheck(false);
    setUpdateCheckRequest((current) => current + 1);
  }, [pendingUpdateCheck, route]);

  function navigate(section: AppSection) {
    setRoute(section);
  }

  function openUpdateSettings() {
    setRoute("settings-general");
    setPendingUpdateCheck(true);
    if (window.location.hash !== "#settings/general") {
      window.location.hash = "#settings/general";
    }
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
          updateAvailableVersion={availableUpdateVersion}
          onOpenUpdateSettings={openUpdateSettings}
          onNavigate={navigate}
          activeSection={route}
          unreadPullRequestCount={unreadPullRequestCount}
          unreadAuthoredPullRequestCount={unreadAuthoredPullRequestCount}
          unreadTaskTrackerCount={unreadTaskTrackerCount}
        >
          <AppRoutes route={route} updateCheckRequest={updateCheckRequest} mockMode={mockMode} />
        </AppShell>
      ) : null}
      {import.meta.env.DEV && mockMode ? <DevOverlay /> : null}
      <SplashScreen visible={!ready} />
      <UpdateBanner enabled={ready && !import.meta.env.DEV && !mockMode} updateVersion={availableUpdateVersion} />
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
