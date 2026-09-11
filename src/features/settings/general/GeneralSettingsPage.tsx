import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  generalSettings,
  openNotificationSettings,
  saveGeneralSettings,
  sendNotificationTest,
  type GeneralSettings,
} from "./api";

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return message.replace(/(?:token|pat|password|secret|authorization)[^\n]*/gi, "credential details redacted");
}

export function GeneralSettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const loaded = await generalSettings();
      setSettings(loaded);
      setError(loaded.permissionCheckError ?? null);
    } catch (loadError) {
      setError(`Unable to load general settings: ${errorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    const onFocus = () => void loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  async function handleEnabledChange(enabled: boolean) {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      setSettings(await saveGeneralSettings(enabled));
    } catch (saveError) {
      setError(`Unable to save notification settings: ${errorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNotification() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      await sendNotificationTest();
      setTestResult("Test notification sent.");
    } catch (testError) {
      setError(errorMessage(testError));
      await loadSettings();
    } finally {
      setTesting(false);
    }
  }

  async function handleOpenNotificationSettings() {
    setOpeningSettings(true);
    setError(null);
    try {
      await openNotificationSettings();
    } catch (settingsError) {
      setError(errorMessage(settingsError));
    } finally {
      setOpeningSettings(false);
    }
  }

  const permissionBlocked =
    settings !== null &&
    settings.notificationsEnabled &&
    settings.notificationPermission !== "granted";

  return (
    <section className="space-y-4" aria-labelledby="general-settings-title">
      <div>
        <h2 id="general-settings-title">Application preferences</h2>
        <p className="text-muted-foreground">
          Configure application-wide notification behavior.
        </p>
      </div>

      {loading ? (
        <Alert role="status" aria-live="polite">
          <AlertDescription>Loading general settings…</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Notification settings unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {permissionBlocked ? (
        <Alert variant="destructive" role="alert" aria-live="polite">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Notifications are not allowed</AlertTitle>
          <AlertDescription>
            Notifications are enabled in Mework, but macOS has not granted permission. Open Notification Settings and allow Mework to send notifications.
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void handleOpenNotificationSettings()} disabled={openingSettings}>
                {openingSettings ? "Opening…" : "Open Notification Settings"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadSettings()} disabled={loading}>
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                Check again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="general-notifications-enabled" className="text-lg font-semibold">
                Notifications
              </Label>
              <CardDescription className="mt-1">
                Notify me when a pull request becomes NEW or UPDATED.
              </CardDescription>
            </div>
            <input
              id="general-notifications-enabled"
              name="notificationsEnabled"
              type="checkbox"
              checked={settings?.notificationsEnabled ?? true}
              onChange={(event) => void handleEnabledChange(event.target.checked)}
              disabled={loading || saving}
              className="mt-1 size-5 accent-primary"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void handleTestNotification()} disabled={loading || testing}>
              {testing ? "Sending…" : "Test notification"}
            </Button>
            {testResult ? (
              <span className="flex items-center gap-1.5 text-sm text-success" role="status" aria-live="polite">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {testResult}
              </span>
            ) : null}
          </div>
        </CardHeader>
      </Card>
    </section>
  );
}
