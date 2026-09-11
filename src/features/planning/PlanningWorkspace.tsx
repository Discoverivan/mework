import { useMemo, useState } from "react";
import type { CompetencySubtask, PlanningDraft, PlanningIssue, PlanningWorkspace as Workspace, TeamMember, TeamPreset, TeamPresetInput } from "../../shared/contracts/planning";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { IssuePlanCard } from "./IssuePlanCard";
import { TeamPresetRail } from "./TeamPresetRail";
import { savePlanningDraft, applyAndLockPlanning, savePlanningTeamPreset, removePlanningTeamPreset } from "./api";

interface PlanningWorkspaceProps {
  workspace: Workspace;
  members?: TeamMember[];
  presets?: TeamPreset[];
  onSaveDraft?: (draft: PlanningDraft) => void | Promise<unknown>;
  onApplyAndLock?: (command: { workspaceId: string; expectedRevision: string; idempotencyKey: string; confirm: true }) => Promise<unknown>;
  onSavePreset?: (preset: TeamPresetInput) => void | Promise<void>;
  onDeletePreset?: (presetId: string) => void | Promise<void>;
}

function newSubtask(): CompetencySubtask {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    summary: "",
    competency: "",
    syncState: "local",
    isRemote: false,
    required: true,
  };
}

function draftForIssue(workspace: Workspace, issue: PlanningIssue): PlanningDraft {
  return {
    workspaceId: workspace.id,
    parentIssueId: issue.id,
    subtasks: issue.subtasks.filter((subtask) => !subtask.isRemote).map((subtask) => ({
      id: subtask.id,
      summary: subtask.summary,
      competency: subtask.competency ?? "",
      storyPoints: subtask.storyPoints,
      assigneeAccountId: subtask.assignee?.accountId,
      required: subtask.required ?? true,
    })),
  };
}

function hydrateIssues(workspace: Workspace, members: TeamMember[]): PlanningIssue[] {
  return workspace.targetIssues.map((issue) => {
    const draft = workspace.drafts?.find((candidate) => candidate.parentIssueId === issue.id);
    if (!draft) return issue;
    const remote = issue.subtasks;
    const local = draft.subtasks.map((subtask) => {
      return {
        id: subtask.id,
        summary: subtask.summary,
        competency: subtask.competency,
        storyPoints: subtask.storyPoints,
        assignee: subtask.assigneeAccountId ? members.find((member) => member.accountId === subtask.assigneeAccountId) : undefined,
        syncState: "local" as const,
        isRemote: false,
        required: subtask.required,
      };
    });
    return { ...issue, subtasks: [...remote, ...local] };
  });
}

