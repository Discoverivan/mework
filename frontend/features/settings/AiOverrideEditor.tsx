import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FieldValidationHint } from "@/components/shared/FieldValidationHint";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import { AiProviderSelectContent } from "./AiProviderSelectContent";
import { AiAdvancedSettingsDialog, type AiAdvancedSettingsExtras } from "./AiAdvancedSettingsDialog";
import type { AiProvider, AiReasoning, AiSettingsProfile } from "@/shared/contracts/settings";

const AI_REASONING_OPTIONS: AiReasoning[] = ["minimal", "low", "medium", "high", "xhigh"];

function modelForAiProvider(provider: AiProvider | null | undefined, currentModel: string): string {
  if (!provider) return "";
  if (provider.models.includes(currentModel)) return currentModel;
  return provider.models.length === 1 ? provider.models[0] : "";
}

export function AiModeSelect({ id, fastMode, onChange, disabled, rows = false }: {
  id: string;
  fastMode: boolean;
  onChange: (fastMode: boolean) => void;
  disabled: boolean;
  rows?: boolean;
}) {
  const { t } = useI18n();
  return <div data-slot={rows ? undefined : "control-field"} className={rows ? "flex flex-wrap items-center justify-between gap-3" : "grid min-w-0 max-w-full gap-2.5"}>
    <Label id={`${id}-label`} alignment={rows ? "inline" : undefined}>{t("settings.ai.mode")}</Label>
    <Select value={fastMode ? "fast" : "normal"} onValueChange={(mode) => onChange(mode === "fast")} disabled={disabled}>
      <SelectTrigger id={id} data-menu-align={rows ? "end" : undefined} aria-labelledby={`${id}-label`} className="h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="normal">{t("settings.ai.modeNormal")}</SelectItem>
          <SelectItem value="fast">{t("settings.ai.modeFast")}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>;
}

