import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { AppShell, type AppSection } from "./components/layout/AppShell";
import { SplashScreen } from "./components/shared/SplashScreen";
import { UpdateBanner } from "./components/shared/UpdateBanner";
import { ReleaseNotesDialog } from "./components/shared/ReleaseNotesDialog";
import { StatusToast } from "./components/shared/StatusToast";
import { getBackgroundUpdateState } from "./components/shared/update-check";
import { getReleaseNotesState, listUpdateReleaseNotesVersions, loadReleaseNoteVersion, markReleaseNotesSeen, prefetchOlderReleaseNotes, type ReleaseNote } from "./release-notes";
import { mockReleaseNotes } from "./release-notes/mock";
import { AppRoutes, type AppRoute } from "./app/routes";
import { PresenterView } from "./features/daily/PresenterView";
import { DevOverlay } from "./features/dev/DevOverlay";
import { devOverlayEnabled } from "./features/dev/api";
import { getPullRequestUnreadCounts, refreshAuthoredPullRequests, refreshMyPullRequests } from "./features/developer/api";
import { listTaskTrackerMonitors } from "@/shared/contracts/task-tracker";
import type { TaskTrackerMonitor } from "@/shared/contracts/task-tracker";
import { EMPTY_UPDATE_AVAILABILITY, type UpdateAvailabilitySnapshot } from "@/shared/contracts/updates";
import { countUnreadTaskTrackerIssues, loadTaskTrackerReadCheckpoints, type TaskTrackerReadCheckpoints } from "./features/product/task-tracker-read-state";
import { refreshAllIntegrationsHealth } from "./features/settings/api";
import { generalSettings } from "./features/settings/general/api";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useI18n } from "@/i18n/context";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { startNativeEventBridge } from "@/app/native-event-bridge";
import { setAppBadgeCount } from "./app/app-badge";
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
  if (hash === "#developer/model-testing") return "developer-model-testing";
  if (hash === "#settings/general") return "settings-general";
  if (hash === "#settings/application-info") return "settings-application-info";
  if (hash === "#settings/ai" || hash.startsWith("#settings/ai?")) return "settings-ai";
  if (hash === "#settings/projects") return "settings-projects";
  if (hash === "#settings/statistics") return "settings-statistics";
  if (hash === "#settings" || hash === "#settings/integrations") return "settings-integrations";
  return "developer-pull-requests";
}

