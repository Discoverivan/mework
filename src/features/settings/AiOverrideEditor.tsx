import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import type { AiProvider, AiReasoning, AiSettingsProfile } from "@/shared/contracts/settings";

const AI_REASONING_OPTIONS: AiReasoning[] = ["minimal", "low", "medium", "high", "xhigh"];

function modelForAiProvider(provider: AiProvider | null | undefined, currentModel: string): string {
  if (!provider) return "";
  if (provider.models.includes(currentModel)) return currentModel;
  return provider.models.length === 1 ? provider.models[0] : "";
}

export function AiModeSelect({ id, fastMode, onChange, disabled }: {
  id: string;
  fastMode: boolean;
  onChange: (fastMode: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return <div className="grid min-w-0 max-w-full gap-2.5">
    <Label className="translate-x-1" id={`${id}-label`}>{t("settings.ai.mode")}</Label>
    <Select value={fastMode ? "fast" : "normal"} onValueChange={(mode) => onChange(mode === "fast")} disabled={disabled}>
      <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="h-9"><SelectValue /></SelectTrigger>
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
}) {
  const selected = providers.find((candidate) => candidate.id === profile?.provider
    && (candidate.id !== "openai-compatible" || (candidate.instanceId ?? "legacy") === (profile.providerInstanceId ?? "legacy")));
  const selectorValue = selected?.instanceId ?? profile?.provider ?? "__inherit__";

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="grid min-w-0 max-w-full gap-2.5">
        <Label className="translate-x-1" id={`${idPrefix}-provider-label`}>{providerLabel}</Label>
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
          };
          onChange(next);
        }} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-provider`} aria-labelledby={`${idPrefix}-provider-label`} className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">{inheritedLabel}</SelectItem>
            {providers.map((candidate) => (
              <SelectItem key={candidate.instanceId ?? candidate.id} value={candidate.instanceId ?? candidate.id} disabled={!candidate.available}>
                {candidate.name}{candidate.name === "OpenAI-compatible API" && candidate.baseUrl ? ` · ${candidate.baseUrl}` : ""}{candidate.available ? "" : ` (${unavailableLabel})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {profile && selected ? <>
        <div className="grid min-w-0 max-w-full gap-2.5">
          <Label className="translate-x-1" id={`${idPrefix}-model-label`}>{modelLabel}</Label>
          <Select value={profile.model} onValueChange={(model) => onChange({ ...profile, model })} disabled={disabled || selected.models.length === 0}>
            <SelectTrigger id={`${idPrefix}-model`} aria-labelledby={`${idPrefix}-model-label`} className="h-9"><SelectValue placeholder={noModelsLabel} /></SelectTrigger>
            <SelectContent>{selected.models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {profile.provider === "codex-cli" ? <>
          <div className="grid min-w-0 max-w-full gap-2.5">
            <Label className="translate-x-1" id={`${idPrefix}-reasoning-label`}>{reasoningLabel}</Label>
            <Select value={profile.reasoning} onValueChange={(reasoning) => onChange({ ...profile, reasoning: reasoning as AiReasoning })} disabled={disabled}>
              <SelectTrigger id={`${idPrefix}-reasoning`} aria-labelledby={`${idPrefix}-reasoning-label`} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{AI_REASONING_OPTIONS.map((reasoning) => <SelectItem key={reasoning} value={reasoning}>{reasoning}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <AiModeSelect id={`${idPrefix}-mode`} fastMode={profile.fastMode} onChange={(fastMode) => onChange({ ...profile, fastMode })} disabled={disabled} />
        </> : null}
      </> : null}
    </div>
  );
}
