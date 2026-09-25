import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ClipboardList, ExternalLink, LoaderCircle, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";
import type { TranslationParams } from "@/i18n/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ManagedProject, PlanningSprint, EpicLinkJqlIssue } from "@/shared/contracts/planning";
import { listManagedProjects, listTargetSprints, previewEpicLinkJql, loadJiraAvatarData } from "../planning/api";
import type { CreatedJiraTask, JiraTaskIssueType, JiraTaskMember } from "./create-task-api";
import { createJiraTask, generateTaskDraft, listJiraTaskTeamMembers } from "./create-task-api";

import "./create-task.css";

const UNASSIGNED_VALUE = "__unassigned__";

function readCreateTaskRouteContext(): { teamId?: string; sprintId?: string } {
  if (typeof window === "undefined") return {};
  const query = window.location.hash.split("?", 2)[1];
  if (!query) return {};
  const params = new URLSearchParams(query);
  return {
    teamId: params.get("team") || undefined,
    sprintId: params.get("sprint") || undefined,
  };
}

type DraftCardStatus = "generating" | "ready" | "creating" | "created" | "failed";

type TeamContext = {
  members: JiraTaskMember[];
  sprints: PlanningSprint[];
  epics: EpicLinkJqlIssue[];
  membersLoading: boolean;
  sprintsLoading: boolean;
  epicsLoading: boolean;
  membersUnavailable: boolean;
  sprintsUnavailable: boolean;
  epicsUnavailable: boolean;
};

type TaskCard = {
  id: string;
  createdAt: number;
  prompt: string;
  teamId?: string;
  issueType: JiraTaskIssueType;
  summary: string;
  description: string;
  epicLink: string;
  assignee: string;
  sprint: string;
  storyPoints: string;
  status: DraftCardStatus;
  error?: string;
  createdTask?: CreatedJiraTask;
};

const CREATE_TASK_STATE_KEY = "mework.create-task.state.v1";
const DRAFT_CARD_STATUSES: DraftCardStatus[] = ["generating", "ready", "creating", "created", "failed"];

type PersistedCreateTaskState = {
  cards: TaskCard[];
  selectedTeamId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function issueTypeValue(value: unknown): JiraTaskIssueType {
  return value === "Spike" ? "Spike" : "Task";
}

function parsePersistedCard(value: unknown): TaskCard | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const createdAt = numberValue(value.createdAt) ?? 0;
  const prompt = stringValue(value.prompt);
  const summary = stringValue(value.summary);
  const description = stringValue(value.description);
  const issueType = issueTypeValue(value.issueType);
  const epicLink = stringValue(value.epicLink);
  const assignee = stringValue(value.assignee);
  const sprint = stringValue(value.sprint);
  const storyPoints = stringValue(value.storyPoints) ?? "";
  const status = stringValue(value.status) as DraftCardStatus | undefined;
  if (!id || !prompt || summary === undefined || description === undefined || epicLink === undefined || assignee === undefined || sprint === undefined || !status || !DRAFT_CARD_STATUSES.includes(status)) {
    return undefined;
  }
  const persistedCreatedTask = isRecord(value.createdTask) ? value.createdTask : undefined;
  const createdTask = persistedCreatedTask
    && stringValue(persistedCreatedTask.id)
    && stringValue(persistedCreatedTask.key)
    && stringValue(persistedCreatedTask.url)
    ? {
        id: stringValue(persistedCreatedTask.id)!,
        key: stringValue(persistedCreatedTask.key)!,
        url: stringValue(persistedCreatedTask.url)!,
        ...(stringValue(persistedCreatedTask.warning) ? { warning: stringValue(persistedCreatedTask.warning) } : {}),
      }
    : undefined;
  const restoredAfterCreate = status === "creating";
  return {
    id,
    createdAt,
    prompt,
    ...(stringValue(value.teamId) ? { teamId: stringValue(value.teamId) } : {}),
    issueType,
    summary,
    description,
    epicLink,
    assignee,
    sprint,
    storyPoints,
    status: restoredAfterCreate ? "ready" : status,
    ...(stringValue(value.error) && !restoredAfterCreate ? { error: stringValue(value.error) } : {}),
    ...(restoredAfterCreate ? { error: "Task creation was interrupted. Review the draft before trying again." } : {}),
    ...(createdTask ? { createdTask } : {}),
  };
}

