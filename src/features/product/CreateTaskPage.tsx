import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
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
import type { CreatedJiraTask, JiraTaskMember } from "./create-task-api";
import { createJiraTask, generateTaskDraft, listJiraTaskTeamMembers } from "./create-task-api";

import "./create-task.css";

const UNASSIGNED_VALUE = "__unassigned__";

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
  prompt: string;
  teamId?: string;
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

function parsePersistedCard(value: unknown): TaskCard | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const prompt = stringValue(value.prompt);
  const summary = stringValue(value.summary);
  const description = stringValue(value.description);
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
    prompt,
    ...(stringValue(value.teamId) ? { teamId: stringValue(value.teamId) } : {}),
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
    return {
      cards: parsed.cards.map(parsePersistedCard).filter((card): card is TaskCard => Boolean(card)),
      ...(stringValue(parsed.selectedTeamId) ? { selectedTeamId: stringValue(parsed.selectedTeamId) } : {}),
    };
  } catch {
    return { cards: [] };
  }
}

function persistCreateTaskState(state: PersistedCreateTaskState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CREATE_TASK_STATE_KEY, JSON.stringify({ version: 1, ...state }));
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

function displayMemberName(member: JiraTaskMember): string {
  return member.displayName.trim() || member.id;
}

function taskErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error)) {
    const message = stringValue(error.message);
    if (message?.trim()) return message;
    const code = stringValue(error.code);
    if (code?.trim()) return `Jira task creation failed (${code}).`;
  }
  return "Unable to create the Jira task.";
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
  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-label="AI is thinking" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI draft</p>
          <h2 className="truncate text-base font-semibold text-foreground">AI is thinking…</h2>
          <p className="text-sm text-muted-foreground">Preparing editable task fields</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3" aria-hidden="true">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Summary</span>
          <div className="h-9 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Description</span>
          <div className="h-20 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            "Epic link",
            "Sprint",
            "Assignee",
            "Story points",
          ].map((label) => (
            <div key={label} className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4" aria-hidden="true">
        <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
      </div>
    </article>
  );
}

