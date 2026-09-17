import { AlertTriangle, CheckCircle2, Circle, CircleHelp, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { ManagedProjectsSettings } from "./planning-projects/ManagedProjectsSettings";
import { GeneralSettingsPage } from "./general/GeneralSettingsPage";
import { INTEGRATIONS_HEALTH_REFRESHED_EVENT } from "./health-events";

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
  credentialLabel: string;
  description: string;
};

const PROVIDERS: Provider[] = [
  {
    kind: "jira",
    label: "Jira",
    credentialLabel: "Personal access token",
    description: "Track Jira issues and project activity.",
  },
  {
    kind: "bitbucket",
    label: "Bitbucket",
    credentialLabel: "Personal access token",
    description: "Connect repositories and pull request activity.",
  },
];

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
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

function healthLabel(status: IntegrationHealthStatus): string {
  switch (status) {
    case "working":
      return "Configured and working";
    case "unavailable":
      return "Configured but not working";
    default:
      return "Configured — health not checked";
  }
}

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
    id: "openai-compatible",
    name: "OpenAI-compatible API",
    status: "unavailable",
    available: false,
    models: [],
    message: "OpenAI-compatible API could not be initialized",
  }],
};

function aiStatusLabel(status: AiProviderStatus): string {
  switch (status) {
    case "loading":
      return "Loading…";
    case "connected":
      return "Connected";
    case "not_configured":
      return "Not configured";
    case "not_found":
      return "CLI not found";
    case "not_authenticated":
      return "Sign in required";
    default:
      return "Unavailable";
  }
}