function readPersistedCreateTaskState(): PersistedCreateTaskState {
  if (typeof window === "undefined") return { cards: [] };
  try {
    const raw = window.localStorage.getItem(CREATE_TASK_STATE_KEY);
    if (!raw) return { cards: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.cards)) return { cards: [] };
    const cards = parsed.cards.map(parsePersistedCard).filter((card): card is TaskCard => Boolean(card));
    const migrationBase = Date.now();
    const normalizedCards = cards.map((card, index) => ({
      card: card.createdAt > 0 ? card : { ...card, createdAt: migrationBase + index },
      index,
    }));
    return {
      cards: normalizedCards
        .sort((left, right) => left.card.createdAt - right.card.createdAt || left.index - right.index)
        .map(({ card }) => card),
      ...(stringValue(parsed.selectedTeamId) ? { selectedTeamId: stringValue(parsed.selectedTeamId) } : {}),
    };
  } catch {
    return { cards: [] };
  }
}

function persistCreateTaskState(state: PersistedCreateTaskState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CREATE_TASK_STATE_KEY, JSON.stringify({ version: 2, ...state }));
  } catch {
    // A private/restricted storage context must not break task creation.
  }
}

function emptyTeamContext(): TeamContext {
  return {
    members: [],
    sprints: [],
    epics: [],
    membersLoading: true,
    sprintsLoading: true,
    epicsLoading: true,
    membersUnavailable: false,
    sprintsUnavailable: false,
    epicsUnavailable: false,
  };
}

function createCardId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nextCardCreatedAt(cards: TaskCard[]): number {
  const latestCreatedAt = cards.reduce((latest, card) => Math.max(latest, card.createdAt), 0);
  return Math.max(Date.now(), latestCreatedAt + 1);
}

function displayMemberName(member: JiraTaskMember): string {
  return member.displayName.trim() || member.id;
}

function taskErrorMessage(
  error: unknown,
  translate: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error)) {
    const message = stringValue(error.message);
    if (message?.trim()) return message;
    const code = stringValue(error.code);
    if (code?.trim()) return translate("task.error.createCode", { code });
  }
  return translate("task.error.create");
}

function TaskMemberAvatar({ member, managedProjectId }: { member: JiraTaskMember; managedProjectId?: string }) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let active = true;
    setSource(undefined);
    if (managedProjectId && member.avatarUrl) {
      void loadJiraAvatarData(managedProjectId, member.avatarUrl)
        .then((dataUrl) => { if (active && dataUrl) setSource(dataUrl); })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [managedProjectId, member.id, member.avatarUrl]);
  return source ? (
    <img src={source} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" onError={() => setSource(undefined)} />
  ) : (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium" aria-hidden="true">
      {displayMemberName(member).slice(0, 2).toUpperCase()}
    </span>
  );
}

function TaskMemberOption({ member, managedProjectId }: { member: JiraTaskMember; managedProjectId?: string }) {
  return (
    <span className="flex items-center gap-2">
      <TaskMemberAvatar member={member} managedProjectId={managedProjectId} />
      <span>{displayMemberName(member)}</span>
    </span>
  );
}

function DraftSkeletonCard() {
  const { t } = useI18n();
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-label={t("task.aiThinking")} aria-busy="true" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("task.aiDraft")}</p>
            <h2 className="truncate text-base font-semibold text-foreground">{t("task.aiThinking")}</h2>
            <p className="text-sm text-muted-foreground">{t("task.preparing")}</p>
          </div>
        </div>
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      </div>
      <div className="mt-4 grid gap-3" aria-hidden="true">
        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
          <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("task.summary")}</span>
            <div className="h-9 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("task.description")}</span>
          <div className="h-20 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[t("task.epicLink"), t("task.sprint"), t("task.assignee"), t("task.storyPoints")].map((label) => (
            <div key={label} className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3" aria-hidden="true">
        <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
      </div>
    </article>
  );
}

