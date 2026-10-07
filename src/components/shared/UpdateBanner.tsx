import { useEffect, useState } from "react";
import { Clock3, NotebookText } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusToast } from "./StatusToast";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";
import { loadAvailableUpdateReleaseNotes, type ReleaseNote } from "@/release-notes";
import { checkForAvailableUpdate } from "./update-check";
import { installAvailableUpdate } from "./update-install";
import { dismissUpdateNotice, useDismissedUpdateVersion } from "./update-notice";
import { useI18n } from "@/i18n/context";

interface UpdateBannerProps {
  enabled: boolean;
  updateVersion: string | null;
  developmentBuild?: boolean;
  mockMode?: boolean;
}

export function UpdateBanner({ enabled, updateVersion, developmentBuild = import.meta.env.DEV, mockMode = false }: UpdateBannerProps) {
  const { t, language } = useI18n();
  const dismissedVersion = useDismissedUpdateVersion();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [developmentNotice, setDevelopmentNotice] = useState<"install" | "notes" | null>(null);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState(false);
  const noteLanguage = language === "russian" ? "ru" : "en";

  useEffect(() => {
    if (!enabled || !updateVersion || updateVersion === dismissedVersion || developmentBuild || mockMode) return;
    void loadAvailableUpdateReleaseNotes(updateVersion, noteLanguage).catch(() => {
      // A failed prefetch is retried when the user opens the notes.
    });
  }, [enabled, updateVersion, dismissedVersion, developmentBuild, mockMode, noteLanguage]);

  if (!enabled || !updateVersion || updateVersion === dismissedVersion) return null;

  function dismissUpdate() {
    if (updateVersion) dismissUpdateNotice(updateVersion);
  }

  async function installUpdate() {
    if (developmentBuild || mockMode) {
      setDevelopmentNotice("install");
      return;
    }
    setInstalling(true);
    setError(undefined);
    try {
      const update = await checkForAvailableUpdate();
      if (!update) throw new Error("No update available");
      await installAvailableUpdate(update);
    } catch {
      setError(t("update.installError"));
    } finally {
      setInstalling(false);
    }
  }

  async function openReleaseNotes() {
    if (!updateVersion) return;
    if (developmentBuild || mockMode) {
      setNotesError(false);
      setDevelopmentNotice("notes");
      return;
    }
    setLoadingNotes(true);
    setNotesError(false);
    try {
      const releases = await loadAvailableUpdateReleaseNotes(updateVersion, noteLanguage);
      if (releases.length === 0) throw new Error("No release notes");
      setNotes(releases);
      setNotesOpen(true);
    } catch {
      setNotesError(true);
    } finally {
      setLoadingNotes(false);
    }
  }

  return (
    <>
      <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl">
        <Alert role="status" className="border-primary/40 bg-background shadow-lg">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AlertTitle className="mb-0 min-w-0 flex-1 text-sm leading-snug">{t("update.available", { version: updateVersion })}</AlertTitle>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void openReleaseNotes()} disabled={loadingNotes}>
                <NotebookText data-icon="inline-start" aria-hidden="true" />{t("releaseNotes.title")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={dismissUpdate} disabled={installing}>
                <Clock3 data-icon="inline-start" aria-hidden="true" />{t("update.later")}
              </Button>
              <Button type="button" actionTone="edit" size="sm" onClick={() => void installUpdate()} disabled={installing}>
                {installing ? t("update.updating") : t("update.now")}
              </Button>
            </div>
          </div>
          {error ? <AlertDescription role="alert" className="mt-2 text-destructive">{error}</AlertDescription> : null}
        </Alert>
      </div>
      <ReleaseNotesDialog open={notesOpen} onOpenChange={setNotesOpen} releases={notes} />
      <StatusToast message={notesError ? t("releaseNotes.loadError") : developmentNotice ? t(developmentNotice === "install" ? "update.developmentInstallBlocked" : "releaseNotes.developmentViewBlocked") : undefined}
        variant="error" onDismiss={() => {
          setDevelopmentNotice(null);
          setNotesError(false);
        }} />
    </>
  );
}