export function CreateTaskPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [cards, setCards] = useState<TaskCard[]>(() => readPersistedCreateTaskState().cards);
  const [teams, setTeams] = useState<ManagedProject[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(() => readPersistedCreateTaskState().selectedTeamId);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamContexts, setTeamContexts] = useState<Record<string, TeamContext>>({});
  const [teamsError, setTeamsError] = useState<string | null>(null);
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
        const restoredTeamId = selectedTeamId && loaded.some((team) => team.id === selectedTeamId)
          ? selectedTeamId
          : loaded[0]?.id;
        setSelectedTeamId(restoredTeamId);
        setCards((current) => restoredTeamId
          ? current.map((card) => card.teamId ? card : { ...card, teamId: restoredTeamId })
          : current);
      })
      .catch(() => {
        if (active) setTeamsError("Unable to load teams");
      })
      .finally(() => {
        if (active) setTeamsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
      setTeamContexts((current) => {
        const previous = current[selectedTeamId] ?? emptyTeamContext();
        return {
          ...current,
          [selectedTeamId]: {
            ...previous,
            members: membersResult.status === "fulfilled"
              ? membersResult.value.filter((member) => member.active)
              : previous.members,
            sprints: sprintsResult.status === "fulfilled"
              ? sprintsResult.value.filter((sprint) => sprint.usable)
              : previous.sprints,
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
    } catch {
      updateCard(id, { status: "failed", error: "Unable to create an AI draft" });
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
        prompt: value,
        teamId: selectedTeamId,
        summary: "",
        description: "",
        epicLink: "",
        assignee: UNASSIGNED_VALUE,
        sprint: teams.find((team) => team.id === selectedTeamId)?.defaultTaskSprintId ?? "",
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
        summary: card.summary,
        description: card.description,
        epicLink: card.epicLink || undefined,
        assignee: card.assignee === UNASSIGNED_VALUE ? undefined : card.assignee || undefined,
        sprint: card.sprint || undefined,
        storyPoints: card.storyPoints || undefined,
      });
      updateCard(card.id, { status: "created", createdTask: result });
    } catch (error) {
      updateCard(card.id, { status: "ready", error: taskErrorMessage(error) });
    }
  };

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const selectedContext = selectedTeamId ? teamContexts[selectedTeamId] : undefined;

  return (
    <section aria-labelledby="create-task-title" className="create-task-page">
      <PageHeader
        title="Create task"
        titleId="create-task-title"
        className="page-header--create-task"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedTeamId ?? ""} onValueChange={setSelectedTeamId} disabled={teamsLoading || teams.length === 0}>
              <SelectTrigger id="create-task-team-select" aria-label="Team" className="w-48">
                <SelectValue placeholder={teamsLoading ? "Loading teams…" : "Select a team"} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" className="create-task-new-button" onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden="true" />
              Create task
            </Button>
          </div>
        )}
      />

      {teamsError ? <p className="text-sm text-destructive" role="alert">{teamsError}</p> : null}
      {selectedTeam && selectedContext?.membersUnavailable ? <p className="text-sm text-muted-foreground">Team members are temporarily unavailable for {selectedTeam.name}.</p> : null}

      {cards.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Task drafts">
          {cards.map((card) => {
            const context = card.teamId ? teamContexts[card.teamId] : undefined;
            const membersLoading = context?.membersLoading ?? false;
            const sprintsLoading = context?.sprintsLoading ?? false;
            const epicsLoading = context?.epicsLoading ?? false;
            const members = context?.members ?? [];
            const sprints = context?.sprints ?? [];
            const epics = context?.epics ?? [];

            if (card.status === "generating") {
              return <DraftSkeletonCard key={card.id} />;
            }

            if (card.status === "failed") {
              return (
                <article key={card.id} className="rounded-xl border border-destructive/40 bg-card p-5 shadow-sm" aria-label="Task draft failed" aria-live="polite">
                  <h2 className="text-base font-semibold text-foreground">AI draft failed</h2>
                  <p className="mt-2 text-sm text-destructive">{card.error}</p>
                  <div className="mt-5 flex items-center justify-between">
                    <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => startGeneration(card.id, card.prompt)}>
                      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry
                    </Button>
                    <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => deleteCard(card.id)}>Delete</Button>
                  </div>
                </article>
              );
            }

            if (card.status === "created" && card.createdTask) {
              // Created cards intentionally use the locked draft form below.
            }

            return (
              <article
                key={card.id}
                className={card.status === "created" ? "rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5 shadow-sm" : "rounded-xl border border-border bg-card p-5 shadow-sm"}
                aria-label={card.status === "created" && card.createdTask ? `Created Jira task ${card.createdTask.key}` : "Editable Jira task draft"}
                aria-live={card.status === "created" ? "polite" : undefined}
              >
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={card.status === "created" ? "text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300" : "text-xs font-medium uppercase tracking-wide text-muted-foreground"}>{card.status === "created" ? "Task was created" : "AI draft"}</p>
                    <h2 className="mt-1 text-base font-semibold text-foreground">{card.status === "created" && card.createdTask ? card.createdTask.key : "Review and create"}</h2>
                  </div>
                  {card.status === "created" ? null : <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </div>
                {card.status === "created" && card.createdTask?.warning ? <p className="mb-4 text-sm text-amber-700 dark:text-amber-300" role="status">{card.createdTask.warning}</p> : null}
                {card.error ? <p className="mb-4 text-sm text-destructive" role="alert">{card.error}</p> : null}
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor={`draft-summary-${card.id}`}>Summary</Label>
                    <Input id={`draft-summary-${card.id}`} value={card.summary} disabled={card.status === "creating" || card.status === "created"} onChange={(event) => updateCard(card.id, { summary: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`draft-description-${card.id}`}>Description</Label>
                    <textarea id={`draft-description-${card.id}`} className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={card.description} disabled={card.status === "creating" || card.status === "created"} onChange={(event) => updateCard(card.id, { description: event.target.value })} />
                  </div>
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor={`draft-epic-link-${card.id}`}>Epic link</Label>
                      <Select value={card.epicLink} onValueChange={(value) => updateCard(card.id, { epicLink: value })} disabled={card.status === "created" || !card.teamId || epicsLoading || epics.length === 0}>
                        <SelectTrigger id={`draft-epic-link-${card.id}`} aria-label="Epic link"><SelectValue placeholder={epicsLoading ? "Loading epics…" : epics.length ? "Select an epic" : "No epics available"} /></SelectTrigger>
                        <SelectContent>
                          {epics.map((epic) => <SelectItem key={epic.key} value={epic.key}>{epic.key} — {epic.summary}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {context?.epicsUnavailable ? <p className="text-xs text-muted-foreground">Epic links are temporarily unavailable.</p> : null}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`draft-sprint-${card.id}`}>Sprint</Label>
                      <Select value={card.sprint} onValueChange={(value) => updateCard(card.id, { sprint: value })} disabled={card.status === "created" || sprintsLoading || sprints.length === 0}>
                        <SelectTrigger id={`draft-sprint-${card.id}`} aria-label="Sprint"><SelectValue placeholder={sprintsLoading ? "Loading sprints…" : "No sprints available"} /></SelectTrigger>
                        <SelectContent>
                          {sprints.map((sprint) => <SelectItem key={sprint.id} value={sprint.id}>{sprint.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {context?.sprintsUnavailable ? <p className="text-xs text-muted-foreground">Sprints are temporarily unavailable.</p> : null}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`draft-story-points-${card.id}`}>Story points</Label>
                      <Input
                        id={`draft-story-points-${card.id}`}
                        aria-label="Story points"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        inputMode="decimal"
                        placeholder="Optional"
                        value={card.storyPoints}
                        disabled={card.status === "creating" || card.status === "created"}
                        onChange={(event) => updateCard(card.id, { storyPoints: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`draft-assignee-${card.id}`}>Assignee</Label>
                      <Select value={card.assignee || UNASSIGNED_VALUE} onValueChange={(value) => updateCard(card.id, { assignee: value })} disabled={card.status === "created" || !card.teamId || membersLoading}>
                        <SelectTrigger id={`draft-assignee-${card.id}`} aria-label="Assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                        {members.map((member) => <SelectItem key={member.id} value={member.id}><TaskMemberOption member={member} managedProjectId={card.teamId} /></SelectItem>)}
                      </SelectContent>
                      </Select>
                      {!card.teamId ? <p className="text-xs text-muted-foreground">Select a team to load members.</p> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                  {card.status === "created" && card.createdTask ? (
                    <>
                      <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => deleteCard(card.id)}>
                        Dismiss
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a href={card.createdTask.url} target="_blank" rel="noreferrer">
                          Open in Jira <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => deleteCard(card.id)}>
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        Delete
                      </Button>
                      <Button type="button" disabled={!card.teamId || card.status === "creating" || !card.summary.trim() || !card.description.trim()} onClick={() => void createTask(card)}>
                        {card.status === "creating" ? "Creating…" : "Create"}
                      </Button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="create-task-empty" aria-hidden="true" />}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="create-task-dialog">
          <DialogHeader>
            <div className="create-task-dialog-icon"><Sparkles aria-hidden="true" /></div>
            <DialogTitle>Describe your task</DialogTitle>
            <DialogDescription>Turn a rough idea into a well-structured Jira task with AI.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form id="create-task-form" className="create-task-form" onSubmit={submitPrompt}>
              <label className="sr-only" htmlFor="task-description">Describe your task</label>
              <textarea id="task-description" className="create-task-textarea create-task-textarea--dialog" value={prompt} placeholder="Describe your task" autoFocus required onChange={(event) => setPrompt(event.target.value)} />
            </form>
          </DialogBody>
          <DialogFooter className="create-task-dialog-footer">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="create-task-form" disabled={!prompt.trim()}>
              <Sparkles aria-hidden="true" />
              Create with AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
