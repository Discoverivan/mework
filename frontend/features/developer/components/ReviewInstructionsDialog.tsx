import { useEffect, useState } from "react";
import { CircleAlert, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { PullRequestTargetPicker } from "./PullRequestTargetPicker";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { ReviewInstructionRule, ReviewInstructionScope } from "@/shared/contracts/developer";
import { getReviewInstructionRules, saveReviewInstructionRules, searchBitbucketProjects, searchBitbucketRepositories, searchBitbucketUsers } from "../api";

type Target = Pick<ReviewInstructionRule, "integrationId" | "externalId" | "label">;
type SearchTarget = Target & { primary: string; secondary?: string; accessibleName: string; enterValue: string };
const pickerCopy = {
  project: { label: "pr.filters.project", placeholder: "pr.filters.projectPlaceholder", searching: "pr.filters.searchingProjects", results: "pr.filters.projectResults" },
  repository: { label: "pr.filters.repository", placeholder: "pr.filters.repositoryPlaceholder", searching: "pr.filters.searchingRepositories", results: "pr.filters.repositoryResults" },
  author: { label: "pr.filters.author", placeholder: "pr.filters.creatorPlaceholder", searching: "pr.filters.searchingCreators", results: "pr.filters.creatorResults" },
} as const;
const scopes: ReviewInstructionScope[] = ["project", "repository", "author"];
const instructionRowClasses = "grid grid-cols-[minmax(0,1fr)_8rem_6rem] items-center gap-2 sm:grid-cols-[minmax(0,3fr)_8rem_minmax(6rem,1fr)] sm:gap-3";
const targetKey = (target: Target) => JSON.stringify([target.integrationId, target.externalId.toLowerCase()]);
const ruleKey = (rule: ReviewInstructionRule) => JSON.stringify([rule.scope, targetKey(rule)]);
const ruleDisplayName = (rule: ReviewInstructionRule) => {
  if (rule.scope !== "author") return rule.externalId;
  const accountSuffix = ` (${rule.externalId})`;
  return rule.label.endsWith(accountSuffix) ? rule.label.slice(0, -accountSuffix.length) : rule.label;
};
const message = (error: unknown) => {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  return value.replace(/\b(?:token|pat|password|secret|authorization)\b\s*[:=][^\n]*/gi, "[redacted]");
};

async function searchTargets(scope: ReviewInstructionScope, query: string): Promise<SearchTarget[]> {
  if (scope === "project") return (await searchBitbucketProjects(query)).map((project) => ({ integrationId: project.integrationId, externalId: project.projectKey, label: `${project.projectKey} · ${project.projectName}`, primary: project.projectKey, secondary: project.projectName, accessibleName: `${project.projectKey} (${project.projectName})`, enterValue: project.projectKey }));
  if (scope === "repository") return (await searchBitbucketRepositories(query)).flatMap((repo) => repo.integrationId ? [{ integrationId: repo.integrationId, externalId: `${repo.projectKey}/${repo.repositorySlug}`, label: `${repo.projectKey}/${repo.repositorySlug} · ${repo.repositoryName}`, primary: `${repo.projectKey}/${repo.repositorySlug}`, secondary: `${repo.repositoryName} (${repo.projectName})`, accessibleName: `${repo.projectKey}/${repo.repositorySlug} · ${repo.repositoryName}`, enterValue: `${repo.projectKey}/${repo.repositorySlug}` }] : []);
  return (await searchBitbucketUsers(query)).flatMap((user) => {
    const account = user.name ?? user.slug;
    const displayName = user.displayName ?? user.name ?? user.slug;
    return user.integrationId && account && displayName ? [{ integrationId: user.integrationId, externalId: account, label: `${displayName} (${account})`, primary: displayName, secondary: `(${account})`, accessibleName: `${displayName} (${account})`, enterValue: displayName }] : [];
  });
}

function ReviewInstructionsHelp() {
  const { t } = useI18n();
  return <InfoPopover label={t("pr.instructions.showHelp")} title={t("pr.instructions.helpTitle")}>
    <p>{t("pr.instructions.helpMatching")}</p>
    <p><strong className="font-medium text-foreground">{t("pr.instructions.append")}.</strong>{" "}{t("pr.instructions.helpAppend")}</p>
    <p><strong className="font-medium text-foreground">{t("pr.instructions.replace")}.</strong>{" "}{t("pr.instructions.helpRewrite")}</p>
    <p>{t("pr.instructions.helpApplicationRules")}</p>
    <p>{t("pr.instructions.helpSaving")}</p>
  </InfoPopover>;
}

function InstructionEditButton({ rule, disabled, onEdit }: { rule: ReviewInstructionRule; disabled: boolean; onEdit: (rule: ReviewInstructionRule) => void }) {
  const { t } = useI18n();
  const [showError, setShowError] = useState(false);
  const invalid = !rule.instructions.trim();
  const error = t("pr.instructions.requiredForRule");
  return <Popover open={!disabled && invalid && showError} onOpenChange={setShowError}>
    <PopoverAnchor asChild>
      <Button type="button" size="icon" variant="ghost" actionTone="edit" className="app-instruction-edit size-6 [&_svg]:!size-3"
        aria-invalid={invalid} aria-description={invalid ? error : undefined} title={invalid ? undefined : t("pr.instructions.edit")}
        aria-label={t("pr.instructions.editFor", { target: rule.label })} disabled={disabled}
        onPointerEnter={() => setShowError(true)}
        onPointerLeave={(event) => { if (document.activeElement !== event.currentTarget) setShowError(false); }}
        onFocus={() => setShowError(true)} onBlur={() => setShowError(false)}
        onClick={() => { setShowError(false); onEdit(rule); }}><Pencil aria-hidden="true" /></Button>
    </PopoverAnchor>
    <PopoverContent role="alert" side="bottom" align="start" sideOffset={6} collisionPadding={8}
      className="flex gap-2 border-destructive/50 px-3 py-2 text-sm text-destructive"
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{error}</span>
    </PopoverContent>
  </Popover>;
}

function InstructionList({ scope, rules, disabled, onAdd, onChange, onEdit, onRemove }: {
  scope: ReviewInstructionScope; rules: ReviewInstructionRule[]; disabled: boolean;
  onAdd: (target: Target) => void; onChange: (rule: ReviewInstructionRule, changes: Partial<ReviewInstructionRule>) => void; onRemove: (rule: ReviewInstructionRule) => void;
  onEdit: (rule: ReviewInstructionRule) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open || query.trim().length < 3) {
      setResults([]);
      setSearching(false);
      setError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError(undefined);
      void searchTargets(scope, query.trim()).then((targets) => { if (active) setResults(targets); })
        .catch((reason) => { if (active) { setResults([]); setError(message(reason) || t("common.unknownError")); } })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query, scope, t]);
  const targets = new Map<string, SearchTarget>();
  for (const target of open && query.trim().length >= 3 ? results : []) {
    if (!rules.some((rule) => targetKey(rule) === targetKey(target))) targets.set(targetKey(target), target);
  }
  const copy = pickerCopy[scope];
  const addTarget = (target: SearchTarget) => {
    onAdd({ integrationId: target.integrationId, externalId: target.externalId, label: target.label });
    setOpen(false);
  };
  const enterMatch = scope === "project" ? undefined : [...targets.values()].find((target) => target.enterValue.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase());
  return <Card className="pr-filter-group shrink-0 overflow-hidden shadow-none">
    <CardHeader variant="section" className="px-3 py-1">
      <div className={instructionRowClasses}>
        <CardTitle className="min-w-0 text-[15px] font-normal leading-normal">{t(`pr.instructions.${scope}`)}</CardTitle>
        <span className="text-[13px] font-normal">{t("pr.instructions.mode")}</span>
        <div className="flex shrink-0 items-center justify-end">
          <PullRequestTargetPicker open={open} onOpenChange={(value) => { setOpen(value); if (value) setQuery(""); }} disabled={disabled}
            actionLabel={t("pr.instructions.addFor", { target: t(`pr.instructions.${scope}`) })} inputId={`instruction-search-${scope}`} fieldLabel={t(copy.label)}
            query={query} onQueryChange={setQuery} placeholder={t(copy.placeholder)} searching={searching} searchingLabel={t(copy.searching)} error={error} resultsLabel={t(copy.results)}
            options={[...targets.values()].map((target) => ({ key: targetKey(target), primary: target.primary, secondary: target.secondary, accessibleName: target.accessibleName }))}
            onSelect={(key) => { const target = targets.get(key); if (target) addTarget(target); }}
            onEnter={enterMatch ? () => addTarget(enterMatch) : undefined} />
        </div>
      </div>
    </CardHeader>
    <CardContent className={rules.length > 0 ? "px-3 pb-0" : "px-3 pb-2 pt-2"}>
      {rules.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("pr.instructions.empty")}</p> : <ul aria-label={t(`pr.instructions.${scope}`)} className="flex flex-col">
        {rules.map((rule) => <li key={ruleKey(rule)} className={cn(instructionRowClasses, "min-h-10 min-w-0 border-b py-1.5 text-[13px] last:border-b-0")}>
          <span className="min-w-0 break-words">{ruleDisplayName(rule)}</span>
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="outline" actionTone="neutral" className="h-7" aria-label={t("pr.instructions.modeFor", { target: rule.label })} aria-pressed={rule.mode === "replace"} title={t("pr.instructions.switchMode", { mode: t(rule.mode === "append" ? "pr.instructions.replace" : "pr.instructions.append") })} disabled={disabled} onClick={() => onChange(rule, { mode: rule.mode === "append" ? "replace" : "append" })}>{t(rule.mode === "append" ? "pr.instructions.append" : "pr.instructions.replace")}</Button>
            <InstructionEditButton rule={rule} disabled={disabled} onEdit={onEdit} />
          </div>
          <div className="flex items-center justify-end">
            <Button type="button" size="sm" variant="ghost" actionTone="delete" className="h-7 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive" aria-label={t("pr.instructions.deleteFor", { target: rule.label })} disabled={disabled} onClick={() => onRemove(rule)}><Trash2 data-icon="inline-start" aria-hidden="true" />{t("pr.filters.remove")}</Button>
          </div>
        </li>)}
      </ul>}
    </CardContent>
  </Card>;
}

