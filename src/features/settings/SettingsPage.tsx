import { AlertTriangle, CheckCircle2, ChevronDown, Circle, CircleHelp, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AiProvider,
  AiProviderStatus,
  AiReasoning,
  AiSettings,
  AiSettingsPageData,
  IntegrationHealth,
  IntegrationHealthStatus,
  IntegrationKind,
  IntegrationRedacted,
  IntegrationSaveInput,
} from "../../shared/contracts/settings";
import {
  deleteIntegration,
  getAiSettings,
  listIntegrations,
  refreshIntegrationHealth,
  saveAiSettings,
  saveIntegration,
  saveOpenAiCompatibleProvider,
} from "./api";
import { validateJiraProjectKey } from "./planning-projects/api";
import { resolveConfluenceSpace } from "../confluence/api";
import { ManagedProjectsSettings } from "./planning-projects/ManagedProjectsSettings";
import { GeneralSettingsPage } from "./general/GeneralSettingsPage";
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";

type IntegrationForm = {
  baseUrl: string;
  secret: string;
  allowInsecureTls: boolean;
};

type OpenAiCompatibleForm = {
  baseUrl: string;
  token: string;
  allowInsecureTls: boolean;
};

type HealthConfirmation = {
  kind: IntegrationKind;
  provider: Provider;
  health: IntegrationHealth;
  saveInput?: IntegrationSaveInput;
};

type Provider = {
  kind: IntegrationKind;
  label: string;
  descriptionKey: TranslationKey;
  placeholder: string;
};

const PROVIDERS: Provider[] = [
  {
    kind: "jira",
    label: "Jira",
    descriptionKey: "settings.data.jiraDescription",
    placeholder: "https://jira.example.com",
  },
  {
    kind: "bitbucket",
    label: "Bitbucket",
    descriptionKey: "settings.data.bitbucketDescription",
    placeholder: "https://bitbucket.example.com",
  },
  {
    kind: "confluence",
    label: "Confluence",
    descriptionKey: "settings.data.confluenceDescription",
    placeholder: "https://confluence.example.com",
  },
];

function errorMessage(error: unknown, fallback: string): string {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return message
    .replace(/\b(?:token|pat|password|secret)\b\s*["']?\s*[:=]\s*["']?[^\s,"'}]+["']?/gi, "credential details redacted")
    .replace(/\bauthorization\b\s*[:=]\s*[^\n]*/gi, "authorization details redacted")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
}

function emptyForm(): IntegrationForm {
  return { baseUrl: "", secret: "", allowInsecureTls: false };
}

function emptyOpenAiCompatibleForm(): OpenAiCompatibleForm {
  return { baseUrl: "", token: "", allowInsecureTls: false };
}

function isAllowedOpenAiUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    return (parsed.protocol === "https:" || localHttp)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}


function formForIntegration(integration: IntegrationRedacted): IntegrationForm {
  return {
    baseUrl: integration.baseUrl,
    secret: "",
    allowInsecureTls: integration.allowInsecureTls ?? false,
  };
}

function replaceIntegration(
  integrations: IntegrationRedacted[],
  nextIntegration: IntegrationRedacted,
): IntegrationRedacted[] {
  const existingIndex = integrations.findIndex((integration) => integration.id === nextIntegration.id);
  if (existingIndex >= 0) {
    return integrations.map((integration, index) =>
      index === existingIndex ? nextIntegration : integration,
    );
  }

  return [
    ...integrations.filter((integration) => integration.kind !== nextIntegration.kind),
    nextIntegration,
  ];
}

function healthStatusFor(integration: IntegrationRedacted): IntegrationHealthStatus {
  return integration.healthStatus ?? "unknown";
}

const HEALTH_LABEL_KEYS: Record<IntegrationHealthStatus, TranslationKey> = {
  working: "settings.health.working",
  unavailable: "settings.health.unavailable",
  unknown: "settings.health.unknown",
};

const AI_REASONING_OPTIONS: AiReasoning[] = ["minimal", "low", "medium", "high", "xhigh"];

const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: null,
  model: "",
  reasoning: "medium",
  fastMode: false,
};

const INITIAL_AI_DATA: AiSettingsPageData = {
  settings: DEFAULT_AI_SETTINGS,
  providers: [{
    id: "codex-cli",
    name: "Codex CLI",
    status: "loading",
    available: false,
    models: [],
    message: "Detecting Codex CLI…",
  }, {
    id: "claude-code-cli",
    name: "Claude Code CLI",
    status: "loading",
    available: false,
    models: [],
  }, {
    id: "openai-compatible",
    name: "OpenAI-compatible API",
    status: "not_configured",
    available: false,
    models: [],
  }],
};

