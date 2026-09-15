import { useEffect, useState } from "react";
import { PageHeader } from "../../components/shared/PageHeader";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Card, CardContent } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import type { ManagedProject, PlanningSprint, PlanningWorkspace as Workspace, TeamMember, TeamPreset } from "../../shared/contracts/planning";
import { listManagedProjects, listPlanningTeamMembers, listPlanningTeamPresets, listTargetSprints, loadPlanningWorkspace } from "./api";
import { PlanningWorkspace } from "./PlanningWorkspace";

function commandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const structured = error as { message?: unknown; code?: unknown };
    if (typeof structured.message === "string" && structured.message.trim()) return structured.message;
    if (typeof structured.code === "string" && structured.code.trim()) return `Command failed (${structured.code})`;
  }
  return "Unknown command error";
}

export function PlanningPage() {
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sprints, setSprints] = useState<PlanningSprint[]>([]);
  const [sprintId, setSprintId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamPresets, setTeamPresets] = useState<TeamPreset[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [error, setError] = useState<"projects" | "sprints" | "workspace">();
  const [sprintError, setSprintError] = useState<string>();
  const [workspaceError, setWorkspaceError] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoadingProjects(true);
    listManagedProjects()
      .then((result) => { if (active) setProjects(result); })
      .catch(() => { if (active) setError("projects"); })
      .finally(() => { if (active) setLoadingProjects(false); });
    return () => { active = false; };
  }, []);

  function selectProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setSprintId("");
    setSprintError(undefined);
    setWorkspaceError(undefined);
    setWorkspace(undefined);
    if (!nextProjectId) { setSprints([]); return; }
    setLoadingSprints(true);
    setError(undefined);
    listTargetSprints(nextProjectId)
      .then(setSprints)
      .catch((reason) => {
        setSprintError(commandError(reason));
        setError("sprints");
      })
      .finally(() => setLoadingSprints(false));
  }

  function selectSprint(nextSprintId: string) {
    setSprintId(nextSprintId);
    setWorkspaceError(undefined);
    if (!nextSprintId || !projectId) { setWorkspace(undefined); return; }
    const project = projects.find((candidate) => candidate.id === projectId);
    setLoadingWorkspace(true);
    setError(undefined);
    loadPlanningWorkspace({ managedProjectId: projectId, sourceSprintId: project?.sourceSprintId ?? "", targetSprintId: nextSprintId })
      .then((loadedWorkspace) => {
        setWorkspace(loadedWorkspace);
        void Promise.all([
          listPlanningTeamMembers(projectId),
          listPlanningTeamPresets(projectId),
        ]).then(([members, presets]) => {
          setTeamMembers(members ?? []);
          setTeamPresets(presets ?? []);
        }).catch(() => {
          // Workspace data remains usable when optional team metadata is unavailable.
          setTeamMembers([]);
          setTeamPresets([]);
        });
      })
      .catch((reason) => {
        setWorkspaceError(commandError(reason));
        setError("workspace");
      })
      .finally(() => setLoadingWorkspace(false));
  }

  return (
    <section aria-labelledby="planning-entry-title" className="space-y-4">
      {!workspace ? (
        <>
          <PageHeader
            title="What do you want to plan?"
            titleId="planning-entry-title"
            description="Jira sprint planning"
          />
          <Card>
            <CardContent className="grid max-w-2xl gap-4 pt-6 sm:grid-cols-2">
              {loadingProjects ? <p role="status" className="sm:col-span-2">Loading managed projects…</p> : null}
              {error === "projects" ? <Alert variant="destructive" role="alert" className="sm:col-span-2"><AlertDescription>Unable to load managed projects. Check Jira permissions in Settings.</AlertDescription></Alert> : null}
              {!loadingProjects && !error && projects.length === 0 ? <p className="sm:col-span-2">No managed Jira projects are configured.</p> : null}
              {!loadingProjects && projects.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="managed-project">Managed project</Label>
                  <Select value={projectId} onValueChange={selectProject}>
                    <SelectTrigger id="managed-project" aria-label="Managed project"><SelectValue placeholder="Choose a managed project" /></SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name} ({project.jiraProjectId})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {projectId ? (
                <div className="space-y-2">
                  <Label htmlFor="target-sprint">Target sprint</Label>
                  {loadingSprints ? <p role="status">Loading target sprints…</p> : (
                    <Select value={sprintId} onValueChange={selectSprint}>
                      <SelectTrigger id="target-sprint" aria-label="Target sprint"><SelectValue placeholder="Choose an open sprint" /></SelectTrigger>
                      <SelectContent>
                        {sprints.filter((sprint) => sprint.usable && sprint.state === "future").map((sprint) => <SelectItem key={sprint.id} value={sprint.id}>{sprint.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {sprints.length > 0 && sprints.every((sprint) => !sprint.usable || sprint.state !== "future") ? <p className="text-sm text-muted-foreground">No future target sprints.</p> : null}
                </div>
              ) : null}
              {error === "sprints" ? <Alert variant="destructive" role="alert" className="sm:col-span-2"><AlertDescription>Unable to load target sprints. {sprintError || "Check Jira board permissions."}</AlertDescription></Alert> : null}
              {error === "workspace" ? <Alert variant="destructive" role="alert" className="sm:col-span-2"><AlertDescription>Unable to load the planning workspace. {workspaceError || "Refresh Jira data and try again."}</AlertDescription></Alert> : null}
              {loadingWorkspace ? <p role="status" className="sm:col-span-2">Loading planning workspace…</p> : null}
            </CardContent>
          </Card>
        </>
      ) : <PlanningWorkspace workspace={workspace} members={teamMembers} presets={teamPresets} />}
    </section>
  );
}