export function PlanningWorkspace({
  workspace,
  members = [],
  presets = [],
  onSaveDraft,
  onApplyAndLock,
  onSavePreset,
  onDeletePreset,
}: PlanningWorkspaceProps) {
  const [issues, setIssues] = useState<PlanningIssue[]>(() => hydrateIssues(workspace, members));
  const [sourceIssues, setSourceIssues] = useState<PlanningIssue[]>(workspace.sourceIssues);
  const [selectedSource, setSelectedSource] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftError, setDraftError] = useState("");
  const [applyState, setApplyState] = useState<"idle" | "confirm" | "applying" | "error">("idle");
  const [activePresetId, setActivePresetId] = useState(presets.find((preset) => preset.selected)?.id ?? presets[0]?.id);
  const activePreset = presets.find((preset) => preset.id === activePresetId);
  const presetMembers = useMemo(
    () => activePreset ? members.filter((member) => activePreset.memberAccountIds.includes(member.accountId)) : members,
    [activePreset, members],
  );
  const locked = workspace.status === "locked";
  const save = onSaveDraft ?? savePlanningDraft;
  const apply = onApplyAndLock ?? applyAndLockPlanning;
  const savePreset = onSavePreset ?? savePlanningTeamPreset;
  const deletePreset = onDeletePreset ?? removePlanningTeamPreset;

  function updateIssue(issueId: string, update: (issue: PlanningIssue) => PlanningIssue) {
    setIssues((current) => current.map((issue) => issue.id === issueId ? update(issue) : issue));
  }

  function addSubtask(issueId: string) {
    updateIssue(issueId, (issue) => ({ ...issue, subtasks: [...issue.subtasks, newSubtask()] }));
  }

  function updateSubtask(issueId: string, subtaskId: string, patch: Partial<CompetencySubtask>) {
    updateIssue(issueId, (issue) => ({
      ...issue,
      subtasks: issue.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, ...patch } : subtask),
    }));
  }

  function removeSubtask(issueId: string, subtaskId: string) {
    updateIssue(issueId, (issue) => ({ ...issue, subtasks: issue.subtasks.filter((subtask) => subtask.id !== subtaskId) }));
  }

  function assign(issueId: string, subtaskId: string, accountId: string | undefined) {
    const member = members.find((candidate) => candidate.accountId === accountId);
    updateSubtask(issueId, subtaskId, {
      assignee: member ? { accountId: member.accountId, displayName: member.displayName, avatarUrl: member.avatarUrl, active: member.active } : undefined,
      syncState: "local",
    });
  }

  async function saveDrafts() {
    const invalid = issues.some((issue) => issue.subtasks.some((subtask) =>
      !subtask.isRemote && (!subtask.summary.trim() || !subtask.competency?.trim() ||
        (subtask.storyPoints !== undefined && (!Number.isFinite(subtask.storyPoints) || subtask.storyPoints < 0 || subtask.storyPoints > 100)))
    ));
    if (invalid) {
      setDraftError("Complete each local competency subtask with a summary, competency, and 0–100 story points.");
      setSaveState("error");
      return;
    }
    setDraftError("");
    setSaveState("saving");
    try {
      await Promise.all(issues.map((issue) => save(draftForIssue(workspace, issue))));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function confirmApply() {
    setApplyState("applying");
    try {
      await apply({
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: `planning:${workspace.id}:${workspace.revision}`,
        confirm: true,
      });
      setApplyState("idle");
    } catch {
      setApplyState("error");
    }
  }

  function addSelectedToTarget() {
    const selected = sourceIssues.filter((issue) => selectedSource.includes(issue.id));
    setIssues((current) => [...current, ...selected.filter((issue) => !current.some((candidate) => candidate.id === issue.id))]);
    setSourceIssues((current) => current.filter((issue) => !selectedSource.includes(issue.id)));
    setSelectedSource([]);
  }

  return (
    <section aria-labelledby="planning-workspace-title" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{workspace.managedProject.name} · {workspace.managedProject.boardName}</p>
          <h2 id="planning-workspace-title" className="text-2xl font-semibold">{workspace.managedProject.name} planning</h2>
          <p className="text-sm text-muted-foreground">Planning source: <strong>{workspace.sourceSprint.name}</strong> → Target sprint: <strong>{workspace.targetSprint.name}</strong></p>
        </div>
        <div className="flex gap-2">
          {!locked ? <Button type="button" variant="outline" onClick={() => void saveDrafts()} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save draft"}</Button> : null}
          {!locked ? <Button type="button" onClick={() => setApplyState("confirm")} disabled={applyState === "applying"}>Apply and lock</Button> : <Badge variant="secondary">Locked</Badge>}
        </div>
      </header>
      {saveState === "saved" ? <p role="status">Draft saved locally. Jira was not changed.</p> : null}
      {saveState === "error" ? <Alert variant="destructive"><AlertDescription>{draftError || "Unable to save the local planning draft."}</AlertDescription></Alert> : null}
      {applyState === "error" ? <Alert variant="destructive"><AlertDescription>Apply failed; the plan remains unlocked. Review the operation errors and retry.</AlertDescription></Alert> : null}
      {applyState === "confirm" ? (
        <Alert role="dialog" aria-label="Confirm Apply and lock">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Applying changes will write to Jira and lock this plan after every operation succeeds.
            <Button type="button" onClick={() => void confirmApply()}>Confirm Apply and lock</Button>
            <Button type="button" variant="ghost" onClick={() => setApplyState("idle")}>Cancel</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader><CardTitle className="text-base">Planning source · {workspace.sourceSprint.name}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sourceIssues.length === 0 ? <p className="text-sm text-muted-foreground">No eligible issues in the planning source.</p> : null}
            {sourceIssues.map((issue) => (
              <label key={issue.id} className="flex gap-2 rounded-md border p-2 text-sm">
                <input type="checkbox" checked={selectedSource.includes(issue.id)} onChange={(event) => setSelectedSource((current) => event.target.checked ? [...current, issue.id] : current.filter((id) => id !== issue.id))} />
                <span><strong>{issue.key}</strong> · {issue.summary}</span>
              </label>
            ))}
            <Button type="button" variant="outline" onClick={addSelectedToTarget} disabled={selectedSource.length === 0}>Add selected to target</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Target sprint · {workspace.targetSprint.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {issues.length === 0 ? <p className="text-sm text-muted-foreground">No issues in this target sprint.</p> : null}
            {issues.map((issue) => (
              <IssuePlanCard
                key={issue.id}
                issue={issue}
                members={presetMembers}
                readOnly={locked}
                onAddSubtask={() => addSubtask(issue.id)}
                onUpdateSubtask={(id, patch) => updateSubtask(issue.id, id, patch)}
                onRemoveSubtask={(id) => removeSubtask(issue.id, id)}
                onAssign={(id, accountId) => assign(issue.id, id, accountId)}
              />
            ))}
          </CardContent>
        </Card>
        <TeamPresetRail
          presets={presets}
          managedProjectId={workspace.managedProject.id}
          members={members}
          activePresetId={activePresetId}
          onSelect={setActivePresetId}
          onSave={savePreset}
          onDelete={deletePreset}
        />
      </div>
    </section>
  );
}
