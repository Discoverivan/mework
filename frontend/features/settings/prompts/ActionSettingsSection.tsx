import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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

export function ActionSettingsSection({ defaults, renderActionHeader, renderModelSettings, renderActionOptions, renderActionLayout, extraAction, onSaved, onSavingChange, onLoadingChange, sectionChanged, sectionReady, onSaveSection, onCancelSection, disabled = false }: {
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
  renderActionOptions?: (action: Exclude<PromptAction, "reviewArbiter">) => ReactNode;
  renderActionLayout?: (action: Exclude<PromptAction, "reviewArbiter">, fields: ReactNode, arbiterInstructions: ReactNode) => ReactNode;
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
    return <header className="flex flex-wrap items-center gap-3">
      <h3 className="text-sm font-medium">{t(label)}</h3>
      {headerControl ? <div className="flex min-w-fit flex-1 justify-center">{headerControl}</div> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!changed || loading || disabled || saving} onClick={() => cancelSection(scope)}>{t("settings.common.cancel")}</Button>
        <Button type="button" size="sm" actionTone="edit" disabled={!changed || loading || disabled || saving || !onSaveSection || sectionReady?.(scope) === false} onClick={() => void saveSection(scope)}>
          {savingScope === scope ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t("settings.common.save")}
        </Button>
      </div>
    </header>;
  }

  function renderInstructions(value: PromptSettings | undefined) {
    const action = value?.action ?? "pullRequestReview";
    return value ? <div role="group" aria-labelledby={`ai-prompt-mode-${action}-label`} className="grid w-fit gap-2.5">
      <Label id={`ai-prompt-mode-${action}-label`}>{t("settings.ai.instructions")}</Label>
      <div className="flex items-center gap-1">
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

  const invalid = !draft.trim() || [...draft].length > 20_000;
  return <TooltipProvider delayDuration={300}><section aria-labelledby="ai-actions-title" className="flex flex-col gap-4">
    <header className="flex flex-col gap-1">
      <h2 id="ai-actions-title" className="text-lg font-semibold leading-tight">{t("settings.ai.actionsTitle")}</h2>
      <p className="text-sm leading-snug text-muted-foreground">{t("settings.ai.actionsDescription")}</p>
    </header>
    <Card>
      <CardContent className="flex flex-col gap-4 px-4 py-4 [&_[id$=-label]]:font-normal">
        {defaults ? <><section aria-label={t("settings.ai.defaults")} className="flex flex-col gap-4">
          {sectionHeader("default", "settings.ai.defaults")}
          {saveError === "default" ? <Alert variant="destructive"><AlertDescription>{t("settings.ai.sectionSaveError")}</AlertDescription></Alert> : null}
          <div className="ml-4">{defaults}</div>
        </section><Separator /></> : null}
        {loadError ? <Alert variant="destructive"><AlertDescription>{t("settings.prompts.loadError")}</AlertDescription></Alert> : null}
        {(["pullRequestReview", "taskCreation", "sprintSummary"] as const).map((action, index) => {
          const value = settings.find((item) => item.action === action);
          const fields = <div className="flex flex-wrap items-start gap-4">
            {renderModelSettings?.(action)}
            {renderActionOptions?.(action)}
            {action === "pullRequestReview" && value ? <div role="group" aria-labelledby="ai-review-fix-examples-label" className="grid w-fit gap-2.5">
              <Label id="ai-review-fix-examples-label">{t("settings.ai.reviewFixExamples")}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Select value={value.includeFixExamples ? "enabled" : "disabled"} disabled={saving || disabled} onValueChange={(mode) => { void toggleFixExamples(mode === "enabled"); }}>
                      <SelectTrigger id="ai-review-fix-examples" aria-labelledby="ai-review-fix-examples-label" className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">{t("settings.ai.reviewFixExamplesDisabled")}</SelectItem>
                        <SelectItem value="enabled">{t("settings.ai.reviewFixExamplesEnabled")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{t("settings.ai.reviewFixExamplesHelp")}</TooltipContent>
              </Tooltip>
            </div> : null}
            {renderInstructions(value)}
          </div>;
          return <Fragment key={action}>
            {index > 0 ? <Separator /> : null}
            <section className="flex flex-col gap-4" aria-label={t(actionLabels[action])}>
              {sectionHeader(action, actionLabels[action])}
              {saveError === action ? <Alert variant="destructive" role="alert"><AlertDescription>{t("settings.ai.sectionSaveError")}</AlertDescription></Alert> : null}
              <div className="ml-4">{renderActionLayout ? renderActionLayout(action, fields, renderInstructions(settings.find((item) => item.action === "reviewArbiter"))) : fields}</div>
            </section>
          </Fragment>;
        })}
        {extraAction ? <><Separator /><section id="ai-token-burner-action" className="flex flex-col gap-4" aria-label={t("settings.ai.tokenBurner")}>
          {sectionHeader("tokenBurner", "settings.ai.tokenBurner")}
          {saveError === "tokenBurner" ? <Alert variant="destructive"><AlertDescription>{t("settings.ai.sectionSaveError")}</AlertDescription></Alert> : null}
          <div className="ml-4">{extraAction}</div>
        </section></> : null}
      </CardContent>
    </Card>
    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
      <DialogContent className="max-w-5xl" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{editing ? t(actionLabels[editing.action]) : t("settings.ai.actionsTitle")}</DialogTitle>
          <DialogDescription>{t(viewing ? "settings.prompts.viewerDescription" : "settings.prompts.editorDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {saveError ? <Alert variant="destructive" role="alert" className="mb-4"><AlertDescription>{t("settings.prompts.saveError")}</AlertDescription></Alert> : null}
          <form autoComplete="off" id="ai-prompt-form" onSubmit={(event) => { event.preventDefault(); if (!invalid) applyInstructions(); }}>
            <FieldGroup>
              <div className={viewing ? "" : "grid items-start gap-6 lg:grid-cols-2"}>
                {!viewing ? <Field data-invalid={invalid} data-disabled={saving || disabled}>
                  <FieldLabel htmlFor="ai-prompt-instructions">{t("settings.prompts.instructions")}</FieldLabel>
                  <Textarea id="ai-prompt-instructions" className={instructionTextareaClassName} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving || disabled} aria-invalid={invalid} aria-describedby="ai-prompt-help" />
                  <p className="text-sm text-muted-foreground" id="ai-prompt-help">{t(invalid ? "settings.prompts.validation" : "settings.prompts.instructionsHelp")}</p>
                </Field> : null}
                <Field>
                  <FieldLabel htmlFor="ai-prompt-default">{t("settings.prompts.builtIn")}</FieldLabel>
                  <Textarea id="ai-prompt-default" className={instructionTextareaClassName} rows={1} value={editing?.defaultInstructions ?? ""} readOnly />
                  <p className="text-sm text-muted-foreground">{t("settings.prompts.builtInHelp")}</p>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="ai-prompt-rules">{t("settings.prompts.protectedRules")}</FieldLabel>
                <Textarea id="ai-prompt-rules" className={instructionTextareaClassName} rows={1} value={editing?.protectedRules ?? ""} readOnly />
                <p className="text-sm text-muted-foreground">{t("settings.prompts.protectedRulesHelp")}</p>
              </Field>
            </FieldGroup>
          </form>
        </DialogBody>
        <DialogFooter className="gap-2">
          {!viewing ? <Button type="button" variant="outline" disabled={saving || disabled || draft === editing?.defaultInstructions} onClick={() => { if (editing) { setDraft(editing.defaultInstructions); setSaveError(null); } }}><RotateCcw data-icon="inline-start" aria-hidden="true" />{t("settings.prompts.reset")}</Button> : null}
          <Button data-dialog-cancel={viewing ? undefined : true} type="button" variant="outline" disabled={saving || disabled} onClick={() => setEditing(null)}>{t(viewing ? "common.close" : "settings.common.cancel")}</Button>
          {!viewing ? <Button type="submit" form="ai-prompt-form" actionTone="edit" disabled={saving || disabled || invalid || draft === editing?.instructions}>{t("settings.prompts.apply")}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section></TooltipProvider>;
}