export function ReviewInstructionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<ReviewInstructionRule[]>([]);
  const [draft, setDraft] = useState<ReviewInstructionRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<{ key: string; label: string; instructions: string } | null>(null);
  const [removing, setRemoving] = useState<ReviewInstructionRule | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setLoaded(false); setError(undefined); setEditing(null); setRemoving(null);
    void getReviewInstructionRules().then((rules) => { if (active) { setSaved(rules); setDraft(rules); setLoaded(true); } })
      .catch((reason) => { if (active) setError(message(reason) || t("common.unknownError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, t]);
  async function save() {
    setSaving(true); setError(undefined);
    try { const rules = await saveReviewInstructionRules(draft); setSaved(rules); setDraft(rules); onOpenChange(false); }
    catch (reason) { setError(message(reason) || t("common.unknownError")); }
    finally { setSaving(false); }
  }
  const disabled = loading || saving || !loaded;
  return <><Dialog open={open} onOpenChange={(value) => { if (!saving) { setEditing(null); setRemoving(null); onOpenChange(value); } }}>
    <DialogContent className="max-w-2xl" data-info-popover-boundary>
      <DialogHeader>
        <div className="flex items-center gap-1.5 pr-6">
          <DialogTitle>{t("pr.instructions.title")}</DialogTitle>
          <ReviewInstructionsHelp />
        </div>
        <DialogDescription>{t("pr.instructions.description")}</DialogDescription>
      </DialogHeader>
      <DialogBody layout="sections">
        {loading ? <p role="status">{t("pr.instructions.loading")}</p> : scopes.map((scope) => <InstructionList key={scope} scope={scope} rules={draft.filter((rule) => rule.scope === scope)} disabled={disabled}
          onAdd={(target) => setDraft((current) => [...current, { ...target, scope, mode: "append", instructions: "" }])}
          onChange={(rule, changes) => setDraft((current) => current.map((existing) => ruleKey(existing) === ruleKey(rule) ? { ...existing, ...changes } : existing))}
          onEdit={(rule) => setEditing({ key: ruleKey(rule), label: rule.label, instructions: rule.instructions })}
          onRemove={setRemoving} />)}
        {error ? <p role="alert" className="rounded-md border border-destructive px-4 py-3 text-sm text-destructive">{error}</p> : null}
      </DialogBody>
      <DialogFooter><Button data-dialog-cancel type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("settings.common.cancel")}</Button><Button type="button" actionTone="edit" disabled={disabled || draft.some((rule) => !rule.instructions.trim()) || JSON.stringify(draft) === JSON.stringify(saved)} onClick={() => void save()}>{t(saving ? "settings.common.saving" : "settings.common.save")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
    <Dialog open={open && editing !== null} onOpenChange={(value) => { if (!value) setEditing(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t("pr.instructions.edit")}</DialogTitle><DialogDescription>{editing?.label}</DialogDescription></DialogHeader>
        <DialogBody>
          <Label htmlFor="review-rule-instructions">{t("pr.instructions.text")}</Label>
          <Textarea id="review-rule-instructions" className="mt-2 min-h-64" aria-label={t("pr.instructions.textFor", { target: editing?.label ?? "" })} value={editing?.instructions ?? ""} maxLength={20000} onChange={(event) => setEditing((current) => current ? { ...current, instructions: event.target.value } : current)} />
        </DialogBody>
        <DialogFooter>
          <Button data-dialog-cancel type="button" variant="outline" onClick={() => setEditing(null)}>{t("settings.common.cancel")}</Button>
          <Button type="button" actionTone="edit" disabled={!editing?.instructions.trim()} onClick={() => {
            if (!editing) return;
            setDraft((current) => current.map((rule) => ruleKey(rule) === editing.key ? { ...rule, instructions: editing.instructions } : rule));
            setEditing(null);
          }}>{t("settings.prompts.apply")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={open && removing !== null} onOpenChange={(value) => { if (!value) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pr.instructions.confirmRemoveTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("pr.instructions.confirmRemove", { target: removing?.label ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("settings.common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" actionTone="delete" onClick={() => {
            if (!removing) return;
            setDraft((current) => current.filter((rule) => ruleKey(rule) !== ruleKey(removing)));
            setRemoving(null);
          }}>{t("pr.filters.remove")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
