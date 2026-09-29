import type { Update } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, NotebookText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusToast } from "@/components/shared/StatusToast";
import { ReleaseNotesDialog } from "@/components/shared/ReleaseNotesDialog";
import { checkForAvailableUpdate } from "@/components/shared/update-check";
import { installAvailableUpdate } from "@/components/shared/update-install";
import { useI18n } from "@/i18n/context";
import { listReleaseNotesVersions, loadReleaseNoteVersion, prefetchOlderReleaseNotes, type ReleaseNote } from "@/release-notes";
import { mockReleaseNotes } from "@/release-notes/mock";

const GITHUB_RELEASES_URL = "https://github.com/Discoverivan/mework/releases";

interface ApplicationInfoPageProps {
  version?: string;
  updateCheckRequest?: number;
  mockMode?: boolean;
}

export function ApplicationInfoPage({ version, updateCheckRequest = 0, mockMode = false }: ApplicationInfoPageProps) {
  const { t, language } = useI18n();
  const noteLanguage = language === "russian" ? "ru" : "en";
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "current" | "available" | "error">("idle");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string>();
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseNotesVersions, setReleaseNotesVersions] = useState<string[]>([]);
  const [selectedReleaseNote, setSelectedReleaseNote] = useState<ReleaseNote | null>(null);
  const [loadingReleaseNotes, setLoadingReleaseNotes] = useState(false);
  const [releaseNotesError, setReleaseNotesError] = useState(false);
  const handledUpdateCheckRequestRef = useRef(updateCheckRequest);
  const checkingUpdatesRef = useRef(false);

  const handleCheckForUpdates = useCallback(async () => {
    if (checkingUpdatesRef.current) return;
    checkingUpdatesRef.current = true;
    setCheckingUpdates(true);
    setUpdateStatus("idle");
    setAvailableUpdate(null);
    setAvailableUpdateVersion(undefined);
    setUpdateInstallError(null);
    try {
      const update = await checkForAvailableUpdate();
      if (update) {
        setAvailableUpdate(update);
        setAvailableUpdateVersion(update.version);
        setUpdateStatus("available");
        emitAppEvent(APP_EVENT.updateAvailabilityChanged, update.version);
      } else {
        setUpdateStatus("current");
        emitAppEvent(APP_EVENT.updateAvailabilityChanged, null);
      }
    } catch {
      setUpdateStatus("error");
    } finally {
      checkingUpdatesRef.current = false;
      setCheckingUpdates(false);
    }
  }, []);

  useEffect(() => {
    if (updateCheckRequest <= handledUpdateCheckRequestRef.current) return;
    handledUpdateCheckRequestRef.current = updateCheckRequest;
    void handleCheckForUpdates();
  }, [handleCheckForUpdates, updateCheckRequest]);

  async function handleInstallUpdate() {
    if (!availableUpdate) return;
    setInstallingUpdate(true);
    setUpdateInstallError(null);
    try {
      await installAvailableUpdate(availableUpdate);
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

  return (
    <section className="space-y-4" aria-labelledby="application-info-title">
      <PageHeader title={t("applicationInfo.title")} titleId="application-info-title" />
      <div>
        <h2 className="text-lg font-semibold leading-tight">{t("applicationInfo.applicationSection")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("applicationInfo.about")}</p>
      </div>
      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 -translate-y-px">
              <CardTitle className="text-base font-semibold leading-tight">{t("applicationInfo.versionSection")}</CardTitle>
              {version ? <CardDescription className="mt-1 leading-snug">
                {version === "dev" ? t("nav.developmentBuild") : `v${version}`}
              </CardDescription> : null}
              {updateStatus === "available" ? <CardDescription className="mt-1 leading-snug">
                {t("general.updateAvailable", { version: availableUpdateVersion ?? "" })}
              </CardDescription> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => void handleOpenReleaseNotes()}
                disabled={loadingReleaseNotes} aria-label={t("releaseNotes.open")} title={t("releaseNotes.open")}>
                <NotebookText aria-hidden="true" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => void openUrl(GITHUB_RELEASES_URL)}
                aria-label={t("applicationInfo.releases")} title={t("applicationInfo.releases")}>
                <ExternalLink aria-hidden="true" />
              </Button>
              {updateStatus === "available" ? (
                <Button type="button" size="icon" className="h-9 w-9" onClick={() => void handleInstallUpdate()} disabled={checkingUpdates || installingUpdate}
                  aria-label={installingUpdate ? t("general.updating", { version: availableUpdateVersion ?? "" }) : t("general.updateNow", { version: availableUpdateVersion ?? "" })}
                  title={installingUpdate ? t("general.updating", { version: availableUpdateVersion ?? "" }) : t("general.updateNow", { version: availableUpdateVersion ?? "" })}>
                  {installingUpdate ? <RefreshCw className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => void handleCheckForUpdates()} disabled={checkingUpdates || installingUpdate}
                aria-label={checkingUpdates ? t("general.checking") : t("general.checkUpdates")}
                title={checkingUpdates ? t("general.checking") : t("general.checkUpdates")}>
                <RefreshCw className={checkingUpdates ? "animate-spin" : undefined} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
      <ReleaseNotesDialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}
        releases={selectedReleaseNote ? [selectedReleaseNote] : []} mode="history"
        navigation={{
          newerVersion: selectedNoteIndex > 0 ? releaseNotesVersions[selectedNoteIndex - 1] : undefined,
          olderVersion: releaseNotesVersions[selectedNoteIndex + 1],
          loading: loadingReleaseNotes,
          onNavigate: (selectedVersion) => void handleNavigateReleaseNotes(selectedVersion),
        }} />
      <StatusToast message={releaseNotesError ? t("releaseNotes.loadError") : updateInstallError ?? (updateStatus === "error" ? t("general.updateCheckError") : updateStatus === "current" ? t("general.current") : undefined)}
        variant={releaseNotesError || updateInstallError || updateStatus === "error" ? "error" : "success"}
        onDismiss={() => {
          setUpdateStatus((current) => current === "current" || current === "error" ? "idle" : current);
          setUpdateInstallError(null);
          setReleaseNotesError(false);
        }} />
    </section>
  );
}
