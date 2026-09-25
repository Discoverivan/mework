import type { Update } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusToast } from "@/components/shared/StatusToast";
import { checkForAvailableUpdate } from "@/components/shared/update-check";
import { installAvailableUpdate } from "@/components/shared/update-install";
import { useI18n } from "@/i18n/context";

const GITHUB_RELEASES_URL = "https://github.com/Discoverivan/mework/releases";

interface ApplicationInfoPageProps {
  version?: string;
  updateCheckRequest?: number;
}

export function ApplicationInfoPage({ version, updateCheckRequest = 0 }: ApplicationInfoPageProps) {
  const { t } = useI18n();
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "current" | "available" | "error">("idle");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string>();
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
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

  return (
    <section className="space-y-6" aria-labelledby="application-info-title">
      <PageHeader title={t("applicationInfo.title")} titleId="application-info-title" description={t("applicationInfo.description")} />
      <Card>
        <CardHeader className="gap-3 px-4 py-3.5">
          <div>
            <h2 className="text-base font-semibold leading-tight">mework</h2>
            <CardDescription className="mt-1 leading-snug">{t("applicationInfo.about")}</CardDescription>
          </div>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {version ? <span className="text-sm text-muted-foreground">
              {t("applicationInfo.version", { version: version === "dev" ? t("nav.developmentBuild") : `v${version}` })}
            </span> : null}
            <Button type="button" variant="outline" size="sm" onClick={() => void openUrl(GITHUB_RELEASES_URL)}>
              <ExternalLink className="size-4" aria-hidden="true" />
              {t("applicationInfo.releases")}
            </Button>
          </div>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="-translate-y-px">
              <h2 className="text-base font-semibold leading-tight">{t("general.updates")}</h2>
              <CardDescription className="mt-1 leading-snug">{t("general.updatesDescription")}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {updateStatus === "available" ? <span className="text-sm text-muted-foreground">{t("general.updateAvailable", { version: availableUpdateVersion ?? "" })}</span> : null}
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
      <StatusToast message={updateInstallError ?? (updateStatus === "error" ? t("general.updateCheckError") : updateStatus === "current" ? t("general.current") : undefined)}
        variant={updateInstallError || updateStatus === "error" ? "error" : "success"}
        onDismiss={() => {
          setUpdateStatus((current) => current === "current" || current === "error" ? "idle" : current);
          setUpdateInstallError(null);
        }} />
    </section>
  );
}
