import { useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { useI18n } from "@/i18n/context";
import { DEFAULT_AI_EXECUTION, type AiSettingsProfile } from "@/shared/contracts/settings";

import { AiExecutionSettingsFields } from "./AiExecutionSettingsFields";

export interface AiAdvancedSettingsExtras {
  changeKey?: string;
  render: (profile: AiSettingsProfile | null) => ReactNode;
  afterModelSettings?: ReactNode;
  inline?: ReactNode;
  onBeginEdit?: () => void;
  onCancelEdit?: () => void;
  onApply?: () => void;
}

function profileChangeKey(profile: AiSettingsProfile | null | undefined): string {
  if (!profile) return "null";
  const execution = profile.execution ?? DEFAULT_AI_EXECUTION;
  const mode = execution.outputTokensMode === "unlimited" ? "unlimited"
    : execution.maxOutputTokens != null || execution.outputTokensMode === "limited" ? "limited" : "unlimited";
  return JSON.stringify({
    provider: profile.provider, providerInstanceId: profile.providerInstanceId ?? null,
    model: profile.model, reasoning: profile.reasoning, fastMode: profile.fastMode,
    timeoutSeconds: execution.timeoutSeconds,
    outputTokensMode: mode, maxOutputTokens: mode === "limited" ? execution.maxOutputTokens ?? 30000 : null,
  });
}

export function AiAdvancedSettingsDialog({ idPrefix, profile, disabled, onChange, renderBasicSettings, inheritsDefaults = true, extras }: {
  idPrefix: string;
  profile: AiSettingsProfile | null | undefined;
  disabled: boolean;
  inheritsDefaults?: boolean;
  extras?: AiAdvancedSettingsExtras;
  onChange: (profile: AiSettingsProfile | null) => void;
  renderBasicSettings: (profile: AiSettingsProfile | null, onChange: (profile: AiSettingsProfile | null) => void, providerHelp: ReactNode) => ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AiSettingsProfile | null>(null);
  const [initial, setInitial] = useState({ profile: "null", extras: "" });
  const [executionValid, setExecutionValid] = useState(true);
  const execution = draft?.execution ?? DEFAULT_AI_EXECUTION;
  const tokensMode = execution.outputTokensMode === "unlimited" ? "unlimited"
    : execution.maxOutputTokens != null || execution.outputTokensMode === "limited" ? "limited" : "unlimited";
  const changed = profileChangeKey(draft) !== initial.profile || (extras?.changeKey ?? "") !== initial.extras;

  return <Dialog open={open} onOpenChange={(nextOpen) => {
    if (nextOpen) {
      setInitial({ profile: profileChangeKey(profile), extras: extras?.changeKey ?? "" });
      extras?.onBeginEdit?.();
      setDraft(profile ? structuredClone(profile) : null);
      setExecutionValid(true);
    } else extras?.onCancelEdit?.();
    setOpen(nextOpen);
  }}>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="icon" className="ml-auto" disabled={disabled}
        aria-label={t("settings.ai.advanced.title")} title={t("settings.ai.advanced.title")}>
        <Ellipsis aria-hidden="true" />
      </Button>
    </DialogTrigger>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t("settings.ai.advanced.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("settings.ai.advanced.description")}</DialogDescription>
      </DialogHeader>
      <DialogBody layout="sections">
        <Card data-info-popover-boundary>
          <CardHeader variant="section" className="flex-row items-center justify-between gap-2 space-y-0 py-2">
            <CardTitle className="text-sm font-semibold leading-tight">{t("settings.ai.advanced.parameters")}</CardTitle>
            <InfoPopover label={t("settings.ai.advanced.help")} title={t("settings.ai.advanced.title")}>
              <p>{t("settings.ai.advanced.description")}</p>
            </InfoPopover>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {renderBasicSettings(draft, setDraft, !draft ? <InfoPopover label={t("settings.ai.advanced.providerHelp")} title={t("settings.ai.provider")}>
              <p>{t(inheritsDefaults ? "settings.ai.advanced.inherited" : "settings.ai.advanced.selectProvider")}</p>
            </InfoPopover> : null)}
            {extras?.afterModelSettings}
            {draft ? <>
              <Separator />
              <AiExecutionSettingsFields idPrefix={idPrefix} profile={draft} disabled={disabled} onChange={setDraft}
                inheritsDefaults={inheritsDefaults} rows onValidityChange={setExecutionValid} />
            </> : null}
            {extras?.render(draft)}
          </CardContent>
        </Card>
      </DialogBody>
      <DialogFooter>
        <Button data-dialog-cancel type="button" variant="outline" onClick={() => { extras?.onCancelEdit?.(); setOpen(false); }}>{t("settings.common.cancel")}</Button>
        <Button type="button" actionTone="success" disabled={disabled || !changed || (draft != null && !executionValid)}
          onClick={() => {
            onChange(draft ? { ...draft, execution: { ...execution, outputTokensMode: tokensMode, maxOutputTokens: tokensMode === "limited" ? execution.maxOutputTokens ?? 30000 : null } } : null);
            extras?.onApply?.();
            setOpen(false);
          }}>{t("settings.ai.advanced.apply")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
