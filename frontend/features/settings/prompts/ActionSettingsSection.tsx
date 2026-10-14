import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";
import type { AiActionSettingsScope, ActionPromptDraft, PromptAction, PromptSettings } from "@/shared/contracts/settings";
import { getCachedPromptSettings, getPromptSettings } from "./api";

const actionLabels: Record<PromptAction, TranslationKey> = {
  pullRequestReview: "settings.ai.pullRequestReview",
  reviewArbiter: "settings.ai.reviewArbiter",
  taskCreation: "settings.ai.taskCreation",
  sprintSummary: "settings.ai.sprintSummary",
};

const instructionTextareaClassName = "min-h-0 resize-none [field-sizing:content] focus-visible:ring-inset focus-visible:ring-offset-0";

export interface AdvancedActionControls {
  changeKey: string;
  afterModelSettings?: ReactNode;
  fields: ReactNode;
  inlineAfterModel: ReactNode;
  inlineFields: ReactNode;
  begin: () => void;
  cancel: () => void;
}

export function ActionSettingsSection({ defaults, renderActionHeader, renderHeaderActions, renderModelSettings, renderActionOptions, renderInlineSettings, renderActionLayout, extraAction, onSaved, onSavingChange, onLoadingChange, sectionChanged, sectionReady, onSaveSection, onCancelSection, disabled = false }: {
  disabled?: boolean;
  sectionChanged?: (scope: AiActionSettingsScope) => boolean;
  sectionReady?: (scope: AiActionSettingsScope) => boolean;
  onSaveSection?: (scope: AiActionSettingsScope, prompt: ActionPromptDraft | null) => Promise<PromptSettings[]>;
  onCancelSection?: (scope: AiActionSettingsScope) => void;
  onLoadingChange?: (loading: boolean) => void;
  onSaved?: () => void;
  onSavingChange?: (saving: boolean) => void;
  defaults?: ReactNode;
  renderActionHeader?: (scope: AiActionSettingsScope) => ReactNode;
  renderHeaderActions?: (scope: AiActionSettingsScope, controls: AdvancedActionControls) => ReactNode;
  renderInlineSettings?: (scope: AiActionSettingsScope, controls: AdvancedActionControls) => ReactNode;
  renderActionOptions?: (action: Exclude<PromptAction, "reviewArbiter">) => ReactNode;
  renderActionLayout?: (action: Exclude<PromptAction, "reviewArbiter">, fields: ReactNode, arbiterControls: AdvancedActionControls) => ReactNode;
  renderModelSettings?: (action: Exclude<PromptAction, "reviewArbiter">) => ReactNode;
  extraAction?: ReactNode;
}) {
  const { t } = useI18n();
  const [savedSettings, setSavedSettings] = useState<PromptSettings[]>(() => getCachedPromptSettings() ?? []);
  const [settings, setSettings] = useState<PromptSettings[]>(() => getCachedPromptSettings() ?? []);
  const [editing, setEditing] = useState<PromptSettings | null>(null);
  const [viewing, setViewing] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(() => !getCachedPromptSettings());
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<AiActionSettingsScope | null>(null);
  const [savingScope, setSavingScope] = useState<AiActionSettingsScope | null>(null);
  const savingRef = useRef(false);
  const settingsRef = useRef(settings);
  const savedRef = useRef(savedSettings);
  const advancedSnapshots = useRef<Partial<Record<AiActionSettingsScope | "reviewArbiter", PromptSettings[]>>>({});
  settingsRef.current = settings;
  savedRef.current = savedSettings;

  function promptChanged(value?: PromptSettings, saved?: PromptSettings) {
    return Boolean(value && saved && (value.instructions !== saved.instructions || value.customized !== saved.customized || value.includeFixExamples !== saved.includeFixExamples));
  }

  useEffect(() => {
    let active = true;
    void getPromptSettings().then((values) => {
      if (active) { setSettings(values); setSavedSettings(values); setLoadError(false); }
    }).catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    const unsubscribe = subscribeAppEvent(APP_EVENT.aiPromptSettingsChanged, (value) => {
      if (!active) return;
      const draftValue = settingsRef.current.find((item) => item.action === value.action);
      const savedValue = savedRef.current.find((item) => item.action === value.action);
      if (!promptChanged(draftValue, savedValue)) setSettings((values) => values.map((item) => item.action === value.action ? value : item));
      setSavedSettings((values) => values.map((item) => item.action === value.action ? value : item));
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    onSavingChange?.(saving);
    return () => onSavingChange?.(false);
  }, [saving, onSavingChange]);

  useEffect(() => {
    onLoadingChange?.(loading);
    return () => onLoadingChange?.(false);
  }, [loading, onLoadingChange]);

  function openInstructions(value: PromptSettings, readOnly: boolean) {
    setEditing(value);
    setViewing(readOnly);
    setDraft(value.instructions);
    setSaveError(null);
  }

  function restoreBuiltIn(value: PromptSettings) {
    setSettings((values) => values.map((item) => item.action === value.action ? { ...item, instructions: item.defaultInstructions, customized: false } : item));
    setSaveError(null);
  }

  function applyInstructions() {
    if (!editing || viewing) return;
    const instructions = draft.trim();
    setSettings((values) => values.map((item) => item.action === editing.action ? { ...item, instructions, customized: instructions !== item.defaultInstructions } : item));
    setEditing(null);
    setSaveError(null);
  }

  function toggleFixExamples(enabled: boolean) {
    setSettings((values) => values.map((item) => item.action === "pullRequestReview" ? { ...item, includeFixExamples: enabled } : item));
    setSaveError(null);
  }

  async function saveSection(scope: AiActionSettingsScope) {
    if (!onSaveSection || savingRef.current) return;
    const value = settings.find((item) => item.action === scope);
    savingRef.current = true;
    setSaving(true);
    setSavingScope(scope);
    setSaveError(null);
    try {
      const arbiter = settings.find((item) => item.action === "reviewArbiter");
      const saved = await onSaveSection(scope, value ? {
        instructions: value.customized ? value.instructions : null, includeFixExamples: value.includeFixExamples,
        ...(scope === "pullRequestReview" && arbiter ? { arbiterInstructions: arbiter.customized ? arbiter.instructions : null } : {}),
      } : null);
      setSettings((values) => values.map((item) => saved.find((value) => value.action === item.action) ?? item));
      setSavedSettings((values) => values.map((item) => saved.find((value) => value.action === item.action) ?? item));
      onSaved?.();
    } catch { setSaveError(scope); }
    finally { savingRef.current = false; setSaving(false); setSavingScope(null); }
  }

  function cancelSection(scope: AiActionSettingsScope) {
    setSettings((values) => values.map((item) => item.action === scope || (scope === "pullRequestReview" && item.action === "reviewArbiter") ? savedSettings.find((saved) => saved.action === item.action) ?? item : item));
    onCancelSection?.(scope);
    setSaveError(null);
  }

  function sectionHeader(scope: AiActionSettingsScope, label: TranslationKey) {
    const value = settings.find((item) => item.action === scope);
    const saved = savedSettings.find((item) => item.action === scope);
    const changed = promptChanged(value, saved)
      || (scope === "pullRequestReview" && promptChanged(settings.find((item) => item.action === "reviewArbiter"), savedSettings.find((item) => item.action === "reviewArbiter")))
      || sectionChanged?.(scope);
    const headerControl = renderActionHeader?.(scope);
    return <header className="rounded-t-[inherit]"><CardHeader variant="section" className="flex-row flex-wrap items-center gap-3 space-y-0 py-1.5 last:rounded-b-none">
      <CardTitle className="text-sm font-semibold leading-tight">{t(label)}</CardTitle>
      {headerControl ? <div className="flex min-w-fit flex-1 justify-center">{headerControl}</div> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {renderHeaderActions?.(scope, advancedControls(scope))}
        <Button type="button" variant="outline" size="sm" disabled={!changed || loading || disabled || saving} onClick={() => cancelSection(scope)}>{t("settings.common.cancel")}</Button>
        <Button type="button" size="sm" actionTone="edit" disabled={!changed || loading || disabled || saving || !onSaveSection || sectionReady?.(scope) === false} onClick={() => void saveSection(scope)}>
          {savingScope === scope ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t("settings.common.save")}
        </Button>
      </div>
    </CardHeader></header>;
  }

  function renderInstructions(value: PromptSettings | undefined, rows = false, inline = false) {
    const action = `${value?.action ?? "pullRequestReview"}${inline ? "-inline" : ""}`;
    return value ? <div data-slot={rows ? undefined : "control-field"} role="group" aria-labelledby={`ai-prompt-mode-${action}-label`} className={rows ? "flex flex-wrap items-center justify-between gap-3" : "grid w-fit gap-2.5"}>
      <Label id={`ai-prompt-mode-${action}-label`} alignment={rows ? "inline" : undefined}>{t("settings.ai.instructions")}</Label>
      <div data-menu-align={rows ? "end" : undefined} className="flex items-center gap-1.5">
        <Select value={value.customized ? "custom" : "builtIn"} disabled={saving || disabled} onValueChange={(mode) => {
          if (mode === "custom") openInstructions(value, false);
          else void restoreBuiltIn(value);
        }}>
          <SelectTrigger id={`ai-prompt-mode-${action}`} aria-labelledby={`ai-prompt-mode-${action}-label`} className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="builtIn">{t("settings.prompts.modeBuiltIn")}</SelectItem>
            <SelectItem value="custom">{t("settings.prompts.modeCustom")}</SelectItem>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 [&_svg]:!size-[15px]" disabled={saving || disabled} onClick={() => openInstructions(value, !value.customized)} aria-label={t(value.customized ? "settings.prompts.edit" : "settings.prompts.view", { action: t(actionLabels[value.action]) })}>
              {value.customized ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(value.customized ? "settings.prompts.editHint" : "settings.prompts.viewHint")}</TooltipContent>
        </Tooltip>
      </div>
    </div> : null;
  }

  function renderFixExamples(value: PromptSettings, rows: boolean, id: string) {
    return (
      <div data-slot={rows ? undefined : "control-field"} className={rows ? "flex flex-wrap items-center justify-between gap-3" : "grid min-w-0 max-w-full gap-2.5"}>
        <div className="flex items-center gap-1">
          <Label id={`${id}-label`} htmlFor={id} alignment={rows ? "inline" : undefined}>{t("settings.ai.reviewFixExamples")}</Label>
          <InfoPopover label={t("settings.ai.reviewFixExamples")} title={t("settings.ai.reviewFixExamples")}><p>{t("settings.ai.reviewFixExamplesHelp")}</p></InfoPopover>
        </div>
        <Select value={value.includeFixExamples ? "enabled" : "disabled"} disabled={saving || disabled} onValueChange={(mode) => toggleFixExamples(mode === "enabled")}>
          <SelectTrigger id={id} data-menu-align={rows ? "end" : undefined} aria-labelledby={`${id}-label`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="disabled">{t("settings.ai.reviewFixExamplesDisabled")}</SelectItem><SelectItem value="enabled">{t("settings.ai.reviewFixExamplesEnabled")}</SelectItem></SelectContent>
        </Select>
      </div>
    );
  }

  function advancedControls(scope: AiActionSettingsScope | "reviewArbiter"): AdvancedActionControls {
    const value = settings.find((item) => item.action === scope);
    return {
      changeKey: JSON.stringify(value ? { instructions: value.instructions, customized: value.customized, includeFixExamples: value.includeFixExamples } : null),
      begin: () => { advancedSnapshots.current[scope] = settingsRef.current.filter((item) => item.action === scope); },
      cancel: () => {
        const snapshot = advancedSnapshots.current[scope];
        if (snapshot) setSettings((current) => current.map((item) => item.action === scope ? snapshot.find((saved) => saved.action === item.action) ?? item : item));
      },
      afterModelSettings: value && scope === "pullRequestReview" ? <><Separator />{renderFixExamples(value, true, "ai-review-fix-examples")}</> : null,
      inlineAfterModel: value && scope === "pullRequestReview" ? renderFixExamples(value, false, "ai-review-fix-examples-inline") : null,
      inlineFields: value ? renderInstructions(value, false, true) : null,
      fields: value ? renderInstructions(value, true) : null,
    };
  }

  const invalid = !draft.trim() || [...draft].length > 20_000;
  return <TooltipProvider delayDuration={300}><section aria-labelledby="ai-actions-title" className="flex flex-col gap-3">
    <header className="flex flex-col gap-1">
      <h2 id="ai-actions-title" className="text-lg font-semibold leading-tight">{t("settings.ai.actionsTitle")}</h2>
      <p className="text-sm leading-snug text-muted-foreground">{t("settings.ai.actionsDescription")}</p>
    </header>
    {defaults ? <Card role="region" aria-label={t("settings.ai.defaults")}>
      {sectionHeader("default", "settings.ai.defaults")}
      <CardContent className="space-y-3 px-4 py-3 [&_[id$=-label]]:font-normal">
        {saveError === "default" ? <Alert variant="destructive"><AlertDescription>{t("settings.ai.sectionSaveError")}</AlertDescription></Alert> : null}
        {defaults}
        {renderInlineSettings?.("default", advancedControls("default"))}
      </CardContent>
    </Card> : null}
    {loadError ? <Alert variant="destructive"><AlertDescription>{t("settings.prompts.loadError")}</AlertDescription></Alert> : null}
    {(["pullRequestReview", "taskCreation", "sprintSummary"] as const).map((action) => {
      const fields = <div className="flex flex-wrap items-start gap-4">
        {renderModelSettings?.(action)}
        {renderActionOptions?.(action)}
        {renderInlineSettings?.(action, advancedControls(action))}
      </div>;
      return <Card key={action} role="region" aria-label={t(actionLabels[action])}>
          {sectionHeader(action, actionLabels[action])}
          <CardContent className="space-y-3 px-4 py-3 [&_[id$=-label]]:font-normal">
          {saveError === action ? <Alert variant="destructive" role="alert"><AlertDescription>{t("settings.ai.sectionSaveError")}</AlertDescription></Alert> : null}
          {renderActionLayout ? renderActionLayout(action, fields, advancedControls("reviewArbiter")) : fields}
          </CardContent>
        </Card>;
    })}
    {extraAction ? <Card id="ai-token-burner-action" role="region" aria-label={t("settings.ai.tokenBurner")}>
      {sectionHeader("tokenBurner", "settings.ai.tokenBurner")}
      <CardContent className="space-y-3 px-4 py-3 [&_[id$=-label]]:font-normal">
        {saveError === "tokenBurner" ? <Alert variant="destructive"><AlertDescription>{t("settings.ai.sectionSaveError")}</AlertDescription></Alert> : null}
        {extraAction}
        {renderInlineSettings?.("tokenBurner", advancedControls("tokenBurner"))}
      </CardContent>
    </Card> : null}
    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
      <DialogContent className="max-w-5xl" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{editing ? t(actionLabels[editing.action]) : t("settings.ai.actionsTitle")}</DialogTitle>
          <DialogDescription>{t(viewing ? "settings.prompts.viewerDescription" : "settings.prompts.editorDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {saveError ? <Alert variant="destructive" role="alert" className="mb-4"><AlertDescription>{t("settings.prompts.saveError")}</AlertDescription></Alert> : null}
          <form autoComplete="off" id="ai-prompt-form" onSubmit={(event) => { event.preventDefault(); if (!invalid) applyInstructions(); }}>
            <FieldGroup className="gap-4">
              <div className={viewing ? "" : "grid items-start gap-4 lg:grid-cols-2"}>
                {!viewing ? <Card className="p-4"><Field data-invalid={invalid} data-disabled={saving || disabled}>
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="ai-prompt-instructions">{t("settings.prompts.instructions")}</FieldLabel>
                    <InfoPopover label={t("settings.prompts.fieldHelp", { field: t("settings.prompts.instructions") })} title={t("settings.prompts.instructions")}><p>{t("settings.prompts.instructionsHelp")}</p></InfoPopover>
                  </div>
                  <Textarea id="ai-prompt-instructions" className={instructionTextareaClassName} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving || disabled} aria-invalid={invalid} aria-describedby={invalid ? "ai-prompt-help" : undefined} aria-description={t("settings.prompts.instructionsHelp")} />
                  {invalid ? <p className="text-sm text-destructive" id="ai-prompt-help">{t("settings.prompts.validation")}</p> : null}
                </Field></Card> : null}
                <Card className="p-4"><Field>
                  <div className="flex items-center gap-1">
                    <FieldLabel htmlFor="ai-prompt-default">{t("settings.prompts.builtIn")}</FieldLabel>
                    <InfoPopover label={t("settings.prompts.fieldHelp", { field: t("settings.prompts.builtIn") })} title={t("settings.prompts.builtIn")}><p>{t("settings.prompts.builtInHelp")}</p></InfoPopover>
                  </div>
                  <Textarea id="ai-prompt-default" className={instructionTextareaClassName} rows={1} value={editing?.defaultInstructions ?? ""} readOnly />
                </Field></Card>
              </div>
              <Card className="p-4"><Field>
                <div className="flex items-center gap-1">
                  <FieldLabel htmlFor="ai-prompt-rules">{t("settings.prompts.protectedRules")}</FieldLabel>
                  <InfoPopover label={t("settings.prompts.fieldHelp", { field: t("settings.prompts.protectedRules") })} title={t("settings.prompts.protectedRules")}><p>{t("settings.prompts.protectedRulesHelp")}</p></InfoPopover>
                </div>
                <Textarea id="ai-prompt-rules" className={instructionTextareaClassName} rows={1} value={editing?.protectedRules ?? ""} readOnly />
              </Field></Card>
            </FieldGroup>
          </form>
        </DialogBody>
        <DialogFooter className="gap-2">
          {!viewing ? <Button type="button" variant="outline" disabled={saving || disabled || draft === editing?.defaultInstructions} onClick={() => { if (editing) { setDraft(editing.defaultInstructions); setSaveError(null); } }}><RotateCcw data-icon="inline-start" aria-hidden="true" />{t("settings.prompts.reset")}</Button> : null}
          <Button data-dialog-cancel type="button" variant="outline" disabled={saving || disabled} onClick={() => setEditing(null)}>{t(viewing ? "common.close" : "settings.common.cancel")}</Button>
          {!viewing ? <Button type="submit" form="ai-prompt-form" actionTone="edit" disabled={saving || disabled || invalid || draft === editing?.instructions}>{t("settings.prompts.apply")}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section></TooltipProvider>;
}
