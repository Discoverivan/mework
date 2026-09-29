import { useEffect, useMemo, useState } from "react";
import { Loader2, Pause, Play, Settings2, Square, RotateCcw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PageHeader } from "@/components/shared/PageHeader";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { getAiSettings } from "@/features/settings/api";
import type { AiProvider, AiSettings } from "@/shared/contracts/settings";
import type { TokenBurnerSettings, TokenBurnerSnapshot } from "@/shared/contracts/token-burner";
import type { TranslationKey } from "@/i18n/locales/en";
import { useI18n } from "@/i18n/context";
import {
  getTokenBurnerSnapshot,
  isTokenBurnerIntegrationAvailable,
  listTokenBurnerRepositories,
  pauseTokenBurner,
  resumeTokenBurner,
  resetTokenBurnerDailyTarget,
  saveTokenBurnerSettings,
  startTokenBurner,
  stopTokenBurner,
} from "./api";

const DEFAULT_SETTINGS: TokenBurnerSettings = {
  dailyTarget: 2_000_000,
  delayBetweenRequestsSeconds: 10,
  repository: null,
  pullRequestStrategy: "awaiting_my_review",
};

const STATUS_KEYS = {
  idle: "tokenBurner.statusIdle",
  running: "tokenBurner.statusRunning",
  paused: "tokenBurner.statusPaused",
  stopping: "tokenBurner.statusStopping",
  target_reached: "tokenBurner.statusTargetReached",
  completed: "tokenBurner.statusCompleted",
  error: "tokenBurner.statusError",
  interrupted: "tokenBurner.statusInterrupted",
} as const;

const PHASE_KEYS: Record<string, TranslationKey> = {
  loading_pr: "tokenBurner.phaseLoadingPr",
  preparing_context: "tokenBurner.phasePreparingContext",
  reviewing_code: "tokenBurner.phaseReviewingCode",
  analyzing_potential_issues: "tokenBurner.phaseAnalyzing",
  completed: "tokenBurner.phaseCompleted",
  failed: "tokenBurner.phaseFailed",
  interrupted: "tokenBurner.statusInterrupted",
};

const PERSPECTIVE_KEYS: Record<string, TranslationKey> = {
  "Correctness & regressions": "tokenBurner.perspectiveCorrectness",
  "Bugs & edge cases": "tokenBurner.perspectiveBugs",
  Security: "tokenBurner.perspectiveSecurity",
  Performance: "tokenBurner.perspectivePerformance",
  Architecture: "tokenBurner.perspectiveArchitecture",
  Maintainability: "tokenBurner.perspectiveMaintainability",
  Testing: "tokenBurner.perspectiveTesting",
  "Independent regression check": "tokenBurner.perspectiveIndependentRegression",
};

const STATUS_VARIANTS = {
  idle: "secondary",
  running: "default",
  paused: "secondary",
  stopping: "secondary",
  target_reached: "outline",
  completed: "outline",
  error: "destructive",
  interrupted: "outline",
} as const;

function formatTokens(value: number, compact = false): string {
  return new Intl.NumberFormat(undefined, compact
    ? { notation: "compact", maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 }).format(value);
}

function effectiveAiSelection(
  settings: AiSettings,
  providers: AiProvider[],
) {
  const profile = settings.tokenBurner;
  const id = profile?.provider ?? settings.provider;
  const instanceId = profile ? profile.providerInstanceId : settings.providerInstanceId;
  const provider = providers.find((candidate) => candidate.id === id
    && (candidate.id !== "openai-compatible"
      || (candidate.instanceId ?? "legacy") === (instanceId ?? "legacy")));
  const model = profile?.model ?? settings.model;
  return {
    provider,
    model,
    reasoning: profile?.reasoning ?? settings.reasoning,
    fastMode: profile?.fastMode ?? settings.fastMode,
    supportsCodexTuning: id === "codex-cli",
    ready: id !== null
      && provider?.available === true
      && provider.status === "connected"
      && provider.models.includes(model),
  };
}

function settingsError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Unknown error";
}