export function AiOverrideEditor({
  idPrefix,
  profile,
  providers,
  inheritedLabel,
  providerLabel,
  modelLabel,
  reasoningLabel,
  noModelsLabel,
  unavailableLabel,
  onChange,
  disabled,
  fieldErrors,
  fieldWarnings,
  showAdvanced = true,
  children,
  rows = false,
  advancedExtras,
  providerHelp,
}: {
  idPrefix: string;
  profile: AiSettingsProfile | null | undefined;
  providers: AiProvider[];
  inheritedLabel: string;
  providerLabel: string;
  modelLabel: string;
  reasoningLabel: string;
  noModelsLabel: string;
  unavailableLabel: string;
  onChange: (profile: AiSettingsProfile | null) => void;
  disabled: boolean;
  fieldErrors?: Partial<Record<"provider" | "model", string>>;
  fieldWarnings?: Partial<Record<"provider" | "model", string>>;
  showAdvanced?: boolean;
  children?: ReactNode;
  rows?: boolean;
  advancedExtras?: AiAdvancedSettingsExtras;
  providerHelp?: ReactNode;
}) {
  const { t } = useI18n();
  const selected = providers.find((candidate) => candidate.id === profile?.provider
    && (candidate.id !== "openai-compatible" || (candidate.instanceId ?? "legacy") === (profile.providerInstanceId ?? "legacy")));
  const selectorValue = selected?.instanceId ?? profile?.provider ?? "__inherit__";
  const fieldClassName = rows ? "flex min-w-0 flex-wrap items-center justify-between gap-3" : "grid min-w-0 max-w-full gap-2.5";

  return (
    <div className={rows ? "space-y-4" : "flex min-w-0 flex-1 flex-wrap items-end gap-y-4"}>
      <div data-slot={rows ? undefined : "control-field"} className={fieldClassName}>
        {providerHelp ? <div className="flex items-center gap-1">
          <Label id={`${idPrefix}-provider-label`} alignment={rows ? "inline" : undefined}>{providerLabel}</Label>
          {providerHelp}
        </div> : <Label id={`${idPrefix}-provider-label`} alignment={rows ? "inline" : undefined}>{providerLabel}</Label>}
        <Select value={selectorValue} onValueChange={(value) => {
          if (value === "__inherit__") { onChange(null); return; }
          const candidate = providers.find((item) => (item.instanceId ?? item.id) === value);
          if (!candidate) return;
          const next: AiSettingsProfile = {
            provider: candidate.id,
            ...(candidate.instanceId ? { providerInstanceId: candidate.instanceId } : {}),
            model: modelForAiProvider(candidate, profile?.model ?? ""),
            reasoning: profile?.reasoning ?? "medium",
            fastMode: profile?.fastMode ?? false,
            execution: profile?.execution,
          };
          onChange(next);
        }} disabled={disabled}>
          <FieldValidationHint error={fieldErrors?.provider} warning={fieldWarnings?.provider}>
            <SelectTrigger id={`${idPrefix}-provider`} data-menu-align={rows ? "end" : undefined} aria-labelledby={`${idPrefix}-provider-label`} className="h-9"><SelectValue /></SelectTrigger>
          </FieldValidationHint>
          <AiProviderSelectContent providers={providers} fallbackValue="__inherit__" fallbackLabel={inheritedLabel} unavailableLabel={unavailableLabel} />
        </Select>
      </div>
      {profile && selected ? <>
        {rows ? <Separator /> : null}
        <div data-slot={rows ? undefined : "control-field"} className={fieldClassName}>
          <Label id={`${idPrefix}-model-label`} alignment={rows ? "inline" : undefined}>{modelLabel}</Label>
          <Select value={profile.model} onValueChange={(model) => onChange({ ...profile, model })} disabled={disabled || selected.models.length === 0}>
            <FieldValidationHint error={fieldErrors?.model} warning={fieldWarnings?.model}>
              <SelectTrigger id={`${idPrefix}-model`} data-menu-align={rows ? "end" : undefined} aria-labelledby={`${idPrefix}-model-label`} className="h-9"><SelectValue placeholder={selected.models.length === 0 ? noModelsLabel : t("settings.ai.selectModel")} /></SelectTrigger>
            </FieldValidationHint>
            <SelectContent>{selected.models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {profile.provider === "codex-cli" ? <>
          {rows ? <Separator /> : null}
          <div data-slot={rows ? undefined : "control-field"} className={fieldClassName}>
            <Label id={`${idPrefix}-reasoning-label`} alignment={rows ? "inline" : undefined}>{reasoningLabel}</Label>
            <Select value={profile.reasoning} onValueChange={(reasoning) => onChange({ ...profile, reasoning: reasoning as AiReasoning })} disabled={disabled}>
              <SelectTrigger id={`${idPrefix}-reasoning`} data-menu-align={rows ? "end" : undefined} aria-labelledby={`${idPrefix}-reasoning-label`} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{AI_REASONING_OPTIONS.map((reasoning) => <SelectItem key={reasoning} value={reasoning}>{reasoning}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {rows ? <Separator /> : null}
          <AiModeSelect id={`${idPrefix}-mode`} rows={rows} fastMode={profile.fastMode} onChange={(fastMode) => onChange({ ...profile, fastMode })} disabled={disabled} />
        </> : null}
      </> : null}
      {children}
      {showAdvanced ? <AiAdvancedSettingsDialog idPrefix={`${idPrefix}-advanced`} profile={profile} disabled={disabled} onChange={onChange} extras={advancedExtras}
        renderBasicSettings={(draft, change, help) => <AiOverrideEditor idPrefix={`${idPrefix}-advanced-basic`} profile={draft} providerHelp={help}
          providers={providers} inheritedLabel={inheritedLabel} providerLabel={providerLabel} modelLabel={modelLabel}
          reasoningLabel={reasoningLabel} noModelsLabel={noModelsLabel} unavailableLabel={unavailableLabel}
          onChange={change} disabled={disabled} showAdvanced={false} rows />} /> : null}
    </div>
  );
}