function AppContent() {
  const { appearanceSaving, themePreference, updateAppearance, language, t } = useI18n();
  const noteLanguage = language === "russian" ? "ru" : "en";
  const initialRoute = routeFromHash(typeof window !== "undefined" ? window.location.hash : "");
  const [appVersion, setAppVersion] = useState<string | undefined>(() =>
    import.meta.env.DEV ? "dev" : undefined
  );
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [ready, setReady] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const [mockModeLoaded, setMockModeLoaded] = useState(false);
  const [modelTestingEnabled, setModelTestingEnabled] = useState(false);
  const [modelTestingPreferenceLoaded, setModelTestingPreferenceLoaded] = useState(false);
  const [unreadPullRequestCount, setUnreadPullRequestCount] = useState(0);
  const [unreadAuthoredPullRequestCount, setUnreadAuthoredPullRequestCount] = useState(0);
  const [taskTrackerMonitors, setTaskTrackerMonitors] = useState<TaskTrackerMonitor[]>([]);
  const [taskTrackerReadCheckpoints, setTaskTrackerReadCheckpoints] = useState<TaskTrackerReadCheckpoints>(
    () => loadTaskTrackerReadCheckpoints(),
  );
  const unreadTaskTrackerCount = countUnreadTaskTrackerIssues(taskTrackerMonitors, taskTrackerReadCheckpoints);
  const unreadAppBadgeCount = unreadPullRequestCount + unreadAuthoredPullRequestCount + unreadTaskTrackerCount;
  const [updateAvailability, setUpdateAvailability] = useState<UpdateAvailabilitySnapshot>(() =>
    import.meta.env.DEV ? EMPTY_UPDATE_AVAILABILITY : { ...EMPTY_UPDATE_AVAILABILITY, status: "checking" },
  );
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const updateAvailabilityRef = useRef(updateAvailability);
  const applyUpdateAvailability = useCallback((snapshot: UpdateAvailabilitySnapshot) => {
    if (snapshot.revision < updateAvailabilityRef.current.revision) return;
    updateAvailabilityRef.current = snapshot;
    setUpdateAvailability(snapshot);
    setAvailableUpdate((current) => current?.version === snapshot.availableVersion ? current : null);
  }, []);
  const [updateCheckRequest, setUpdateCheckRequest] = useState(0);
  const [pendingUpdateCheck, setPendingUpdateCheck] = useState(false);
  const [updateNoteVersions, setUpdateNoteVersions] = useState<string[]>([]);
  const [selectedUpdateNote, setSelectedUpdateNote] = useState<ReleaseNote | null>(null);
  const [loadingUpdateNote, setLoadingUpdateNote] = useState(false);
  const [updateNoteError, setUpdateNoteError] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);

  useEffect(() => {
    if (!ready || !mockModeLoaded) return;
    if (import.meta.env.DEV && mockMode) {
      const notes = mockReleaseNotes(noteLanguage);
      setUpdateNoteVersions(notes.map((note) => note.version));
      setSelectedUpdateNote(notes[0]);
      setReleaseNotesOpen(true);
      return;
    }
    if (mockMode || import.meta.env.DEV) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const loadPendingNotes = async () => {
      try {
        const { pendingFromVersion } = await getReleaseNotesState();
        if (!active || !pendingFromVersion) return;
        const versions = await listUpdateReleaseNotesVersions();
        if (versions.length === 0) return;
        const note = await loadReleaseNoteVersion(versions[0], noteLanguage);
        if (active) {
          setUpdateNoteVersions(versions);
          setSelectedUpdateNote(note);
          setReleaseNotesOpen(true);
          prefetchOlderReleaseNotes(versions, note.version, noteLanguage);
        }
      } catch {
        if (active) retryTimer = setTimeout(() => void loadPendingNotes(), 60 * 60 * 1000);
      }
    };
    void loadPendingNotes();
    return () => { active = false; clearTimeout(retryTimer); };
  }, [ready, mockModeLoaded, mockMode, noteLanguage]);

  function handleReleaseNotesOpenChange(open: boolean) {
    setReleaseNotesOpen(open);
    if (!open && !mockMode) void markReleaseNotesSeen().catch(() => {
      // A failed save allows the notes to reappear on the next launch.
    });
  }

  async function handleNavigateUpdateNotes(version: string) {
    setLoadingUpdateNote(true);
    setUpdateNoteError(false);
    try {
      const note = import.meta.env.DEV && mockMode
        ? mockReleaseNotes(noteLanguage).find((item) => item.version === version)
        : await loadReleaseNoteVersion(version, noteLanguage);
      if (!note) return;
      setSelectedUpdateNote(note);
      if (!mockMode) prefetchOlderReleaseNotes(updateNoteVersions, note.version, noteLanguage);
    } catch {
      setUpdateNoteError(true);
    } finally {
      setLoadingUpdateNote(false);
    }
  }

  const selectedUpdateNoteIndex = selectedUpdateNote ? updateNoteVersions.indexOf(selectedUpdateNote.version) : -1;
  const availableUpdateVersion = updateAvailability.availableVersion;

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
      (snapshot) => {
        if (active) applyUpdateAvailability(snapshot);
      },
    );
    void startNativeEventBridge().then(async (cleanup) => {
      if (!active) {
        cleanup();
        return;
      }
      stopBridge = cleanup;
      try {
        const snapshot = await getBackgroundUpdateState();
        if (active) applyUpdateAvailability(snapshot);
      } catch {
        // Fall back to an idle state so the user can still trigger a manual check.
        if (active) applyUpdateAvailability(EMPTY_UPDATE_AVAILABILITY);
      }
    });
    return () => {
      active = false;
      unsubscribeUpdateAvailability();
      stopBridge?.();
    };
  }, [applyUpdateAvailability]);

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
      let modelTestingPreference = false;
      try {
        modelTestingPreference = (await generalSettings()).extraFunctionsEnabled;
      } catch {
        // Keep optional developer features hidden if settings could not be loaded.
      }
      if (!active) return;
      setModelTestingEnabled(modelTestingPreference);
      setModelTestingPreferenceLoaded(true);
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
    if (!ready) return;
    void setAppBadgeCount(unreadAppBadgeCount).catch(() => undefined);
  }, [ready, unreadAppBadgeCount]);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => subscribeAppEvent(
    APP_EVENT.extraFunctionsEnabledChanged,
    setModelTestingEnabled,
  ), []);

  useEffect(() => {
    if (!modelTestingPreferenceLoaded || route !== "developer-model-testing" || modelTestingEnabled) return;
    setRoute("settings-general");
    if (window.location.hash !== "#settings/general") {
      window.location.hash = "#settings/general";
    }
  }, [modelTestingEnabled, modelTestingPreferenceLoaded, route]);

  useEffect(() => {
    if (route !== "settings-application-info" || !pendingUpdateCheck) return;
    setPendingUpdateCheck(false);
    if (updateAvailability.status === "idle" || updateAvailability.status === "error") {
      setUpdateCheckRequest((current) => current + 1);
    }
  }, [pendingUpdateCheck, route, updateAvailability.status]);

  function navigate(section: AppSection) {
    setRoute(section);
  }

  function openApplicationInfo() {
    setRoute("settings-application-info");
    setPendingUpdateCheck(updateAvailability.status === "idle" || updateAvailability.status === "error");
    if (window.location.hash !== "#settings/application-info") {
      window.location.hash = "#settings/application-info";
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
          onOpenApplicationInfo={openApplicationInfo}
          onNavigate={navigate}
          activeSection={route}
          unreadPullRequestCount={unreadPullRequestCount}
          unreadAuthoredPullRequestCount={unreadAuthoredPullRequestCount}
          unreadTaskTrackerCount={unreadTaskTrackerCount}
          modelTestingEnabled={modelTestingEnabled}
        >
          <AppRoutes
            route={route}
            updateCheckRequest={updateCheckRequest}
            mockMode={mockMode}
            modelTestingEnabled={modelTestingEnabled}
            version={appVersion}
            availableUpdate={availableUpdate}
            updateAvailability={updateAvailability}
            onAvailableUpdateChange={setAvailableUpdate}
          />
        </AppShell>
      ) : null}
      {import.meta.env.DEV && mockMode ? <DevOverlay /> : null}
      <SplashScreen visible={!ready} />
      <UpdateBanner enabled={ready && !import.meta.env.DEV && !mockMode} updateVersion={availableUpdateVersion} />
      <ReleaseNotesDialog open={releaseNotesOpen} onOpenChange={handleReleaseNotesOpenChange}
        releases={selectedUpdateNote ? [selectedUpdateNote] : []}
        navigation={{
          newerVersion: selectedUpdateNoteIndex > 0 ? updateNoteVersions[selectedUpdateNoteIndex - 1] : undefined,
          olderVersion: updateNoteVersions[selectedUpdateNoteIndex + 1],
          loading: loadingUpdateNote,
          onNavigate: (version) => void handleNavigateUpdateNotes(version),
        }} />
      <StatusToast message={updateNoteError ? t("releaseNotes.loadError") : undefined}
        variant="error" onDismiss={() => setUpdateNoteError(false)} />
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