export function TokenBurnerPage() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<TokenBurnerSnapshot | null>(null);
  const [settings, setSettings] = useState<TokenBurnerSettings>(DEFAULT_SETTINGS);
  const [repositories, setRepositories] = useState<{ key: string; name: string }[]>([]);
  const [integrationAvailable, setIntegrationAvailable] = useState(false);
  const [aiSettings, setAiSettings] = useState<Awaited<ReturnType<typeof getAiSettings>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<TokenBurnerSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    void Promise.all([
      getTokenBurnerSnapshot(),
      getAiSettings(),
      isTokenBurnerIntegrationAvailable(),
    ]).then(async ([current, ai, hasIntegration]) => {
      if (!active) return;
      setSnapshot(current);
      setSnapshotReceivedAt(Date.now());
      setSettings(current.settings);
      setAiSettings(ai);
      setIntegrationAvailable(hasIntegration);
      if (hasIntegration) {
        try {
          const repos = await listTokenBurnerRepositories();
          if (active) setRepositories(repos);
        } catch {
          if (active) setRepositories([]);
        }
      }
    }).catch((error: unknown) => {
      if (active) setPageError(settingsError(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    const unsubscribeBurner = subscribeAppEvent(APP_EVENT.tokenBurnerChanged, (current) => {
      if (!active) return;
      setSnapshot(current);
      setSnapshotReceivedAt(Date.now());
      setSettings(current.settings);
    });
    const unsubscribeAi = subscribeAppEvent(APP_EVENT.aiSettingsChanged, setAiSettings);
    let currentLocalDay = new Date().toDateString();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      const nextLocalDay = new Date().toDateString();
      if (nextLocalDay === currentLocalDay) return;
      currentLocalDay = nextLocalDay;
      void getTokenBurnerSnapshot().then((next) => {
        if (!active) return;
        setSnapshot(next);
        setSnapshotReceivedAt(Date.now());
        setSettings(next.settings);
      }).catch((error: unknown) => {
        if (active) setPageError(settingsError(error));
      });
    }, 30_000);
    return () => {
      active = false;
      unsubscribeBurner();
      unsubscribeAi();
      window.clearInterval(timer);
    };
  }, []);

  const aiSelection = useMemo(() => aiSettings
    ? effectiveAiSelection(aiSettings.settings, aiSettings.providers)
    : {
      provider: undefined,
      model: "",
      reasoning: "medium" as const,
      fastMode: false,
      supportsCodexTuning: false,
      ready: false,
    }, [aiSettings]);
  const state = snapshot?.status ?? "idle";
  const tokensToday = snapshot?.tokensUsedToday ?? 0;
  const target = settings.dailyTarget;
  const percent = target > 0 ? Math.min(100, Math.round((tokensToday / target) * 100)) : 0;
  const activeFor = (snapshot?.activeForMs ?? 0) + (state === "running" ? Math.max(0, now - snapshotReceivedAt) : 0);
  const statusKey = STATUS_KEYS[state as keyof typeof STATUS_KEYS] ?? STATUS_KEYS.idle;
  const statusVariant = STATUS_VARIANTS[state as keyof typeof STATUS_VARIANTS] ?? STATUS_VARIANTS.idle;
  const activeMinutes = Math.floor(Math.max(0, activeFor) / 60_000);
  const activeHours = Math.floor(activeMinutes / 60);
  const remainingMinutes = activeMinutes % 60;
  const activeForLabel = activeHours > 0
    ? t("tokenBurner.durationHours", { hours: activeHours, minutes: remainingMinutes })
    : t("tokenBurner.durationMinutes", { minutes: remainingMinutes });

  function changeSettings<K extends keyof TokenBurnerSettings>(field: K, value: TokenBurnerSettings[K]) {
    const next = { ...settings, [field]: value };
    setSettings(next);
    setSnapshot((current) => current ? { ...current, settings: next } : current);
    void saveTokenBurnerSettings(next).then((saved) => {
      setSettings(saved);
      setSnapshot((current) => current ? { ...current, settings: saved } : current);
    }).catch((error: unknown) => setPageError(settingsError(error)));
  }

  function openAiSettings() {
    window.location.hash = "#settings/ai?focus=token-burner";
  }

  async function runAction(action: "start" | "pause" | "resume" | "stop") {
    setActionBusy(true);
    setPageError(null);
    try {
      const handlers = { start: startTokenBurner, pause: pauseTokenBurner, resume: resumeTokenBurner, stop: stopTokenBurner };
      const next = await handlers[action]();
      setSnapshot(next);
      setSettings(next.settings);
    } catch (error) {
      setPageError(settingsError(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function resetDailyProgress() {
    setResetBusy(true);
    setPageError(null);
    try {
      const next = await resetTokenBurnerDailyTarget();
      setSnapshot(next);
      setSnapshotReceivedAt(Date.now());
      setSettings(next.settings);
      setResetConfirmOpen(false);
    } catch (error) {
      setPageError(settingsError(error));
    } finally {
      setResetBusy(false);
    }
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSavingError(null);
    try {
      const saved = await saveTokenBurnerSettings(settingsDraft);
      setSettings(saved);
      setSnapshot((current) => current ? { ...current, settings: saved } : current);
      setSettingsOpen(false);
    } catch (error) {
      setSavingError(settingsError(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  const runningOrStopping = state === "running" || state === "stopping";
  const canResetDailyProgress = !["running", "paused", "stopping"].includes(state);
  const currentIterations = snapshot?.activeIterations ?? [];
  const completedIterations = snapshot?.completedIterations ?? [];
  const selectedRepository = repositories.find((repository) => repository.key === settings.repository);

  if (loading) return <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-5 animate-spin" aria-label={t("tokenBurner.title")} /></div>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("tokenBurner.title")}
        titleId="token-burner-title"
        description={t("tokenBurner.subtitle")}
        actions={(
          <Button type="button" variant="outline" onClick={() => { setSettingsDraft(settings); setSettingsOpen(true); }}>
            <Settings2 data-icon="inline-start" />{t("tokenBurner.settings")}
          </Button>
        )}
      />

      {pageError ? <Alert variant="destructive"><AlertDescription>{t("tokenBurner.error", { error: pageError })}</AlertDescription></Alert> : null}
      {!pageError && snapshot?.error ? <Alert variant="destructive"><AlertDescription>{t("tokenBurner.error", { error: snapshot.error })}</AlertDescription></Alert> : null}
      {snapshot?.previousSessionInterrupted ? <Alert><AlertDescription>{t("tokenBurner.interruptedHint")}</AlertDescription></Alert> : null}
      {!integrationAvailable ? <Alert><AlertDescription>{t("tokenBurner.bitbucketRequired")}</AlertDescription></Alert> : null}
      {!aiSelection.ready ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("tokenBurner.aiSettingsMissing")}</span>
            <Button type="button" variant="outline" size="sm" onClick={openAiSettings}>{t("tokenBurner.changeAiSettings")}</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3" aria-label={t("tokenBurner.status")}>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t("tokenBurner.usedToday")}</CardDescription><CardTitle className="text-2xl tabular-nums">{formatTokens(tokensToday)}</CardTitle></CardHeader>
          <CardContent className="flex justify-end pt-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setResetConfirmOpen(true)} disabled={!canResetDailyProgress || resetBusy}>
              {resetBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{t("tokenBurner.resetDailyProgress")}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t("tokenBurner.dailyTarget")}</CardDescription><CardTitle className="text-2xl tabular-nums">{percent}%</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div role="progressbar" aria-label={t("tokenBurner.dailyTarget")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">{formatTokens(tokensToday, true)} / {formatTokens(target, true)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t("tokenBurner.activeFor")}</CardDescription><CardTitle className="text-2xl tabular-nums">{activeForLabel}</CardTitle></CardHeader>
          <CardContent><Badge variant={statusVariant}>{t(statusKey)}</Badge></CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("tokenBurner.configuration")}</CardTitle>
          <CardDescription>{t("tokenBurner.configurationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <p className="text-sm text-muted-foreground">{t("tokenBurner.action")}</p>
              <p className="font-medium">{t("tokenBurner.reviewPullRequests")}</p>
            </Field>
            <Field>
              <FieldLabel htmlFor="token-burner-repository">{t("tokenBurner.repository")}</FieldLabel>
              <Select value={settings.repository ?? "__all__"} onValueChange={(value) => changeSettings("repository", value === "__all__" ? null : value)} disabled={runningOrStopping || !integrationAvailable}>
                <SelectTrigger id="token-burner-repository"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="__all__">{t("tokenBurner.allRepositories")}</SelectItem>{repositories.map((repository) => <SelectItem key={repository.key} value={repository.key}>{repository.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="token-burner-strategy">{t("tokenBurner.prSelection")}</FieldLabel>
              <Select value={settings.pullRequestStrategy} onValueChange={(value) => changeSettings("pullRequestStrategy", value as TokenBurnerSettings["pullRequestStrategy"])} disabled={runningOrStopping}>
                <SelectTrigger id="token-burner-strategy"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="awaiting_my_review">{t("tokenBurner.awaitingReview")}</SelectItem><SelectItem value="open">{t("tokenBurner.openPullRequests")}</SelectItem><SelectItem value="random_open">{t("tokenBurner.randomOpenPullRequest")}</SelectItem></SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" aria-label={t("tokenBurner.aiConfiguration")}>
            <div className="min-w-0"><p className="text-sm text-muted-foreground">{t("tokenBurner.aiProvider")}</p><p className="truncate font-medium">{aiSelection.provider?.name ?? t("tokenBurner.aiSettingsMissing")}</p></div>
            <div className="min-w-0"><p className="text-sm text-muted-foreground">{t("settings.ai.model")}</p><p className="truncate font-medium">{aiSelection.model || t("settings.ai.notSelected")}</p></div>
            <div><p className="text-sm text-muted-foreground">{t("settings.ai.reasoning")}</p><p className="font-medium">{aiSelection.supportsCodexTuning ? aiSelection.reasoning : t("tokenBurner.notApplied")}</p></div>
            <div><p className="text-sm text-muted-foreground">{t("settings.ai.fastMode")}</p><p className="font-medium">{aiSelection.supportsCodexTuning ? t(aiSelection.fastMode ? "tokenBurner.enabled" : "tokenBurner.disabled") : t("tokenBurner.notApplied")}</p></div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2"><Badge variant={aiSelection.ready ? "secondary" : "destructive"}>{t(aiSelection.ready ? "tokenBurner.aiReady" : "tokenBurner.aiSettingsMissing")}</Badge><Button type="button" variant="ghost" size="sm" onClick={openAiSettings}>{t("tokenBurner.changeAiSettings")}</Button></div>
          </section>
        </CardContent>
        <div className="flex justify-end px-6 pb-5">
          {state === "running" ? <div className="flex gap-2"><Button variant="outline" onClick={() => void runAction("pause")} disabled={actionBusy}><Pause data-icon="inline-start" />{t("tokenBurner.pause")}</Button><Button variant="outline" onClick={() => void runAction("stop")} disabled={actionBusy}><Square data-icon="inline-start" />{t("tokenBurner.stop")}</Button></div>
            : state === "paused" ? <div className="flex gap-2"><Button onClick={() => void runAction("resume")} disabled={actionBusy}><Play data-icon="inline-start" />{t("tokenBurner.resume")}</Button><Button variant="outline" onClick={() => void runAction("stop")} disabled={actionBusy}><Square data-icon="inline-start" />{t("tokenBurner.stop")}</Button></div>
              : <Button onClick={() => void runAction("start")} disabled={actionBusy || !integrationAvailable || !aiSelection.ready || state === "stopping"}>{state === "error" || state === "interrupted" ? <RotateCcw data-icon="inline-start" /> : <Play data-icon="inline-start" />}{t(state === "error" || state === "interrupted" ? "tokenBurner.retry" : "tokenBurner.start")}</Button>}
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("tokenBurner.runningNow")}</CardTitle><CardDescription>{selectedRepository?.name}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {currentIterations.length === 0 && completedIterations.length === 0 ? <p className="text-sm text-muted-foreground">{t("tokenBurner.noActiveWork")}</p> : null}
          {currentIterations.map((iteration) => (
            <div key={iteration.id} className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium">PR #{iteration.pullRequestId} — {iteration.repositoryName}</p><p className="truncate text-sm text-muted-foreground">{iteration.pullRequestTitle}</p></div>
                <Badge variant="secondary">{t("tokenBurner.runningNow")}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" /><span>{t("tokenBurner.currentReview")}: {t(PERSPECTIVE_KEYS[iteration.perspective] ?? "tokenBurner.perspectiveUnknown")}</span></div>
              <p className="text-sm text-muted-foreground">{t(PHASE_KEYS[iteration.phase] ?? "tokenBurner.phaseAnalyzing")}</p>
            </div>
          ))}
          {completedIterations.map((iteration) => (
            <div key={iteration.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
              <span className="min-w-0 truncate">✓ PR #{iteration.pullRequestId} · {iteration.repositoryName} · {t(PERSPECTIVE_KEYS[iteration.perspective] ?? "tokenBurner.perspectiveUnknown")}</span>
              <span className="tabular-nums text-muted-foreground">{t("tokenBurner.tokens", { count: formatTokens(iteration.totalTokens) })}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tokenBurner.resetDailyProgressTitle")}</DialogTitle>
            <DialogDescription>{t("tokenBurner.resetDailyProgressDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetConfirmOpen(false)}>{t("tokenBurner.cancel")}</Button>
            <Button type="button" variant="destructive" onClick={() => void resetDailyProgress()} disabled={resetBusy}>
              {resetBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{t("tokenBurner.confirmResetDailyProgress")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("tokenBurner.settingsTitle")}</DialogTitle><DialogDescription>{t("tokenBurner.settingsDescription")}</DialogDescription></DialogHeader>
          <DialogBody>
            <FieldGroup className="gap-4 pr-1">
              <Field>
                <FieldLabel htmlFor="burner-daily-target">{t("tokenBurner.dailyTargetField")}</FieldLabel>
                <Input id="burner-daily-target" type="number" min={1000} max={100_000_000} value={settingsDraft.dailyTarget} onChange={(event) => setSettingsDraft((current) => ({ ...current, dailyTarget: Number(event.target.value) }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="burner-request-delay">{t("tokenBurner.delayBetweenRequests")}</FieldLabel>
                <Input id="burner-request-delay" type="number" min={0} max={3600} value={settingsDraft.delayBetweenRequestsSeconds} onChange={(event) => setSettingsDraft((current) => ({ ...current, delayBetweenRequestsSeconds: Number(event.target.value) }))} />
              </Field>
              {savingError ? <Alert variant="destructive"><AlertDescription>{savingError}</AlertDescription></Alert> : null}
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>{t("tokenBurner.cancel")}</Button>
            <Button type="button" onClick={() => void saveSettings()} disabled={settingsSaving}>{settingsSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{t("tokenBurner.saveSettings")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
