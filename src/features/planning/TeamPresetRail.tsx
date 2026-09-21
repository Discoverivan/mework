import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import type { TeamMember, TeamPreset, TeamPresetInput } from "../../shared/contracts/planning";
import { useI18n } from "@/i18n/context";

interface TeamPresetRailProps {
  presets: TeamPreset[];
  managedProjectId?: string;
  members?: TeamMember[];
  activePresetId?: string;
  onSelect: (presetId: string) => void;
  onSave: (preset: TeamPresetInput) => void | Promise<unknown>;
  onDelete: (presetId: string) => void | Promise<unknown>;
}

export function TeamPresetRail({
  presets,
  managedProjectId,
  members = [],
  activePresetId,
  onSelect,
  onSave,
  onDelete,
}: TeamPresetRailProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [renameId, setRenameId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [localPresets, setLocalPresets] = useState(presets);
  const [selectedId, setSelectedId] = useState(activePresetId ?? presets[0]?.id);
  useEffect(() => {
    setLocalPresets(presets);
    if (activePresetId) setSelectedId(activePresetId);
  }, [presets, activePresetId]);
  const currentActiveId = activePresetId ?? selectedId;
  const active = localPresets.find((preset) => preset.id === currentActiveId);
  const activeMembers = new Set(active?.memberAccountIds ?? []);

  async function createPreset() {
    const trimmed = name.trim();
    if (!trimmed || !managedProjectId) return;
    const result = await onSave({ managedProjectId, name: trimmed, memberAccountIds: [] });
    if (result && typeof result === "object" && "id" in result) {
      const saved = result as TeamPreset;
      setLocalPresets((current) => [...current, saved]);
      setSelectedId(saved.id);
    }
    setName("");
    setShowCreate(false);
  }

  async function renamePreset(preset: TeamPreset) {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    const result = await onSave({ ...preset, name: trimmed });
    const saved = result && typeof result === "object" && "id" in result ? result as TeamPreset : { ...preset, name: trimmed };
    setLocalPresets((current) => current.map((candidate) => candidate.id === preset.id ? saved : candidate));
    setRenameId(undefined);
  }

  return (
    <Card aria-label={t("planning.myTeams")}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t("planning.myTeams")}</CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowCreate((value) => !value)}>{t("planning.newTeam")}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showCreate ? (
          <div className="space-y-2">
            <Label htmlFor="new-team-name">{t("teams.name")}</Label>
            <Input id="new-team-name" value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder={t("planning.teamPlaceholder")} />
            <Button type="button" size="sm" onClick={() => void createPreset()} disabled={!name.trim()}>{t("planning.createTeam")}</Button>
          </div>
        ) : null}
        {localPresets.length === 0 ? <p className="text-sm text-muted-foreground">{t("planning.noPresets")}</p> : null}
        <div role="list" aria-label={t("planning.presets")} className="space-y-1">
          {localPresets.map((preset) => (
            <div key={preset.id}>
              <div role="listitem" className="flex items-center gap-2">
              <Button
                type="button"
                variant={preset.id === currentActiveId ? "secondary" : "ghost"}
                className="flex-1 justify-start"
                aria-pressed={preset.id === currentActiveId}
                onClick={() => { setSelectedId(preset.id); onSelect(preset.id); }}
              >
                {preset.color ? <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: preset.color }} /> : null}
                {preset.name}
                <Badge variant="outline" className="ml-auto">{preset.memberAccountIds.length}</Badge>
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={t("planning.renameTeam", { team: preset.name })} onClick={() => { setRenameId(preset.id); setRenameValue(preset.name); }}>{t("planning.rename")}</Button>
              <Button type="button" variant="ghost" size="sm" aria-label={t("planning.deleteTeam", { team: preset.name })} onClick={() => { setLocalPresets((current) => current.filter((candidate) => candidate.id !== preset.id)); void onDelete(preset.id); }}>{t("teams.delete")}</Button>
            </div>
            {renameId === preset.id ? (
              <div className="flex gap-1 pl-2">
                <Label className="sr-only" htmlFor={`rename-team-${preset.id}`}>{t("teams.name")}</Label>
                <Input id={`rename-team-${preset.id}`} value={renameValue} onChange={(event: ChangeEvent<HTMLInputElement>) => setRenameValue(event.target.value)} />
                <Button type="button" size="sm" onClick={() => void renamePreset(preset)}>{t("planning.saveName")}</Button>
              </div>
            ) : null}
            </div>
          ))}
        </div>
        {active ? (
          <div aria-label={t("planning.roster")} className="space-y-1 text-xs text-muted-foreground">
            <p>{t("planning.rosterCount", { count: members.filter((member) => activeMembers.has(member.accountId)).length, team: active.name })}</p>
            {members.filter((member) => activeMembers.has(member.accountId)).map((member) => (
              <p key={member.accountId} className="flex items-center gap-1">
                {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-4 w-4 rounded-full" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                <span>{member.displayName}</span>
                {member.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