function aiStatusIcon(status: AiProviderStatus) {
  if (status === "loading") return <Loader2 className="size-5 animate-spin" aria-hidden="true" />;
  if (status === "connected") return <CheckCircle2 className="size-5 text-success" aria-hidden="true" />;
  if (status === "not_configured" || status === "not_found") return <Circle className="size-5" aria-hidden="true" />;
  return <AlertTriangle className="size-5 text-warning" aria-hidden="true" />;
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

export type SettingsSection = "general" | "integrations" | "projects";

interface SettingsPageProps {
  section?: SettingsSection;
}

export function SettingsPage({ section = "integrations" }: SettingsPageProps) {
  const [integrations, setIntegrations] = useState<IntegrationRedacted[]>([]);
  const [aiData, setAiData] = useState<AiSettingsPageData>(INITIAL_AI_DATA);
  const [aiDraft, setAiDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const [openAiDialogOpen, setOpenAiDialogOpen] = useState(false);
  const [openAiForm, setOpenAiForm] = useState<OpenAiCompatibleForm>(emptyOpenAiCompatibleForm);
  const [openAiSaving, setOpenAiSaving] = useState(false);
  const [openAiError, setOpenAiError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<IntegrationKind | null>(null);
  const [forms, setForms] = useState<Record<IntegrationKind, IntegrationForm>>({
    jira: emptyForm(),
    bitbucket: emptyForm(),
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
    setAiData(INITIAL_AI_DATA);
    setAiDraft(DEFAULT_AI_SETTINGS);
    setAiError(null);
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
        if (active) setError("Unable to load integrations. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void getAiSettings()
      .then((loadedAiData) => {
        if (!active) return;
        setAiData(loadedAiData);
        setAiDraft(loadedAiData.settings);
      })
      .catch(() => {
        if (active) {
          setAiData(UNAVAILABLE_AI_DATA);
          setAiError("Unable to load Codex CLI settings. AI Review is disabled.");
        }
      });

    return () => {
      active = false;
    };
  }, [retry, section]);

  useEffect(() => {
    const onHealthRefreshed = (event: Event) => {
      const loadedIntegrations = (event as CustomEvent<IntegrationRedacted[]>).detail;
      if (!Array.isArray(loadedIntegrations)) return;
      setIntegrations(loadedIntegrations);
      setForms((current) => {
        const next = { ...current };
        for (const integration of loadedIntegrations) {
          next[integration.kind] = formForIntegration(integration);
        }
        return next;
      });
    };
    window.addEventListener(INTEGRATIONS_HEALTH_REFRESHED_EVENT, onHealthRefreshed);
    return () => window.removeEventListener(INTEGRATIONS_HEALTH_REFRESHED_EVENT, onHealthRefreshed);
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
      if (!jira) return Promise.reject(new Error("A Jira integration is required."));
      return validateJiraProjectKey({ integrationId: jira.id, projectKey });
    },
    [integrations],
  );

  const hasJiraIntegration = integrations.some((integration) => integration.kind === "jira");

  async function handleSaveAiSettings() {
    if (!aiDraft.provider || !aiReady) return;
    setAiSaving(true);
    setAiError(null);
    setAiSaved(false);
    try {
      const saved = await saveAiSettings(aiDraft);
      setAiData(saved);
      setAiDraft(saved.settings);
      setAiSaved(true);
    } catch (saveError) {
      setAiError(`Unable to save AI settings: ${errorMessage(saveError)}`);
    } finally {
      setAiSaving(false);
    }
  }

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
      setOpenAiError("API URL is required.");
      return;
    }
    if (!isAllowedOpenAiUrl(baseUrl)) {
      setOpenAiError("API URL must use https:// (http:// is allowed only for localhost) and must not contain credentials, a query, or a fragment.");
      return;
    }
    if (!openAiForm.token) {
      setOpenAiError("Token is required.");
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
      setOpenAiForm((current) => ({ ...current, token: "" }));
      setOpenAiDialogOpen(false);
    } catch (saveError) {
      setOpenAiError(`Unable to configure OpenAI-compatible API: ${errorMessage(saveError)}`);
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
      setError(`Unable to check ${provider.label} health: ${errorMessage(error)}`);
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
      setError("Base URL is required.");
      return;
    }
    if (!activeForm.baseUrl.trim().startsWith("https://")) {
      setError("Base URL must start with https://.");
      return;
    }
    if (!selectedIntegration && !activeForm.secret.trim()) {
      setError("Personal access token is required for a new integration.");
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
      setError(`Unable to save ${activeProvider.label} integration: ${errorMessage(error)}`);
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
      setError(`Unable to save ${provider.label} integration: ${errorMessage(error)}`);
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
    } catch (error) {
      setError(`Unable to delete ${provider.label} integration: ${errorMessage(error)}`);
    } finally {
      setAction(null);
    }
  }

  return (
    <main className="space-y-6" aria-labelledby="settings-title">
      <PageHeader
        title={section === "general" ? "General" : section === "projects" ? "Team settings" : "Integrations"}
        titleId="settings-title"
      />

      {section !== "general" && loading ? (
        <Alert role="status" aria-live="polite">
          <AlertDescription>Loading integrations…</AlertDescription>
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
              Retry loading integrations
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {section === "general" ? <GeneralSettingsPage /> : null}

      {section === "integrations" ? (
        <>
          <section className="space-y-4" aria-labelledby="ai-title">
          <div>
            <h2 id="ai-title">AI</h2>
            <p className="text-muted-foreground">
              Select the provider and review execution options used by AI-assisted workflows.
            </p>
          </div>
          <Card>
            <CardHeader className="gap-4 p-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2">
                  <Label htmlFor="ai-provider">AI provider</Label>
                  <select
                    id="ai-provider"
                    aria-label="AI provider"
                    value={aiDraft.provider ?? ""}
                    onChange={(event) => updateAiProvider(event.target.value)}
                    disabled={aiData === null || aiLoading || aiSaving}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Not selected</option>
                    {aiData?.providers.map((candidate) => (
                      <option key={candidate.id} value={candidate.id} disabled={!candidate.available}>
                        {candidate.name}{candidate.available ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-model">Model</Label>
                  <select
                    id="ai-model"
                    aria-label="Model"
                    value={aiDraft.model}
                    onChange={(event) => updateAiSetting("model", event.target.value)}
                    disabled={!aiDraft.provider || !selectedAiProvider || aiSaving}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {(selectedAiProvider?.models ?? []).length === 0 ? (
                      <option value="">No models reported by {selectedAiProvider?.name ?? "selected provider"}</option>
                    ) : (selectedAiProvider?.models ?? []).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai-reasoning">Reasoning</Label>
                  <select
                    id="ai-reasoning"
                    aria-label="Reasoning"
                    value={aiDraft.reasoning}
                    onChange={(event) => updateAiReasoning(event.target.value)}
                    disabled={!aiDraft.provider || aiSaving}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {AI_REASONING_OPTIONS.map((reasoning) => (
                      <option key={reasoning} value={reasoning}>{reasoning}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <input
                    id="ai-fast-mode"
                    type="checkbox"
                    checked={aiDraft.fastMode}
                    onChange={(event) => updateAiSetting("fastMode", event.target.checked)}
                    disabled={!aiDraft.provider || aiSaving}
                    className="size-4 accent-primary"
                  />
                  <Label htmlFor="ai-fast-mode" className="font-medium">Fast mode</Label>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm" aria-live="polite">
                  {aiError ? <span className="text-destructive">{aiError}</span> : null}
                  {!aiError && aiSaved ? <span className="text-success">AI settings saved.</span> : null}
                  {!aiError && !aiSaved && aiDraft.provider && !aiReady ? (
                    <span className="text-warning">
                      {selectedAiProvider?.status === "connected"
                        ? "No available model selected."
                        : selectedAiProvider?.message ?? "Selected provider is not connected."}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  onClick={() => void handleSaveAiSettings()}
                  disabled={!aiDraft.provider || !aiReady || aiSaving}
                >
                  {aiSaving ? "Saving…" : "Save AI settings"}
                </Button>
              </div>
            </CardHeader>
          </Card>
        </section>

        <section className="space-y-4" aria-labelledby="ai-providers-title">
          <div>
            <h2 id="ai-providers-title">AI Providers</h2>
            <p className="text-muted-foreground">
              Providers available to mework AI workflows.
            </p>
          </div>
          <div aria-label="AI providers" className="flex w-full flex-col gap-3">
            {(aiData?.providers ?? []).map((candidate) => (
              <Card key={candidate.id} role="group" aria-label={`${candidate.name} AI provider`} className="w-full">
                <CardHeader className="flex-row items-center justify-between gap-4 p-4">
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    aria-label={candidate.name}
                    disabled={candidate.id !== "openai-compatible" || openAiSaving}
                    onClick={candidate.id === "openai-compatible" ? openOpenAiCompatibleDialog : undefined}
                  >
                    <p className="text-lg font-semibold">{candidate.name}</p>
                    <CardDescription>
                      {candidate.id === "openai-compatible"
                        ? "Connect an OpenAI-compatible API for AI-assisted workflows."
                        : "Use the local Codex installation with its existing authentication."}
                      {candidate.message ? <span className="mt-1 block">{candidate.message}</span> : null}
                    </CardDescription>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    {aiStatusIcon(candidate.status)}
                    <span>{aiStatusLabel(candidate.status)}</span>
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
              <DialogTitle>OpenAI-compatible API</DialogTitle>
              <DialogDescription>
                Enter an API URL and token. Authorization is checked through the API before the token is stored in the operating system keyring. Available models are always loaded from the API.
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
                  <Label htmlFor="openai-compatible-token">Token</Label>
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
                  <p className="text-sm text-muted-foreground">The token is write-only and is never returned to the UI.</p>
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
                    <span className="font-medium">Allow insecure TLS</span>
                    <span className="block text-muted-foreground">Disable certificate verification for this OpenAI-compatible API.</span>
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
                Cancel
              </Button>
              <Button type="submit" form="openai-compatible-settings-form" disabled={openAiSaving}>
                {openAiSaving ? "Checking…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section className="space-y-4" aria-labelledby="integrations-title">
        <div>
          <h2 id="integrations-title">Data Integrations</h2>
          <p className="text-muted-foreground">
            Connect Jira and Bitbucket to provide data for mework workflows. Secrets are write-only and are never displayed.
          </p>
        </div>

        <div aria-label="Data integration providers" className="flex w-full flex-col gap-3">
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
                <CardHeader className="flex-row items-center justify-between gap-4 p-4">
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={candidate.label}
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedKind(candidate.kind);
                      setError(null);
                    }}
                  >
                    <p className="text-lg font-semibold">{candidate.label}</p>
                    <CardDescription>{candidate.description}</CardDescription>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex min-w-0 flex-col items-end gap-0.5">
                      <span className="flex items-center gap-1.5">
                        {!configured ? (
                          <Circle className="size-5" aria-hidden="true" />
                        ) : healthStatus === "working" ? (
                          <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
                        ) : healthStatus === "unavailable" ? (
                          <AlertTriangle className="size-5 text-warning" aria-hidden="true" />
                        ) : (
                          <CircleHelp className="size-5 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span>{configured ? healthLabel(healthStatus) : "Not configured"}</span>
                      </span>
                      {configured && healthStatus === "working" && integration.accountDisplayName ? (
                        <span className="text-xs text-muted-foreground">
                          Connected as {integration.accountDisplayName}
                        </span>
                      ) : null}
                    </div>
                    {configured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Refresh ${candidate.label} health check`}
                        title={`Refresh ${candidate.label} health check`}
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
                <DialogTitle>{provider.label} integration</DialogTitle>
                <DialogDescription>
                  {selectedIntegration
                    ? "Token is configured; enter a new value to replace it."
                    : "Token is write-only and will not be shown after saving."}
                  {" "}The token/API key is cleared after saving.
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
                    <Label htmlFor="settings-base-url">Base URL</Label>
                    <Input
                      id="settings-base-url"
                      name="baseUrl"
                      type="url"
                      value={form.baseUrl}
                      onChange={(event) => updateForm("baseUrl", event.target.value)}
                      placeholder={selectedKind === "jira" ? "https://jira.example.com" : "https://bitbucket.example.com"}
                      disabled={controlsDisabled}
                      required
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="settings-secret">{provider.credentialLabel}</Label>
                    <Input
                      id="settings-secret"
                      aria-label="Personal access token"
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
                      <Label htmlFor="settings-allow-insecure-tls" className="font-medium">
                        Allow insecure TLS connection
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Allow invalid or self-signed certificates. Use only on trusted internal networks.
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
                    {action === "delete" ? "Deleting…" : "Delete integration"}
                  </Button>
                ) : null}
                <Button type="submit" form="integration-settings-form" disabled={controlsDisabled}>
                  {action === "save" ? "Saving…" : "Save integration"}
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
                <DialogTitle>Integration health check failed</DialogTitle>
                <DialogDescription>
                  {healthConfirmation.provider.label} is not recommended for saving because its health check failed.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <Alert>
                  <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                  <AlertTitle>Configured but not working</AlertTitle>
                  <AlertDescription>
                    {healthConfirmation.health.message ?? "The health check failed."}
                  </AlertDescription>
                </Alert>
                <details className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Show health check details
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                    {healthConfirmation.health.details ?? "No additional details were returned."}
                  </pre>
                </details>
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={healthConfirmation.saveInput ? "Cancel integration save" : "Dismiss health check details"}
                  onClick={closeHealthConfirmation}
                >
                  {healthConfirmation.saveInput ? "Cancel" : "Close"}
                </Button>
                {healthConfirmation.saveInput ? (
                  <Button type="button" onClick={() => void handleHealthConfirmationSave()}>
                    {action === "save" ? "Saving…" : "Save anyway"}
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
            validateProjectKey={validateProjectKey}
          />
        ) : (
          <Alert aria-labelledby="project-settings-dependency-title">
            <AlertTitle id="project-settings-dependency-title">Configure Jira first</AlertTitle>
            <AlertDescription>
              <p>Team settings are unavailable until the Jira integration is configured.</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <a href="#settings/integrations">Open Integrations</a>
              </Button>
            </AlertDescription>
          </Alert>
        )
      ) : null}
    </main>
  );
}
