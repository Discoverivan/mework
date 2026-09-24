import type { Update } from "@tauri-apps/plugin-updater";

import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkForAvailableUpdate } from "@/components/shared/update-check";
import { installAvailableUpdate } from "@/components/shared/update-install";
import { StatusToast } from "@/components/shared/StatusToast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  commandBoardTerminalPreferences,
  generalSettings,
  openNotificationSettings,
  requestNotificationPermission,
  saveCommandBoardTerminalPreference,
  saveGeneralSettings,
  sendNotificationTest,
  type CommandBoardTerminalPreferences,
  type GeneralSettings,
  type GeneralSettingsSaveInput,
  type NotificationTestKind,
  AiResponseLanguage,
  type ThemePreference,
} from "./api";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { useI18n } from "@/i18n/context";
import { AppLanguage } from "@/i18n/types";

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return message.replace(/(?:token|pat|password|secret|authorization)[^\n]*/gi, "credential details redacted");
}

interface GeneralSettingsPageProps {
  updateCheckRequest?: number;
}

export function GeneralSettingsPage({ updateCheckRequest = 0 }: GeneralSettingsPageProps) {
  const { appearanceSaving, language, themePreference, t, updateAppearance } = useI18n();
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [terminalPreferences, setTerminalPreferences] = useState<CommandBoardTerminalPreferences | null>(null);
  const [terminalLoading, setTerminalLoading] = useState(true);
  const [terminalSaving, setTerminalSaving] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
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
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const terminalSavingRef = useRef(false);
  const languageRef = useRef(language);
  const themePreferenceRef = useRef(themePreference);

  const loadTerminalPreferences = useCallback(async () => {
    if (terminalSavingRef.current) return;
    setTerminalLoading(true);
    try {
      setTerminalPreferences(await commandBoardTerminalPreferences());
      setTerminalError(null);
    } catch (loadError) {
      setTerminalError(t("general.terminalLoadError", {
        error: errorMessage(loadError, t("common.unknownError")),
      }));
    } finally {
      setTerminalLoading(false);
    }
  }, [t]);

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
      setNotificationError(loaded.permissionCheckError ?? null);
      void loadTerminalPreferences();
    } catch (loadError) {
      setError(t("general.loadError", { error: errorMessage(loadError, t("common.unknownError")) }));
    } finally {
      setLoading(false);
    }
  }, [loadTerminalPreferences, t]);

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
      taskTrackerNotificationsEnabled: settings.taskTrackerNotificationsEnabled,
      language: settings.language,
      aiResponseLanguage: settings.aiResponseLanguage ?? AiResponseLanguage.SameAsUi,
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

  async function handleTerminalPreferenceChange(terminalId: string) {
    if (!terminalPreferences || terminalSavingRef.current) return;
    const previous = terminalPreferences;
    terminalSavingRef.current = true;
    setTerminalSaving(true);
    setTerminalError(null);
    setTerminalPreferences({ ...previous, selectedTerminal: terminalId });
    try {
      setTerminalPreferences(await saveCommandBoardTerminalPreference(terminalId));
    } catch (saveError) {
      setTerminalPreferences(previous);
      setTerminalError(t("general.terminalSaveError", {
        error: errorMessage(saveError, t("common.unknownError")),
      }));
    } finally {
      terminalSavingRef.current = false;
      setTerminalSaving(false);
    }
  }

  async function handleTestNotification(notificationKind: NotificationTestKind) {
    setTestingNotification(notificationKind);
    setTestedNotification(null);
    setNotificationError(null);
    try {
      await sendNotificationTest(notificationKind);
      setTestedNotification(notificationKind);
    } catch (testError) {
      const message = errorMessage(testError, t("common.unknownError"));
      await loadSettings();
      setNotificationError(message);
    } finally {
      setTestingNotification(null);
    }
  }

  async function handleOpenNotificationSettings() {
    setOpeningSettings(true);
    setNotificationError(null);
    try {
      await openNotificationSettings();
    } catch (settingsError) {
      setNotificationError(errorMessage(settingsError, t("common.unknownError")));
    } finally {
      setOpeningSettings(false);
    }
  }

  async function handleRequestNotificationPermission() {
    setRequestingPermission(true);
    setNotificationError(null);
    try {
      const notificationPermission = await requestNotificationPermission();
      setSettings((current) => current ? { ...current, notificationPermission } : current);
    } catch (permissionError) {
      setNotificationError(errorMessage(permissionError, t("common.unknownError")));
    } finally {
      setRequestingPermission(false);
    }
  }

  const handleCheckForUpdates = useCallback(async () => {
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
      setCheckingUpdates(false);
    }
  }, []);

  const handledUpdateCheckRequestRef = useRef(updateCheckRequest);
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

      <Card>
        <CardHeader className="px-4 pb-0 pt-3.5">
          <CardTitle className="text-base font-semibold leading-tight">{t("general.language")}</CardTitle>
          <CardDescription className="mt-1 leading-snug">
            {t("general.languageDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4 pb-3.5 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="general-language" alignment="inline" className="font-medium">
                {t("general.languageUi")}
              </Label>
              <CardDescription className="mt-1 leading-snug">
                {t("general.languageUiDescription")}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-48">
              <select
                id="general-language"
                aria-label={t("general.languageUi")}
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
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="general-ai-response-language" alignment="inline" className="font-medium">
                {t("general.aiResponseLanguage")}
              </Label>
              <CardDescription className="mt-1 leading-snug">
                {t("general.aiResponseLanguageDescription")}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-48">
              <select
                id="general-ai-response-language"
                aria-label={t("general.aiResponseLanguage")}
                value={settings?.aiResponseLanguage ?? AiResponseLanguage.SameAsUi}
                onChange={(event) => void handlePreferencesChange({
                  aiResponseLanguage: event.target.value as AiResponseLanguage,
                })}
                disabled={loading || saving || settings === null}
                className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={AiResponseLanguage.SameAsUi}>{t("general.aiResponseLanguageSameAsUi")}</option>
                <option value={AiResponseLanguage.English}>{t("general.aiResponseLanguageEnglish")}</option>
                <option value={AiResponseLanguage.Russian}>{t("general.aiResponseLanguageRussian")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="-translate-y-px">
              <Label htmlFor="general-theme" alignment="inline" className="text-base font-semibold leading-tight">
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
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="-translate-y-px min-w-0 flex-1">
              <Label htmlFor="general-terminal" alignment="inline" className="text-base font-semibold leading-tight">
                {t("general.terminal")}
              </Label>
              <CardDescription className="mt-1 leading-snug">
                {t("general.terminalDescription")}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-48">
              <select
                id="general-terminal"
                aria-label={t("general.terminal")}
                value={terminalPreferences?.selectedTerminal ?? ""}
                onChange={(event) => void handleTerminalPreferenceChange(event.target.value)}
                disabled={loading || terminalLoading || terminalSaving || terminalPreferences === null}
                className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {!terminalPreferences ? (
                  <option value="" disabled>
                    {terminalLoading ? t("general.terminalLoading") : t("general.terminalOptionsUnavailable")}
                  </option>
                ) : null}
                {terminalPreferences?.options.map((option) => (
                  <option key={option.id} value={option.id} disabled={!option.available}>
                    {option.id === "system"
                      ? option.available ? t("general.terminalSystem") : t("general.terminalSystemUnavailable")
                      : option.available ? option.label : t("general.terminalOptionUnavailable", {
                          name: option.label || t("general.terminalUnknown"),
                        })}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
            </div>
          </div>
          {terminalError ? (
            <Alert variant="destructive" role="alert" aria-live="polite">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>{terminalError}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="space-y-4 px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="-translate-y-px">
              <Label htmlFor="general-notifications-enabled" alignment="inline" className="text-base font-semibold leading-tight">
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
          {permissionBlocked ? (
            <Alert variant="destructive" role="alert" aria-live="polite">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>{t("general.permissionTitle")}</AlertTitle>
              <AlertDescription>
                {settings?.notificationPermission === "notDetermined"
                  ? t("general.permissionRequestDescription")
                  : t("general.permissionDescription")}
                <div className="mt-3 flex flex-wrap gap-2">
                  {settings?.notificationPermission === "notDetermined" ? (
                    <Button type="button" size="sm" onClick={() => void handleRequestNotificationPermission()} disabled={requestingPermission}>
                      {t("general.allowNotifications")}
                    </Button>
                  ) : (
                    <Button type="button" size="sm" onClick={() => void handleOpenNotificationSettings()} disabled={openingSettings}>
                      {openingSettings ? t("general.opening") : t("general.openNotificationSettings")}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadSettings()} disabled={loading}>
                    <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                    {t("general.checkAgain")}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {notificationError ? (
            <Alert variant="destructive" role="alert" aria-live="assertive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>{notificationError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-3 border-t pt-4">
            <div className="flex items-center justify-between gap-4 pl-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="general-task-tracker-notifications-enabled" alignment="inline" className="font-medium">Task tracker</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground [&_svg]:!size-3.5"
                    onClick={() => void handleTestNotification("taskTracker")}
                    disabled={loading || testingNotification !== null || !(settings?.notificationsEnabled ?? true) || !(settings?.taskTrackerNotificationsEnabled ?? true)}
                    aria-label={t("general.testTaskTrackerNotification")}
                    title={t("general.testTaskTrackerNotification")}
                  >
                    {testingNotification === "taskTracker"
                      ? <RefreshCw className="animate-spin" aria-hidden="true" />
                      : testedNotification === "taskTracker"
                        ? <CheckCircle2 className="text-success" aria-hidden="true" />
                        : <BellRing aria-hidden="true" />}
                  </Button>
                </div>
                <CardDescription className="mt-1">Notifications from Task tracker monitors.</CardDescription>
              </div>
              <Switch
                id="general-task-tracker-notifications-enabled"
                size="sm"
                checked={settings?.taskTrackerNotificationsEnabled ?? true}
                onCheckedChange={(checked) => void handlePreferencesChange({ taskTrackerNotificationsEnabled: checked })}
                disabled={loading || saving || !(settings?.notificationsEnabled ?? true)}
              />
            </div>
            <div className="pl-4"><Separator /></div>
            <div className="flex items-center justify-between gap-4 pl-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="general-review-notifications-enabled" alignment="inline" className="font-medium">
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
                  <Label htmlFor="general-authored-notifications-enabled" alignment="inline" className="font-medium">
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
              {updateStatus === "available" ? <span className="text-sm text-muted-foreground">{t("general.updateAvailable", { version: availableUpdateVersion ?? "" })}</span> : null}
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
