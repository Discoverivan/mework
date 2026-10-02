import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkForAvailableUpdate } from "./update-check";
import { installAvailableUpdate } from "./update-install";
import { useI18n } from "@/i18n/context";

const DISMISSED_VERSION_KEY = "mework.update-banner.dismissed-version";

function readDismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

interface UpdateBannerProps {
  enabled: boolean;
  updateVersion: string | null;
}

export function UpdateBanner({ enabled, updateVersion }: UpdateBannerProps) {
  const { t } = useI18n();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(readDismissedVersion);
  const [visibleVersion, setVisibleVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled || !updateVersion || updateVersion === dismissedVersion) return;
    setVisibleVersion(updateVersion);
  }, [dismissedVersion, enabled, updateVersion]);

  if (!enabled || !updateVersion || visibleVersion !== updateVersion) return null;

  function dismissUpdate() {
    if (!visibleVersion) return;
    setDismissedVersion(visibleVersion);
    setVisibleVersion(null);
    try {
      window.localStorage.setItem(DISMISSED_VERSION_KEY, visibleVersion);
    } catch {
      // In-memory dismissal still prevents repeating the popup for this app session.
    }
  }

  async function installUpdate() {
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

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl">
      <Alert role="status" className="border-primary/40 bg-background shadow-lg">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <AlertTitle className="mb-0 min-w-0 flex-1 text-sm leading-snug">{t("update.available", { version: updateVersion })}</AlertTitle>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={dismissUpdate} disabled={installing}>
              {t("update.later")}
            </Button>
            <Button type="button" size="sm" onClick={() => void installUpdate()} disabled={installing}>
              {installing ? t("update.updating") : t("update.now")}
            </Button>
          </div>
        </div>
        {error ? <AlertDescription role="alert" className="mt-2 text-destructive">{error}</AlertDescription> : null}
      </Alert>
    </div>
  );
}
