import type { Update } from "@tauri-apps/plugin-updater";

import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkForAvailableUpdate } from "@/components/shared/update-check";
import { installAvailableUpdate } from "@/components/shared/update-install";
import { StatusToast } from "@/components/shared/StatusToast";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  generalSettings,
  openNotificationSettings,
  saveGeneralSettings,
  sendNotificationTest,
  type GeneralSettings,
  type GeneralSettingsSaveInput,
  type NotificationTestKind,
  type ThemePreference,
} from "./api";
import { useI18n } from "@/i18n/context";
import { AppLanguage } from "@/i18n/types";

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return message.replace(/(?:token|pat|password|secret|authorization)[^\n]*/gi, "credential details redacted");
}

export function GeneralSettingsPage() {
  const { appearanceSaving, language, themePreference, t, updateAppearance } = useI18n();
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingNotification, setTestingNotification] = useState<NotificationTestKind | null>(null);
  const [testedNotification, setTestedNotification] = useState<NotificationTestKind | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "current" | "available" | "error">("idle");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string>();
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const languageRef = useRef(language);
  const themePreferenceRef = useRef(themePreference);

  useEffect(() => {
    languageRef.current = language;
    themePreferenceRef.current = themePreference;
    setSettings((current) => current ? { ...current, language, themePreference } : current);
  }, [language, themePreference]);

  const loadSettings = useCallback(async () => {
    if (savingRef.current) return;
    try {
      const loaded = await generalSettings();
      if (savingRef.current) return;
      setSettings({
        ...loaded,
        language: languageRef.current,
        themePreference: themePreferenceRef.current,
      });
      setError(loaded.permissionCheckError ?? null);
    } catch (loadError) {
      setError(t("general.loadError", { error: errorMessage(loadError, t("common.unknownError")) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
    const onFocus = () => void loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  async function handlePreferencesChange(changes: Partial<GeneralSettingsSaveInput>) {
    if (!settings) return;
    const previous = settings;
    const requested: GeneralSettingsSaveInput = {
      notificationsEnabled: settings.notificationsEnabled,
      reviewNotificationsEnabled: settings.reviewNotificationsEnabled,
      authoredNotificationsEnabled: settings.authoredNotificationsEnabled,
      language: settings.language,
      themePreference: settings.themePreference,
      ...changes,
    };
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setTestedNotification(null);
    setSettings({ ...settings, ...requested });
    try {
      const appearanceChanged = changes.language !== undefined || changes.themePreference !== undefined;
      const saved = appearanceChanged
        ? await updateAppearance({
            language: requested.language,
            themePreference: requested.themePreference,
          })
        : await saveGeneralSettings(requested);
      setSettings(saved);
    } catch (saveError) {
      setSettings(previous);
      setError(t("general.saveError", { error: errorMessage(saveError, t("common.unknownError")) }));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleTestNotification(notificationKind: NotificationTestKind) {
    setTestingNotification(notificationKind);
    setTestedNotification(null);
    setError(null);
    try {
      await sendNotificationTest(notificationKind);
      setTestedNotification(notificationKind);
    } catch (testError) {
      setError(errorMessage(testError, t("common.unknownError")));
      await loadSettings();
    } finally {
      setTestingNotification(null);
    }
  }

  async function handleOpenNotificationSettings() {
    setOpeningSettings(true);
    setError(null);
    try {
      await openNotificationSettings();
    } catch (settingsError) {
      setError(errorMessage(settingsError, t("common.unknownError")));
    } finally {
      setOpeningSettings(false);
    }
  }

  async function handleCheckForUpdates() {
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
      } else {
        setUpdateStatus("current");
      }
    } catch {
      setUpdateStatus("error");
    } finally {
      setCheckingUpdates(false);
    }
  }

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

  const permissionBlocked =
    settings !== null &&
    settings.notificationsEnabled &&
    settings.notificationPermission !== "granted";

  return (
    <section className="space-y-4" aria-labelledby="general-settings-title">
      <div>
        <h2 id="general-settings-title" className="text-lg font-semibold leading-tight">{t("general.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("general.description")}
        </p>
      </div>

      {loading ? (
        <Alert role="status" aria-live="polite">
          <AlertDescription>{t("general.loading")}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>{t("general.unavailable")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {permissionBlocked ? (
        <Alert variant="destructive" role="alert" aria-live="polite">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>{t("general.permissionTitle")}</AlertTitle>
          <AlertDescription>
            {t("general.permissionDescription")}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void handleOpenNotificationSettings()} disabled={openingSettings}>
                {openingSettings ? t("general.opening") : t("general.openNotificationSettings")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadSettings()} disabled={loading}>
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                {t("general.checkAgain")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="-translate-y-px">
              <Label htmlFor="general-language" className="text-base font-semibold leading-tight">
                {t("general.language")}
              </Label>
              <CardDescription className="mt-1 leading-snug">
                {t("general.languageDescription")}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-48">
              <select
                id="general-language"
                aria-label={t("general.language")}
                value={language}
                onChange={(event) => void handlePreferencesChange({ language: event.target.value as AppLanguage })}
                disabled={loading || saving || appearanceSaving}
                className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={AppLanguage.English}>English</option>
                <option value={AppLanguage.Russian}>Русский</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="-translate-y-px">
              <Label htmlFor="general-theme" className="text-base font-semibold leading-tight">
                {t("general.theme")}
              </Label>
              <CardDescription className="mt-1 leading-snug">
                {t("general.themeDescription")}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-48">
              <select
                id="general-theme"
                aria-label={t("general.theme")}
                value={themePreference}
                onChange={(event) => void handlePreferencesChange({ themePreference: event.target.value as ThemePreference })}
                disabled={loading || saving || appearanceSaving}
                className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="system">{t("general.themeSystem")}</option>
                <option value="light">{t("general.themeLight")}</option>
                <option value="dark">{t("general.themeDark")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="-translate-y-px">
              <Label htmlFor="general-notifications-enabled" className="text-base font-semibold leading-tight">
                {t("general.notifications")}
              </Label>
              <CardDescription className="mt-1 leading-snug">
                {t("general.notificationsDescription")}
              </CardDescription>
            </div>
            <Switch
              id="general-notifications-enabled"
              size="md"
              checked={settings?.notificationsEnabled ?? true}
              onCheckedChange={(checked) => void handlePreferencesChange({ notificationsEnabled: checked })}
              disabled={loading || saving}
            />
          </div>
          <div className="grid gap-3 border-t pt-4">
            <div className="flex items-center justify-between gap-4 pl-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="general-review-notifications-enabled" className="font-medium">
                    {t("general.notificationsReview")}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground [&_svg]:!size-3.5"
                    onClick={() => void handleTestNotification("review")}
                    disabled={loading || testingNotification !== null || !(settings?.notificationsEnabled ?? true) || !(settings?.reviewNotificationsEnabled ?? true)}
                    aria-label={t("general.testReviewNotification")}
                    title={t("general.testReviewNotification")}
                  >
                    {testingNotification === "review"
                      ? <RefreshCw className="animate-spin" aria-hidden="true" />
                      : testedNotification === "review"
                        ? <CheckCircle2 className="text-success" aria-hidden="true" />
                        : <BellRing aria-hidden="true" />}
                  </Button>
                </div>
                <CardDescription className="mt-1">
                  {t("general.notificationsReviewDescription")}
                </CardDescription>
              </div>
              <Switch
                id="general-review-notifications-enabled"
                size="sm"
                checked={settings?.reviewNotificationsEnabled ?? true}
                onCheckedChange={(checked) => void handlePreferencesChange({ reviewNotificationsEnabled: checked })}
                disabled={loading || saving || !(settings?.notificationsEnabled ?? true)}
              />
            </div>
            <div className="pl-4">
              <Separator />
            </div>
            <div className="flex items-center justify-between gap-4 pl-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="general-authored-notifications-enabled" className="font-medium">
                    {t("general.notificationsAuthored")}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground [&_svg]:!size-3.5"
                    onClick={() => void handleTestNotification("authored")}
                    disabled={loading || testingNotification !== null || !(settings?.notificationsEnabled ?? true) || !(settings?.authoredNotificationsEnabled ?? true)}
                    aria-label={t("general.testAuthoredNotification")}
                    title={t("general.testAuthoredNotification")}
                  >
                    {testingNotification === "authored"
                      ? <RefreshCw className="animate-spin" aria-hidden="true" />
                      : testedNotification === "authored"
                        ? <CheckCircle2 className="text-success" aria-hidden="true" />
                        : <BellRing aria-hidden="true" />}
                  </Button>
                </div>
                <CardDescription className="mt-1">
                  {t("general.notificationsAuthoredDescription")}
                </CardDescription>
              </div>
              <Switch
                id="general-authored-notifications-enabled"
                size="sm"
                checked={settings?.authoredNotificationsEnabled ?? true}
                onCheckedChange={(checked) => void handlePreferencesChange({ authoredNotificationsEnabled: checked })}
                disabled={loading || saving || !(settings?.notificationsEnabled ?? true)}
              />
            </div>
          </div>
        </CardHeader>
        <span className="sr-only" role="status" aria-live="polite">
          {testedNotification ? t("general.testSent") : ""}
        </span>
      </Card>

      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="-translate-y-px">
              <h3 className="text-base font-semibold leading-tight">{t("general.updates")}</h3>
              <CardDescription className="mt-1 leading-snug">
                {t("general.updatesDescription")}
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {updateStatus === "available" ? (
                <Button
                  type="button"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => void handleInstallUpdate()}
                  disabled={checkingUpdates || installingUpdate}
                  aria-label={installingUpdate
                    ? t("general.updating", { version: availableUpdateVersion ?? "" })
                    : t("general.updateNow", { version: availableUpdateVersion ?? "" })}
                  title={installingUpdate
                    ? t("general.updating", { version: availableUpdateVersion ?? "" })
                    : t("general.updateNow", { version: availableUpdateVersion ?? "" })}
                >
                  {installingUpdate
                    ? <RefreshCw className="animate-spin" aria-hidden="true" />
                    : <Download aria-hidden="true" />}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => void handleCheckForUpdates()}
                disabled={checkingUpdates || installingUpdate}
                aria-label={checkingUpdates ? t("general.checking") : t("general.checkUpdates")}
                title={checkingUpdates ? t("general.checking") : t("general.checkUpdates")}
              >
                <RefreshCw className={checkingUpdates ? "animate-spin" : undefined} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>
      <StatusToast
        message={updateInstallError
          ?? (updateStatus === "error"
            ? t("general.updateCheckError")
            : updateStatus === "current" ? t("general.current") : undefined)}
        variant={updateInstallError || updateStatus === "error" ? "error" : "success"}
        onDismiss={() => {
          setUpdateStatus((current) => current === "current" || current === "error" ? "idle" : current);
          setUpdateInstallError(null);
        }}
      />
    </section>
  );
}
