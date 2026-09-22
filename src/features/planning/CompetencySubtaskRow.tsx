import type { ChangeEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { CompetencySubtask, PlanningSyncState, TeamMember } from "../../shared/contracts/planning";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { TeamMemberPicker } from "./TeamMemberPicker";
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";

interface CompetencySubtaskRowProps {
  subtask: CompetencySubtask;
  members?: TeamMember[];
  readOnly?: boolean;
  onChange?: (patch: Partial<CompetencySubtask>) => void;
  onRemove?: () => void;
  onAssign?: (accountId: string | undefined) => void;
}

function syncLabelKey(state: PlanningSyncState): TranslationKey {
  switch (state) {
    case "synced": return "planning.sync.synced";
    case "pending": return "planning.sync.pending";
    case "conflict": return "planning.sync.conflict";
    case "error": return "planning.sync.error";
    case "unmapped": return "planning.sync.unmapped";
    default: return "planning.sync.local";
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
  const { t } = useI18n();
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
        <Label className="sr-only" htmlFor={`summary-${subtask.id}`}>{t("planning.subtaskSummary")}</Label>
      ) : null}
      {editable ? (
        <Input
          id={`summary-${subtask.id}`}
          aria-label={t("planning.subtaskSummary")}
          value={subtask.summary}
          onChange={handleSummary}
          className="min-w-[13rem] flex-1"
        />
      ) : (
        <span className="min-w-[13rem] flex-1 font-medium">{subtask.summary}</span>
      )}
      {editable ? (
        <div className="relative">
          <select
            aria-label={t("planning.competency")}
            value={subtask.competency ?? ""}
            onChange={handleCompetency}
            className="h-9 appearance-none rounded-md border bg-background py-2 pl-3 pr-8 text-sm"
          >
            <option value="">{t("planning.chooseCompetency")}</option>
            <option value="Analyst">Analyst</option>
            <option value="Backend">Backend</option>
            <option value="Frontend">Frontend</option>
            <option value="QA">QA</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
        </div>
      ) : subtask.competency ? <Badge variant="secondary">{subtask.competency}</Badge> : null}
      {editable ? (
        <>
          <Label className="sr-only" htmlFor={`points-${subtask.id}`}>{t("planning.storyPoints")}</Label>
          <Input
            id={`points-${subtask.id}`}
            aria-label={t("planning.storyPoints")}
            type="number"
            min={0}
            max={100}
            value={subtask.storyPoints ?? ""}
            onChange={handlePoints}
            className="w-20"
          />
        </>
      ) : subtask.storyPoints !== undefined ? <span aria-label={t("planning.storyPointsCount", { count: subtask.storyPoints })} className="text-sm text-muted-foreground">{subtask.storyPoints} SP</span> : null}
      {onAssign && !readOnly ? (
        <TeamMemberPicker
          members={members}
          selectedAccountId={subtask.assignee?.accountId}
          competency={subtask.competency}
          onAssign={onAssign}
        />
      ) : subtask.assignee ? (
        <span className="flex items-center gap-1 text-sm" aria-label={t("planning.assignedTo", { member: subtask.assignee.displayName })}>
          {subtask.assignee.avatarUrl ? <img src={subtask.assignee.avatarUrl} alt="" className="h-5 w-5 rounded-full" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
          {subtask.assignee.displayName}
        </span>
      ) : <span className="text-sm text-muted-foreground">{t("planning.unassigned")}</span>}
      <Badge variant={subtask.syncState === "error" || subtask.syncState === "conflict" ? "destructive" : "outline"}>
        {t(syncLabelKey(subtask.syncState))}
      </Badge>
      {editable && onRemove ? (
        <Button type="button" variant="ghost" size="sm" aria-label={t("planning.removeSubtask")} onClick={onRemove}>
          {t("planning.remove")}
        </Button>
      ) : null}
    </div>
  );
}
