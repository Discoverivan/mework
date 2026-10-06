import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, CircleAlert, Info, Loader2, Pause, Play, Settings2, Square, RotateCcw } from "lucide-react";
import "./model-testing.css";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInfoPopoverAnchor } from "@/components/shared/use-info-popover-anchor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusToast } from "@/components/shared/StatusToast";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { getAiSettings } from "@/features/settings/api";
import type { AiProvider, AiSettings } from "@/shared/contracts/settings";
import type { TokenBurnerSettings, TokenBurnerSnapshot } from "@/shared/contracts/token-burner";
import type { TranslationKey } from "@/i18n/locales/en";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { subscribeModelTestingIntegrations } from "./integration-resource";
import {
  getTokenBurnerSnapshot,
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
};

const DELAY_UNITS = { seconds: 1, minutes: 60, hours: 3600 } as const;
type DelayUnit = keyof typeof DELAY_UNITS;
const TOKEN_UNITS = { tokens: 1, thousands: 1000, millions: 1_000_000 } as const;
type TokenUnit = keyof typeof TOKEN_UNITS;

const STATUS_KEYS = {
  idle: "tokenBurner.statusIdle",
  running: "tokenBurner.statusRunning",
  paused: "tokenBurner.statusPaused",
  stopping: "tokenBurner.statusStopping",
  target_reached: "tokenBurner.statusTargetReached",
  no_prs: "tokenBurner.statusNoPullRequests",
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
  no_prs: "outline",
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
  const { triggerRef, alignOffset, onOpenChange } = useInfoPopoverAnchor();
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<TokenBurnerSnapshot | null>(null);
  const [settings, setSettings] = useState<TokenBurnerSettings>(DEFAULT_SETTINGS);
  const [repositories, setRepositories] = useState<{ key: string; name: string }[]>([]);
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [integrationAvailable, setIntegrationAvailable] = useState(false);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<Awaited<ReturnType<typeof getAiSettings>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<TokenBurnerSettings>(DEFAULT_SETTINGS);
  const [targetUnit, setTargetUnit] = useState<TokenUnit>("tokens");
  const [targetAmount, setTargetAmount] = useState(DEFAULT_SETTINGS.dailyTarget);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("seconds");
  const [delayAmount, setDelayAmount] = useState(DEFAULT_SETTINGS.delayBetweenRequestsSeconds);
  const [dailyTargetValid, setDailyTargetValid] = useState(true);
  const [delayValid, setDelayValid] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());
  const [errorNotice, setErrorNotice] = useState<{ message: string; revision: number } | null>(null);
  const lastSnapshot = useRef<TokenBurnerSnapshot | null>(null);
  const settingsDialogRef = useRef<HTMLDivElement>(null);

  function acceptSnapshot(current: TokenBurnerSnapshot) {
    lastSnapshot.current = current;
    setSnapshot(current);
    setSnapshotReceivedAt(Date.now());
    setSettings(current.settings);
  }

  function showErrorNotice(message: string) {
    setErrorNotice((current) => ({ message, revision: (current?.revision ?? 0) + 1 }));
  }

  useEffect(() => {
    const error = pageError ?? integrationError;
    if (error) showErrorNotice(error);
  }, [pageError, integrationError]);

  useEffect(() => {
    let active = true;
    const initialSnapshot = lastSnapshot.current;
    void getTokenBurnerSnapshot().then((current) => {
      // A live event can arrive while the initial command is still resolving.
      if (active && lastSnapshot.current === initialSnapshot) acceptSnapshot(current);
    }).catch((error: unknown) => {
      if (active && lastSnapshot.current === initialSnapshot) setPageError(settingsError(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    void getAiSettings().then((ai) => {
      if (active) setAiSettings(ai);
    }).catch((error: unknown) => {
      if (active) setPageError(settingsError(error));
    });
    const unsubscribeIntegrations = subscribeModelTestingIntegrations((current) => {
      if (!active) return;
      setIntegrationAvailable(current.available);
      setIntegrationLoading(current.loading);
      setRepositories(current.repositories);
      setIntegrationError(current.error == null ? null : settingsError(current.error));
    });
    const unsubscribeBurner = subscribeAppEvent(APP_EVENT.tokenBurnerChanged, (current) => {
      if (!active) return;
      const previous = lastSnapshot.current;
      if (current.error && (!previous || (
        current.error !== previous.error
        || current.status !== previous.status
        || current.sessionStartedAt !== previous.sessionStartedAt
      ))) showErrorNotice(current.error);
      acceptSnapshot(current);
    });
    const unsubscribeAi = subscribeAppEvent(APP_EVENT.aiSettingsChanged, setAiSettings);
    let currentLocalDay = new Date().toDateString();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      const nextLocalDay = new Date().toDateString();
      if (nextLocalDay === currentLocalDay) return;
      currentLocalDay = nextLocalDay;
      const beforeRefresh = lastSnapshot.current;
      void getTokenBurnerSnapshot().then((next) => {
        if (active && lastSnapshot.current === beforeRefresh) acceptSnapshot(next);
      }).catch((error: unknown) => {
        if (active && lastSnapshot.current === beforeRefresh) setPageError(settingsError(error));
      });
    }, 30_000);
    return () => {
      active = false;
      unsubscribeBurner();
      unsubscribeAi();
      unsubscribeIntegrations();
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
      acceptSnapshot(next);
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
      acceptSnapshot(next);
      setResetConfirmOpen(false);
    } catch (error) {
      setPageError(settingsError(error));
    } finally {
      setResetBusy(false);
    }
  }

  const settingsChanged = settingsDraft.dailyTarget !== settings.dailyTarget
    || settingsDraft.delayBetweenRequestsSeconds !== settings.delayBetweenRequestsSeconds
    || settingsDraft.repository !== settings.repository;
  const delaySeconds = delayAmount * DELAY_UNITS[delayUnit];
  const targetTokens = targetAmount * TOKEN_UNITS[targetUnit];
  const settingsValid = dailyTargetValid && delayValid
    && Number.isSafeInteger(targetTokens) && targetTokens >= 1000 && targetTokens <= 100_000_000
    && Number.isSafeInteger(delaySeconds) && delaySeconds >= 0 && delaySeconds <= 3600;

  function openSettings() {
    const seconds = settings.delayBetweenRequestsSeconds;
    const unit: DelayUnit = seconds > 0 && seconds % 3600 === 0 ? "hours" : seconds > 0 && seconds % 60 === 0 ? "minutes" : "seconds";
    setSettingsDraft(settings);
    const tokenUnit: TokenUnit = settings.dailyTarget % 1_000_000 === 0 ? "millions" : settings.dailyTarget % 1000 === 0 ? "thousands" : "tokens";
    setTargetUnit(tokenUnit);
    setTargetAmount(settings.dailyTarget / TOKEN_UNITS[tokenUnit]);
    setDelayUnit(unit);
    setDelayAmount(seconds / DELAY_UNITS[unit]);
    setDailyTargetValid(true);
    setDelayValid(true);
    setSavingError(null);
    setSettingsOpen(true);
  }

  function changeTarget(amount: number, unit: TokenUnit) {
    setTargetAmount(amount);
    setTargetUnit(unit);
    const tokens = amount * TOKEN_UNITS[unit];
    if (Number.isSafeInteger(tokens) && tokens >= 1000 && tokens <= 100_000_000) {
      setSettingsDraft((current) => ({ ...current, dailyTarget: tokens }));
    }
  }

  function changeDelay(amount: number, unit: DelayUnit) {
    setDelayAmount(amount);
    setDelayUnit(unit);
    const seconds = amount * DELAY_UNITS[unit];
    if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 3600) {
      setSettingsDraft((current) => ({ ...current, delayBetweenRequestsSeconds: seconds }));
    }
  }

  async function saveSettings() {
    if (settingsSaving || !settingsChanged || !settingsValid) return;
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
  const repositoryQuery = repositorySearch.trim().toLocaleLowerCase();
  const matchingRepositories = repositories.filter((repository) => `${repository.name} ${repository.key}`.toLocaleLowerCase().includes(repositoryQuery));
  const lastError = pageError ?? integrationError ?? snapshot?.error;

  if (loading) return <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-5 animate-spin" aria-label={t("tokenBurner.title")} /></div>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0!"
        title={t("tokenBurner.title")}
        titleId="token-burner-title"
        description={t("tokenBurner.subtitle")}
        actions={(
          <Button type="button" variant="outline" onClick={openSettings}>
            <Settings2 data-icon="inline-start" />{t("tokenBurner.settings")}
          </Button>
        )}
      />

      {errorNotice
        ? <StatusToast key={errorNotice.revision} variant="error" duration={6000} message={t("tokenBurner.error", { error: errorNotice.message })} onDismiss={() => setErrorNotice(null)} />
        : integrationLoading ? <StatusToast variant="loading" message={t("tokenBurner.loadingIntegrations")} /> : null}
      {snapshot?.previousSessionInterrupted ? <Alert><AlertDescription>{t("tokenBurner.interruptedHint")}</AlertDescription></Alert> : null}
      {!integrationLoading && !integrationAvailable && !integrationError ? <Alert><AlertDescription>{t("tokenBurner.bitbucketRequired")}</AlertDescription></Alert> : null}
      {!aiSelection.ready ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("tokenBurner.aiSettingsMissing")}</span>
            <Button type="button" variant="outline" size="sm" onClick={openAiSettings}>{t("tokenBurner.changeAiSettings")}</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3" aria-label={t("tokenBurner.status")}>
        <Card className="text-sm">
          <CardHeader className="px-4 pb-2 pt-3.5"><CardTitle className="text-base font-semibold leading-tight">{t("tokenBurner.usedToday")}</CardTitle><p className="text-base font-medium leading-snug tabular-nums">{formatTokens(tokensToday)}</p></CardHeader>
          <CardContent className="flex justify-end px-4 pb-3.5 pt-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setResetConfirmOpen(true)} disabled={!canResetDailyProgress || resetBusy}>
              {resetBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{t("tokenBurner.resetDailyProgress")}
            </Button>
          </CardContent>
        </Card>
        <Card className="text-sm">
          <CardHeader className="px-4 pb-2 pt-3.5"><CardTitle className="text-base font-semibold leading-tight">{t("tokenBurner.dailyTarget")}</CardTitle><p className="text-base font-medium leading-snug tabular-nums">{percent}%</p></CardHeader>
          <CardContent className="flex flex-col gap-2 px-4 pb-3.5">
            <div role="progressbar" aria-label={t("tokenBurner.dailyTarget")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">{formatTokens(tokensToday, true)} / {formatTokens(target, true)}</p>
          </CardContent>
        </Card>
        <Card className="text-sm" data-info-popover-boundary>
          <CardHeader className="px-4 pb-2 pt-3.5"><CardTitle className="text-base font-semibold leading-tight">{t("tokenBurner.activeFor")}</CardTitle><p className="text-base font-medium leading-snug tabular-nums">{activeForLabel}</p></CardHeader>
          <CardContent className="flex items-center gap-1.5 px-4 pb-3.5">
            <Badge variant={statusVariant}>{t(statusKey)}</Badge>
            {lastError ? (
              <Popover onOpenChange={onOpenChange}>
                <PopoverTrigger asChild>
                  <button ref={triggerRef} type="button" className="inline-flex size-5 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("tokenBurner.errorDetailsTitle")} title={t("tokenBurner.errorDetailsTitle")}>
                    <Info className="size-3.5" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" alignOffset={alignOffset} sideOffset={6} className="w-max max-w-[min(20rem,calc(100vw-2rem))]">
                  <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{lastError}</p>
                </PopoverContent>
              </Popover>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="text-sm">
        <CardHeader className="px-4 py-3.5">
          <CardTitle className="text-base font-semibold leading-tight">{t("tokenBurner.configuration")}</CardTitle>
          <CardDescription className="leading-snug">{t("tokenBurner.configurationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 px-4 pb-3.5 lg:grid-cols-2">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <p className="text-sm text-muted-foreground">{t("tokenBurner.action")}</p>
              <p className="font-medium">{t("tokenBurner.reviewPullRequests")}</p>
            </Field>
            <Field>
              <FieldLabel htmlFor="token-burner-repository">{t("tokenBurner.repository")}</FieldLabel>
              <Popover open={repositoryPickerOpen} onOpenChange={(open) => {
                setRepositoryPickerOpen(open);
                if (open) setRepositorySearch("");
              }}>
                <PopoverTrigger asChild>
                  <Button id="token-burner-repository" type="button" variant="outline" role="combobox" aria-label={t("tokenBurner.repository")} aria-expanded={repositoryPickerOpen} aria-haspopup="dialog" disabled={runningOrStopping || !integrationAvailable} className="w-fit max-w-full justify-between gap-3 font-normal">
                    <span className="truncate">{selectedRepository?.name ?? settings.repository ?? t("tokenBurner.allRepositories")}</span>
                    <ChevronDown className="opacity-50" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" aria-label={t("tokenBurner.repository")} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
                  <Input aria-label={t("tokenBurner.searchRepository")} placeholder={t("tokenBurner.searchRepository")} value={repositorySearch} onChange={(event) => setRepositorySearch(event.target.value)} />
                  <ul aria-label={t("tokenBurner.repositoryResults")} className="flex max-h-[min(18rem,40vh)] flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
                    {[{ key: null, name: t("tokenBurner.allRepositories") }, ...matchingRepositories].map((repository) => (
                      <li key={repository.key ?? "__all__"}>
                        <button type="button" aria-pressed={settings.repository === repository.key} className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:text-primary focus-visible:text-primary" onClick={() => {
                          changeSettings("repository", repository.key);
                          setRepositoryPickerOpen(false);
                        }}>
                          <span className="min-w-0 break-words">{repository.name}</span>
                          {settings.repository === repository.key ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {matchingRepositories.length === 0 && repositoryQuery ? <p className="text-sm text-muted-foreground">{t("tokenBurner.noMatchingRepositories")}</p> : null}
                </PopoverContent>
              </Popover>
            </Field>
          </FieldGroup>
          <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" aria-label={t("tokenBurner.aiConfiguration")}>
            <div className="min-w-0"><p className="text-sm text-muted-foreground">{t("tokenBurner.aiProvider")}</p><p className="truncate font-medium">{aiSelection.provider?.name ?? t("tokenBurner.aiSettingsMissing")}</p></div>
            <div className="min-w-0"><p className="text-sm text-muted-foreground">{t("settings.ai.model")}</p><p className="truncate font-medium">{aiSelection.model || t("settings.ai.notSelected")}</p></div>
            <div><p className="text-sm text-muted-foreground">{t("settings.ai.reasoning")}</p><p className="font-medium">{aiSelection.supportsCodexTuning ? aiSelection.reasoning : t("tokenBurner.notApplied")}</p></div>
            <div><p className="text-sm text-muted-foreground">{t("settings.ai.fastMode")}</p><p className="font-medium">{aiSelection.supportsCodexTuning ? t(aiSelection.fastMode ? "tokenBurner.enabled" : "tokenBurner.disabled") : t("tokenBurner.notApplied")}</p></div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2"><Badge variant={aiSelection.ready ? "outline" : "destructive"} className={cn("model-testing-ai-status min-h-9 gap-2 rounded-md px-3 text-sm font-medium", aiSelection.ready && "border-success/30 bg-success/10 text-success")}>{aiSelection.ready ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="size-4 shrink-0" aria-hidden="true" />}{t(aiSelection.ready ? "tokenBurner.aiReady" : "tokenBurner.aiSettingsMissing")}</Badge><Button type="button" variant="secondary" size="sm" onClick={openAiSettings}>{t("tokenBurner.changeAiSettings")}</Button></div>
          </section>
        </CardContent>
      </Card>

      <Card className="text-sm">
        <CardHeader className="px-4 pb-2 pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <CardTitle className="text-base font-semibold leading-tight">{t("tokenBurner.activity")}</CardTitle>
              {selectedRepository ? <CardDescription>{selectedRepository.name}</CardDescription> : null}
            </div>
            <div className="shrink-0">
              {state === "running" ? <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void runAction("pause")} disabled={actionBusy}><Pause data-icon="inline-start" />{t("tokenBurner.pause")}</Button><Button variant="outline" size="sm" onClick={() => void runAction("stop")} disabled={actionBusy}><Square data-icon="inline-start" />{t("tokenBurner.stop")}</Button></div>
                : state === "paused" ? <div className="flex gap-2"><Button size="sm" onClick={() => void runAction("resume")} disabled={actionBusy}><Play data-icon="inline-start" />{t("tokenBurner.resume")}</Button><Button variant="outline" size="sm" onClick={() => void runAction("stop")} disabled={actionBusy}><Square data-icon="inline-start" />{t("tokenBurner.stop")}</Button></div>
                  : <Button size="sm" onClick={() => void runAction("start")} disabled={actionBusy || !integrationAvailable || !aiSelection.ready || state === "stopping"}>{state === "error" || state === "interrupted" ? <RotateCcw data-icon="inline-start" /> : <Play data-icon="inline-start" />}{t(state === "error" || state === "interrupted" ? "tokenBurner.retry" : "tokenBurner.start")}</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4 pb-3.5 pt-0">
          {currentIterations.length === 0 && completedIterations.length === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground">{state === "running" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{t(state === "running" ? "tokenBurner.findingPullRequest" : state === "no_prs" ? "tokenBurner.noAssignedPullRequests" : "tokenBurner.noActiveWork")}</p> : null}
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
        <DialogContent ref={settingsDialogRef} tabIndex={-1} aria-describedby={undefined} onOpenAutoFocus={(event) => {
          event.preventDefault();
          settingsDialogRef.current?.focus();
        }}>
          <DialogHeader className="px-1"><DialogTitle className="text-base leading-tight">{t("tokenBurner.settings")}</DialogTitle></DialogHeader>
          <DialogBody className="p-1">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <ManualNumberField id="burner-daily-target" label={t("tokenBurner.dailyTargetField")}
                  description={t("tokenBurner.dailyTargetHelp")} value={targetAmount} min={1000} max={100_000_000} scale={TOKEN_UNITS[targetUnit]} allowDecimals
                  disabled={settingsSaving} onValidityChange={setDailyTargetValid}
                  errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 1000 / TOKEN_UNITS[targetUnit], max: 100_000_000 / TOKEN_UNITS[targetUnit] }), whole: t("tokenBurner.targetWholeTokens") }}
                  onChange={(amount) => changeTarget(amount, targetUnit)} />
                <div className="grid w-fit gap-2.5">
                  <span id="burner-target-unit-label" className="px-1 text-sm font-medium leading-none">{t("tokenBurner.tokenUnit")}</span>
                  <Select value={targetUnit} onValueChange={(unit) => changeTarget(targetAmount, unit as TokenUnit)} disabled={settingsSaving}>
                    <SelectTrigger aria-labelledby="burner-target-unit-label" className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(TOKEN_UNITS) as TokenUnit[]).map((unit) => <SelectItem key={unit} value={unit}>{t(`tokenBurner.unit.${unit}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <ManualNumberField id="burner-request-delay" label={t("tokenBurner.delayBetweenRequests")}
                  description={t("tokenBurner.delayHelp")} value={delayAmount} min={0} max={3600} scale={DELAY_UNITS[delayUnit]} allowDecimals
                  disabled={settingsSaving} onValidityChange={setDelayValid}
                  errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 0, max: 3600 / DELAY_UNITS[delayUnit] }), whole: t("tokenBurner.delayWholeSeconds") }}
                  onChange={(amount) => changeDelay(amount, delayUnit)} />
                <div className="grid w-fit gap-2.5">
                  <span id="burner-delay-unit-label" className="px-1 text-sm font-medium leading-none">{t("tokenBurner.timeUnit")}</span>
                  <Select value={delayUnit} onValueChange={(unit) => changeDelay(delayAmount, unit as DelayUnit)} disabled={settingsSaving}>
                    <SelectTrigger aria-labelledby="burner-delay-unit-label" className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(DELAY_UNITS) as DelayUnit[]).map((unit) => <SelectItem key={unit} value={unit}>{t(`tokenBurner.unit.${unit}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {savingError ? <Alert variant="destructive"><AlertDescription>{savingError}</AlertDescription></Alert> : null}
            </div>
          </DialogBody>
          <DialogFooter className="px-1">
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>{t("tokenBurner.cancel")}</Button>
            <Button type="button" onClick={() => void saveSettings()} disabled={settingsSaving || !settingsChanged || !settingsValid}>{settingsSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{t("settings.common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