export function CreateTaskPage() {
  const { t } = useI18n();
  const routeContext = useRef(readCreateTaskRouteContext()).current;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [cards, setCards] = useState<TaskCard[]>(() => readPersistedCreateTaskState().cards);
  const [teams, setTeams] = useState<ManagedProject[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(() => routeContext.teamId ?? readPersistedCreateTaskState().selectedTeamId);
  const [selectedSprintId, setSelectedSprintId] = useState(() => routeContext.sprintId ?? "");
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamContexts, setTeamContexts] = useState<Record<string, TeamContext>>({});
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [improvingDescriptionCardId, setImprovingDescriptionCardId] = useState<string>();
  const [descriptionImprovingCardId, setDescriptionImprovingCardId] = useState<string>();
  const [descriptionImproveContext, setDescriptionImproveContext] = useState("");
  const [descriptionImproveError, setDescriptionImproveError] = useState<string>();
  const [descriptionImproveErrorCardId, setDescriptionImproveErrorCardId] = useState<string>();
  const [descriptionImproveInFlight, setDescriptionImproveInFlight] = useState(false);
  const generationInFlight = useRef(new Set<string>());

  useEffect(() => {
    persistCreateTaskState({ cards, selectedTeamId });
  }, [cards, selectedTeamId]);

  useEffect(() => {
    let active = true;
    void listManagedProjects()
      .then((loaded) => {
        if (!active) return;
        setTeams(loaded);
        const restoredTeam = loaded.find((team) => team.id === selectedTeamId) ?? loaded[0];
        const restoredTeamId = restoredTeam?.id;
        setSelectedTeamId(restoredTeamId);
        setSelectedSprintId((current) => current || restoredTeam?.defaultTaskSprintId || "");
        setCards((current) => restoredTeamId
          ? current.map((card) => card.teamId ? card : { ...card, teamId: restoredTeamId })
          : current);
      })
      .catch(() => {
        if (active) setTeamsError(t("task.error.loadTeams"));
      })
      .finally(() => {
        if (active) setTeamsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (!selectedTeamId) return undefined;
    let active = true;
    setTeamContexts((current) => ({
      ...current,
      [selectedTeamId]: {
        ...(current[selectedTeamId] ?? emptyTeamContext()),
        membersLoading: true,
        sprintsLoading: true,
        epicsLoading: Boolean(teams.find((team) => team.id === selectedTeamId)?.epicLinkJql?.trim()),
        membersUnavailable: false,
        sprintsUnavailable: false,
        epicsUnavailable: false,
      },
    }));
    const selectedTeam = teams.find((team) => team.id === selectedTeamId);
    const epicJql = selectedTeam?.epicLinkJql?.trim();
    void Promise.allSettled([
      listJiraTaskTeamMembers(selectedTeamId),
      listTargetSprints(selectedTeamId),
      epicJql
        ? previewEpicLinkJql({ managedProjectId: selectedTeamId, jql: epicJql })
        : Promise.resolve([] as EpicLinkJqlIssue[]),
    ]).then(([membersResult, sprintsResult, epicsResult]) => {
      if (!active) return;
      const availableSprints = sprintsResult.status === "fulfilled"
        ? sprintsResult.value.filter((sprint) => sprint.usable)
        : [];
      setTeamContexts((current) => {
        const previous = current[selectedTeamId] ?? emptyTeamContext();
        return {
          ...current,
          [selectedTeamId]: {
            ...previous,
            members: membersResult.status === "fulfilled"
              ? membersResult.value.filter((member) => member.active)
              : previous.members,
            sprints: sprintsResult.status === "fulfilled" ? availableSprints : previous.sprints,
            epics: epicsResult.status === "fulfilled" ? epicsResult.value : previous.epics,
            membersLoading: false,
            sprintsLoading: false,
            epicsLoading: false,
            membersUnavailable: membersResult.status === "rejected",
            sprintsUnavailable: sprintsResult.status === "rejected",
            epicsUnavailable: Boolean(epicJql) && epicsResult.status === "rejected",
          },
        };
      });
      if (sprintsResult.status === "fulfilled") {
        setSelectedSprintId((current) => {
          if (current && availableSprints.some((sprint) => sprint.id === current)) return current;
          const configuredSprintId = selectedTeam?.defaultTaskSprintId;
          if (configuredSprintId && availableSprints.some((sprint) => sprint.id === configuredSprintId)) {
            return configuredSprintId;
          }
          return availableSprints.find((sprint) => sprint.state === "active")?.id ?? availableSprints[0]?.id ?? "";
        });
      }
    });
    return () => {
      active = false;
    };
  }, [selectedTeamId, teams]);

  const updateCard = (id: string, update: Partial<TaskCard>) => {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...update } : card)));
  };

  const generateCard = async (id: string, value: string) => {
    try {
      const generated = await generateTaskDraft(value);
      updateCard(id, {
        summary: generated.summary,
        description: generated.description,
        status: "ready",
        error: undefined,
      });
    } catch (error) {
      updateCard(id, { status: "failed", error: taskErrorMessage(error, t) });
    }
  };

  const openDescriptionImproveDialog = (cardId: string) => {
    setImprovingDescriptionCardId(cardId);
    setDescriptionImproveContext("");
    setDescriptionImproveError(undefined);
    setDescriptionImproveErrorCardId(undefined);
  };

  const closeDescriptionImproveDialog = () => {
    if (descriptionImproveInFlight) return;
    setImprovingDescriptionCardId(undefined);
    setDescriptionImproveContext("");
    setDescriptionImproveError(undefined);
    setDescriptionImproveErrorCardId(undefined);
  };

  const improveDescription = async () => {
    const cardId = improvingDescriptionCardId;
    const card = cards.find((candidate) => candidate.id === cardId);
    const context = descriptionImproveContext.trim();
    if (!card || !context || descriptionImproveInFlight) return;

    setDescriptionImproveInFlight(true);
    setDescriptionImprovingCardId(card.id);
    setDescriptionImproveError(undefined);
    setDescriptionImproveErrorCardId(undefined);
    setImprovingDescriptionCardId(undefined);
    setDescriptionImproveContext("");
    try {
      const generated = await generateTaskDraft([
        "Improve only the Jira task description.",
        "Keep the current meaning and return a complete replacement description.",
        "Do not rewrite the task summary or invent unrelated requirements.",
        `Current description:\n${card.description}`,
        `Additional context from the user:\n${context}`,
      ].join("\n\n"));
      updateCard(card.id, { description: generated.description });
    } catch (error) {
      setDescriptionImproveError(taskErrorMessage(error, t));
      setDescriptionImproveErrorCardId(card.id);
    } finally {
      setDescriptionImproveInFlight(false);
      setDescriptionImprovingCardId(undefined);
    }
  };

  const startGeneration = (id: string, value: string) => {
    if (generationInFlight.current.has(id)) return;
    generationInFlight.current.add(id);
    setCards((current) => current.map((card) => card.id === id
      ? { ...card, status: "generating", error: undefined }
      : card));
    void generateCard(id, value).finally(() => {
      generationInFlight.current.delete(id);
    });
  };

  useEffect(() => {
    cards
      .filter((card) => card.status === "generating")
      .forEach((card) => startGeneration(card.id, card.prompt));
  }, [cards]);

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value) return;
    const id = createCardId();
    setCards((current) => [
      ...current,
      {
        id,
        createdAt: nextCardCreatedAt(current),
        prompt: value,
        teamId: selectedTeamId,
        issueType: "Task",
        summary: "",
        description: "",
        epicLink: teams.find((team) => team.id === selectedTeamId)?.defaultEpicLinkKey ?? "",
        assignee: UNASSIGNED_VALUE,
        sprint: selectedSprintId,
        storyPoints: "",
        status: "generating",
      },
    ]);
    setDialogOpen(false);
    setPrompt("");
    startGeneration(id, value);
  };

  const deleteCard = (id: string) => {
    setCards((current) => current.filter((card) => card.id !== id));
  };

  const createTask = async (card: TaskCard) => {
    if (!card.summary.trim() || !card.description.trim() || card.status !== "ready") return;
    updateCard(card.id, { status: "creating", error: undefined });
    try {
      const result = await createJiraTask({
        managedProjectId: card.teamId ?? "",
        issueType: card.issueType,
        summary: card.summary,
        description: card.description,
        epicLink: card.epicLink || undefined,
        assignee: card.assignee === UNASSIGNED_VALUE ? undefined : card.assignee || undefined,
        sprint: card.sprint || undefined,
        storyPoints: card.storyPoints || undefined,
      });
      updateCard(card.id, { status: "created", createdTask: result });
    } catch (error) {
      updateCard(card.id, { status: "ready", error: taskErrorMessage(error, t) });
    }
  };

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const selectedContext = selectedTeamId ? teamContexts[selectedTeamId] : undefined;
  const improvingDescriptionCard = cards.find((card) => card.id === improvingDescriptionCardId);

  const renderTaskCard = (card: TaskCard) => {
    const context = card.teamId ? teamContexts[card.teamId] : undefined;
    const membersLoading = context?.membersLoading ?? false;
    const sprintsLoading = context?.sprintsLoading ?? false;
    const epicsLoading = context?.epicsLoading ?? false;
    const members = context?.members ?? [];
    const sprints = context?.sprints ?? [];
    const epics = context?.epics ?? [];
    const isDescriptionImproving = descriptionImprovingCardId === card.id;
    const hasDescriptionImproveError = descriptionImproveErrorCardId === card.id;

    if (card.status === "generating") {
      return <DraftSkeletonCard key={card.id} />;
    }

    if (card.status === "failed") {
      return (
        <article key={card.id} className="rounded-xl border border-destructive/40 bg-card p-4 shadow-sm" aria-label={t("task.draftFailedAria")} aria-live="polite">
          <h2 className="text-base font-semibold text-foreground">{t("task.draftFailed")}</h2>
          <p className="mt-2 text-sm text-destructive" role="alert">{card.error}</p>
          <div className="mt-4 flex items-center justify-between">
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => startGeneration(card.id, card.prompt)}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> {t("task.retry")}
            </Button>
            <Button type="button" variant="ghost" actionTone="delete" className="text-muted-foreground hover:bg-transparent hover:text-destructive" onClick={() => deleteCard(card.id)}>{t("task.delete")}</Button>
          </div>
        </article>
      );
    }

    if (card.status === "created" && card.createdTask) {
      return (
        <article
          key={card.id}
          className="create-task-created-card"
          aria-label={t("task.createdAria", { key: card.createdTask.key })}
          aria-live="polite"
        >
          <div className="create-task-created-card-head">
            <div className="create-task-created-card-main">
              <span className="create-task-created-badge">{card.createdTask.key}</span>
              <h2 className="create-task-created-title">{card.summary}</h2>
              {card.createdTask.warning ? <p className="create-task-created-warning" role="status">{card.createdTask.warning}</p> : null}
            </div>
            <Check className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="create-task-created-actions">
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => deleteCard(card.id)}>
              {t("task.dismiss")}
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={card.createdTask.url} target="_blank" rel="noreferrer">
                {t("task.openJira")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </article>
      );
    }

    return (
      <article
        key={card.id}
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        aria-label={t("task.editableDraft")}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("task.aiDraft")}</p>
            <h2 className="mt-1 text-base font-semibold text-foreground">{t("task.reviewCreate")}</h2>
          </div>
          <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
        {card.status === "created" && card.createdTask?.warning ? <p className="mb-4 text-sm text-amber-700 dark:text-amber-300" role="status">{card.createdTask.warning}</p> : null}
        {card.error ? <p className="mb-4 text-sm text-destructive" role="alert">{card.error}</p> : null}
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[7.25rem_minmax(0,1fr)] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor={`draft-issue-type-${card.id}`}>{t("task.type")}</Label>
              <Select value={card.issueType} onValueChange={(value) => updateCard(card.id, { issueType: issueTypeValue(value) })} disabled={card.status === "creating"}>
                <SelectTrigger id={`draft-issue-type-${card.id}`} aria-label={t("task.issueType")} className="h-10 px-2.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Task">{t("task.task")}</SelectItem>
                  <SelectItem value="Spike">{t("task.spike")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`draft-summary-${card.id}`}>{t("task.summary")}</Label>
              <Input id={`draft-summary-${card.id}`} value={card.summary} disabled={card.status === "creating"} onChange={(event) => updateCard(card.id, { summary: event.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`draft-description-${card.id}`}>{t("task.description")}</Label>
              {isDescriptionImproving ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-primary" role="status" aria-live="polite">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t("task.improving")}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-primary"
                  disabled={card.status === "creating"}
                  onClick={() => openDescriptionImproveDialog(card.id)}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t("task.improveWithAi")}
                </Button>
              )}
            </div>
            <textarea id={`draft-description-${card.id}`} aria-busy={isDescriptionImproving} className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={card.description} disabled={card.status === "creating" || isDescriptionImproving} onChange={(event) => updateCard(card.id, { description: event.target.value })} />
            {hasDescriptionImproveError ? <p className="text-xs text-destructive" role="alert">{descriptionImproveError}</p> : null}
            <p className="text-xs text-muted-foreground">{t("task.markupHelp")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`draft-epic-link-${card.id}`}>{t("task.epicLink")}</Label>
              <Select value={card.epicLink} onValueChange={(value) => updateCard(card.id, { epicLink: value })} disabled={!card.teamId || epicsLoading || epics.length === 0}>
                <SelectTrigger id={`draft-epic-link-${card.id}`} aria-label={t("task.epicLink")} className="h-10 px-2"><SelectValue placeholder={epicsLoading ? t("task.loadingEpics") : epics.length ? t("task.selectEpic") : t("task.noEpics")} /></SelectTrigger>
                <SelectContent>
                  {card.epicLink && !epics.some((epic) => epic.key === card.epicLink) ? <SelectItem className="create-task-epic-item" value={card.epicLink}>{card.epicLink}</SelectItem> : null}
                  {epics.map((epic) => <SelectItem className="create-task-epic-item" key={epic.key} value={epic.key}>{epic.key} — {epic.summary}</SelectItem>)}
                </SelectContent>
              </Select>
              {context?.epicsUnavailable ? <p className="text-xs text-muted-foreground">{t("task.epicsUnavailable")}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`draft-sprint-${card.id}`}>{t("task.sprint")}</Label>
              <Select value={card.sprint} onValueChange={(value) => updateCard(card.id, { sprint: value })} disabled={sprintsLoading || sprints.length === 0}>
                <SelectTrigger id={`draft-sprint-${card.id}`} aria-label={t("task.sprint")}><SelectValue placeholder={sprintsLoading ? t("task.loadingSprints") : t("task.noSprints")} /></SelectTrigger>
                <SelectContent>
                  {sprints.map((sprint) => <SelectItem key={sprint.id} value={sprint.id}>{sprint.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {context?.sprintsUnavailable ? <p className="text-xs text-muted-foreground">{t("task.sprintsUnavailable")}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`draft-assignee-${card.id}`}>{t("task.assignee")}</Label>
              <Select value={card.assignee || UNASSIGNED_VALUE} onValueChange={(value) => updateCard(card.id, { assignee: value })} disabled={!card.teamId || membersLoading}>
                <SelectTrigger id={`draft-assignee-${card.id}`} aria-label={t("task.assignee")}><SelectValue placeholder={t("task.unassigned")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>{t("task.unassigned")}</SelectItem>
                  {members.map((member) => <SelectItem key={member.id} value={member.id}><TaskMemberOption member={member} managedProjectId={card.teamId} /></SelectItem>)}
                </SelectContent>
              </Select>
              {!card.teamId ? <p className="text-xs text-muted-foreground">{t("task.selectTeamMembers")}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`draft-story-points-${card.id}`}>{t("task.storyPoints")}</Label>
              <Input
                id={`draft-story-points-${card.id}`}
                aria-label={t("task.storyPoints")}
                type="number"
                min="0"
                max="100"
                step="0.5"
                inputMode="decimal"
                placeholder={t("task.optional")}
                value={card.storyPoints}
                disabled={card.status === "creating"}
                onChange={(event) => updateCard(card.id, { storyPoints: event.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          {card.status === "created" && card.createdTask ? (
            <>
              <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => deleteCard(card.id)}>
                {t("task.dismiss")}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={card.createdTask.url} target="_blank" rel="noreferrer">
                  {t("task.openJira")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" actionTone="delete" className="text-muted-foreground hover:bg-transparent hover:text-destructive" onClick={() => deleteCard(card.id)}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("task.delete")}
              </Button>
              <Button type="button" disabled={!card.teamId || card.status === "creating" || !card.summary.trim() || !card.description.trim()} onClick={() => void createTask(card)}>
                {card.status === "creating" ? t("task.creating") : t("task.create")}
              </Button>
            </>
          )}
        </div>
      </article>
    );
  };

  const cardColumns = [
    cards.filter((_, index) => index % 2 === 0),
    cards.filter((_, index) => index % 2 === 1),
  ];

  return (
    <section aria-labelledby="create-task-title" className="create-task-page">
      <PageHeader
        title={t("page.createTask")}
        titleId="create-task-title"
        description={t("task.pageDescription")}
        className="page-header--create-task"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={selectedTeamId ?? ""}
          onValueChange={(teamId) => {
            const team = teams.find((candidate) => candidate.id === teamId);
            setSelectedTeamId(teamId);
            setSelectedSprintId(team?.defaultTaskSprintId ?? "");
          }}
          disabled={teamsLoading || teams.length === 0}
        >
          <SelectTrigger id="create-task-team-select" aria-label={t("task.team")}>
            <SelectValue placeholder={teamsLoading ? t("task.loadingTeams") : t("task.selectTeam")} />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={selectedSprintId}
          onValueChange={setSelectedSprintId}
          disabled={!selectedTeamId || selectedContext?.sprintsLoading || !selectedContext?.sprints.length}
        >
          <SelectTrigger id="create-task-sprint-select" aria-label={t("task.newTaskSprint")}>
            <SelectValue placeholder={selectedContext?.sprintsLoading ? t("task.loadingSprints") : t("task.noSprints")} />
          </SelectTrigger>
          <SelectContent>
            {(selectedContext?.sprints ?? []).map((sprint) => <SelectItem key={sprint.id} value={sprint.id}>{sprint.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            actionTone="add"
            className="h-9 w-9"
            onClick={() => setDialogOpen(true)}
            aria-label={t("task.new")}
            title={t("task.new")}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {teamsError ? <p className="text-sm text-destructive" role="alert">{teamsError}</p> : null}
      {selectedTeam && selectedContext?.membersUnavailable ? <p className="text-sm text-muted-foreground">{t("task.membersUnavailable", { team: selectedTeam.name })}</p> : null}

      {cards.length > 0 ? (
        <div className="create-task-card-columns" aria-label={t("task.drafts")}>
          {cardColumns.map((column, columnIndex) => (
            <div className="create-task-card-column" key={columnIndex}>
              {column.map(renderTaskCard)}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          titleId="create-task-empty-title"
          title={t("task.empty")}
          description={t("task.emptyDescription")}
          hint={t("task.emptyHint")}
          icon={<ClipboardList className="size-5" />}
        />
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="create-task-dialog">
          <DialogHeader>
            <div className="create-task-dialog-icon"><Sparkles aria-hidden="true" /></div>
            <DialogTitle>{t("task.describe")}</DialogTitle>
            <DialogDescription>{t("task.describeDescription")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form id="create-task-form" className="create-task-form" onSubmit={submitPrompt}>
              <label className="sr-only" htmlFor="task-description">{t("task.describe")}</label>
              <textarea id="task-description" className="create-task-textarea create-task-textarea--dialog" value={prompt} placeholder={t("task.describe")} autoFocus required onChange={(event) => setPrompt(event.target.value)} />
            </form>
          </DialogBody>
          <DialogFooter className="create-task-dialog-footer">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("settings.common.cancel")}</Button>
            <Button type="submit" form="create-task-form" disabled={!prompt.trim()}>
              <Sparkles aria-hidden="true" />
              {t("task.createWithAi")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(improvingDescriptionCard)} onOpenChange={(open) => { if (!open) closeDescriptionImproveDialog(); }}>
        <DialogContent className="create-task-dialog">
          <DialogHeader>
            <div className="create-task-dialog-icon"><Sparkles aria-hidden="true" /></div>
            <DialogTitle>{t("task.improveTitle")}</DialogTitle>
            <DialogDescription>{t("task.improveDescription")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label className="sr-only" htmlFor="description-improve-context">{t("task.additionalContext")}</label>
            <textarea
              id="description-improve-context"
              className="create-task-textarea create-task-textarea--dialog"
              value={descriptionImproveContext}
              placeholder={t("task.contextPlaceholder")}
              autoFocus
              onChange={(event) => setDescriptionImproveContext(event.target.value)}
            />
            {descriptionImproveError ? <p className="mt-2 text-sm text-destructive" role="alert">{descriptionImproveError}</p> : null}
          </DialogBody>
          <DialogFooter className="create-task-dialog-footer">
            <Button type="button" variant="outline" onClick={() => closeDescriptionImproveDialog()} disabled={descriptionImproveInFlight}>{t("settings.common.cancel")}</Button>
            <Button type="button" onClick={() => void improveDescription()} disabled={!descriptionImproveContext.trim() || descriptionImproveInFlight}>
              <Sparkles aria-hidden="true" />
              {descriptionImproveInFlight ? t("task.improving") : t("task.improve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
