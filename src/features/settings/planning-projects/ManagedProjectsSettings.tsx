import { ChevronDown, GripVertical, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
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
import type { ConfluenceSpace } from "@/shared/contracts/confluence";
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
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";

type Action = "next" | "save" | "delete" | null;
type AddTeamStep = "details" | "board";

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

export type ResolveConfluenceSpace = (
  keyOrUrl: string,
  integrationId?: string,
) => ConfluenceSpace | Promise<ConfluenceSpace>;

export interface ManagedProjectsSettingsProps {
  jiraIntegrations: IntegrationRedacted[];
  confluenceIntegrations?: IntegrationRedacted[];
  validateProjectKey?: ValidateProjectKey;
  resolveConfluenceSpace?: ResolveConfluenceSpace;
}

interface ManagedProjectForm {
  id?: string;
  integrationId: string;
  jiraProjectId: string;
  jiraProjectKey: string;
  jiraProjectName: string;
  confluenceInput: string;
  boardId: string;
  defaultTaskSprintId: string;
  defaultTaskSprintName: string;
  defaultEpicLinkKey: string;
  defaultEpicLinkSummary: string;
  epicLinkJql: string;
  enabled: boolean;
}

function emptyForm(integrationId?: string): ManagedProjectForm {
  return {
    integrationId: integrationId ?? "",
    jiraProjectId: "",
    jiraProjectKey: "",
    jiraProjectName: "",
    confluenceInput: "",
    boardId: "",
    defaultTaskSprintId: "",
    defaultTaskSprintName: "",
    defaultEpicLinkKey: "",
    defaultEpicLinkSummary: "",
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
    confluenceInput: project.confluenceSpace?.spaceKey ?? "",
    boardId: project.boardId ?? "",
    defaultTaskSprintId: project.defaultTaskSprintId ?? "",
    defaultTaskSprintName: project.defaultTaskSprintName ?? "",
    defaultEpicLinkKey: project.defaultEpicLinkKey ?? "",
    defaultEpicLinkSummary: project.defaultEpicLinkSummary ?? "",
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

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

function formErrors(form: ManagedProjectForm, t: Translate): string[] {
  const errors: string[] = [];
  if (!value(form.integrationId)) errors.push(t("teams.integrationRequired"));
  if (!value(form.jiraProjectKey)) errors.push(t("teams.projectKeyRequired"));
  if (!value(form.boardId)) errors.push(t("teams.boardRequired"));
  return errors;
}

function addTeamDetailsErrors(form: ManagedProjectForm, t: Translate): string[] {
  const errors: string[] = [];
  if (!value(form.jiraProjectKey)) errors.push(t("teams.projectKeyRequired"));
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
  confluenceIntegrations = [],
  validateProjectKey,
  resolveConfluenceSpace,
}: ManagedProjectsSettingsProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ManagedProjectSettings[]>([]);
  const [form, setForm] = useState<ManagedProjectForm | null>(null);
  const [addTeamStep, setAddTeamStep] = useState<AddTeamStep>("details");
  const [validatedProject, setValidatedProject] = useState<ProjectKeyValidationSuccess | null>(null);
  const [validatedConfluenceSpace, setValidatedConfluenceSpace] = useState<ConfluenceSpace | null>(null);
  const [detailProject, setDetailProject] = useState<ManagedProjectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
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
  const [removingMemberAccountId, setRemovingMemberAccountId] = useState<string | null>(null);
  const [teamSaveError, setTeamSaveError] = useState<string | null>(null);
  const [taskSprints, setTaskSprints] = useState<PlanningSprint[]>([]);
  const [taskSprintsLoading, setTaskSprintsLoading] = useState(false);
  const [taskSprintsError, setTaskSprintsError] = useState<string | null>(null);
  const [defaultTaskSprintId, setDefaultTaskSprintId] = useState("");
  const [defaultTaskSprintName, setDefaultTaskSprintName] = useState("");
  const [defaultEpicLinkKey, setDefaultEpicLinkKey] = useState("");
  const [defaultEpicLinkSummary, setDefaultEpicLinkSummary] = useState("");
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
            ? t("teams.permissionError")
            : message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

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
    setDefaultEpicLinkKey(detailProject.defaultEpicLinkKey ?? "");
    setDefaultEpicLinkSummary(detailProject.defaultEpicLinkSummary ?? "");
    setEpicLinkJql(detailProject.epicLinkJql ?? "");
    setEpicPreviewIssues([]);
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

  const errors = form ? formErrors(form, t) : [];
  const addDetailsErrors = form ? addTeamDetailsErrors(form, t) : [];
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
      setValidatedProject(null);
    }
    if (field === "confluenceInput") {
      setValidatedConfluenceSpace(null);
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
    setAddTeamStep("details");
    setValidatedProject(null);
    setValidatedConfluenceSpace(null);
    setSaveError(null);
    setForm(emptyForm(jiraIntegrations.find((integration) => integration.enabled)?.id));
  }

  function startEdit(project: ManagedProjectSettings) {
    setDetailProject(null);
    resetBoards();
    setAddTeamStep("details");
    setValidatedProject(null);
    setValidatedConfluenceSpace(project.confluenceSpace ?? null);
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
        setBoardsError(t("teams.noBoards"));
      }
    } catch (error) {
      setBoardsError(t("teams.loadBoardsError", { error: commandError(error) }));
    } finally {
      setBoardsLoading(false);
    }
  }

  async function handleNext() {
    if (!form || form.id || controlsDisabled) return;
    if (addDetailsErrors.length > 0) {
      setSaveError(addDetailsErrors.join(" "));
      return;
    }
    if (!value(form.integrationId)) {
      setSaveError(t("teams.integrationRequiredAdd"));
      return;
    }
    if (!validateProjectKey) {
      setSaveError(t("teams.validationUnavailableAdd"));
      return;
    }

    setAction("next");
    setSaveError(null);
    setBoardsError(null);
    setBoardsLoading(true);
    try {
      const validation = await validateProjectKey(value(form.jiraProjectKey), value(form.integrationId));
      if ("error" in validation) {
        setSaveError(validation.error);
        return;
      }

      let confluenceSpace: ConfluenceSpace | null = null;
      if (value(form.confluenceInput)) {
        const confluence = confluenceIntegrations.find((integration) => integration.enabled);
        if (!confluence || !resolveConfluenceSpace) {
          setSaveError(t("teams.confluenceIntegrationRequired"));
          return;
        }
        try {
          confluenceSpace = await resolveConfluenceSpace(value(form.confluenceInput), confluence.id);
        } catch (error) {
          setSaveError(t("teams.confluenceValidateError", { error: commandError(error) }));
          return;
        }
      }

      const loaded = await listPlanningProjectBoards({
        integrationId: value(form.integrationId),
        projectKey: value(validation.projectKey),
      });
      const nextBoards = Array.isArray(loaded) ? loaded : [];
      if (nextBoards.length === 0) {
        setBoards([]);
        setSaveError(t("teams.noBoards"));
        return;
      }
      setBoards(nextBoards);
      setValidatedProject(validation);
      setValidatedConfluenceSpace(confluenceSpace);
      setForm((current) => current ? {
        ...current,
        jiraProjectId: validation.projectId,
        jiraProjectKey: validation.projectKey,
        jiraProjectName: validation.projectName,
        confluenceInput: confluenceSpace?.spaceKey ?? "",
      } : current);
      setAddTeamStep("board");
    } catch (error) {
      setSaveError(t("teams.loadBoardsError", { error: commandError(error) }));
    } finally {
      setBoardsLoading(false);
      setAction(null);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || errors.length > 0 || controlsDisabled) return;

    setAction("save");
    setSaveError(null);
    try {
      let validation: ProjectKeyValidationResult;
      let confluenceSpace = validatedConfluenceSpace;
      if (!form.id) {
        if (addTeamStep !== "board" || !validatedProject) {
          setSaveError(t("teams.completeValidation"));
          return;
        }
        validation = validatedProject;
      } else {
        if (!validateProjectKey) {
          setSaveError(t("teams.validationUnavailableSave"));
          return;
        }
        try {
          validation = await validateProjectKey(value(form.jiraProjectKey), value(form.integrationId));
        } catch (error) {
          setSaveError(t("teams.validateError", { error: commandError(error) }));
          return;
        }
        if ("error" in validation) {
          setSaveError(validation.error);
          return;
        }
        if (value(form.confluenceInput)) {
          const integrationId = projects.find((project) => project.id === form.id)
            ?.confluenceSpace?.integrationId
            ?? confluenceIntegrations.find((integration) => integration.enabled)?.id;
          if (!integrationId || !resolveConfluenceSpace) {
            setSaveError(t("teams.confluenceIntegrationRequired"));
            return;
          }
          try {
            confluenceSpace = await resolveConfluenceSpace(value(form.confluenceInput), integrationId);
          } catch (error) {
            setSaveError(t("teams.confluenceValidateError", { error: commandError(error) }));
            return;
          }
        } else {
          confluenceSpace = null;
        }
      }

      const request: ManagedProjectSaveInput = {
        ...(form.id ? { id: form.id } : {}),
        integrationId: value(form.integrationId),
        jiraProjectId: value(validation.projectId),
        jiraProjectKey: value(validation.projectKey),
        jiraProjectName: value(validation.projectName),
        confluenceSpace: confluenceSpace ?? undefined,
        boardId: value(form.boardId),
        defaultTaskSprintId: value(form.defaultTaskSprintId) || undefined,
        defaultTaskSprintName: value(form.defaultTaskSprintName) || undefined,
        defaultEpicLinkKey: value(form.defaultEpicLinkKey) || undefined,
        defaultEpicLinkSummary: value(form.defaultEpicLinkSummary) || undefined,
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
        ? t("teams.savePermissionError")
        : t("teams.saveError"));
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
        confluenceSpace: detailProject.confluenceSpace,
        boardId: detailProject.boardId,
        sourceSprintId: detailProject.sourceSprintId,
        sourceSprintName: detailProject.sourceSprintName,
        storyPointsFieldId: detailProject.storyPointsFieldId,
        competencyFieldId: detailProject.competencyFieldId,
        subtaskIssueTypeId: detailProject.subtaskIssueTypeId,
        defaultTeamPresetId: detailProject.defaultTeamPresetId,
        defaultTaskSprintId: defaultTaskSprintId || undefined,
        defaultTaskSprintName: selectedSprint?.name ?? (defaultTaskSprintId ? defaultTaskSprintName : undefined),
        defaultEpicLinkKey: defaultEpicLinkKey || undefined,
        defaultEpicLinkSummary: defaultEpicLinkKey ? (defaultEpicLinkSummary || undefined) : undefined,
        epicLinkJql: epicLinkJql.trim(),
        enabled: detailProject.enabled,
      });
      setProjects((current) => replaceProject(current, saved));
      setDetailProject(saved);
    } catch (error) {
      setTeamSaveError(t("teams.saveTaskSettingsError", { error: commandError(error) }));
    } finally {
      setTeamSaving(false);
    }
  }

  async function handleCheckEpicLinkJql() {
    if (!detailProject || epicPreviewLoading) return;
    const jql = epicLinkJql.trim();
    if (!jql) {
      setTeamSaveError(t("teams.epicJqlRequired"));
      return;
    }
    setEpicPreviewLoading(true);
    setTeamSaveError(null);
    try {
      const issues = await previewEpicLinkJql({ managedProjectId: detailProject.id, jql });
      const nextIssues = Array.isArray(issues) ? issues : [];
      setEpicPreviewIssues(nextIssues);
      if (defaultEpicLinkKey && !nextIssues.some((issue) => issue.key === defaultEpicLinkKey)) {
        setDefaultEpicLinkKey("");
        setDefaultEpicLinkSummary("");
      }
      setEpicPreviewOpen(true);
    } catch (error) {
      setTeamSaveError(t("teams.epicJqlError", { error: commandError(error) }));
    } finally {
      setEpicPreviewLoading(false);
    }
  }

  async function handleDelete(project: ManagedProjectSettings) {
    setAction("delete");
    setDeletingProjectId(project.id);
    setSaveError(null);
    try {
      await deleteManagedProject(project.id);
      setProjects((current) => current.filter((candidate) => candidate.id !== project.id));
      if (detailProject?.id === project.id) setDetailProject(null);
      if (form?.id === project.id) setForm(null);
    } catch (error) {
      const message = commandError(error);
      setSaveError(/permission|forbidden|denied/i.test(message)
        ? t("teams.deletePermissionError")
        : t("teams.deleteError"));
    } finally {
      setAction(null);
      setDeletingProjectId(null);
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
      setTeamSaveError(t("teams.addMemberError", { error: commandError(error) }));
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
      setTeamSaveError(t("teams.saveMemberError", { error: commandError(error) }));
    } finally {
      setTeamSaving(false);
    }
  }

  async function handleRemoveTeamMember(accountId: string) {
    if (!detailProject || teamSaving) return;
    setTeamSaving(true);
    setRemovingMemberAccountId(accountId);
    setTeamSaveError(null);
    try {
      await removePlanningTeamMember(detailProject.id, accountId);
      setConfiguredMembers((current) => current.filter((member) => member.accountId !== accountId));
    } catch (error) {
      setTeamSaveError(t("teams.removeMemberError", { error: commandError(error) }));
    } finally {
      setTeamSaving(false);
      setRemovingMemberAccountId(null);
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
      setTeamSaveError(t("teams.reorderMembersError", { error: commandError(error) }));
    } finally {
      setTeamSaving(false);
    }
  }

  const isCreatingTeam = form !== null && !form.id;

  return (
    <section className="space-y-4" aria-labelledby="settings-title">
      <PageHeader
        title={t("nav.teamSettings")}
        titleId="settings-title"
        description={t("settings.projects.description")}
        actions={(
          <Button
            type="button"
            size="icon"
            className="h-9 w-9"
            onClick={startAdd}
            disabled={controlsDisabled}
            aria-label={t("teams.add")}
            title={t("teams.add")}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        )}
      />

      {loading ? <p role="status">{t("teams.loading")}</p> : null}
      {loadError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t("teams.loadError", { error: loadError })}</AlertDescription>
        </Alert>
      ) : null}
      {saveError && !form ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      {!loading && !loadError && projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p>{t("teams.empty")}</p>
          </CardContent>
        </Card>
      ) : null}

      {!loading && projects.length > 0 ? (
        <div className="flex w-full flex-col gap-3" role="list" aria-label={t("teams.list")}>
          {projects.map((project) => {
            return (
              <div key={project.id} role="listitem" aria-label={project.projectName} className="w-full">
                <Card className="w-full">
                  <CardHeader className="space-y-0 px-4 pb-4 pt-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="grid min-w-0 flex-1 gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto justify-start p-0 text-left text-base font-semibold leading-tight"
                          onClick={() => detailProject?.id === project.id ? setDetailProject(null) : openDetail(project)}
                          disabled={controlsDisabled}
                          aria-label={t("teams.openDetails", { team: project.projectName })}
                        >
                          <ChevronDown className={`mr-1 inline-block h-4 w-4 transition-transform ${detailProject?.id === project.id ? "rotate-180" : ""}`} aria-hidden="true" />
                          {project.projectName}
                        </Button>
                        <CardDescription className="leading-snug">
                          <span aria-label={t("teams.projectKeyFor", { team: project.projectName })}>{project.projectKey}</span>
                          {` · ${boardNames[project.id] ?? project.boardId ?? t("teams.jiraBoard")}`}
                          {project.confluenceSpace ? ` · ${project.confluenceSpace.spaceName} (${project.confluenceSpace.spaceKey})` : ""}
                        </CardDescription>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => startEdit(project)}
                          disabled={controlsDisabled}
                          aria-label={t("teams.editTeamAction", { team: project.projectName })}
                          title={t("teams.editTeamAction", { team: project.projectName })}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => void handleDelete(project)}
                          disabled={controlsDisabled}
                          aria-label={t(deletingProjectId === project.id ? "teams.deletingTeamAction" : "teams.deleteTeamAction", { team: project.projectName })}
                          title={t(deletingProjectId === project.id ? "teams.deletingTeamAction" : "teams.deleteTeamAction", { team: project.projectName })}
                        >
                          {deletingProjectId === project.id
                            ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                            : <Trash2 className="size-4" aria-hidden="true" />}
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
              <DialogTitle>{form.id ? t("teams.editTitle") : t("teams.addTitle")}</DialogTitle>
              <DialogDescription>
                {isCreatingTeam
                  ? (addTeamStep === "details" ? t("teams.addDetailsDescription") : t("teams.addBoardDescription"))
                  : t("teams.editDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              {isCreatingTeam && addTeamStep === "details" ? (
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleNext();
                  }}
                  aria-busy={controlsDisabled}
                >
                  <TextField
                    label={t("teams.projectKey")}
                    value={form.jiraProjectKey}
                    onChange={(next) => updateForm("jiraProjectKey", next)}
                    disabled={controlsDisabled}
                  />
                  <TextField
                    label={t("teams.confluenceSpace")}
                    value={form.confluenceInput}
                    onChange={(next) => updateForm("confluenceInput", next)}
                    disabled={controlsDisabled || confluenceIntegrations.every((integration) => !integration.enabled)}
                    placeholder={t("teams.confluenceSpacePlaceholder")}
                    hint={t(confluenceIntegrations.some((integration) => integration.enabled)
                      ? "teams.confluenceSpaceHint"
                      : "teams.confluenceSpaceUnavailable")}
                  />
                  {!value(form.integrationId) ? (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{t("teams.integrationRequiredAdd")}</AlertDescription>
                    </Alert>
                  ) : null}
                  {addDetailsErrors.length > 0 ? (
                    <Alert variant="destructive" role="alert" aria-live="assertive">
                      <AlertTitle>{t("teams.completeTeam")}</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-5">
                          {addDetailsErrors.map((error) => <li key={error}>{error}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {saveError ? (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{saveError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button type="submit" disabled={controlsDisabled || addDetailsErrors.length > 0}>
                      {action === "next" ? t("settings.common.checking") : t("teams.next")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setForm(null)} disabled={controlsDisabled}>
                      {t("settings.common.cancel")}
                    </Button>
                  </div>
                </form>
              ) : (
                <form className="grid gap-4" onSubmit={(event) => void handleSave(event)} aria-busy={controlsDisabled}>
                  {isCreatingTeam ? (
                    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">{t("teams.name")}</p>
                        <p className="font-medium">{form.jiraProjectName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("teams.projectKey")}</p>
                        <p className="font-medium">{form.jiraProjectKey}</p>
                      </div>
                      {validatedConfluenceSpace ? (
                        <div>
                          <p className="text-muted-foreground">{t("teams.confluenceSpace")}</p>
                          <p className="font-medium">{validatedConfluenceSpace.spaceName} ({validatedConfluenceSpace.spaceKey})</p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <TextField
                        label={t("teams.projectKey")}
                        value={form.jiraProjectKey}
                        onChange={(next) => updateForm("jiraProjectKey", next)}
                        disabled={controlsDisabled}
                        onBlur={() => void handleLoadBoards()}
                      />
                      <TextField
                        label={t("teams.confluenceSpace")}
                        value={form.confluenceInput}
                        onChange={(next) => updateForm("confluenceInput", next)}
                        disabled={controlsDisabled || confluenceIntegrations.every((integration) => !integration.enabled)}
                        placeholder={t("teams.confluenceSpacePlaceholder")}
                        hint={t(confluenceIntegrations.some((integration) => integration.enabled)
                          ? "teams.confluenceSpaceHint"
                          : "teams.confluenceSpaceUnavailable")}
                      />
                    </>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor="jira-board">{t("teams.jiraBoard")}</Label>
                    <div className="flex flex-wrap gap-2">
                      <div className="relative min-w-72">
                        <select
                          id="jira-board"
                          aria-label={t("teams.jiraBoard")}
                          className="h-10 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                          value={form.boardId}
                          onFocus={isCreatingTeam ? undefined : () => void handleLoadBoards()}
                          onChange={(event) => updateForm("boardId", event.target.value)}
                          disabled={controlsDisabled}
                        >
                          <option value="">{boardsLoading ? t("teams.loadingBoards") : t("teams.chooseBoard")}</option>
                          {boards.map((board) => (
                            <option key={board.id} value={board.id}>
                              {board.name} ({board.id})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                      </div>
                    </div>
                    {boardsLoading ? <p role="status">{t("teams.loadingBoardsForProject")}</p> : null}
                    {boardsError ? (
                      <Alert variant="destructive" role="alert">
                        <AlertDescription>{boardsError}</AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                  {!value(form.integrationId) && !isCreatingTeam ? (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{t("teams.integrationRequiredEdit")}</AlertDescription>
                    </Alert>
                  ) : null}
                  {errors.length > 0 ? (
                    <Alert variant="destructive" role="alert" aria-live="assertive">
                      <AlertTitle>{t("teams.completeProject")}</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-5">
                          {errors.filter((error) => !error.includes("integration")).map((error) => <li key={error}>{error}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {saveError ? (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{saveError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-2">
                    {isCreatingTeam ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setAddTeamStep("details");
                          setValidatedProject(null);
                          setValidatedConfluenceSpace(null);
                          resetBoards();
                        }}
                        disabled={controlsDisabled}
                      >
                        {t("teams.back")}
                      </Button>
                    ) : null}
                    <Button type="submit" disabled={controlsDisabled || errors.length > 0}>
                      {action === "save" ? t("settings.common.saving") : t("teams.save")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setForm(null)} disabled={controlsDisabled}>
                      {t("settings.common.cancel")}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {detailProject && detailHost ? createPortal(
        <div className="border-t px-4 pb-4 pt-4" aria-label={t("teams.members")}>
          <CardContent className="grid gap-4">
            <section className="grid gap-4 rounded-md border p-3" aria-label={t("teams.taskSettings")}>
              <div>
                <h3 className="font-semibold">{t("teams.taskSettings")}</h3>
                <p className="text-sm text-muted-foreground">{t("teams.taskSettingsDescription")}</p>
              </div>
              <div className="grid gap-2 sm:max-w-xl">
                <Label htmlFor={`default-task-sprint-${detailProject.id}`}>{t("teams.defaultSprint")}</Label>
                <div className="relative">
                  <select
                    id={`default-task-sprint-${detailProject.id}`}
                    aria-label={t("teams.defaultSprint")}
                    className="h-10 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                    value={defaultTaskSprintId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setDefaultTaskSprintId(nextId);
                      setDefaultTaskSprintName(taskSprints.find((sprint) => sprint.id === nextId)?.name ?? "");
                    }}
                    disabled={controlsDisabled || taskSprintsLoading}
                  >
                    <option value="">{taskSprintsLoading ? t("teams.loadingSprints") : t("teams.noDefaultSprint")}</option>
                    {defaultTaskSprintId && !taskSprints.some((sprint) => sprint.id === defaultTaskSprintId) ? (
                      <option value={defaultTaskSprintId}>{defaultTaskSprintName || defaultTaskSprintId}</option>
                    ) : null}
                    {taskSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                </div>
                {taskSprintsError ? <p className="text-xs text-destructive">{t("teams.loadSprintsError", { error: taskSprintsError })}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`epic-link-jql-${detailProject.id}`}>{t("teams.epicJql")}</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={`epic-link-jql-${detailProject.id}`}
                    aria-label={t("teams.epicJql")}
                    value={epicLinkJql}
                    onChange={(event) => {
                      setEpicLinkJql(event.target.value);
                      setEpicPreviewIssues([]);
                      setDefaultEpicLinkKey("");
                      setDefaultEpicLinkSummary("");
                    }}
                    placeholder="project = DEMO AND issuetype = Epic"
                    disabled={controlsDisabled}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleCheckEpicLinkJql()} disabled={controlsDisabled || epicPreviewLoading || !epicLinkJql.trim()}>
                    {epicPreviewLoading ? t("settings.common.checking") : t("teams.check")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("teams.epicJqlDescription")}</p>
                <div className="grid gap-2 sm:max-w-xl">
                  <Label htmlFor={`default-epic-link-${detailProject.id}`}>{t("teams.defaultEpic")}</Label>
                  <div className="relative">
                    <select
                      id={`default-epic-link-${detailProject.id}`}
                      aria-label={t("teams.defaultEpic")}
                      className="h-10 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                      value={defaultEpicLinkKey}
                      onChange={(event) => {
                        const nextKey = event.target.value;
                        const selected = epicPreviewIssues.find((issue) => issue.key === nextKey);
                        setDefaultEpicLinkKey(nextKey);
                        setDefaultEpicLinkSummary(selected?.summary ?? (nextKey ? defaultEpicLinkSummary : ""));
                      }}
                      disabled={controlsDisabled}
                    >
                      <option value="">{t("teams.noDefaultEpic")}</option>
                      {defaultEpicLinkKey && !epicPreviewIssues.some((issue) => issue.key === defaultEpicLinkKey) ? (
                        <option value={defaultEpicLinkKey}>{defaultEpicLinkSummary || defaultEpicLinkKey}</option>
                      ) : null}
                      {epicPreviewIssues.map((issue) => (
                        <option key={issue.key} value={issue.key}>{issue.key} — {issue.summary}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("teams.epicSaveHint")}</p>
                </div>
              </div>
              {teamSaveError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{teamSaveError}</AlertDescription>
                </Alert>
              ) : null}
              <div>
                <Button type="button" onClick={() => void handleSaveTaskCreationSettings()} disabled={controlsDisabled}>
                  {teamSaving ? t("settings.common.saving") : t("teams.saveTaskSettings")}
                </Button>
              </div>
            </section>

            <Dialog open={epicPreviewOpen} onOpenChange={setEpicPreviewOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("teams.epicCandidates")}</DialogTitle>
                  <DialogDescription>{t("teams.epicCandidatesDescription")}</DialogDescription>
                </DialogHeader>
                {epicPreviewIssues.length > 0 ? (
                  <div role="list" aria-label={t("teams.epicCandidates")} className="grid max-h-96 gap-2 overflow-y-auto">
                    {epicPreviewIssues.map((issue) => (
                      <div key={issue.key} role="listitem" className="rounded-md border p-3">
                        <p className="font-medium">{issue.key}</p>
                        <p className="text-sm text-muted-foreground">{issue.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">{t("teams.noEpicCandidates")}</p>}
              </DialogContent>
            </Dialog>

            {memberLoadError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{t("teams.loadMembersError", { error: memberLoadError })}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{t("teams.members")}</h3>
              <Button type="button" size="sm" onClick={openAddMemberDialog} disabled={controlsDisabled}>{t("teams.addMember")}</Button>
            </div>
            <Dialog open={memberDialogOpen} onOpenChange={(open) => { if (open) setMemberDialogOpen(true); else closeMemberDialog(); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingMemberAccountId ? t("teams.editMember") : t("teams.addMember")}</DialogTitle>
                  <DialogDescription>{editingMemberAccountId ? t("teams.editMemberDescription") : t("teams.addMemberDescription")}</DialogDescription>
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
                placeholder={t("teams.memberSearchPlaceholder")}
                autoComplete="off"
                disabled={controlsDisabled}
              />
              {memberSearch.trim().length > 0 && memberSearch.trim().length < 3 ? (
                <p className="text-sm text-muted-foreground">{t("teams.memberSearchHint")}</p>
              ) : null}
              {memberSearchLoading ? <p role="status">{t("teams.memberSearching")}</p> : null}
              {memberSearchError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{t("teams.memberSearchError", { error: memberSearchError })}</AlertDescription>
                </Alert>
              ) : null}
              {memberSearchResults.length > 0 && !selectedSearchMember ? (
                <div role="listbox" aria-label={t("teams.memberSearchResults")} className="grid gap-1 rounded-md border p-1">
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
                <p className="text-sm text-muted-foreground">{t("teams.noMembersFound")}</p>
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
                  <Label htmlFor="team-member-role">{t("teams.role")}</Label>
                  <div className="relative">
                    <select
                      id="team-member-role"
                      aria-label={t("teams.roleFor", { member: selectedSearchMember.displayName })}
                      className="h-10 w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                      value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value)}
                      disabled={controlsDisabled}
                    >
                      <option value="">{t("teams.chooseRole")}</option>
                      {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
                  </div>
                </div>
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="team-member-alias">{t("teams.alias")}</Label>
                  <Input
                    id="team-member-alias"
                    value={memberAlias}
                    onChange={(event) => setMemberAlias(event.target.value)}
                    placeholder={t("teams.displayName")}
                    disabled={controlsDisabled}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleSaveMemberDialog()} disabled={!memberRole || controlsDisabled}>
                    {teamSaving ? t("settings.common.saving") : editingMemberAccountId ? t("settings.common.save") : t("teams.addMemberAction")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closeMemberDialog}
                    disabled={controlsDisabled}
                  >
                    {t("settings.common.cancel")}
                  </Button>
                </div>
              </div>
            ) : null}
              </DialogContent>
            </Dialog>

            {configuredMembers.length > 0 ? (
              <div className="grid gap-3" aria-label={t("teams.configuredMembers")}>
                {configuredMembers.map((member, index) => {
                  const label = memberLabel(member);
                  return (
                    <Fragment key={member.accountId}>
                      {draggingMemberAccountId && pointerDropInsertionIndex === index ? (
                        <div className="h-1 w-full rounded-full bg-primary shadow-sm" aria-label={t("teams.dropPosition")} />
                      ) : null}
                      <div
                        data-team-member-id={member.accountId}
                        className={`flex flex-wrap items-center gap-2 rounded-md border p-2 transition ${draggingMemberAccountId === member.accountId ? "opacity-60" : ""}`}
                      >
                      <span
                        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                        aria-label={t("teams.dragMember", { member: label })}
                        title={t("teams.dragToReorder")}
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
                            {member.tags[0] || t("teams.roleNotSelected")}
                          </Badge>
                        </div>
                        <p className="text-xs leading-4 text-muted-foreground">{member.displayName}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => openEditMemberDialog(member)}
                        disabled={controlsDisabled}
                        aria-label={t("teams.editMemberAction", { member: label })}
                        title={t("teams.editMemberAction", { member: label })}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleRemoveTeamMember(member.accountId)}
                        disabled={controlsDisabled}
                        aria-label={t(removingMemberAccountId === member.accountId ? "teams.deletingMemberAction" : "teams.deleteMemberAction", { member: label })}
                        title={t(removingMemberAccountId === member.accountId ? "teams.deletingMemberAction" : "teams.deleteMemberAction", { member: label })}
                      >
                        {removingMemberAccountId === member.accountId
                          ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                          : <Trash2 className="size-4" aria-hidden="true" />}
                      </Button>
                      </div>
                    </Fragment>
                  );
                })}
                {draggingMemberAccountId && pointerDropInsertionIndex === configuredMembers.length ? (
                  <div className="h-1 w-full rounded-full bg-primary shadow-sm" aria-label={t("teams.dropPosition")} />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("teams.noMembers")}</p>
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
  hint?: string;
  onBlur?: () => void;
  placeholder?: string;
}

function TextField({ label, value, onChange, disabled, hint, onBlur, placeholder }: TextFieldProps) {
  const id = `managed-project-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-describedby={hint ? hintId : undefined} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} disabled={disabled} />
      {hint ? <p id={hintId} className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
