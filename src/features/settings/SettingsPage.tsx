import { AlertTriangle, CheckCircle2, Circle, CircleHelp, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  AiCliProviderId,
  AiProviderStatus,
  AiReasoning,
  AiSettings,
  AiSettingsPageData,
  AiSettingsProfile,
  IntegrationHealth,
  IntegrationHealthStatus,
  IntegrationKind,
  IntegrationRedacted,
  IntegrationSaveInput,
} from "../../shared/contracts/settings";
import {
  deleteIntegration,
  deleteAiProvider,
  addAiCliProvider,
  inspectAiCliProvider,
  getAiSettings,
  listIntegrations,
  refreshAiSettings,
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
const ADD_MENU_ITEM_CLASS = "px-3 hover:bg-transparent hover:text-primary focus:bg-transparent focus:text-primary data-[highlighted]:bg-transparent data-[highlighted]:text-primary";

const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: null,
  model: "",
  reasoning: "medium",
  fastMode: false,
  tokenBurner: null,
};

const INITIAL_AI_DATA: AiSettingsPageData = { settings: DEFAULT_AI_SETTINGS, providers: [] };
const UNAVAILABLE_AI_DATA: AiSettingsPageData = INITIAL_AI_DATA;

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

function AiOverrideEditor({
  idPrefix,
  profile,
  providers,
  inheritedLabel,
  providerLabel,
  modelLabel,
  reasoningLabel,
  fastModeLabel,
  noModelsLabel,
  unavailableLabel,
  onChange,
  disabled,
}: {
  idPrefix: string;
  profile: AiSettingsProfile | null | undefined;
  providers: AiProvider[];
  inheritedLabel: string;
  providerLabel: string;
  modelLabel: string;
  reasoningLabel: string;
  fastModeLabel: string;
  noModelsLabel: string;
  unavailableLabel: string;
  onChange: (profile: AiSettingsProfile | null) => void;
  disabled: boolean;
}) {
  const selected = providers.find((candidate) => candidate.id === profile?.provider
    && (candidate.id !== "openai-compatible" || (candidate.instanceId ?? "legacy") === (profile.providerInstanceId ?? "legacy")));
  const selectorValue = selected?.instanceId ?? profile?.provider ?? "__inherit__";

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="grid min-w-0 max-w-full gap-2.5">
        <Label htmlFor={`${idPrefix}-provider`}>{providerLabel}</Label>
        <Select value={selectorValue} onValueChange={(value) => {
          if (value === "__inherit__") { onChange(null); return; }
          const candidate = providers.find((item) => (item.instanceId ?? item.id) === value);
          if (!candidate) return;
          const next: AiSettingsProfile = {
            provider: candidate.id,
            ...(candidate.instanceId ? { providerInstanceId: candidate.instanceId } : {}),
            model: modelForAiProvider(candidate, profile?.model ?? ""),
            reasoning: profile?.reasoning ?? "medium",
            fastMode: profile?.fastMode ?? false,
          };
          onChange(next);
        }} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-provider`} aria-label={providerLabel} className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">{inheritedLabel}</SelectItem>
            {providers.map((candidate) => (
              <SelectItem key={candidate.instanceId ?? candidate.id} value={candidate.instanceId ?? candidate.id} disabled={!candidate.available}>
                {candidate.name}{candidate.baseUrl ? ` · ${candidate.baseUrl}` : ""}{candidate.available ? "" : ` (${unavailableLabel})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {profile && selected ? <>
        <div className="grid min-w-0 max-w-full gap-2.5">
          <Label htmlFor={`${idPrefix}-model`}>{modelLabel}</Label>
          <Select value={profile.model} onValueChange={(model) => onChange({ ...profile, model })} disabled={disabled || selected.models.length === 0}>
            <SelectTrigger id={`${idPrefix}-model`} aria-label={modelLabel} className="h-9"><SelectValue placeholder={noModelsLabel} /></SelectTrigger>
            <SelectContent>{selected.models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {profile.provider === "codex-cli" ? <>
          <div className="grid min-w-0 max-w-full gap-2.5">
            <Label htmlFor={`${idPrefix}-reasoning`}>{reasoningLabel}</Label>
            <Select value={profile.reasoning} onValueChange={(reasoning) => onChange({ ...profile, reasoning: reasoning as AiReasoning })} disabled={disabled}>
              <SelectTrigger id={`${idPrefix}-reasoning`} aria-label={reasoningLabel} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{AI_REASONING_OPTIONS.map((reasoning) => <SelectItem key={reasoning} value={reasoning}>{reasoning}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex h-9 items-center gap-2">
            <input id={`${idPrefix}-fast-mode`} type="checkbox" checked={profile.fastMode} onChange={(event) => onChange({ ...profile, fastMode: event.target.checked })} disabled={disabled} className="size-4 accent-primary" />
            <Label htmlFor={`${idPrefix}-fast-mode`} alignment="inline" className="font-medium">{fastModeLabel}</Label>
          </div>
        </> : null}
      </> : null}
    </div>
  );
}


export type SettingsSection = "general" | "ai" | "integrations" | "projects";
type AiSettingsScope = "default" | "taskCreation" | "pullRequestReview" | "tokenBurner";
type AiActivity = Exclude<AiSettingsScope, "default">;

const AI_ACTIVITIES: { key: AiActivity; labelKey: TranslationKey; idPrefix: string }[] = [
  { key: "taskCreation", labelKey: "settings.ai.taskCreation", idPrefix: "ai-task" },
  { key: "pullRequestReview", labelKey: "settings.ai.pullRequestReview", idPrefix: "ai-review" },
  { key: "tokenBurner", labelKey: "settings.ai.tokenBurner", idPrefix: "ai-token-burner" },
];

const CLI_PROVIDER_OPTIONS: { id: AiCliProviderId; name: string }[] = [
  { id: "codex-cli", name: "Codex CLI" },
  { id: "claude-code-cli", name: "Claude Code CLI" },
  { id: "hermes-cli", name: "Hermes CLI" },
];

interface SettingsPageProps {
  section?: SettingsSection;
  focusActivity?: "token-burner";
  mockMode?: boolean;
}

type CliInspection =
  | { state: "checking" }
  | { state: "ready"; provider: AiProvider }
  | { state: "error"; message: string };

export function SettingsPage({ section = "integrations", focusActivity, mockMode = false }: SettingsPageProps) {
  const { t } = useI18n();
  const [integrations, setIntegrations] = useState<IntegrationRedacted[]>([]);
  const [aiData, setAiData] = useState<AiSettingsPageData>(INITIAL_AI_DATA);
  const [aiDraft, setAiDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiStatusScope, setAiStatusScope] = useState<AiSettingsScope>("default");
  const [visibleAiActivities, setVisibleAiActivities] = useState<AiActivity[]>(focusActivity === "token-burner" ? ["tokenBurner"] : []);
  const aiSaveRevisionRef = useRef(0);
  const [openAiDialogOpen, setOpenAiDialogOpen] = useState(false);
  const [addAiMenuOpen, setAddAiMenuOpen] = useState(false);
  const [selectedAiGroup, setSelectedAiGroup] = useState<"cli" | "api">("cli");
  const [addingAi, setAddingAi] = useState(false);
  const [cliInspections, setCliInspections] = useState<Partial<Record<AiCliProviderId, CliInspection>>>({});
  const cliInspectionRevisionRef = useRef<Partial<Record<AiCliProviderId, number>>>({});
  const [cliAddError, setCliAddError] = useState<string | null>(null);
  const [deletingAiProvider, setDeletingAiProvider] = useState<AiProvider | null>(null);
  const [aiDeleting, setAiDeleting] = useState(false);
  const [aiDeleteError, setAiDeleteError] = useState<string | null>(null);
  const [refreshingAiProvider, setRefreshingAiProvider] = useState<string | null>(null);
  const [aiProviderRefreshError, setAiProviderRefreshError] = useState<string | null>(null);
  const [editingOpenAiId, setEditingOpenAiId] = useState<string | undefined>();
  const [openAiForm, setOpenAiForm] = useState<OpenAiCompatibleForm>(emptyOpenAiCompatibleForm);
  const [openAiSaving, setOpenAiSaving] = useState(false);
  const [openAiError, setOpenAiError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<IntegrationKind | null>(null);
  const [deletingIntegrationKind, setDeletingIntegrationKind] = useState<IntegrationKind | null>(null);
  const [integrationDeleteError, setIntegrationDeleteError] = useState<string | null>(null);
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
          setVisibleAiActivities(AI_ACTIVITIES.filter(({ key }) => Boolean(loadedAiData.settings[key]) || (key === "tokenBurner" && focusActivity === "token-burner")).map(({ key }) => key));
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
  }, [focusActivity, retry, section, t]);

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
  const integrationToDelete = deletingIntegrationKind
    ? integrations.find((integration) => integration.kind === deletingIntegrationKind)
    : undefined;
  const deletingIntegrationProvider = PROVIDERS.find((candidate) => candidate.kind === deletingIntegrationKind);
  const availableIntegrationProviders = PROVIDERS.filter((candidate) =>
    !integrations.some((integration) => integration.kind === candidate.kind));
  const availableAiActivities = AI_ACTIVITIES.filter(({ key }) => !visibleAiActivities.includes(key));
  const shownAiActivities = AI_ACTIVITIES.filter(({ key }) => visibleAiActivities.includes(key));
  const selectedAiProvider = aiData.providers.find((provider) => provider.id === aiDraft.provider
    && (provider.id !== "openai-compatible" || (provider.instanceId ?? "legacy") === (aiDraft.providerInstanceId ?? "legacy")));
  const cliProviders = aiData.providers.filter((provider) => provider.id !== "openai-compatible");
  const apiProviders = aiData.providers.filter((provider) => provider.id === "openai-compatible");
  const visibleAiProviders = selectedAiGroup === "cli" ? cliProviders : apiProviders;
  const allCliAdded = CLI_PROVIDER_OPTIONS.every(({ id }) => cliProviders.some((provider) => provider.id === id));
  const cliMenuOptions = CLI_PROVIDER_OPTIONS
    .filter(({ id }) => !cliProviders.some((provider) => provider.id === id))
    .map((option) => {
      const inspection = cliInspections[option.id];
      const ready = inspection?.state === "ready"
        && inspection.provider.available
        && inspection.provider.status === "connected"
        && inspection.provider.models.length > 0;
      const reason = inspection?.state === "error" ? inspection.message
        : inspection?.state === "ready" && !ready
          ? inspection.provider.status === "not_found"
            ? t("settings.aiProviders.cliNotFound", { provider: option.name })
            : inspection.provider.status === "connected" && inspection.provider.models.length === 0
              ? t("settings.ai.noModels", { provider: option.name })
              : inspection.provider.message ?? t(AI_STATUS_LABEL_KEYS[inspection.provider.status])
          : inspection?.state === "checking" ? t("settings.aiProviders.checkingCli") : null;
      return { ...option, ready, reason, checking: inspection?.state === "checking" || !inspection };
    })
    .sort((a, b) => (a.ready ? 0 : a.checking ? 1 : 2) - (b.ready ? 0 : b.checking ? 1 : 2));
  const aiLoading = aiData?.providers.some((provider) => provider.status === "loading") === true;
  const aiReady = aiProviderReady(selectedAiProvider, aiDraft.model);
  const provider = selectedKind
    ? PROVIDERS.find((candidate) => candidate.kind === selectedKind)
    : undefined;
  const form = selectedKind ? forms[selectedKind] : undefined;
  const controlsDisabled = action !== null;

  useEffect(() => {
    setSelectedAiGroup((current) => {
      if (current === "cli" && cliProviders.length === 0 && apiProviders.length > 0) return "api";
      if (current === "api" && apiProviders.length === 0 && cliProviders.length > 0) return "cli";
      return current;
    });
  }, [aiData.providers]);

  const checkCliProvider = useCallback(async (id: AiCliProviderId) => {
    const revision = (cliInspectionRevisionRef.current[id] ?? 0) + 1;
    cliInspectionRevisionRef.current[id] = revision;
    setCliInspections((current) => ({ ...current, [id]: { state: "checking" } }));
    try {
      const provider = await inspectAiCliProvider(id);
      if (cliInspectionRevisionRef.current[id] === revision) {
        setCliInspections((current) => ({ ...current, [id]: { state: "ready", provider } }));
      }
    } catch (checkError) {
      if (cliInspectionRevisionRef.current[id] === revision) {
        setCliInspections((current) => ({ ...current, [id]: { state: "error", message: errorMessage(checkError, t("common.unknownError")) } }));
      }
    }
  }, [t]);

  useEffect(() => {
    if (!addAiMenuOpen) return;
    for (const { id } of CLI_PROVIDER_OPTIONS) {
      if (!aiData.providers.some((provider) => provider.id === id)) void checkCliProvider(id);
    }
  }, [addAiMenuOpen, aiData.providers, checkCliProvider]);

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
      && (aiDraft.providerInstanceId ?? null) === (aiData.settings.providerInstanceId ?? null)
      && aiDraft.model === aiData.settings.model
      && aiDraft.reasoning === aiData.settings.reasoning
      && aiDraft.fastMode === aiData.settings.fastMode
      && JSON.stringify(aiDraft.taskCreation ?? null) === JSON.stringify(aiData.settings.taskCreation ?? null)
      && JSON.stringify(aiDraft.pullRequestReview ?? null) === JSON.stringify(aiData.settings.pullRequestReview ?? null)
      && JSON.stringify(aiDraft.tokenBurner ?? null) === JSON.stringify(aiData.settings.tokenBurner ?? null);
    const defaultSettingsUnchanged = aiDraft.provider === aiData.settings.provider
      && (aiDraft.providerInstanceId ?? null) === (aiData.settings.providerInstanceId ?? null)
      && aiDraft.model === aiData.settings.model
      && aiDraft.reasoning === aiData.settings.reasoning
      && aiDraft.fastMode === aiData.settings.fastMode;
    const profileChanges = [
      [aiDraft.taskCreation, aiData.settings.taskCreation],
      [aiDraft.pullRequestReview, aiData.settings.pullRequestReview],
      [aiDraft.tokenBurner, aiData.settings.tokenBurner],
    ] as const;
    const changedProfilesReady = profileChanges.some(([draft, saved]) =>
      JSON.stringify(draft ?? null) !== JSON.stringify(saved ?? null))
      && profileChanges.every(([draft, saved]) => {
        if (JSON.stringify(draft ?? null) === JSON.stringify(saved ?? null) || !draft) return true;
        const provider = aiData.providers.find((candidate) => candidate.id === draft.provider
          && (candidate.id !== "openai-compatible" || (candidate.instanceId ?? "legacy") === (draft.providerInstanceId ?? "legacy")));
        return aiProviderReady(provider, draft.model);
      });
    const canSave = (Boolean(aiDraft.provider) && aiReady)
      || (defaultSettingsUnchanged && changedProfilesReady);
    if (unchanged || !canSave || aiDeleting) return;

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
        if (aiStatusScope !== "default" && !visibleAiActivities.includes(aiStatusScope) && aiData.settings[aiStatusScope]) {
          setVisibleAiActivities((current) => [...current, aiStatusScope]);
          setAiDraft((current) => ({ ...current, [aiStatusScope]: aiData.settings[aiStatusScope] }));
        }
        setAiError(t("settings.error.saveAi", { error: errorMessage(saveError, t("common.unknownError")) }));
        setAiSaving(false);
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [aiData.settings, aiDraft, aiReady, aiDeleting, aiStatusScope, visibleAiActivities, t]);

  function openOpenAiCompatibleDialog(provider?: AiProvider) {
    setEditingOpenAiId(provider?.instanceId ?? undefined);
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
    if (!editingOpenAiId && !openAiForm.token) {
      setOpenAiError(t("settings.error.tokenRequired"));
      return;
    }

    setOpenAiSaving(true);
    setOpenAiError(null);
    try {
      const saved = await saveOpenAiCompatibleProvider({
        ...(editingOpenAiId ? { id: editingOpenAiId } : {}),
        baseUrl,
        token: openAiForm.token,
        allowInsecureTls: openAiForm.allowInsecureTls,
      });
      setAiData(saved);
      setAiDraft(saved.settings);
      setSelectedAiGroup("api");
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
    setAiStatusScope(field === "taskCreation" || field === "pullRequestReview" || field === "tokenBurner" ? field : "default");
    setAiSaved(false);
    setAiError(null);
  }

  function updateAiProfile(field: "taskCreation" | "pullRequestReview" | "tokenBurner", profile: AiSettingsProfile | null) {
    updateAiSetting(field, profile);
  }

  function updateAiProvider(value: string) {
    const provider = value === "__none__"
      ? null
      : aiData.providers.find((candidate) => (candidate.instanceId ?? candidate.id) === value) ?? null;
    setAiDraft((current) => {
      const next: AiSettings = {
        ...current,
        provider: provider?.id ?? null,
        model: modelForAiProvider(provider, current.model),
      };
      if (provider?.instanceId) next.providerInstanceId = provider.instanceId;
      else delete next.providerInstanceId;
      return next;
    });
    setAiSaved(false);
    setAiStatusScope("default");
    setAiError(null);
  }

  function renderAiStatus(scope: AiSettingsScope) {
    if (aiStatusScope !== scope) return null;
    const profile = scope === "taskCreation" ? aiDraft.taskCreation
      : scope === "pullRequestReview" ? aiDraft.pullRequestReview
        : scope === "tokenBurner" ? aiDraft.tokenBurner : null;
    const statusProvider = scope === "default" ? selectedAiProvider : aiData.providers.find((candidate) => candidate.id === profile?.provider
      && (candidate.id !== "openai-compatible" || (candidate.instanceId ?? "legacy") === (profile?.providerInstanceId ?? "legacy")));
    const showReadiness = scope === "default"
      ? Boolean(aiDraft.provider && !aiReady)
      : Boolean(profile && !aiProviderReady(statusProvider, profile.model));
    if (!aiError && !aiSaving && !aiSaved && !showReadiness) return null;
    return (
      <div className="text-sm" aria-live="polite">
        {aiError ? <span className="text-destructive">{aiError}</span> : null}
        {!aiError && aiSaving ? <span className="text-muted-foreground">{t("settings.common.saving")}</span> : null}
        {!aiError && !aiSaving && aiSaved ? <span className="text-success">{t("settings.ai.saved")}</span> : null}
        {!aiError && !aiSaved && showReadiness ? (
          <span className="text-warning">
            {statusProvider?.status === "connected"
              ? t("settings.ai.noModelSelected")
              : statusProvider?.message ?? t("settings.ai.notConnected")}
          </span>
        ) : null}
      </div>
    );
  }

  async function handleAddAiProvider(provider: AiCliProviderId) {
    setAddingAi(true);
    setCliAddError(null);
    try {
      const saved = await addAiCliProvider(provider);
      setAiData(saved);
      setSelectedAiGroup("cli");
      emitAppEvent(APP_EVENT.aiSettingsChanged, saved);
    } catch (addError) {
      setCliAddError(t("settings.aiProviders.addError", { error: errorMessage(addError, t("common.unknownError")) }));
    } finally {
      setAddingAi(false);
    }
  }

  async function handleDeleteAiProvider() {
    if (!deletingAiProvider) return;
    setAiDeleting(true);
    setAiDeleteError(null);
    aiSaveRevisionRef.current += 1;
    try {
      const saved = await deleteAiProvider(deletingAiProvider.id, deletingAiProvider.instanceId);
      setAiData(saved);
      setAiDraft(saved.settings);
      setAiSaved(false);
      emitAppEvent(APP_EVENT.aiSettingsChanged, saved);
      setDeletingAiProvider(null);
    } catch (deleteError) {
      setAiDeleteError(t("settings.aiProviders.deleteError", { error: errorMessage(deleteError, t("common.unknownError")) }));
    } finally {
      setAiDeleting(false);
    }
  }

  async function handleRefreshAiProvider(candidate: AiProvider) {
    setRefreshingAiProvider(candidate.instanceId ?? candidate.id);
    setAiProviderRefreshError(null);
    try {
      const refreshed = await refreshAiSettings();
      setAiData(refreshed);
      emitAppEvent(APP_EVENT.aiSettingsChanged, refreshed);
    } catch (refreshError) {
      setAiProviderRefreshError(t("settings.aiProviders.refreshError", { provider: candidate.name, error: errorMessage(refreshError, t("common.unknownError")) }));
    } finally {
      setRefreshingAiProvider(null);
    }
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
    if (!mockMode && !activeForm.baseUrl.trim().startsWith("https://")) {
      setError(t("settings.error.baseUrlHttps"));
      return;
    }
    if (!mockMode && !selectedIntegration && !activeForm.secret.trim()) {
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
    if (!deletingIntegrationKind || !integrationToDelete || !deletingIntegrationProvider) return;
    const kind = deletingIntegrationKind;
    const integrationId = integrationToDelete.id;

    setAction("delete");
    setIntegrationDeleteError(null);
    try {
      await deleteIntegration({ id: integrationId });
      setIntegrations((current) =>
        current.filter((integration) => integration.id !== integrationId),
      );
      setForms((current) => ({ ...current, [kind]: emptyForm() }));
      setDeletingIntegrationKind(null);
      emitAppEvent(APP_EVENT.integrationsChanged);
    } catch (deleteError) {
      setIntegrationDeleteError(t("settings.error.deleteIntegration", { provider: deletingIntegrationProvider.label, error: errorMessage(deleteError, t("common.unknownError")) }));
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
          description={section === "integrations"
              ? t("settings.data.description")
              : section === "projects"
                ? t("settings.projects.description")
                : undefined}
          actions={section === "integrations" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" actionTone="add" className="h-9 w-9 text-muted-foreground hover:bg-transparent hover:text-primary" aria-label={t("settings.data.add")} title={t("settings.data.add")} disabled={loading || availableIntegrationProviders.length === 0}>
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {availableIntegrationProviders.map((candidate) => (
                  <DropdownMenuItem key={candidate.kind} className={ADD_MENU_ITEM_CLASS} onSelect={() => { setSelectedKind(candidate.kind); setError(null); }}>
                    {candidate.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined}
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

      {section === "general" ? <GeneralSettingsPage /> : null}

      {section === "ai" ? (
        <div className="space-y-8">
          <section aria-labelledby="ai-providers-title">
            <div aria-label={t("settings.aiProviders.aria")} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[16rem] flex-1">
                  <h2 id="ai-providers-title" className="text-lg font-semibold leading-tight">{t("settings.aiProviders.title")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("settings.aiProviders.description")}</p>
                </div>
                <Select value={selectedAiGroup} onValueChange={(value) => setSelectedAiGroup(value as "cli" | "api")}>
                  <SelectTrigger aria-label={t("settings.aiProviders.groups")} className="h-9 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cli">{t("settings.aiProviders.cliGroup")}</SelectItem>
                    <SelectItem value="api">{t("settings.aiProviders.apiGroup")}</SelectItem>
                  </SelectContent>
                </Select>
                {selectedAiGroup === "cli" ? (
                  <DropdownMenu open={addAiMenuOpen} onOpenChange={(open) => { setAddAiMenuOpen(open); if (open) { setCliAddError(null); setCliInspections({}); } }}>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" actionTone="add" className="ml-auto h-9 w-9 text-muted-foreground hover:bg-transparent hover:text-primary" aria-label={t("settings.aiProviders.addCli")} title={t("settings.aiProviders.addCli")} disabled={allCliAdded || addingAi}>
                        <Plus className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-max min-w-0">
                      {cliMenuOptions.map(({ id, name, ready, reason, checking }) => (
                        <div key={id} className="flex items-center gap-1" title={ready ? undefined : reason ?? undefined}>
                          <DropdownMenuItem
                            className={cn(ADD_MENU_ITEM_CLASS, "min-w-0 flex-1", !ready && "cursor-help text-muted-foreground")}
                            aria-label={reason && !ready ? `${name}: ${reason}` : name}
                            disabled={!ready || addingAi}
                            onSelect={() => void handleAddAiProvider(id)}
                          >
                            {name}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="size-7 shrink-0 justify-center p-0 [&_svg]:!size-3.5" aria-label={`${t("settings.aiProviders.retryCheck")}: ${name}`} title={`${t("settings.aiProviders.retryCheck")}: ${name}`} disabled={checking || addingAi} onSelect={(event) => { event.preventDefault(); void checkCliProvider(id); }}>
                            {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                          </DropdownMenuItem>
                        </div>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button type="button" variant="ghost" size="icon" actionTone="add" className="ml-auto h-9 w-9 text-muted-foreground hover:bg-transparent hover:text-primary" aria-label={t("settings.aiProviders.addApi")} title={t("settings.aiProviders.addApi")} onClick={() => openOpenAiCompatibleDialog()}>
                    <Plus className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
              <Card className="min-w-0">
                <CardContent className="px-4 pb-0 pt-0">
                  {aiData.providers.length === 0 && !loading ? (
                    <div role="status" aria-labelledby="ai-providers-empty-title" className="flex min-h-14 items-center gap-3 py-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true"><Sparkles className="size-4" /></span>
                      <div className="min-w-0">
                        <h4 id="ai-providers-empty-title" className="text-[15px] font-medium">{t("settings.aiProviders.empty")}</h4>
                        <p className="text-[13px] text-muted-foreground">{t("settings.aiProviders.emptyDescription")}</p>
                      </div>
                    </div>
                  ) : visibleAiProviders.length === 0 ? (
                    <p className="flex min-h-14 items-center text-[15px] text-muted-foreground">{t(selectedAiGroup === "cli" ? "settings.aiProviders.emptyCli" : "settings.aiProviders.emptyApi")}</p>
                  ) : (
                    <div>
                      {visibleAiProviders.map((candidate, index) => (
                        <Fragment key={candidate.instanceId ?? candidate.id}>
                          <div role="group" aria-label={`${candidate.name} AI provider`} className="flex min-h-14 min-w-0 flex-wrap items-center gap-3 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px]">{candidate.name}</p>
                              {candidate.baseUrl || candidate.version || candidate.message ? (
                                <p className="truncate text-xs text-muted-foreground" title={candidate.baseUrl ?? candidate.message ?? candidate.version}>
                                  {candidate.baseUrl ?? candidate.message ?? candidate.version}
                                </p>
                              ) : null}
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-1.5">
                              <span className="mr-1 flex items-center gap-1.5 text-[13px] text-muted-foreground [&_svg]:size-[18px]" title={candidate.message}>
                                {aiStatusIcon(candidate.status)}
                                {t(AI_STATUS_LABEL_KEYS[candidate.status])}
                              </span>
                              <Button type="button" size="icon" variant="ghost" className="size-7 [&_svg]:!size-4" aria-label={t("settings.aiProviders.refreshLabel", { provider: candidate.name })} title={t("settings.aiProviders.refreshLabel", { provider: candidate.name })} onClick={() => void handleRefreshAiProvider(candidate)} disabled={refreshingAiProvider !== null || openAiSaving || aiDeleting || aiSaving}>
                                <RefreshCw className={cn(refreshingAiProvider === (candidate.instanceId ?? candidate.id) && "animate-spin")} aria-hidden="true" />
                              </Button>
                              {candidate.id === "openai-compatible" ? (
                                <Button type="button" size="icon" variant="ghost" actionTone="edit" className="size-7 [&_svg]:!size-4" aria-label={t("settings.aiProviders.editLabel", { provider: candidate.baseUrl ?? candidate.name })} title={t("settings.aiProviders.edit")} onClick={() => openOpenAiCompatibleDialog(candidate)} disabled={openAiSaving || aiDeleting || aiSaving}>
                                  <Pencil aria-hidden="true" />
                                </Button>
                              ) : null}
                              <Button type="button" size="icon" variant="ghost" actionTone="delete" className="size-7 text-muted-foreground hover:bg-transparent hover:text-destructive [&_svg]:!size-4" aria-label={t("settings.aiProviders.deleteLabel", { provider: candidate.baseUrl ?? candidate.name })} title={t("settings.aiProviders.delete")} onClick={() => { setAiDeleteError(null); setDeletingAiProvider(candidate); }} disabled={openAiSaving || aiDeleting || aiSaving}>
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                          {index < visibleAiProviders.length - 1 ? <Separator /> : null}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              {aiProviderRefreshError ? <p role="alert" className="text-sm text-destructive">{aiProviderRefreshError}</p> : null}
              {cliAddError ? <p role="alert" className="text-sm text-destructive">{cliAddError}</p> : null}
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="ai-defaults-title">
            <div>
              <h2 id="ai-defaults-title" className="text-lg font-semibold leading-tight">{t("settings.ai.defaults")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("settings.ai.defaultsDescription")}</p>
            </div>
            <Card>
              <CardHeader className="space-y-4 px-4 pb-4 pt-3.5">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="grid min-w-0 max-w-full gap-2.5">
                    <Label htmlFor="ai-provider">{t("settings.ai.provider")}</Label>
                    <Select value={selectedAiProvider?.instanceId ?? aiDraft.provider ?? "__none__"} onValueChange={updateAiProvider} disabled={aiData === null || aiLoading || aiSaving}>
                      <SelectTrigger id="ai-provider" aria-label={t("settings.ai.provider")} className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("settings.ai.notSelected")}</SelectItem>
                        {cliProviders.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel className="cursor-default py-1 pl-2 pr-2 text-xs font-medium text-muted-foreground">{t("settings.aiProviders.cliGroup")}</SelectLabel>
                            {cliProviders.map((candidate) => (
                              <SelectItem key={candidate.instanceId ?? candidate.id} value={candidate.instanceId ?? candidate.id} disabled={!candidate.available}>
                                {candidate.name}{candidate.available ? "" : ` (${t("settings.ai.unavailableSuffix")})`}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                        {cliProviders.length > 0 && apiProviders.length > 0 ? <SelectSeparator data-testid="ai-provider-group-separator" /> : null}
                        {apiProviders.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel className="cursor-default py-1 pl-2 pr-2 text-xs font-medium text-muted-foreground">{t("settings.aiProviders.apiGroup")}</SelectLabel>
                            {apiProviders.map((candidate) => (
                              <SelectItem key={candidate.instanceId ?? candidate.id} value={candidate.instanceId ?? candidate.id} disabled={!candidate.available}>
                                {candidate.name}{candidate.baseUrl ? ` · ${candidate.baseUrl}` : ""}{candidate.available ? "" : ` (${t("settings.ai.unavailableSuffix")})`}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-0 max-w-full gap-2.5">
                    <Label htmlFor="ai-model">{t("settings.ai.model")}</Label>
                    <Select value={aiDraft.model} onValueChange={(value) => updateAiSetting("model", value)} disabled={!aiDraft.provider || !selectedAiProvider || aiSaving || (selectedAiProvider.models.length === 0)}>
                      <SelectTrigger id="ai-model" aria-label={t("settings.ai.model")} className="h-9">
                        <SelectValue placeholder={t("settings.ai.noModels", { provider: selectedAiProvider?.name ?? t("settings.ai.selectedProvider") })} />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedAiProvider?.models ?? []).map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {aiDraft.provider === "codex-cli" ? <div className="grid min-w-0 max-w-full gap-2.5">
                    <Label htmlFor="ai-reasoning">{t("settings.ai.reasoning")}</Label>
                    <Select value={aiDraft.reasoning} onValueChange={updateAiReasoning} disabled={!aiDraft.provider || aiSaving}>
                      <SelectTrigger id="ai-reasoning" aria-label={t("settings.ai.reasoning")} className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AI_REASONING_OPTIONS.map((reasoning) => <SelectItem key={reasoning} value={reasoning}>{reasoning}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div> : null}
                  {aiDraft.provider === "codex-cli" ? <div className="flex h-9 items-center gap-2">
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
                {renderAiStatus("default")}
              </CardHeader>
            </Card>
          </section>

          <section className="space-y-4" aria-labelledby="ai-activities-title">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="ai-activities-title" className="text-lg font-semibold leading-tight">{t("settings.ai.overridesTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("settings.ai.overridesDescription")}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" actionTone="add" className="size-9 text-muted-foreground hover:bg-transparent" aria-label={t("settings.ai.addActivity")} title={t("settings.ai.addActivity")} disabled={loading || availableAiActivities.length === 0}>
                    <Plus className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {availableAiActivities.map(({ key, labelKey }) => (
                    <DropdownMenuItem key={key} className={ADD_MENU_ITEM_CLASS} onSelect={() => setVisibleAiActivities((current) => [...current, key])}>
                      {t(labelKey)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Card>
              <CardContent className="px-4 py-3">
                {shownAiActivities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("settings.ai.noActivities")}</p>
                ) : shownAiActivities.map((activity, index) => {
                  const { key } = activity;
                  return <Fragment key={key}>
                    {index > 0 ? <Separator className="my-4" /> : null}
                    <section className="space-y-4" aria-label={t(activity.labelKey)}>
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-base font-semibold leading-tight">{t(activity.labelKey)}</h3>
                        <Button type="button" variant="ghost" size="icon" actionTone="delete" className="size-7 text-muted-foreground hover:bg-transparent hover:text-destructive [&_svg]:!size-4" aria-label={t("settings.ai.removeActivity", { activity: t(activity.labelKey) })} title={t("settings.ai.removeActivity", { activity: t(activity.labelKey) })} disabled={aiSaving} onClick={() => { setVisibleAiActivities((current) => current.filter((item) => item !== key)); updateAiProfile(key, null); }}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                      <AiOverrideEditor
                        idPrefix={activity.idPrefix}
                        profile={aiDraft[key]}
                        providers={aiData.providers}
                        inheritedLabel={t("settings.ai.inheritDefault")}
                        providerLabel={t("settings.ai.provider")}
                        modelLabel={t("settings.ai.model")}
                        reasoningLabel={t("settings.ai.reasoning")}
                        fastModeLabel={t("settings.ai.fastMode")}
                        noModelsLabel={t("settings.ai.noModels", { provider: t("settings.ai.selectedProvider") })}
                        unavailableLabel={t("settings.ai.unavailableSuffix")}
                        onChange={(profile) => updateAiProfile(key, profile)}
                        disabled={aiLoading || aiSaving}
                      />
                      {renderAiStatus(key)}
                    </section>
                  </Fragment>;
                })}
                {aiStatusScope !== "default" && !visibleAiActivities.includes(aiStatusScope) ? renderAiStatus(aiStatusScope) : null}
              </CardContent>
            </Card>
          </section>

        <Dialog open={deletingAiProvider !== null} onOpenChange={(open) => { if (!open && !aiDeleting) setDeletingAiProvider(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.aiProviders.delete")}</DialogTitle>
              <DialogDescription>{t("settings.aiProviders.deleteConfirmation", { provider: deletingAiProvider?.baseUrl ?? deletingAiProvider?.name ?? "" })}</DialogDescription>
            </DialogHeader>
            {aiDeleteError ? <DialogBody><Alert variant="destructive" role="alert"><AlertDescription>{aiDeleteError}</AlertDescription></Alert></DialogBody> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeletingAiProvider(null)} disabled={aiDeleting}>{t("settings.common.cancel")}</Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteAiProvider()} disabled={aiDeleting}>{t("settings.aiProviders.delete")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                  <Label htmlFor="openai-compatible-api-url">{t("settings.openAi.apiUrl")}</Label>
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
                    required={!editingOpenAiId}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t(editingOpenAiId ? "settings.openAi.tokenOptionalDescription" : "settings.openAi.tokenDescription")}
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
          {!loading && integrations.length === 0 ? (
            <Card className="w-full">
              <CardContent className="flex min-h-14 items-center px-4 py-3 text-sm text-muted-foreground">{t("settings.data.empty")}</CardContent>
            </Card>
          ) : null}
          {PROVIDERS.filter((candidate) => integrations.some((integration) => integration.kind === candidate.kind)).map((candidate) => {
            const integration = integrations.find((item) => item.kind === candidate.kind);
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
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <p className="text-base font-semibold leading-tight">{candidate.label}</p>
                    <CardDescription className="leading-snug">
                      {t(candidate.descriptionKey)}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex min-w-0 flex-col items-end gap-0.5">
                      <span className="flex items-center gap-1.5">
                        {healthStatus === "working" ? (
                          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                        ) : healthStatus === "unavailable" ? (
                          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                        ) : (
                          <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span>{t(HEALTH_LABEL_KEYS[healthStatus])}</span>
                      </span>
                      {integration && healthStatus === "working" && integration.accountDisplayName ? (
                        <span className="text-xs text-muted-foreground">
                          {t("settings.health.connectedAs", { account: integration.accountDisplayName })}
                        </span>
                      ) : null}
                    </div>
                    {integration ? (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t("settings.health.refresh", { provider: candidate.label })}
                          title={t("settings.health.refresh", { provider: candidate.label })}
                          disabled={healthCheckKind !== null || action !== null}
                          onClick={() => void handleHealthCheck(candidate.kind)}
                        >
                          <RefreshCw className={cn(healthCheckKind === candidate.kind && "animate-spin")} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          actionTone="edit"
                          className="size-8 [&_svg]:size-[18px]"
                          aria-label={t("settings.integration.editLabel", { provider: candidate.label })}
                          title={t("settings.integration.edit")}
                          disabled={healthCheckKind !== null || action !== null}
                          onClick={() => { setSelectedKind(candidate.kind); setError(null); }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          actionTone="delete"
                          className="size-8 text-muted-foreground hover:bg-transparent hover:text-destructive [&_svg]:size-[18px]"
                          aria-label={t("settings.integration.deleteLabel", { provider: candidate.label })}
                          title={t("settings.integration.delete")}
                          disabled={healthCheckKind !== null || action !== null}
                          onClick={() => { setIntegrationDeleteError(null); setDeletingIntegrationKind(candidate.kind); }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
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
              <DialogFooter>
                <Button type="submit" form="integration-settings-form" disabled={controlsDisabled}>
                  {action === "save" ? t("settings.common.saving") : t("settings.integration.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>

        <Dialog open={deletingIntegrationKind !== null} onOpenChange={(open) => { if (!open && action === null) setDeletingIntegrationKind(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.integration.delete")}</DialogTitle>
              <DialogDescription>{t("settings.integration.deleteConfirmation", { provider: deletingIntegrationProvider?.label ?? "" })}</DialogDescription>
            </DialogHeader>
            {integrationDeleteError ? <DialogBody><Alert variant="destructive" role="alert"><AlertDescription>{integrationDeleteError}</AlertDescription></Alert></DialogBody> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeletingIntegrationKind(null)} disabled={action !== null}>{t("settings.common.cancel")}</Button>
              <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={action !== null}>{action === "delete" ? t("settings.integration.deleting") : t("settings.integration.delete")}</Button>
            </DialogFooter>
          </DialogContent>
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