const UNAVAILABLE_AI_DATA: AiSettingsPageData = {
  settings: DEFAULT_AI_SETTINGS,
  providers: [{
    id: "codex-cli",
    name: "Codex CLI",
    status: "unavailable",
    available: false,
    models: [],
    message: "Codex CLI could not be initialized",
  }, {
    id: "claude-code-cli",
    name: "Claude Code CLI",
    status: "unavailable",
    available: false,
    models: [],
  }, {
    id: "openai-compatible",
    name: "OpenAI-compatible API",
    status: "unavailable",
    available: false,
    models: [],
    message: "OpenAI-compatible API could not be initialized",
  }],
};

const AI_STATUS_LABEL_KEYS: Record<AiProviderStatus, TranslationKey> = {
  loading: "settings.status.loading",
  connected: "settings.status.connected",
  not_configured: "settings.status.notConfigured",
  not_found: "settings.status.cliNotFound",
  not_authenticated: "settings.status.signInRequired",
  unavailable: "settings.status.unavailable",
};

function aiStatusIcon(status: AiProviderStatus) {
  if (status === "loading") return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  if (status === "connected") return <CheckCircle2 className="size-4 text-success" aria-hidden="true" />;
  if (status === "not_configured" || status === "not_found") return <Circle className="size-4" aria-hidden="true" />;
  return <AlertTriangle className="size-4 text-warning" aria-hidden="true" />;
}

function modelForAiProvider(provider: AiProvider | null | undefined, currentModel: string): string {
  if (!provider) return "";
  if (provider.models.includes(currentModel)) return currentModel;
  return provider.models.length === 1 ? provider.models[0] : "";
}

function aiProviderReady(provider: AiProvider | undefined, model: string): boolean {
  return provider?.available === true
    && provider.status === "connected"
    && provider.models.includes(model);
}

export type SettingsSection = "general" | "ai" | "integrations" | "projects";

interface SettingsPageProps {
  section?: SettingsSection;
  updateCheckRequest?: number;
}

