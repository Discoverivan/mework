import type { Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpCircle, Download, ExternalLink, FolderOpen, NotebookText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusToast } from "@/components/shared/StatusToast";
import { ReleaseNotesDialog } from "@/components/shared/ReleaseNotesDialog";
import { beginUpdateCheck, checkForAvailableUpdate, recordUpdateCheckResult } from "@/components/shared/update-check";
import { installAvailableUpdate } from "@/components/shared/update-install";
import { useI18n } from "@/i18n/context";
import { EMPTY_UPDATE_AVAILABILITY, type UpdateAvailabilitySnapshot } from "@/shared/contracts/updates";
import { listReleaseNotesVersions, loadReleaseNoteVersion, prefetchOlderReleaseNotes, type ReleaseNote } from "@/release-notes";
import { mockReleaseNotes } from "@/release-notes/mock";

const GITHUB_URL = "https://github.com/Discoverivan/mework";

interface ApplicationInfoPageProps {
  version?: string;
  updateCheckRequest?: number;
  availableUpdate?: Update | null;
  updateAvailability?: UpdateAvailabilitySnapshot;
  onAvailableUpdateChange?: (update: Update | null) => void;
  mockMode?: boolean;
}

export function ApplicationInfoPage({
  version,
  updateCheckRequest = 0,
  availableUpdate: sharedAvailableUpdate,
  updateAvailability: sharedUpdateAvailability,
  onAvailableUpdateChange,
  mockMode = false,
}: ApplicationInfoPageProps) {
  const { t, language } = useI18n();
  const noteLanguage = language === "russian" ? "ru" : "en";
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [localUpdateAvailability, setLocalUpdateAvailability] = useState(EMPTY_UPDATE_AVAILABILITY);
  const [localAvailableUpdate, setLocalAvailableUpdate] = useState<Update | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseNotesVersions, setReleaseNotesVersions] = useState<string[]>([]);
  const [selectedReleaseNote, setSelectedReleaseNote] = useState<ReleaseNote | null>(null);
  const [loadingReleaseNotes, setLoadingReleaseNotes] = useState(false);
  const [releaseNotesError, setReleaseNotesError] = useState(false);
  const handledUpdateCheckRequestRef = useRef(updateCheckRequest);
  const checkingUpdatesRef = useRef(false);

  const updateAvailability = onAvailableUpdateChange
    ? sharedUpdateAvailability ?? EMPTY_UPDATE_AVAILABILITY
    : localUpdateAvailability;
  const availableUpdate = onAvailableUpdateChange ? sharedAvailableUpdate ?? null : localAvailableUpdate;
  const availableUpdateVersion = availableUpdate?.version ?? updateAvailability.availableVersion;
  const publishUpdateAvailability = useCallback((snapshot: UpdateAvailabilitySnapshot) => {
    setLocalUpdateAvailability(snapshot);
    emitAppEvent(APP_EVENT.updateAvailabilityChanged, snapshot);
  }, []);

  const performUpdateCheck = useCallback(async (): Promise<Update | null> => {
    const previousAvailability = updateAvailability;
    publishUpdateAvailability({
      ...previousAvailability,
      status: "checking",
      revision: previousAvailability.revision + 1,
    });
    const ticket = await beginUpdateCheck().catch(() => null);
    if (ticket) publishUpdateAvailability(ticket.snapshot);

    let update: Update | null;
    try {
      update = await checkForAvailableUpdate();
    } catch (error) {
      const completion = ticket
        ? await recordUpdateCheckResult(ticket.checkId, null, false).catch(() => null)
        : null;
      if (completion) {
        publishUpdateAvailability(completion.snapshot);
        if (!completion.accepted) return null;
      } else {
        publishUpdateAvailability({
          ...previousAvailability,
          lastCheckedAt: Date.now(),
          status: "error",
          revision: Math.max(previousAvailability.revision, ticket?.snapshot.revision ?? 0) + 1,
        });
      }
      throw error;
    }

    const completion = ticket
      ? await recordUpdateCheckResult(ticket.checkId, update?.version ?? null, true).catch(() => null)
      : null;
    if (completion) {
      publishUpdateAvailability(completion.snapshot);
      if (!completion.accepted) {
        const currentUpdate = update?.version === completion.snapshot.availableVersion
          ? update
          : availableUpdate?.version === completion.snapshot.availableVersion
            ? availableUpdate
            : null;
        setLocalAvailableUpdate(currentUpdate);
        onAvailableUpdateChange?.(currentUpdate);
        return currentUpdate;
      }
    } else {
      publishUpdateAvailability({
        availableVersion: update?.version ?? null,
        lastCheckedAt: Date.now(),
        status: update ? "available" : "current",
        revision: Math.max(previousAvailability.revision, ticket?.snapshot.revision ?? 0) + 1,
      });
    }
    setLocalAvailableUpdate(update);
    onAvailableUpdateChange?.(update);
    return update;
  }, [availableUpdate, onAvailableUpdateChange, publishUpdateAvailability, updateAvailability]);

  const handleCheckForUpdates = useCallback(async () => {
    if (checkingUpdatesRef.current) return;
    checkingUpdatesRef.current = true;
    setCheckingUpdates(true);
    setUpdateInstallError(null);
    try {
      await performUpdateCheck();
    } catch {
      // The failed status is recorded by performUpdateCheck and shown inline.
    } finally {
      checkingUpdatesRef.current = false;
      setCheckingUpdates(false);
    }
  }, [performUpdateCheck]);

  useEffect(() => {
    if (updateCheckRequest <= handledUpdateCheckRequestRef.current) return;
    handledUpdateCheckRequestRef.current = updateCheckRequest;
    void handleCheckForUpdates();
  }, [handleCheckForUpdates, updateCheckRequest]);

  async function handleOpenLogs() {
    try {
      await invoke("application_open_logs_directory");
    } catch {
      setUpdateInstallError(t("applicationInfo.logsOpenError"));
    }
  }

  async function handleInstallUpdate() {
    setInstallingUpdate(true);
    setUpdateInstallError(null);
    try {
      const update = availableUpdate ?? await performUpdateCheck();
      if (!update) throw new Error("No update available");
      await installAvailableUpdate(update);
    } catch {
      setUpdateInstallError(t("general.updateInstallError"));
    } finally {
      setInstallingUpdate(false);
    }
  }

  async function handleOpenReleaseNotes() {
    setLoadingReleaseNotes(true);
    setReleaseNotesError(false);
    try {
      if (import.meta.env.DEV && mockMode) {
        const notes = mockReleaseNotes(noteLanguage);
        setReleaseNotesVersions(notes.map((note) => note.version));
        setSelectedReleaseNote(notes[0]);
      } else {
        const versions = await listReleaseNotesVersions();
        if (versions.length === 0) throw new Error("No release notes");
        const note = await loadReleaseNoteVersion(versions[0], noteLanguage);
        setReleaseNotesVersions(versions);
        setSelectedReleaseNote(note);
        prefetchOlderReleaseNotes(versions, note.version, noteLanguage);
      }
      setReleaseNotesOpen(true);
    } catch {
      setReleaseNotesError(true);
    } finally {
      setLoadingReleaseNotes(false);
    }
  }

  async function handleNavigateReleaseNotes(version: string) {
    setLoadingReleaseNotes(true);
    setReleaseNotesError(false);
    try {
      const note = import.meta.env.DEV && mockMode
        ? mockReleaseNotes(noteLanguage).find((item) => item.version === version)
        : await loadReleaseNoteVersion(version, noteLanguage);
      if (!note) throw new Error("No release notes");
      setSelectedReleaseNote(note);
      if (!mockMode) prefetchOlderReleaseNotes(releaseNotesVersions, note.version, noteLanguage);
    } catch {
      setReleaseNotesError(true);
    } finally {
      setLoadingReleaseNotes(false);
    }
  }

  const selectedNoteIndex = selectedReleaseNote ? releaseNotesVersions.indexOf(selectedReleaseNote.version) : -1;
  const displayedVersion = mockMode || version === "dev" ? "0.0.0" : version;
  const currentLocale = language === "russian" ? "ru-RU" : "en-US";
  const isUpdateChecking = checkingUpdates || updateAvailability.status === "checking";
  const statusLabel = isUpdateChecking
    ? t("general.checking")
    : updateAvailability.status === "error"
      ? t("general.updateCheckError")
      : availableUpdateVersion
        ? undefined
        : updateAvailability.status === "current"
          ? t("general.current")
          : updateAvailability.status === "available"
            ? t("applicationInfo.updateStatusAvailable")
            : t("applicationInfo.updateStatusNotChecked");
  const lastCheckedAt = updateAvailability.lastCheckedAt === null ? null : new Date(updateAvailability.lastCheckedAt);
  const lastCheckedLabel = lastCheckedAt
    ? lastCheckedAt.toDateString() === new Date().toDateString()
      ? t("applicationInfo.lastCheckedToday", {
          time: new Intl.DateTimeFormat(currentLocale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(lastCheckedAt),
        })
      : t("applicationInfo.lastCheckedAt", {
          dateTime: new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium", timeStyle: "short" }).format(lastCheckedAt),
        })
    : t("applicationInfo.lastCheckedNever");

  return (
    <section className="space-y-4" aria-labelledby="application-info-title">
      <PageHeader title={t("applicationInfo.title")} titleId="application-info-title" />
      <Card className="application-info-card">
        <div className="application-info-topline">
          <div className="application-info-identity">
            <img className="application-info-icon" src="/mework-icon.png" alt="" aria-hidden="true" />
            <div className="application-info-copy">
              <div className="application-info-title-row">
                <h2 className="application-info-name">{mockMode || version === "dev" ? "mework-dev" : "mework"}</h2>
                {displayedVersion ? <Badge variant="secondary" className="application-info-version">{displayedVersion}</Badge> : null}
              </div>
              {statusLabel ? <p className="application-info-status">{statusLabel}</p> : null}
              <p className="application-info-last-checked">{lastCheckedLabel}</p>
            </div>
          </div>
          <div className="application-info-actions">
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleOpenReleaseNotes()}
              disabled={loadingReleaseNotes}>
              <NotebookText data-icon="inline-start" aria-hidden="true" />{t("releaseNotes.open")}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => void openUrl(GITHUB_URL)}>
              <ExternalLink data-icon="inline-start" aria-hidden="true" />{t("applicationInfo.viewOnGitHub")}
            </Button>
            <Button type="button" variant="secondary" size="sm"
              onClick={() => void handleCheckForUpdates()} disabled={isUpdateChecking || installingUpdate}
              aria-label={isUpdateChecking ? t("general.checking") : t("general.checkUpdates")}
              title={isUpdateChecking ? t("general.checking") : t("general.checkUpdates")}>
              <RefreshCw data-icon="inline-start" className={isUpdateChecking ? "animate-spin" : undefined} aria-hidden="true" />
              {isUpdateChecking ? t("general.checking") : t("general.checkUpdates")}
            </Button>
          </div>
        </div>
        {availableUpdateVersion ? (
          <div className="application-update-banner">
            <ArrowUpCircle className="application-update-icon" aria-hidden="true" />
            <div className="application-update-copy">
              <p className="application-update-title">{t("applicationInfo.newVersionAvailable", { version: availableUpdateVersion ?? "" })}</p>
              <Button type="button" variant="link" size="sm" className="h-auto justify-start p-0" onClick={() => void handleOpenReleaseNotes()}
                disabled={loadingReleaseNotes}>
                {t("applicationInfo.viewReleaseNotes")}
              </Button>
            </div>
            <Button type="button" className="application-update-install" onClick={() => void handleInstallUpdate()} disabled={isUpdateChecking || installingUpdate}>
              {installingUpdate ? <RefreshCw data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Download data-icon="inline-start" aria-hidden="true" />}
              {installingUpdate ? t("general.updating", { version: availableUpdateVersion ?? "" }) : t("applicationInfo.downloadInstall")}
            </Button>
          </div>
        ) : null}
      </Card>
      <Card className="flex flex-row items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("applicationInfo.troubleshooting")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("applicationInfo.logsDescription")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void handleOpenLogs()}>
          <FolderOpen data-icon="inline-start" aria-hidden="true" />{t("applicationInfo.openLogs")}
        </Button>
      </Card>
      <ReleaseNotesDialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}
        releases={selectedReleaseNote ? [selectedReleaseNote] : []} mode="history"
        navigation={{
          newerVersion: selectedNoteIndex > 0 ? releaseNotesVersions[selectedNoteIndex - 1] : undefined,
          olderVersion: releaseNotesVersions[selectedNoteIndex + 1],
          loading: loadingReleaseNotes,
          onNavigate: (selectedVersion) => void handleNavigateReleaseNotes(selectedVersion),
        }} />
      <StatusToast message={releaseNotesError ? t("releaseNotes.loadError") : updateInstallError ?? undefined}
        variant={releaseNotesError || updateInstallError ? "error" : "success"}
        onDismiss={() => {
          setUpdateInstallError(null);
          setReleaseNotesError(false);
        }} />
    </section>
  );
}
