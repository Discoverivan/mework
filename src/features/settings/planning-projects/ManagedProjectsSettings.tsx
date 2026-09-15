import { ChevronDown, GripVertical } from "lucide-react";
import { createPortal } from "react-dom";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EpicLinkJqlIssue, PlanningBoard, PlanningSprint } from "@/shared/contracts/planning";
import type { TeamMember } from "@/shared/contracts/planning";
import type {
  IntegrationRedacted,
  ManagedProjectSettings,
} from "@/shared/contracts/settings";
import {
  addPlanningTeamMember,
  listPlanningConfiguredTeamMembers,
  listPlanningProjectBoards,
  listTargetSprints,
  loadJiraAvatarData,
  previewEpicLinkJql,
  reorderPlanningTeamMembers,
  removePlanningTeamMember,
  searchPlanningTeamMembers,
} from "../../planning/api";
import type { ManagedProjectSaveInput } from "@/shared/contracts/settings";
import { deleteManagedProject, listManagedProjects, saveManagedProject } from "./api";

type Action = "save" | "delete" | null;

const ROLE_OPTIONS = ["backend", "frontend", "qa", "devops", "analyst", "product", "architect"];

export function memberInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "?";
}

function memberLabel(member: TeamMember): string {
  return member.alias?.trim() || member.displayName;
}

function MemberAvatar({ member, managedProjectId }: { member: TeamMember; managedProjectId: string }) {
  const [source, setSource] = useState(member.avatarUrl);
  useEffect(() => {
    let active = true;
    setSource(member.avatarUrl);
    if (member.avatarUrl) {
      void loadJiraAvatarData(managedProjectId, member.avatarUrl)
        .then((dataUrl) => { if (active && dataUrl) setSource(dataUrl); })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [managedProjectId, member.accountId, member.avatarUrl]);
  return source ? (
    <img src={source} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" onError={() => setSource(undefined)} />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium" aria-hidden="true">
      {memberInitials(member.displayName)}
    </span>
  );
}

export interface ProjectKeyValidationSuccess {
  projectId: string;
  projectKey: string;
  projectName: string;
}

export interface ProjectKeyValidationError {
  error: string;
}

export type ProjectKeyValidationResult = ProjectKeyValidationSuccess | ProjectKeyValidationError;

/** Parent-provided Jira read-path validation. The callback must not access credentials in the renderer. */
export type ValidateProjectKey = (
  projectKey: string,
  integrationId?: string,
) => ProjectKeyValidationResult | Promise<ProjectKeyValidationResult>;

export interface ManagedProjectsSettingsProps {
  jiraIntegrations: IntegrationRedacted[];
  validateProjectKey?: ValidateProjectKey;
}

interface ManagedProjectForm {
  id?: string;
  integrationId: string;
  jiraProjectId: string;
  jiraProjectKey: string;
  jiraProjectName: string;
  boardId: string;
  defaultTaskSprintId: string;
  defaultTaskSprintName: string;
  epicLinkJql: string;
  enabled: boolean;
}

function emptyForm(integrationId?: string): ManagedProjectForm {
  return {
    integrationId: integrationId ?? "",
    jiraProjectId: "",
    jiraProjectKey: "",
    jiraProjectName: "",
    boardId: "",
    defaultTaskSprintId: "",
    defaultTaskSprintName: "",
    epicLinkJql: "",
    enabled: true,
  };
}

function formForProject(project: ManagedProjectSettings): ManagedProjectForm {
  return {
    id: project.id,
    integrationId: project.integrationId,
    jiraProjectId: project.projectId,
    jiraProjectKey: project.projectKey,
    jiraProjectName: project.projectName,
    boardId: project.boardId ?? "",
    defaultTaskSprintId: project.defaultTaskSprintId ?? "",
    defaultTaskSprintName: project.defaultTaskSprintName ?? "",
    epicLinkJql: project.epicLinkJql ?? "",
    enabled: project.enabled,
  };
}

function value(input: string | undefined): string {
  return input?.trim() ?? "";
}

function commandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const structured = error as { message?: unknown; code?: unknown };
    if (typeof structured.message === "string" && structured.message.trim()) {
      return structured.message;
    }
    if (typeof structured.code === "string" && structured.code.trim()) {
      return `Command failed (${structured.code})`;
    }
  }
  return "Unknown command error";
}

function replaceProject(
  projects: ManagedProjectSettings[],
  nextProject: ManagedProjectSettings,
): ManagedProjectSettings[] {
  const found = projects.some((project) => project.id === nextProject.id);
  return found
    ? projects.map((project) => (project.id === nextProject.id ? nextProject : project))
    : [...projects, nextProject];
}