export function SettingsPage({ section = "integrations", updateCheckRequest = 0 }: SettingsPageProps) {
  const { t } = useI18n();
  const [integrations, setIntegrations] = useState<IntegrationRedacted[]>([]);
  const [aiData, setAiData] = useState<AiSettingsPageData>(INITIAL_AI_DATA);
  const [aiDraft, setAiDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const aiSaveRevisionRef = useRef(0);
  const [openAiDialogOpen, setOpenAiDialogOpen] = useState(false);
  const [openAiForm, setOpenAiForm] = useState<OpenAiCompatibleForm>(emptyOpenAiCompatibleForm);
  const [openAiSaving, setOpenAiSaving] = useState(false);
  const [openAiError, setOpenAiError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<IntegrationKind | null>(null);
  const [forms, setForms] = useState<Record<IntegrationKind, IntegrationForm>>({
    jira: emptyForm(),
    bitbucket: emptyForm(),
    confluence: emptyForm(),
  });
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"save" | "delete" | null>(null);
  const [healthCheckKind, setHealthCheckKind] = useState<IntegrationKind | null>(null);
  const [healthConfirmation, setHealthConfirmation] = useState<HealthConfirmation | null>(null);

  useEffect(() => {
    if (section === "general") {
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    if (section === "ai") {
      setAiData(INITIAL_AI_DATA);
      setAiDraft(DEFAULT_AI_SETTINGS);
      setAiError(null);
      void getAiSettings()
        .then((loadedAiData) => {
          if (!active) return;
          setAiData(loadedAiData);
          setAiDraft(loadedAiData.settings);
        })
        .catch(() => {
          if (!active) return;
          setAiData(UNAVAILABLE_AI_DATA);
          setAiError(t("settings.error.loadCodex"));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }

    void listIntegrations()
      .then((loadedIntegrations) => {
        if (!active) return;
        setIntegrations(loadedIntegrations);
        setForms((current) => {
          const next = { ...current };
          for (const integration of loadedIntegrations) {
            next[integration.kind] = formForIntegration(integration);
          }
          return next;
        });
      })
      .catch(() => {
        if (active) setError(t("settings.error.loadIntegrations"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retry, section, t]);

  useEffect(() => {
    if (section !== "ai") return;
    return subscribeAppEvent(APP_EVENT.aiSettingsChanged, (updated) => {
      setAiData(updated);
      setAiError(null);
    });
  }, [section]);

  useEffect(() => {
    return subscribeAppEvent(APP_EVENT.integrationsHealthRefreshed, (loadedIntegrations) => {
      if (!Array.isArray(loadedIntegrations)) return;
      setIntegrations(loadedIntegrations);
      setForms((current) => {
        const next = { ...current };
        for (const integration of loadedIntegrations) {
          next[integration.kind] = formForIntegration(integration);
        }
        return next;
      });
    });
  }, []);

  const selectedIntegration = useMemo(
    () => (selectedKind ? integrations.find((integration) => integration.kind === selectedKind) : undefined),
    [integrations, selectedKind],
  );
  const selectedAiProvider = aiData?.providers.find((provider) => provider.id === aiDraft.provider);
  const aiLoading = aiData?.providers.some((provider) => provider.status === "loading") === true;
  const aiReady = aiProviderReady(selectedAiProvider, aiDraft.model);
  const provider = selectedKind
    ? PROVIDERS.find((candidate) => candidate.kind === selectedKind)
    : undefined;
  const form = selectedKind ? forms[selectedKind] : undefined;
  const controlsDisabled = action !== null;

  useEffect(() => {
    if (!selectedAiProvider || selectedAiProvider.models.length !== 1) return;
    const onlyModel = selectedAiProvider.models[0];
    setAiDraft((current) => {
      if (current.provider !== selectedAiProvider.id || current.model === onlyModel) return current;
      return { ...current, model: onlyModel };
    });
  }, [selectedAiProvider, aiDraft.model]);

  const validateProjectKey = useCallback(
    (projectKey: string, integrationId?: string) => {
      const jira = integrations.find(
        (integration) =>
          integration.kind === "jira" && integration.enabled && (!integrationId || integration.id === integrationId),
      );
      if (!jira) return Promise.reject(new Error(t("teams.integrationRequired")));
      return validateJiraProjectKey({ integrationId: jira.id, projectKey });
    },
    [integrations, t],
  );

  const resolveTeamConfluenceSpace = useCallback(
    (keyOrUrl: string, integrationId?: string) => {
      const confluence = integrations.find(
        (integration) => integration.kind === "confluence"
          && integration.enabled
          && (!integrationId || integration.id === integrationId),
      );
      if (!confluence) return Promise.reject(new Error(t("teams.confluenceIntegrationRequired")));
      return resolveConfluenceSpace(confluence.id, keyOrUrl);
    },
    [integrations, t],
  );

  const hasJiraIntegration = integrations.some((integration) => integration.kind === "jira");

  useEffect(() => {
    const revision = aiSaveRevisionRef.current + 1;
    aiSaveRevisionRef.current = revision;
    const unchanged = aiDraft.provider === aiData.settings.provider
      && aiDraft.model === aiData.settings.model
      && aiDraft.reasoning === aiData.settings.reasoning
      && aiDraft.fastMode === aiData.settings.fastMode;
    if (unchanged || !aiDraft.provider || !aiReady) return;

    const timer = window.setTimeout(() => {
      setAiSaving(true);
      setAiError(null);
      void saveAiSettings(aiDraft).then((saved) => {
        if (aiSaveRevisionRef.current !== revision) return;
        setAiData(saved);
        setAiDraft(saved.settings);
        emitAppEvent(APP_EVENT.aiSettingsChanged, saved);
        setAiSaved(true);
        setAiSaving(false);
      }).catch((saveError) => {
        if (aiSaveRevisionRef.current !== revision) return;
        setAiError(t("settings.error.saveAi", { error: errorMessage(saveError, t("common.unknownError")) }));
        setAiSaving(false);
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [aiData.settings, aiDraft, aiReady, t]);

  function openOpenAiCompatibleDialog() {
    const provider = aiData.providers.find((candidate) => candidate.id === "openai-compatible");
    setOpenAiForm({
      baseUrl: provider?.baseUrl ?? "",
      token: "",
      allowInsecureTls: provider?.allowInsecureTls ?? false,
    });
    setOpenAiError(null);
    setOpenAiDialogOpen(true);
  }

  async function handleSaveOpenAiCompatible(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const baseUrl = openAiForm.baseUrl.trim();
    if (!baseUrl) {
      setOpenAiError(t("settings.error.apiUrlRequired"));
      return;
    }
    if (!isAllowedOpenAiUrl(baseUrl)) {
      setOpenAiError(t("settings.error.apiUrlInvalid"));
      return;
    }
    if (!openAiForm.token) {
      setOpenAiError(t("settings.error.tokenRequired"));
      return;
    }

    setOpenAiSaving(true);
    setOpenAiError(null);
    try {
      const saved = await saveOpenAiCompatibleProvider({
        baseUrl,
        token: openAiForm.token,
        allowInsecureTls: openAiForm.allowInsecureTls,
      });
      setAiData(saved);
      setAiDraft(saved.settings);
      emitAppEvent(APP_EVENT.aiSettingsChanged, saved);
      setOpenAiForm((current) => ({ ...current, token: "" }));
      setOpenAiDialogOpen(false);
    } catch (saveError) {
      setOpenAiError(t("settings.error.configureOpenAi", { error: errorMessage(saveError, t("common.unknownError")) }));
    } finally {
      setOpenAiSaving(false);
    }
  }

  function updateAiSetting<K extends keyof AiSettings>(field: K, value: AiSettings[K]) {
    setAiDraft((current) => ({ ...current, [field]: value }));
    setAiSaved(false);
    setAiError(null);
  }

  function updateAiProvider(value: string) {
    const provider = value === ""
      ? null
      : aiData.providers.find((candidate) => candidate.id === value) ?? null;
    setAiDraft((current) => ({
      ...current,
      provider: provider?.id ?? null,
      model: modelForAiProvider(provider, current.model),
    }));
    setAiSaved(false);
    setAiError(null);
  }

  function updateAiReasoning(value: string) {
    updateAiSetting("reasoning", value as AiReasoning);
  }

  function updateForm(field: keyof IntegrationForm, value: string | boolean) {
    if (!selectedKind) return;
    setForms((current) => ({
      ...current,
      [selectedKind]: { ...current[selectedKind], [field]: value },
    }));
  }

  function applySavedIntegration(kind: IntegrationKind, savedIntegration: IntegrationRedacted) {
    setIntegrations((current) => replaceIntegration(current, savedIntegration));
    setForms((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        baseUrl: savedIntegration.baseUrl,
        secret: "",
      },
    }));
    setSelectedKind(null);
    emitAppEvent(APP_EVENT.integrationsChanged);
  }

  async function handleHealthCheck(kind: IntegrationKind) {
    const integration = integrations.find((candidate) => candidate.kind === kind);
    const provider = PROVIDERS.find((candidate) => candidate.kind === kind);
    if (!integration || !provider) return;

    setHealthCheckKind(kind);
    setError(null);
    try {
      const refreshed = await refreshIntegrationHealth({ id: integration.id });
      setIntegrations((current) => replaceIntegration(current, refreshed));
      emitAppEvent(APP_EVENT.integrationsChanged);
      if (refreshed.healthStatus === "unavailable") {
        setHealthConfirmation({
          kind,
          provider,
          health: {
            status: "unavailable",
            message: refreshed.healthError,
            details: refreshed.healthDetails,
          },
        });
      }
    } catch (error) {
      setError(t("settings.error.checkHealth", { provider: provider.label, error: errorMessage(error, t("common.unknownError")) }));
    } finally {
      setHealthCheckKind(null);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKind || !provider || !form) return;
    const kind = selectedKind;
    const activeForm = form;
    const activeProvider = provider;
    if (!activeForm.baseUrl.trim()) {
      setError(t("settings.error.baseUrlRequired"));
      return;
    }
    if (!activeForm.baseUrl.trim().startsWith("https://")) {
      setError(t("settings.error.baseUrlHttps"));
      return;
    }
    if (!selectedIntegration && !activeForm.secret.trim()) {
      setError(t("settings.error.personalTokenRequired"));
      return;
    }

    setAction("save");
    setError(null);
    const input: IntegrationSaveInput = {
      ...(selectedIntegration ? { id: selectedIntegration.id } : {}),
      kind,
      baseUrl: activeForm.baseUrl,
      allowInsecureTls: activeForm.allowInsecureTls,
      ...(activeForm.secret ? { secret: activeForm.secret } : {}),
    };

    try {
      let result = await saveIntegration(input);
      if (result.status === "requiresConfirmation") {
        setSelectedKind(null);
        setHealthConfirmation({
          kind,
          provider: activeProvider,
          health: result.health,
          saveInput: input,
        });
        return;
      }
      if (result.status !== "saved") {
        throw new Error("Integration health confirmation was not completed.");
      }
      applySavedIntegration(kind, result.integration);
    } catch (error) {
      setError(t("settings.error.saveIntegration", { provider: activeProvider.label, error: errorMessage(error, t("common.unknownError")) }));
    } finally {
      setAction(null);
    }
  }

  function closeHealthConfirmation() {
    if (!healthConfirmation) return;
    const shouldReopenForm = healthConfirmation.saveInput !== undefined;
    const kind = healthConfirmation.kind;
    setHealthConfirmation(null);
    if (shouldReopenForm) setSelectedKind(kind);
  }

  async function handleHealthConfirmationSave() {
    if (!healthConfirmation?.saveInput) return;
    const { kind, provider, saveInput } = healthConfirmation;
    setAction("save");
    setError(null);
    try {
      const result = await saveIntegration({ ...saveInput, allowUnavailable: true });
      if (result.status !== "saved") {
        throw new Error("Integration health confirmation was not completed.");
      }
      applySavedIntegration(kind, result.integration);
      setHealthConfirmation(null);
    } catch (error) {
      setHealthConfirmation(null);
      setSelectedKind(kind);
      setError(t("settings.error.saveIntegration", { provider: provider.label, error: errorMessage(error, t("common.unknownError")) }));
    } finally {
      setAction(null);
    }
  }

  async function handleDelete() {
    if (!selectedKind || !selectedIntegration || !provider) return;
    const kind = selectedKind;

    setAction("delete");
    setError(null);
    try {
      await deleteIntegration({ id: selectedIntegration.id });
      setIntegrations((current) =>
        current.filter((integration) => integration.id !== selectedIntegration.id),
      );
      setForms((current) => ({ ...current, [kind]: emptyForm() }));
      setSelectedKind(null);
      emitAppEvent(APP_EVENT.integrationsChanged);
    } catch (error) {
      setError(t("settings.error.deleteIntegration", { provider: provider.label, error: errorMessage(error, t("common.unknownError")) }));
    } finally {
      setAction(null);
    }
  }

  return (
    <main className="space-y-6" aria-labelledby="settings-title">
      {section !== "projects" || loading ? (
        <PageHeader
          title={section === "general" ? t("nav.general") : section === "ai" ? t("nav.aiSettings") : section === "projects" ? t("nav.teamSettings") : t("nav.dataIntegrations")}
          titleId="settings-title"
          description={section === "ai"
            ? t("settings.ai.description")
            : section === "integrations"
              ? t("settings.data.description")
              : section === "projects"
                ? t("settings.projects.description")
                : undefined}
        />
      ) : null}

      {section !== "general" && loading ? (
        <Alert role="status" aria-live="polite">
          <AlertDescription>{t(section === "ai" ? "settings.ai.loading" : "settings.loading")}</AlertDescription>
        </Alert>
      ) : null}
      {section !== "general" && error && selectedKind === null ? (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertDescription>
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setRetry((current) => current + 1)}
            >
              {t("settings.retryLoading")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {section === "general" ? <GeneralSettingsPage updateCheckRequest={updateCheckRequest} /> : null}

      {section === "ai" ? (
        <div className="space-y-8">
          <section className="space-y-4" aria-label={t("nav.aiSettings")}>
          <Card>
            <CardHeader className="space-y-4 px-4 pb-4 pt-3.5">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2.5">
                  <Label htmlFor="ai-provider">{t("settings.ai.provider")}</Label>
                  <div className="relative">
                    <select
                      id="ai-provider"
                      aria-label={t("settings.ai.provider")}
                      value={aiDraft.provider ?? ""}
                      onChange={(event) => updateAiProvider(event.target.value)}
                      disabled={aiData === null || aiLoading || aiSaving}
                      className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pb-px pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{t("settings.ai.notSelected")}</option>
                      {aiData?.providers.map((candidate) => (
                        <option key={candidate.id} value={candidate.id} disabled={!candidate.available}>
                          {candidate.name}{candidate.available ? "" : ` (${t("settings.ai.unavailableSuffix")})`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                  </div>
                </div>
                <div className="grid gap-2.5">
                  <Label htmlFor="ai-model">{t("settings.ai.model")}</Label>
                  <div className="relative">
                    <select
                      id="ai-model"
                      aria-label={t("settings.ai.model")}
                      value={aiDraft.model}
                      onChange={(event) => updateAiSetting("model", event.target.value)}
                      disabled={!aiDraft.provider || !selectedAiProvider || aiSaving}
                      className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pb-px pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {(selectedAiProvider?.models ?? []).length === 0 ? (
                        <option value="">
                          {t("settings.ai.noModels", {
                            provider: selectedAiProvider?.name ?? t("settings.ai.selectedProvider"),
                          })}
                        </option>
                      ) : (selectedAiProvider?.models ?? []).map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                  </div>
                </div>
                {aiDraft.provider === "codex-cli" ? <div className="grid gap-2.5">
                  <Label htmlFor="ai-reasoning">{t("settings.ai.reasoning")}</Label>
                  <div className="relative">
                    <select
                      id="ai-reasoning"
                      aria-label={t("settings.ai.reasoning")}
                      value={aiDraft.reasoning}
                      onChange={(event) => updateAiReasoning(event.target.value)}
                      disabled={!aiDraft.provider || aiSaving}
                      className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pb-px pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {AI_REASONING_OPTIONS.map((reasoning) => (
                        <option key={reasoning} value={reasoning}>{reasoning}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                  </div>
                </div> : null}
                {aiDraft.provider === "codex-cli" ? <div className="flex items-center gap-2 md:pt-6">
                  <input
                    id="ai-fast-mode"
                    type="checkbox"
                    checked={aiDraft.fastMode}
                    onChange={(event) => updateAiSetting("fastMode", event.target.checked)}
                    disabled={!aiDraft.provider || aiSaving}
                    className="size-4 accent-primary"
                  />
                  <Label htmlFor="ai-fast-mode" alignment="inline" className="font-medium">{t("settings.ai.fastMode")}</Label>
                </div> : null}
              </div>
              {aiError || aiSaving || aiSaved || (aiDraft.provider && !aiReady) ? (
                <div className="text-sm" aria-live="polite">
                  {aiError ? <span className="text-destructive">{aiError}</span> : null}
                  {!aiError && aiSaving ? <span className="text-muted-foreground">{t("settings.common.saving")}</span> : null}
                  {!aiError && !aiSaving && aiSaved ? <span className="text-success">{t("settings.ai.saved")}</span> : null}
                  {!aiError && !aiSaved && aiDraft.provider && !aiReady ? (
                    <span className="text-warning">
                      {selectedAiProvider?.status === "connected"
                        ? t("settings.ai.noModelSelected")
                        : selectedAiProvider?.message ?? t("settings.ai.notConnected")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </CardHeader>
          </Card>
        </section>

        <section className="space-y-4" aria-labelledby="ai-providers-title">
          <div>
            <h2 id="ai-providers-title" className="text-lg font-semibold leading-tight">{t("settings.aiProviders.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.aiProviders.description")}
            </p>
          </div>
          <div aria-label={t("settings.aiProviders.aria")} className="flex w-full flex-col gap-3">
            {(aiData?.providers ?? []).map((candidate) => (
              <Card key={candidate.id} role="group" aria-label={`${candidate.name} AI provider`} className="w-full">
                <CardHeader className="flex-row items-center justify-between space-y-0 gap-4 px-4 pb-4 pt-3.5">
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    aria-label={candidate.name}
                    disabled={candidate.id !== "openai-compatible" || openAiSaving}
                    onClick={candidate.id === "openai-compatible" ? openOpenAiCompatibleDialog : undefined}
                  >
                    <p className="text-base font-semibold leading-tight">{candidate.name}</p>
                    <CardDescription className="leading-snug">
                      {candidate.id === "openai-compatible"
                        ? t("settings.aiProviders.openAiDescription")
                        : candidate.id === "claude-code-cli"
                          ? t("settings.aiProviders.claudeDescription")
                          : t("settings.aiProviders.codexDescription")}
                      {candidate.message ? <span className="mt-1 block">{candidate.message}</span> : null}
                    </CardDescription>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    {aiStatusIcon(candidate.status)}
                    <span>{t(AI_STATUS_LABEL_KEYS[candidate.status])}</span>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Dialog
          open={openAiDialogOpen}
          onOpenChange={(open) => {
            if (!open && !openAiSaving) {
              setOpenAiDialogOpen(false);
              setOpenAiError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.openAi.title")}</DialogTitle>
              <DialogDescription>
                {t("settings.openAi.description")}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              {openAiError ? (
                <Alert variant="destructive" role="alert" aria-live="assertive" className="mb-4">
                  <AlertDescription>{openAiError}</AlertDescription>
                </Alert>
              ) : null}
              <form
                id="openai-compatible-settings-form"
                className="grid gap-4"
                onSubmit={handleSaveOpenAiCompatible}
                aria-busy={openAiSaving}
              >
                <div className="grid gap-2">
                  <Label htmlFor="openai-compatible-api-url">API URL</Label>
                  <Input
                    id="openai-compatible-api-url"
                    name="baseUrl"
                    type="url"
                    value={openAiForm.baseUrl}
                    onChange={(event) => setOpenAiForm((current) => ({ ...current, baseUrl: event.target.value }))}
                    placeholder="https://api.example.com/v1"
                    disabled={openAiSaving}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="openai-compatible-token">{t("settings.openAi.token")}</Label>
                  <Input
                    id="openai-compatible-token"
                    name="token"
                    type="password"
                    value={openAiForm.token}
                    autoComplete="new-password"
                    onChange={(event) => setOpenAiForm((current) => ({ ...current, token: event.target.value }))}
                    disabled={openAiSaving}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("settings.openAi.tokenDescription")}
                  </p>
                </div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    id="openai-compatible-allow-insecure-tls"
                    name="allowInsecureTls"
                    type="checkbox"
                    checked={openAiForm.allowInsecureTls}
                    onChange={(event) => setOpenAiForm((current) => ({ ...current, allowInsecureTls: event.target.checked }))}
                    disabled={openAiSaving}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span>
                    <span className="font-medium">{t("settings.openAi.allowInsecureTls")}</span>
                    <span className="block text-muted-foreground">
                      {t("settings.openAi.allowInsecureTlsDescription")}
                    </span>
                  </span>
                </label>
              </form>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenAiDialogOpen(false)}
                disabled={openAiSaving}
              >
                {t("settings.common.cancel")}
              </Button>
              <Button type="submit" form="openai-compatible-settings-form" disabled={openAiSaving}>
                {openAiSaving ? t("settings.common.checking") : t("settings.common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        </div>
      ) : null}

      {section === "integrations" ? (
        <>
        <section className="space-y-4" aria-label={t("settings.data.title")}>
        <div aria-label={t("settings.data.aria")} className="flex w-full flex-col gap-3">
          {PROVIDERS.map((candidate) => {
            const integration = integrations.find((item) => item.kind === candidate.kind);
            const configured = integration !== undefined;
            const selected = selectedKind === candidate.kind;
            const healthStatus = integration ? healthStatusFor(integration) : "unknown";
            return (
              <Card
                key={candidate.kind}
                role="group"
                aria-label={`${candidate.label} integration`}
                className={cn(
                  "w-full transition-colors",
                  selected && "border-primary",
                )}
              >
                <CardHeader className="flex-row items-center justify-between space-y-0 gap-4 px-4 pb-4 pt-3.5">
                  <button
                    type="button"
                    className="-m-2 grid min-w-0 flex-1 cursor-pointer gap-1.5 rounded-md p-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={candidate.label}
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedKind(candidate.kind);
                      setError(null);
                    }}
                  >
                    <p className="text-base font-semibold leading-tight">{candidate.label}</p>
                    <CardDescription className="leading-snug">
                      {t(candidate.descriptionKey)}
                    </CardDescription>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex min-w-0 flex-col items-end gap-0.5">
                      <span className="flex items-center gap-1.5">
                        {!configured ? (
                          <Circle className="size-4" aria-hidden="true" />
                        ) : healthStatus === "working" ? (
                          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                        ) : healthStatus === "unavailable" ? (
                          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                        ) : (
                          <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span>{configured ? t(HEALTH_LABEL_KEYS[healthStatus]) : t("settings.health.notConfigured")}</span>
                      </span>
                      {configured && healthStatus === "working" && integration.accountDisplayName ? (
                        <span className="text-xs text-muted-foreground">
                          {t("settings.health.connectedAs", { account: integration.accountDisplayName })}
                        </span>
                      ) : null}
                    </div>
                    {configured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("settings.health.refresh", { provider: candidate.label })}
                        title={t("settings.health.refresh", { provider: candidate.label })}
                        disabled={healthCheckKind !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleHealthCheck(candidate.kind);
                        }}
                      >
                        <RefreshCw
                          className={cn(
                            healthCheckKind === candidate.kind && "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>

        <Dialog
          open={selectedKind !== null}
          onOpenChange={(open) => {
            if (!open && action === null) setSelectedKind(null);
          }}
        >
          {provider && form ? (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("settings.integration.title", { provider: provider.label })}</DialogTitle>
                <DialogDescription>
                  {selectedIntegration
                    ? t("settings.integration.tokenConfigured")
                    : t("settings.integration.tokenWriteOnly")}
                  {" "}{t("settings.integration.tokenCleared")}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                {error ? (
                  <Alert variant="destructive" role="alert" aria-live="assertive" className="mb-4">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <form
                  id="integration-settings-form"
                  className="grid gap-4"
                  onSubmit={handleSave}
                  aria-busy={controlsDisabled}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="settings-base-url">{t("settings.integration.baseUrl")}</Label>
                    <Input
                      id="settings-base-url"
                      name="baseUrl"
                      type="url"
                      value={form.baseUrl}
                      onChange={(event) => updateForm("baseUrl", event.target.value)}
                      placeholder={provider.placeholder}
                      disabled={controlsDisabled}
                      required
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="settings-secret">{t("settings.integration.personalToken")}</Label>
                    <Input
                      id="settings-secret"
                      aria-label={t("settings.integration.personalToken")}
                      name="secret"
                      type="password"
                      value={form.secret}
                      autoComplete="new-password"
                      onChange={(event) => updateForm("secret", event.target.value)}
                      disabled={controlsDisabled}
                    />
                  </div>

                  <div className="flex items-start gap-2">
                    <input
                      id="settings-allow-insecure-tls"
                      name="allowInsecureTls"
                      type="checkbox"
                      checked={form.allowInsecureTls}
                      onChange={(event) => updateForm("allowInsecureTls", event.target.checked)}
                      disabled={controlsDisabled}
                      className="mt-1 size-4 accent-primary"
                    />
                    <div>
                      <Label htmlFor="settings-allow-insecure-tls" alignment="inline" className="font-medium">
                        {t("settings.integration.allowInsecureTls")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("settings.integration.allowInsecureTlsDescription")}
                      </p>
                    </div>
                  </div>
                </form>
              </DialogBody>
              <DialogFooter className="sm:justify-between sm:space-x-0">
                {selectedIntegration ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={controlsDisabled}
                    onClick={() => void handleDelete()}
                  >
                    {action === "delete" ? t("settings.integration.deleting") : t("settings.integration.delete")}
                  </Button>
                ) : null}
                <Button type="submit" form="integration-settings-form" disabled={controlsDisabled}>
                  {action === "save" ? t("settings.common.saving") : t("settings.integration.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>

        <Dialog
          open={healthConfirmation !== null}
          onOpenChange={(open) => {
            if (!open && action === null) closeHealthConfirmation();
          }}
        >
          {healthConfirmation ? (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("settings.integration.healthFailed")}</DialogTitle>
                <DialogDescription>
                  {t("settings.integration.healthFailedDescription", { provider: healthConfirmation.provider.label })}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <Alert>
                  <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                  <AlertTitle>{t("settings.health.unavailable")}</AlertTitle>
                  <AlertDescription>
                    {healthConfirmation.health.message ?? t("settings.integration.healthFailedFallback")}
                  </AlertDescription>
                </Alert>
                <details className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {t("settings.integration.healthDetails")}
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                    {healthConfirmation.health.details ?? t("settings.integration.noHealthDetails")}
                  </pre>
                </details>
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={healthConfirmation.saveInput
                    ? t("settings.integration.cancelSave")
                    : t("settings.integration.dismissHealth")}
                  onClick={closeHealthConfirmation}
                >
                  {healthConfirmation.saveInput ? t("settings.common.cancel") : t("settings.common.close")}
                </Button>
                {healthConfirmation.saveInput ? (
                  <Button type="button" onClick={() => void handleHealthConfirmationSave()}>
                    {action === "save" ? t("settings.common.saving") : t("settings.integration.saveAnyway")}
                  </Button>
                ) : null}
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>
        </section>
        </>
      ) : null}

      {section === "projects" && !loading ? (
        hasJiraIntegration ? (
          <ManagedProjectsSettings
            jiraIntegrations={integrations.filter((integration) => integration.kind === "jira")}
            confluenceIntegrations={integrations.filter((integration) => integration.kind === "confluence")}
            validateProjectKey={validateProjectKey}
            resolveConfluenceSpace={resolveTeamConfluenceSpace}
          />
        ) : (
          <>
            <PageHeader
              title={t("nav.teamSettings")}
              titleId="settings-title"
              description={t("settings.projects.description")}
            />
            <Alert aria-labelledby="project-settings-dependency-title">
              <AlertTitle id="project-settings-dependency-title">{t("settings.projects.configureJira")}</AlertTitle>
              <AlertDescription>
                <p>{t("settings.projects.requiresJira")}</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <a href="#settings/integrations">{t("settings.projects.openIntegrations")}</a>
                </Button>
              </AlertDescription>
            </Alert>
          </>
        )
      ) : null}
    </main>
  );
}
