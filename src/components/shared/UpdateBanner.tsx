import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type AvailableUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
};

interface UpdateBannerProps {
  enabled: boolean;
}

export function UpdateBanner({ enabled }: UpdateBannerProps) {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void import("@tauri-apps/plugin-updater")
      .then(({ check }) => check({ timeout: 10_000 }))
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
      await currentUpdate.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setError("The update could not be installed. Try again later.");
      setInstalling(false);
    }
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl">
      <Alert role="status" className="border-primary/40 bg-background shadow-lg">
        <AlertTitle>Mework {update.version} is available</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{error ?? update.body ?? "Install the latest version to get new features and fixes."}</span>
          <span className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDismissed(true)} disabled={installing}>
              Later
            </Button>
            <Button type="button" size="sm" onClick={() => void installUpdate()} disabled={installing}>
              {installing ? "Installing…" : "Install update"}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