function formErrors(form: ManagedProjectForm): string[] {
  const errors: string[] = [];
  if (!value(form.integrationId)) errors.push("A Jira integration is required.");
  if (!value(form.jiraProjectName)) errors.push("Project name is required.");
  if (!value(form.jiraProjectKey)) errors.push("Jira Project Key is required.");
  if (!value(form.boardId)) errors.push("A Jira board must be selected.");
  return errors;
}

export function reorderMemberIdsAtInsertionIndex(memberIds: string[], draggedId: string, insertionIndex: number): string[] {
  const sourceIndex = memberIds.indexOf(draggedId);
  if (sourceIndex < 0 || insertionIndex < 0 || insertionIndex > memberIds.length) return memberIds;

  const next = [...memberIds];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return memberIds;
  const adjustedInsertionIndex = sourceIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
  next.splice(adjustedInsertionIndex, 0, moved);
  return next;
}

export function ManagedProjectsSettings({
  jiraIntegrations,
  validateProjectKey,
}: ManagedProjectsSettingsProps) {
  const [projects, setProjects] = useState<ManagedProjectSettings[]>([]);
  const [form, setForm] = useState<ManagedProjectForm | null>(null);
  const [detailProject, setDetailProject] = useState<ManagedProjectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [boards, setBoards] = useState<PlanningBoard[]>([]);
  const [boardNames, setBoardNames] = useState<Record<string, string>>({});
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsError, setBoardsError] = useState<string | null>(null);

  const [configuredMembers, setConfiguredMembers] = useState<TeamMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<TeamMember[]>([]);
  const [selectedSearchMember, setSelectedSearchMember] = useState<TeamMember | null>(null);
  const [memberRole, setMemberRole] = useState("");
  const [memberAlias, setMemberAlias] = useState("");
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);
  const [memberLoadError, setMemberLoadError] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamSaveError, setTeamSaveError] = useState<string | null>(null);
  const [taskSprints, setTaskSprints] = useState<PlanningSprint[]>([]);
  const [taskSprintsLoading, setTaskSprintsLoading] = useState(false);
  const [taskSprintsError, setTaskSprintsError] = useState<string | null>(null);
  const [defaultTaskSprintId, setDefaultTaskSprintId] = useState("");
  const [defaultTaskSprintName, setDefaultTaskSprintName] = useState("");
  const [epicLinkJql, setEpicLinkJql] = useState("");
  const [epicPreviewIssues, setEpicPreviewIssues] = useState<EpicLinkJqlIssue[]>([]);
  const [epicPreviewOpen, setEpicPreviewOpen] = useState(false);
  const [epicPreviewLoading, setEpicPreviewLoading] = useState(false);
  const draggedMemberAccountId = useRef<string | null>(null);
  const dropInsertionIndex = useRef<number | null>(null);
  const [draggingMemberAccountId, setDraggingMemberAccountId] = useState<string | null>(null);
  const [pointerDropInsertionIndex, setPointerDropInsertionIndex] = useState<number | null>(null);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingMemberAccountId, setEditingMemberAccountId] = useState<string | null>(null);
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    listManagedProjects()
      .then((loaded) => {
        if (active) setProjects(loaded);
      })
      .catch((error) => {
        if (active) {
          const message = commandError(error);
          setLoadError(/permission|forbidden|denied/i.test(message)
            ? "Managed-project configuration is unavailable until Jira access is granted."
            : message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadBoardNames = async () => {
      const entries = await Promise.all(projects.map(async (project) => {
        if (!project.boardId) return [project.id, ""] as const;
        try {
          const found = await listPlanningProjectBoards({ integrationId: project.integrationId, projectKey: project.projectKey });
          const board = found.find((candidate) => candidate.id === project.boardId);
          return [project.id, board?.name ?? project.boardId] as const;
        } catch {
          return [project.id, project.boardId] as const;
        }
      }));
      if (active) setBoardNames(Object.fromEntries(entries));
    };
    if (projects.length > 0) void loadBoardNames();
    return () => { active = false; };
  }, [projects]);

  useEffect(() => {
    if (!detailProject) return undefined;

    let active = true;
    setMemberLoadError(null);
    setTeamSaveError(null);
    setConfiguredMembers([]);
    setMemberSearch("");
    setMemberSearchResults([]);
    setSelectedSearchMember(null);
    setMemberRole("");
    setMemberAlias("");
    setDefaultTaskSprintId(detailProject.defaultTaskSprintId ?? "");
    setDefaultTaskSprintName(detailProject.defaultTaskSprintName ?? "");
    setEpicLinkJql(detailProject.epicLinkJql ?? "");
    setTaskSprints([]);
    setTaskSprintsError(null);
    setTaskSprintsLoading(true);

    listPlanningConfiguredTeamMembers(detailProject.id)
      .then((members) => {
        if (active) {
          const loadedMembers = Array.isArray(members) ? members : [];
          setConfiguredMembers(loadedMembers);
        }
      })
      .catch((error) => {
        if (active) setMemberLoadError(commandError(error));
      });

    listTargetSprints(detailProject.id)
      .then((sprints) => {
        if (active) setTaskSprints(Array.isArray(sprints) ? sprints.filter((sprint) => sprint.usable) : []);
      })
      .catch((error) => {
        if (active) setTaskSprintsError(commandError(error));
      })
      .finally(() => {
        if (active) setTaskSprintsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [detailProject]);

  useEffect(() => {
    const query = memberSearch.trim();
    if (!detailProject || query.length < 3) {
      setMemberSearchResults([]);
      setMemberSearchError(null);
      setMemberSearchLoading(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setMemberSearchLoading(true);
      setMemberSearchError(null);
      searchPlanningTeamMembers({ managedProjectId: detailProject.id, query })
        .then((members) => {
          if (active) setMemberSearchResults(Array.isArray(members) ? members : []);
        })
        .catch((error) => {
          if (active) setMemberSearchError(commandError(error));
        })
        .finally(() => {
          if (active) setMemberSearchLoading(false);
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [detailProject, memberSearch]);

  const errors = form ? formErrors(form) : [];
  const controlsDisabled = action !== null || teamSaving || boardsLoading;

  function updateForm(field: keyof ManagedProjectForm, nextValue: string) {
    setForm((current) => {
      if (!current) return current;
      return field === "jiraProjectKey"
        ? { ...current, [field]: nextValue, boardId: "" }
        : { ...current, [field]: nextValue };
    });
    if (field === "jiraProjectKey") {
      setBoards([]);
      setBoardsError(null);
    }
    setSaveError(null);
  }

  function resetBoards() {
    setBoards([]);
    setBoardsError(null);
  }

  function startAdd() {
    setDetailProject(null);
    resetBoards();
    setSaveError(null);
    setForm(emptyForm(jiraIntegrations.find((integration) => integration.enabled)?.id));
  }

  function startEdit(project: ManagedProjectSettings) {
    setDetailProject(null);
    resetBoards();
    setSaveError(null);
    setForm(formForProject(project));
  }

  function openAddMemberDialog() {
    setEditingMemberAccountId(null);
    setSelectedSearchMember(null);
    setMemberSearch("");
    setMemberRole("");
    setMemberAlias("");
    setMemberDialogOpen(true);
  }

  function openEditMemberDialog(member: TeamMember) {
    setEditingMemberAccountId(member.accountId);
    setSelectedSearchMember(member);
    setMemberRole(member.tags[0] ?? "");
    setMemberAlias(member.alias ?? "");
    setMemberDialogOpen(true);
  }

  function closeMemberDialog() {
    if (teamSaving) return;
    setMemberDialogOpen(false);
    setEditingMemberAccountId(null);
    setSelectedSearchMember(null);
    setMemberSearch("");
    setMemberRole("");
    setMemberAlias("");
  }

  function openDetail(project: ManagedProjectSettings) {
    setForm(null);
    setSaveError(null);
    setDetailProject(project);
  }

  async function handleLoadBoards() {
    if (!form || boardsLoading || !value(form.integrationId) || !value(form.jiraProjectKey)) return;
    setBoardsLoading(true);
    setBoardsError(null);
    setSaveError(null);
    try {
      const loaded = await listPlanningProjectBoards({
        integrationId: value(form.integrationId),
        projectKey: value(form.jiraProjectKey),
      });
      const nextBoards = Array.isArray(loaded) ? loaded : [];
      setBoards(nextBoards);
      setForm((current) => current
        ? {
            ...current,
            boardId: nextBoards.some((board) => board.id === current.boardId) ? current.boardId : "",
          }
        : current);
      if (nextBoards.length === 0) {
        setBoardsError("No Jira boards were found for this project.");
      }
    } catch (error) {
      setBoardsError(`Unable to load Jira boards. ${commandError(error)}`);
    } finally {
      setBoardsLoading(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || errors.length > 0 || controlsDisabled) return;

    setAction("save");
    setSaveError(null);
    try {
      if (!validateProjectKey) {
        setSaveError("Project-key validation is unavailable; the project cannot be saved yet.");
        return;
      }

      let validation: ProjectKeyValidationResult;
      try {
        validation = await validateProjectKey(value(form.jiraProjectKey), value(form.integrationId));
      } catch (error) {
        setSaveError(`Unable to validate Jira project key. ${commandError(error)}`);
        return;
      }
      if ("error" in validation) {
        setSaveError(validation.error);
        return;
      }

      const request: ManagedProjectSaveInput = {
        ...(form.id ? { id: form.id } : {}),
        integrationId: value(form.integrationId),
        jiraProjectId: value(validation.projectId),
        jiraProjectKey: value(validation.projectKey),
        jiraProjectName: value(validation.projectName ?? form.jiraProjectName),
        boardId: value(form.boardId),
        defaultTaskSprintId: value(form.defaultTaskSprintId) || undefined,
        defaultTaskSprintName: value(form.defaultTaskSprintName) || undefined,
        epicLinkJql: form.epicLinkJql.trim(),
        enabled: form.enabled,
      };
      const saved = await saveManagedProject(request);
      setProjects((current) => replaceProject(current, saved));
      setForm(null);
      setDetailProject(saved);
    } catch (error) {
      const message = commandError(error);
      setSaveError(/permission|forbidden|denied/i.test(message)
        ? "This project cannot be saved until the required Jira permissions are granted."
        : "Unable to save managed project. Try again.");
    } finally {
      setAction(null);
    }
  }

  async function handleSaveTaskCreationSettings() {
    if (!detailProject || teamSaving) return;
    setTeamSaving(true);
    setTeamSaveError(null);
    try {
      const selectedSprint = taskSprints.find((sprint) => sprint.id === defaultTaskSprintId);
      const saved = await saveManagedProject({
        id: detailProject.id,
        integrationId: detailProject.integrationId,
        jiraProjectId: detailProject.projectId,
        jiraProjectKey: detailProject.projectKey,
        jiraProjectName: detailProject.projectName,
        boardId: detailProject.boardId,
        sourceSprintId: detailProject.sourceSprintId,
        sourceSprintName: detailProject.sourceSprintName,
        storyPointsFieldId: detailProject.storyPointsFieldId,
        competencyFieldId: detailProject.competencyFieldId,
        subtaskIssueTypeId: detailProject.subtaskIssueTypeId,
        defaultTeamPresetId: detailProject.defaultTeamPresetId,
        defaultTaskSprintId: defaultTaskSprintId || undefined,
        defaultTaskSprintName: selectedSprint?.name ?? (defaultTaskSprintId ? defaultTaskSprintName : undefined),
        epicLinkJql: epicLinkJql.trim(),
        enabled: detailProject.enabled,
      });
      setProjects((current) => replaceProject(current, saved));
      setDetailProject(saved);
    } catch (error) {
      setTeamSaveError(`Unable to save task creation settings. ${commandError(error)}`);
    } finally {
      setTeamSaving(false);
    }
  }

  async function handleCheckEpicLinkJql() {
    if (!detailProject || epicPreviewLoading) return;
    const jql = epicLinkJql.trim();
    if (!jql) {
      setTeamSaveError("Epic link JQL is required before checking.");
      return;
    }
    setEpicPreviewLoading(true);
    setTeamSaveError(null);
    try {
      const issues = await previewEpicLinkJql({ managedProjectId: detailProject.id, jql });
      setEpicPreviewIssues(Array.isArray(issues) ? issues : []);
      setEpicPreviewOpen(true);
    } catch (error) {
      setTeamSaveError(`Unable to check Epic link JQL. ${commandError(error)}`);
    } finally {
      setEpicPreviewLoading(false);
    }
  }

  async function handleDelete(project: ManagedProjectSettings) {
    setAction("delete");
    setSaveError(null);
    try {
      await deleteManagedProject(project.id);
      setProjects((current) => current.filter((candidate) => candidate.id !== project.id));
      if (detailProject?.id === project.id) setDetailProject(null);
      if (form?.id === project.id) setForm(null);
    } catch (error) {
      const message = commandError(error);
      setSaveError(/permission|forbidden|denied/i.test(message)
        ? "This project cannot be deleted with the current Jira permissions."
        : "Unable to delete managed project. Try again.");
    } finally {
      setAction(null);
    }
  }

  async function handleAddTeamMember() {
    if (!detailProject || !selectedSearchMember || !memberRole || teamSaving) return;
    setTeamSaving(true);
    setTeamSaveError(null);
    try {
      const saved = await addPlanningTeamMember({
        managedProjectId: detailProject.id,
        accountId: selectedSearchMember.accountId,
        displayName: selectedSearchMember.displayName,
        ...(memberAlias.trim() ? { alias: memberAlias.trim() } : {}),
        ...(selectedSearchMember.avatarUrl ? { avatarUrl: selectedSearchMember.avatarUrl } : {}),
        role: memberRole,
      });
      setConfiguredMembers((current) => [
        ...current.filter((member) => member.accountId !== saved.accountId),
        saved,
      ]);
      setMemberSearch("");
      setMemberSearchResults([]);
      setSelectedSearchMember(null);
      setMemberRole("");
      setMemberAlias("");
      setMemberDialogOpen(false);
      setEditingMemberAccountId(null);
    } catch (error) {
      setTeamSaveError(`Unable to add the team member. ${commandError(error)}`);
    } finally {
      setTeamSaving(false);
    }
  }

  async function handleSaveMemberDialog() {
    if (!detailProject || !selectedSearchMember || !memberRole || teamSaving) return;
    if (!editingMemberAccountId) {
      await handleAddTeamMember();
      return;
    }
    setTeamSaving(true);
    setTeamSaveError(null);
    try {
      const saved = await addPlanningTeamMember({
        managedProjectId: detailProject.id,
        accountId: editingMemberAccountId,
        displayName: selectedSearchMember.displayName,
        ...(memberAlias.trim() ? { alias: memberAlias.trim() } : {}),
        ...(selectedSearchMember.avatarUrl ? { avatarUrl: selectedSearchMember.avatarUrl } : {}),
        role: memberRole,
      });
      setConfiguredMembers((current) => current.map((member) => member.accountId === saved.accountId ? saved : member));
      closeMemberDialog();
    } catch (error) {
      setTeamSaveError(`Unable to save the team member. ${commandError(error)}`);
    } finally {
      setTeamSaving(false);
    }
  }

  async function handleRemoveTeamMember(accountId: string) {
    if (!detailProject || teamSaving) return;
    setTeamSaving(true);
    setTeamSaveError(null);
    try {
      await removePlanningTeamMember(detailProject.id, accountId);
      setConfiguredMembers((current) => current.filter((member) => member.accountId !== accountId));
    } catch (error) {
      setTeamSaveError(`Unable to remove the team member. ${commandError(error)}`);
    } finally {
      setTeamSaving(false);
    }
  }

  function updatePointerDropTarget(clientX: number, clientY: number) {
    const draggedAccountId = draggedMemberAccountId.current;
    if (!draggedAccountId) return;
    const targetCard = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-team-member-id]");
    const targetAccountId = targetCard?.dataset.teamMemberId;
    if (!targetCard || !targetAccountId || targetAccountId === draggedAccountId) {
      dropInsertionIndex.current = null;
      setPointerDropInsertionIndex(null);
      return;
    }

    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-team-member-id]"));
    const targetIndex = cards.indexOf(targetCard);
    if (targetIndex < 0) return;
    const bounds = targetCard.getBoundingClientRect();
    const insertionIndex = clientY < bounds.top + bounds.height / 2 ? targetIndex : targetIndex + 1;
    dropInsertionIndex.current = insertionIndex;
    setPointerDropInsertionIndex(insertionIndex);
  }

  async function handleFinishMemberDrag() {
    const draggedAccountId = draggedMemberAccountId.current;
    const insertionIndex = dropInsertionIndex.current;
    draggedMemberAccountId.current = null;
    dropInsertionIndex.current = null;
    setDraggingMemberAccountId(null);
    setPointerDropInsertionIndex(null);
    if (!detailProject || !draggedAccountId || insertionIndex === null || teamSaving) return;

    const currentIds = configuredMembers.map((member) => member.accountId);
    const nextIds = reorderMemberIdsAtInsertionIndex(currentIds, draggedAccountId, insertionIndex);
    if (nextIds.join("\u0000") === currentIds.join("\u0000")) return;

    setTeamSaving(true);
    setTeamSaveError(null);
    try {
      const saved = await reorderPlanningTeamMembers({
        managedProjectId: detailProject.id,
        accountIds: nextIds,
      });
      setConfiguredMembers(saved);
    } catch (error) {
      setTeamSaveError(`Unable to reorder the team members. ${commandError(error)}`);
    } finally {
      setTeamSaving(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="Team settings">
      <div className="flex flex-wrap items-start justify-end gap-3">
        <Button type="button" onClick={startAdd} disabled={controlsDisabled}>
          Add team
        </Button>
      </div>

      {loading ? <p role="status">Loading managed projects…</p> : null}
      {loadError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Unable to load managed projects. {loadError}</AlertDescription>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      {!loading && !loadError && projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p>No teams are configured.</p>
          </CardContent>
        </Card>
      ) : null}

      {!loading && projects.length > 0 ? (
        <div className="flex w-full flex-col gap-3" role="list" aria-label="Teams">
          {projects.map((project) => {
            return (
              <div key={project.id} role="listitem" aria-label={project.projectName} className="w-full">
                <Card className="w-full">
                  <CardHeader className="gap-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto justify-start p-0 text-left text-lg font-semibold"
                          onClick={() => detailProject?.id === project.id ? setDetailProject(null) : openDetail(project)}
                          disabled={controlsDisabled}
                          aria-label={`Open ${project.projectName} project details`}
                        >
                          <ChevronDown className={`mr-1 inline-block h-4 w-4 transition-transform ${detailProject?.id === project.id ? "rotate-180" : ""}`} aria-hidden="true" />
                          {project.projectName}
                        </Button>
                        <CardDescription>
                          <span aria-label={`Jira project key for ${project.projectName}`}>{project.projectKey}</span>
                          {` · ${boardNames[project.id] ?? project.boardId ?? "Jira board"}`}
                        </CardDescription>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(project)}
                          disabled={controlsDisabled}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => void handleDelete(project)}
                          disabled={controlsDisabled}
                        >
                          {action === "delete" ? "Deleting…" : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {detailProject?.id === project.id ? <div ref={setDetailHost} /> : null}
                </Card>
              </div>
            );
          })}
        </div>
      ) : null}

      {form ? (
        <Dialog open onOpenChange={(open) => { if (!open && !controlsDisabled) setForm(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit team" : "Add team"}</DialogTitle>
              <DialogDescription>Connect a Jira team and choose its board.</DialogDescription>
            </DialogHeader>
          <div className="grid gap-4">
            <form className="grid gap-4" onSubmit={(event) => void handleSave(event)} aria-busy={controlsDisabled}>
              <TextField
                label="Project name"
                value={form.jiraProjectName}
                onChange={(next) => updateForm("jiraProjectName", next)}
                disabled={controlsDisabled}
              />
              <TextField
                label="Jira Project Key"
                value={form.jiraProjectKey}
                onChange={(next) => updateForm("jiraProjectKey", next)}
                disabled={controlsDisabled}
                onBlur={() => void handleLoadBoards()}
              />
              <div className="grid gap-2">
                <Label htmlFor="jira-board">Jira board</Label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id="jira-board"
                    aria-label="Jira board"
                    className="h-10 min-w-72 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.boardId}
                    onFocus={() => void handleLoadBoards()}
                    onChange={(event) => updateForm("boardId", event.target.value)}
                    disabled={controlsDisabled}
                  >
                    <option value="">{boardsLoading ? "Loading Jira boards…" : "Choose a Jira board"}</option>
                    {boards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name} ({board.id})
                      </option>
                    ))}
                  </select>
                </div>
                {boardsLoading ? <p role="status">Loading Jira boards for this project…</p> : null}
                {boardsError ? (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{boardsError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              {!value(form.integrationId) ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>A Jira integration is required before adding a project.</AlertDescription>
                </Alert>
              ) : null}
              {errors.length > 0 ? (
                <Alert variant="destructive" role="alert" aria-live="assertive">
                  <AlertTitle>Complete the project details</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-5">
                      {errors.filter((error) => !error.includes("integration")).map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" disabled={controlsDisabled || errors.length > 0}>
                  {action === "save" ? "Saving…" : "Save managed project"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setForm(null)} disabled={controlsDisabled}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {detailProject && detailHost ? createPortal(
        <div className="border-t px-4 pb-4 pt-4" aria-label="Team members">
          <CardContent className="grid gap-4">
            <section className="grid gap-4 rounded-md border p-3" aria-label="Task creation settings">
              <div>
                <h3 className="font-semibold">Task creation settings</h3>
                <p className="text-sm text-muted-foreground">These defaults are applied to new Create task cards for this team.</p>
              </div>
              <div className="grid gap-2 sm:max-w-xl">
                <Label htmlFor={`default-task-sprint-${detailProject.id}`}>Default sprint for task creation</Label>
                <select
                  id={`default-task-sprint-${detailProject.id}`}
                  aria-label="Default sprint for task creation"
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={defaultTaskSprintId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setDefaultTaskSprintId(nextId);
                    setDefaultTaskSprintName(taskSprints.find((sprint) => sprint.id === nextId)?.name ?? "");
                  }}
                  disabled={controlsDisabled || taskSprintsLoading}
                >
                  <option value="">{taskSprintsLoading ? "Loading sprints…" : "No default sprint"}</option>
                  {defaultTaskSprintId && !taskSprints.some((sprint) => sprint.id === defaultTaskSprintId) ? (
                    <option value={defaultTaskSprintId}>{defaultTaskSprintName || defaultTaskSprintId}</option>
                  ) : null}
                  {taskSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
                </select>
                {taskSprintsError ? <p className="text-xs text-destructive">Unable to load sprints. {taskSprintsError}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`epic-link-jql-${detailProject.id}`}>Epic link JQL</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={`epic-link-jql-${detailProject.id}`}
                    aria-label="Epic link JQL"
                    value={epicLinkJql}
                    onChange={(event) => setEpicLinkJql(event.target.value)}
                    placeholder="project = COREAPI AND issuetype = Epic"
                    disabled={controlsDisabled}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleCheckEpicLinkJql()} disabled={controlsDisabled || epicPreviewLoading || !epicLinkJql.trim()}>
                    {epicPreviewLoading ? "Checking…" : "Check"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">The matching Jira issues will be available as Epic link choices when creating a task.</p>
              </div>
              {teamSaveError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{teamSaveError}</AlertDescription>
                </Alert>
              ) : null}
              <div>
                <Button type="button" onClick={() => void handleSaveTaskCreationSettings()} disabled={controlsDisabled}>
                  {teamSaving ? "Saving…" : "Save task creation settings"}
                </Button>
              </div>
            </section>

            <Dialog open={epicPreviewOpen} onOpenChange={setEpicPreviewOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Epic link candidates</DialogTitle>
                  <DialogDescription>Issues returned by the configured Epic link JQL.</DialogDescription>
                </DialogHeader>
                {epicPreviewIssues.length > 0 ? (
                  <div role="list" aria-label="Epic link candidates" className="grid max-h-96 gap-2 overflow-y-auto">
                    {epicPreviewIssues.map((issue) => (
                      <div key={issue.key} role="listitem" className="rounded-md border p-3">
                        <p className="font-medium">{issue.key}</p>
                        <p className="text-sm text-muted-foreground">{issue.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No Jira issues matched this JQL.</p>}
              </DialogContent>
            </Dialog>

            {memberLoadError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>Unable to load the saved project team. {memberLoadError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Team members</h3>
              <Button type="button" size="sm" onClick={openAddMemberDialog} disabled={controlsDisabled}>Add team member</Button>
            </div>
            <Dialog open={memberDialogOpen} onOpenChange={(open) => { if (open) setMemberDialogOpen(true); else closeMemberDialog(); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingMemberAccountId ? "Edit team member" : "Add team member"}</DialogTitle>
                  <DialogDescription>{editingMemberAccountId ? "Update Alias and role for this Jira account." : "Search for a Jira account, then set its Alias and role."}</DialogDescription>
                </DialogHeader>
            {!editingMemberAccountId ? (
              <>
              <div className="grid gap-2">
              <Input
                id="team-member-search"
                value={memberSearch}
                onChange={(event) => {
                  setMemberSearch(event.target.value);
                  setSelectedSearchMember(null);
                  setMemberRole("");
                  setMemberSearchError(null);
                }}
                placeholder="Type at least 4 characters to search Jira"
                autoComplete="off"
                disabled={controlsDisabled}
              />
              {memberSearch.trim().length > 0 && memberSearch.trim().length < 3 ? (
                <p className="text-sm text-muted-foreground">Enter at least 3 characters to search Jira users.</p>
              ) : null}
              {memberSearchLoading ? <p role="status">Searching Jira users…</p> : null}
              {memberSearchError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>Unable to search Jira team members. {memberSearchError}</AlertDescription>
                </Alert>
              ) : null}
              {memberSearchResults.length > 0 && !selectedSearchMember ? (
                <div role="listbox" aria-label="Jira team member search results" className="grid gap-1 rounded-md border p-1">
                  {memberSearchResults.map((member) => (
                    <button
                      key={member.accountId}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="rounded px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setSelectedSearchMember(member);
                        setMemberRole("");
                      }}
                    >
                      <span className="block font-medium">{member.displayName}</span>
                      <span className="block text-sm text-muted-foreground">{member.accountId}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {!memberSearchLoading && memberSearch.trim().length >= 3 && !memberSearchError && memberSearchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Jira users found.</p>
              ) : null}
            </div>
              </>
            ) : null}

            {selectedSearchMember ? (
              <div className="grid gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{selectedSearchMember.displayName}</p>
                  <p className="text-sm text-muted-foreground">{selectedSearchMember.accountId}</p>
                </div>
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="team-member-role">Role</Label>
                  <select
                    id="team-member-role"
                    aria-label={`Role for ${selectedSearchMember.displayName}`}
                    className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={memberRole}
                    onChange={(event) => setMemberRole(event.target.value)}
                    disabled={controlsDisabled}
                  >
                    <option value="">Choose a role</option>
                    {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </div>
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="team-member-alias">Alias (optional)</Label>
                  <Input
                    id="team-member-alias"
                    value={memberAlias}
                    onChange={(event) => setMemberAlias(event.target.value)}
                    placeholder="Display name"
                    disabled={controlsDisabled}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleSaveMemberDialog()} disabled={!memberRole || controlsDisabled}>
                    {teamSaving ? "Saving…" : editingMemberAccountId ? "Save" : "Add"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closeMemberDialog}
                    disabled={controlsDisabled}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
              </DialogContent>
            </Dialog>

            {configuredMembers.length > 0 ? (
              <div className="grid gap-3" aria-label="Configured project team">
                {configuredMembers.map((member, index) => {
                  const label = memberLabel(member);
                  return (
                    <Fragment key={member.accountId}>
                      {draggingMemberAccountId && pointerDropInsertionIndex === index ? (
                        <div className="h-1 w-full rounded-full bg-primary shadow-sm" aria-label="Drop position" />
                      ) : null}
                      <div
                        data-team-member-id={member.accountId}
                        className={`flex flex-wrap items-center gap-2 rounded-md border p-2 transition ${draggingMemberAccountId === member.accountId ? "opacity-60" : ""}`}
                      >
                      <span
                        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                        aria-label={`Drag ${label} to reorder`}
                        title="Drag to reorder"
                        onPointerDown={(event) => {
                          if (controlsDisabled || event.button !== 0) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          draggedMemberAccountId.current = member.accountId;
                          dropInsertionIndex.current = null;
                          setDraggingMemberAccountId(member.accountId);
                          setPointerDropInsertionIndex(null);
                        }}
                        onPointerMove={(event) => {
                          if (draggedMemberAccountId.current !== member.accountId) return;
                          event.preventDefault();
                          updatePointerDropTarget(event.clientX, event.clientY);
                        }}
                        onPointerUp={(event) => {
                          if (draggedMemberAccountId.current !== member.accountId) return;
                          updatePointerDropTarget(event.clientX, event.clientY);
                          event.currentTarget.releasePointerCapture(event.pointerId);
                          void handleFinishMemberDrag();
                        }}
                        onPointerCancel={() => {
                          if (draggedMemberAccountId.current !== member.accountId) return;
                          draggedMemberAccountId.current = null;
                          dropInsertionIndex.current = null;
                          setDraggingMemberAccountId(null);
                          setPointerDropInsertionIndex(null);
                        }}
                      >
                        <GripVertical aria-hidden="true" />
                      </span>
                      <MemberAvatar member={member} managedProjectId={detailProject.id} />
                      <div className="min-w-48 flex-1">
                        <div className="flex min-h-5 items-center gap-2">
                          <p className="font-medium leading-5">{label}</p>
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4">
                            {member.tags[0] || "Not selected"}
                          </Badge>
                        </div>
                        <p className="text-xs leading-4 text-muted-foreground">{member.displayName}</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => openEditMemberDialog(member)} disabled={controlsDisabled}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => void handleRemoveTeamMember(member.accountId)} disabled={controlsDisabled}>
                        Delete
                      </Button>
                      </div>
                    </Fragment>
                  );
                })}
                {draggingMemberAccountId && pointerDropInsertionIndex === configuredMembers.length ? (
                  <div className="h-1 w-full rounded-full bg-primary shadow-sm" aria-label="Drop position" />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No team members are configured for this project.</p>
            )}

            {teamSaveError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{teamSaveError}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </div>, detailHost) : null}
    </section>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onBlur?: () => void;
}

function TextField({ label, value, onChange, disabled, onBlur }: TextFieldProps) {
  const id = `managed-project-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} disabled={disabled} />
    </div>
  );
}
