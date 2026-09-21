import { useEffect, useState } from "react";

import type { Update } from "@tauri-apps/plugin-updater";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkForAvailableUpdate } from "./update-check";
import { installAvailableUpdate } from "./update-install";
import { useI18n } from "@/i18n/context";

type AvailableUpdate = Update;

interface UpdateBannerProps {
  enabled: boolean;
}

export function UpdateBanner({ enabled }: UpdateBannerProps) {
  const { t } = useI18n();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void checkForAvailableUpdate()
      .then((available) => {
        if (!active || !available) return;
        setUpdate(available);
      })
      .catch(() => {
        // Update availability is optional and must not block the application.
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  if (!update || dismissed) return null;

  async function installUpdate() {
    const currentUpdate = update;
    if (!currentUpdate) return;
    setInstalling(true);
    setError(undefined);
    try {
      await installAvailableUpdate(currentUpdate);
    } catch {
      setError(t("update.installError"));
      setInstalling(false);
    }
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl">
      <Alert role="status" className="border-primary/40 bg-background shadow-lg">
        <AlertTitle>{t("update.available", { version: update.version })}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{error ?? t("update.ready")}</span>
          <span className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDismissed(true)} disabled={installing}>
              {t("update.later")}
            </Button>
            <Button type="button" size="sm" onClick={() => void installUpdate()} disabled={installing}>
              {installing ? t("update.updating") : t("update.now")}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
