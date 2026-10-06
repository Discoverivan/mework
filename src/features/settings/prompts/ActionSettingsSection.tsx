import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Eye, Pencil, RotateCcw } from "lucide-react";
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
import type { PromptAction, PromptSettings } from "@/shared/contracts/settings";
import { getCachedPromptSettings, getPromptSettings, savePromptSettings } from "./api";

const actionLabels: Record<PromptAction, TranslationKey> = {
  pullRequestReview: "settings.ai.pullRequestReview",
  taskCreation: "settings.ai.taskCreation",
  sprintSummary: "settings.ai.sprintSummary",
};

const instructionTextareaClassName = "min-h-0 resize-none [field-sizing:content] focus-visible:ring-inset focus-visible:ring-offset-0";

export function ActionSettingsSection({ defaults, renderModelSettings, renderActionOptions, extraAction, onSaved, onSavingChange, onLoadingChange }: {
  onLoadingChange?: (loading: boolean) => void;
  onSaved?: () => void;
  onSavingChange?: (saving: boolean) => void;
  defaults?: ReactNode;
  renderActionOptions?: (action: PromptAction) => ReactNode;
  renderModelSettings?: (action: PromptAction) => ReactNode;
  extraAction?: ReactNode;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PromptSettings[]>(() => getCachedPromptSettings() ?? []);
  const [editing, setEditing] = useState<PromptSettings | null>(null);
  const [viewing, setViewing] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(() => !getCachedPromptSettings());
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let active = true;
    void getPromptSettings().then((values) => {
      if (active) { setSettings(values); setLoadError(false); }
    }).catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    const unsubscribe = subscribeAppEvent(APP_EVENT.aiPromptSettingsChanged, (value) => {
      if (active) setSettings((values) => values.map((item) => item.action === value.action ? value : item));
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
    setSaveError(false);
  }

  async function restoreBuiltIn(value: PromptSettings) {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const restored = await savePromptSettings(value.action, null);
      setSettings((values) => values.map((item) => item.action === restored.action ? restored : item));
      onSaved?.();
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  }

  async function save() {
    if (!editing || viewing || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const value = await savePromptSettings(editing.action, draft.trim() === editing.defaultInstructions ? null : draft);
      setSettings((values) => values.map((item) => item.action === value.action ? value : item));
      setEditing(null);
      onSaved?.();
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  }

  const invalid = !draft.trim() || [...draft].length > 20_000;
  return <TooltipProvider delayDuration={300}><section aria-labelledby="ai-actions-title" className="flex flex-col gap-4">
    <header className="flex flex-col gap-1">
      <h2 id="ai-actions-title" className="text-lg font-semibold leading-tight">{t("settings.ai.actionsTitle")}</h2>
      <p className="text-sm leading-snug text-muted-foreground">{t("settings.ai.actionsDescription")}</p>
    </header>
    <Card>
      <CardContent className="flex flex-col gap-4 px-4 py-4">
        {defaults ? <>{defaults}<Separator /></> : null}
        {loadError ? <Alert variant="destructive"><AlertDescription>{t("settings.prompts.loadError")}</AlertDescription></Alert> : null}
        {saveError && !editing ? <Alert variant="destructive" role="alert"><AlertDescription>{t("settings.prompts.saveError")}</AlertDescription></Alert> : null}
        {(Object.keys(actionLabels) as PromptAction[]).map((action, index) => {
          const value = settings.find((item) => item.action === action);
          return <Fragment key={action}>
            {index > 0 ? <Separator /> : null}
            <section className="flex flex-col gap-4" aria-label={t(actionLabels[action])}>
              <h3 className="text-base font-medium">{t(actionLabels[action])}</h3>
              <div className="flex flex-wrap items-start gap-4">
                {renderModelSettings?.(action)}
                {renderActionOptions?.(action)}
                {value ? <div role="group" aria-labelledby={`ai-prompt-mode-${action}-label`} className="grid w-fit gap-2.5">
                  <Label className="translate-x-1" id={`ai-prompt-mode-${action}-label`}>{t("settings.ai.instructions")}</Label>
                  <div className="flex items-center gap-1">
                    <Select value={value.customized ? "custom" : "builtIn"} disabled={saving} onValueChange={(mode) => {
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
                        <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 [&_svg]:!size-[15px]" disabled={saving} onClick={() => openInstructions(value, !value.customized)} aria-label={t(value.customized ? "settings.prompts.edit" : "settings.prompts.view", { action: t(actionLabels[value.action]) })}>
                          {value.customized ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t(value.customized ? "settings.prompts.editHint" : "settings.prompts.viewHint")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div> : null}
              </div>
            </section>
          </Fragment>;
        })}
        {extraAction ? <><Separator />{extraAction}</> : null}
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
          <form autoComplete="off" id="ai-prompt-form" onSubmit={(event) => { event.preventDefault(); if (!invalid) void save(); }}>
            <FieldGroup>
              <div className={viewing ? "" : "grid items-start gap-6 lg:grid-cols-2"}>
                {!viewing ? <Field data-invalid={invalid} data-disabled={saving}>
                  <FieldLabel className="pl-1" htmlFor="ai-prompt-instructions">{t("settings.prompts.instructions")}</FieldLabel>
                  <Textarea id="ai-prompt-instructions" className={instructionTextareaClassName} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving} aria-invalid={invalid} aria-describedby="ai-prompt-help" />
                  <p className="text-sm text-muted-foreground" id="ai-prompt-help">{t(invalid ? "settings.prompts.validation" : "settings.prompts.instructionsHelp")}</p>
                </Field> : null}
                <Field>
                  <FieldLabel className="pl-1" htmlFor="ai-prompt-default">{t("settings.prompts.builtIn")}</FieldLabel>
                  <Textarea id="ai-prompt-default" className={instructionTextareaClassName} rows={1} value={editing?.defaultInstructions ?? ""} readOnly />
                  <p className="text-sm text-muted-foreground">{t("settings.prompts.builtInHelp")}</p>
                </Field>
              </div>
              <Field>
                <FieldLabel className="pl-1" htmlFor="ai-prompt-rules">{t("settings.prompts.protectedRules")}</FieldLabel>
                <Textarea id="ai-prompt-rules" className={instructionTextareaClassName} rows={1} value={editing?.protectedRules ?? ""} readOnly />
                <p className="text-sm text-muted-foreground">{t("settings.prompts.protectedRulesHelp")}</p>
              </Field>
            </FieldGroup>
          </form>
        </DialogBody>
        <DialogFooter className="gap-2">
          {!viewing ? <Button type="button" variant="outline" disabled={saving || draft === editing?.defaultInstructions} onClick={() => { if (editing) { setDraft(editing.defaultInstructions); setSaveError(false); } }}><RotateCcw data-icon="inline-start" aria-hidden="true" />{t("settings.prompts.reset")}</Button> : null}
          <Button data-dialog-cancel={viewing ? undefined : true} type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>{t(viewing ? "common.close" : "settings.common.cancel")}</Button>
          {!viewing ? <Button type="submit" form="ai-prompt-form" actionTone="edit" disabled={saving || invalid || draft === editing?.instructions}>{t(saving ? "settings.prompts.saving" : "settings.prompts.save")}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section></TooltipProvider>;
}
