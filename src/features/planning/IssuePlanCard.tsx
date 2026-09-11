import { useState } from "react";
import type { PlanningIssue, CompetencySubtask, TeamMember } from "../../shared/contracts/planning";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { CompetencySubtaskRow } from "./CompetencySubtaskRow";

interface IssuePlanCardProps {
  issue: PlanningIssue;
  members?: TeamMember[];
  readOnly?: boolean;
  onAddSubtask?: () => void;
  onUpdateSubtask?: (id: string, patch: Partial<CompetencySubtask>) => void;
  onRemoveSubtask?: (id: string) => void;
  onAssign?: (subtaskId: string, accountId: string | undefined) => void;
}

export function IssuePlanCard({
  issue,
  members = [],
  readOnly = false,
  onAddSubtask,
  onUpdateSubtask,
  onRemoveSubtask,
  onAssign,
}: IssuePlanCardProps) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Card>
      <article aria-label={`${issue.key}: ${issue.summary}`}>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{issue.key} · {issue.summary}</CardTitle>
            <p className="text-sm text-muted-foreground">{issue.status}{issue.storyPoints !== undefined ? ` · ${issue.storyPoints} SP` : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {issue.assignee ? <span className="text-sm text-muted-foreground">{issue.assignee.displayName}</span> : <Badge variant="outline">Unassigned</Badge>}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${issue.key}`}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide" : "Show"}
            </Button>
          </div>
        </CardHeader>
        {expanded ? (
          <CardContent className="space-y-1">
            {issue.subtasks.length === 0 ? <p className="text-sm text-muted-foreground">No competency subtasks yet.</p> : null}
            {issue.subtasks.map((subtask) => (
              <CompetencySubtaskRow
                key={subtask.id}
                subtask={subtask}
                members={members}
                readOnly={readOnly || subtask.isRemote}
                onChange={onUpdateSubtask ? (patch) => onUpdateSubtask(subtask.id, patch) : undefined}
                onRemove={onRemoveSubtask ? () => onRemoveSubtask(subtask.id) : undefined}
                onAssign={onAssign ? (accountId) => onAssign(subtask.id, accountId) : undefined}
              />
            ))}
            {!readOnly ? <Button type="button" size="sm" variant="outline" onClick={onAddSubtask}>Add competency subtask</Button> : null}
          </CardContent>
        ) : null}
      </article>
    </Card>
  );
}
