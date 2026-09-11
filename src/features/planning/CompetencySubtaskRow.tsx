import type { ChangeEvent } from "react";
import type { CompetencySubtask, PlanningSyncState, TeamMember } from "../../shared/contracts/planning";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { TeamMemberPicker } from "./TeamMemberPicker";

interface CompetencySubtaskRowProps {
  subtask: CompetencySubtask;
  members?: TeamMember[];
  readOnly?: boolean;
  onChange?: (patch: Partial<CompetencySubtask>) => void;
  onRemove?: () => void;
  onAssign?: (accountId: string | undefined) => void;
}

function syncLabel(state: PlanningSyncState) {
  switch (state) {
    case "synced": return "Synced";
    case "pending": return "Pending sync";
    case "conflict": return "Conflict";
    case "error": return "Sync error";
    case "unmapped": return "Unmapped competency";
    default: return "Local draft";
  }
}

export function CompetencySubtaskRow({
  subtask,
  members = [],
  readOnly = false,
  onChange,
  onRemove,
  onAssign,
}: CompetencySubtaskRowProps) {
  const editable = !readOnly && Boolean(onChange);
  const handleSummary = (event: ChangeEvent<HTMLInputElement>) =>
    onChange?.({ summary: event.target.value, syncState: "local" });
  const handlePoints = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value === "" ? undefined : Number(event.target.value);
    onChange?.({ storyPoints: value, syncState: "local" });
  };
  const handleCompetency = (event: ChangeEvent<HTMLSelectElement>) =>
    onChange?.({ competency: event.target.value, syncState: "local" });

  return (
    <div className="flex flex-wrap items-center gap-2 border-l-2 pl-3 py-2" data-testid={`subtask-${subtask.id}`}>
      {editable ? (
        <Label className="sr-only" htmlFor={`summary-${subtask.id}`}>Subtask summary</Label>
      ) : null}
      {editable ? (
        <Input
          id={`summary-${subtask.id}`}
          aria-label="Subtask summary"
          value={subtask.summary}
          onChange={handleSummary}
          className="min-w-[13rem] flex-1"
        />
      ) : (
        <span className="min-w-[13rem] flex-1 font-medium">{subtask.summary}</span>
      )}
      {editable ? (
        <select
          aria-label="Competency"
          value={subtask.competency ?? ""}
          onChange={handleCompetency}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Choose competency</option>
          <option value="Analyst">Analyst</option>
          <option value="Backend">Backend</option>
          <option value="Frontend">Frontend</option>
          <option value="QA">QA</option>
        </select>
      ) : subtask.competency ? <Badge variant="secondary">{subtask.competency}</Badge> : null}
      {editable ? (
        <>
          <Label className="sr-only" htmlFor={`points-${subtask.id}`}>Story points</Label>
          <Input
            id={`points-${subtask.id}`}
            aria-label="Story points"
            type="number"
            min={0}
            max={100}
            value={subtask.storyPoints ?? ""}
            onChange={handlePoints}
            className="w-20"
          />
        </>
      ) : subtask.storyPoints !== undefined ? <span aria-label={`${subtask.storyPoints} story points`} className="text-sm text-muted-foreground">{subtask.storyPoints} SP</span> : null}
      {onAssign && !readOnly ? (
        <TeamMemberPicker
          members={members}
          selectedAccountId={subtask.assignee?.accountId}
          competency={subtask.competency}
          onAssign={onAssign}
        />
      ) : subtask.assignee ? (
        <span className="flex items-center gap-1 text-sm" aria-label={`Assigned to ${subtask.assignee.displayName}`}>
          {subtask.assignee.avatarUrl ? <img src={subtask.assignee.avatarUrl} alt="" className="h-5 w-5 rounded-full" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
          {subtask.assignee.displayName}
        </span>
      ) : <span className="text-sm text-muted-foreground">Unassigned</span>}
      <Badge variant={subtask.syncState === "error" || subtask.syncState === "conflict" ? "destructive" : "outline"}>
        {syncLabel(subtask.syncState)}
      </Badge>
      {editable && onRemove ? (
        <Button type="button" variant="ghost" size="sm" aria-label="Remove competency subtask" onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}
