import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { useI18n } from "@/i18n/context";
import { DEFAULT_AI_EXECUTION, type AiSettingsProfile } from "@/shared/contracts/settings";

const TIMEOUT_UNITS = { seconds: 1, minutes: 60, hours: 3600 } as const;
type TimeoutUnit = keyof typeof TIMEOUT_UNITS;

export function AiExecutionSettingsFields({ idPrefix, profile, disabled, onChange, inheritsDefaults = true, rows = false, onValidityChange }: {
  idPrefix: string;
  profile: AiSettingsProfile;
  disabled: boolean;
  onChange: (profile: AiSettingsProfile) => void;
  inheritsDefaults?: boolean;
  rows?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const { t } = useI18n();
  const [timeoutValid, setTimeoutValid] = useState(true);
  const [tokensValid, setTokensValid] = useState(true);
  const [timeoutUnit, setTimeoutUnit] = useState<TimeoutUnit>("minutes");
  const execution = profile.execution ?? DEFAULT_AI_EXECUTION;
  const secondsPerUnit = TIMEOUT_UNITS[timeoutUnit];
  const decimalScale = timeoutUnit === "seconds" ? 1 : 1_000_000;
  const supportsTokens = profile.provider === "open-code-cli" || profile.provider === "openai-compatible";
  const canSetTokens = supportsTokens || !inheritsDefaults;
  const tokensMode = execution.outputTokensMode === "unlimited" ? "unlimited"
    : execution.maxOutputTokens != null || execution.outputTokensMode === "limited" ? "limited" : "unlimited";
  const errors = { required: t("settings.ai.advanced.required"), number: t("settings.ai.advanced.integer"), range: t("settings.ai.advanced.tokenRange") };
  const valid = timeoutValid && (!canSetTokens || tokensMode !== "limited" || tokensValid);
  useEffect(() => { onValidityChange?.(valid); }, [onValidityChange, valid]);
  return <div data-slot="control-group" className={rows ? "space-y-4" : "contents"}>
    <div data-slot={rows ? undefined : "control-field"} className={rows ? "flex flex-wrap items-center justify-between gap-3" : "grid min-w-0 max-w-full gap-2.5"}>
      <div className="flex items-center gap-1">
        <Label id={`${idPrefix}-tokens-label`} alignment={rows ? "inline" : undefined} htmlFor={`${idPrefix}-tokens-mode`}>{t("settings.ai.advanced.tokens")}</Label>
        <InfoPopover label={t("settings.ai.advanced.tokensHelp")} title={t("settings.ai.advanced.tokens")}>
          <p>{t(inheritsDefaults ? "settings.ai.advanced.tokensModesDescription" : "settings.ai.advanced.tokensDefaultsDescription")}</p>
          <p>{t(!supportsTokens ? inheritsDefaults ? "settings.ai.advanced.tokensCli" : "settings.ai.advanced.tokensCliDefaults" : profile.provider === "open-code-cli" ? "settings.ai.advanced.tokensOpenCode" : "settings.ai.advanced.tokensApi")}</p>
          <p>{t("settings.ai.advanced.tokensDescription")}</p>
        </InfoPopover>
      </div>
      <div data-slot="control-group" data-menu-align={rows ? "end" : undefined} className="flex min-w-0 max-w-full flex-wrap items-center gap-y-1.5">
        <Select value={tokensMode} disabled={disabled} onValueChange={(mode: "unlimited" | "limited") => {
          setTokensValid(true);
          onChange({ ...profile, execution: { ...execution, outputTokensMode: mode, maxOutputTokens: mode === "limited" ? execution.maxOutputTokens ?? 30000 : null } });
        }}>
          <SelectTrigger id={`${idPrefix}-tokens-mode`} data-menu-align={rows ? "end" : undefined} aria-labelledby={`${idPrefix}-tokens-label`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unlimited">{t("settings.ai.advanced.tokensUnlimited")}</SelectItem>
            <SelectItem value="limited" disabled={!canSetTokens}>{t("settings.ai.advanced.tokensLimited")}</SelectItem>
          </SelectContent>
        </Select>
        {tokensMode === "limited" ? <>
        <Label id={`${idPrefix}-token-count-label`} htmlFor={`${idPrefix}-tokens`} className="sr-only">{t("settings.ai.advanced.tokenCount")}</Label>
        <ManualNumberField id={`${idPrefix}-tokens`} label={t("settings.ai.advanced.tokenCount")}
          labelledBy={`${idPrefix}-token-count-label`} value={execution.maxOutputTokens ?? 30000} min={1} max={256000}
          minVisibleDigits={6} disabled={disabled || !canSetTokens} errors={errors} onValidityChange={setTokensValid}
          onChange={(maxOutputTokens) => onChange({ ...profile, execution: { ...execution, maxOutputTokens } })} />
        </> : null}
      </div>
    </div>
    {rows ? <Separator /> : null}
    <div data-slot={rows ? undefined : "control-field"} className={rows ? "flex flex-wrap items-center justify-between gap-3" : "grid min-w-0 max-w-full gap-2.5"}>
      <div className="flex items-center gap-1">
        <Label id={`${idPrefix}-timeout-label`} htmlFor={`${idPrefix}-timeout`} alignment={rows ? "inline" : undefined}>{t("settings.ai.advanced.timeout")}</Label>
        <InfoPopover label={t("settings.ai.advanced.timeoutHelp")} title={t("settings.ai.advanced.timeout")}>
          <p>{t("settings.ai.advanced.timeoutDescription")}</p>
        </InfoPopover>
      </div>
      <div data-slot="control-group" data-menu-align={rows ? "end" : undefined} className="flex min-w-0 max-w-full flex-wrap items-center gap-y-1.5">
        <ManualNumberField key={timeoutUnit} id={`${idPrefix}-timeout`} label={t("settings.ai.advanced.timeout")}
        labelledBy={`${idPrefix}-timeout-label`}
        value={Number((execution.timeoutSeconds / secondsPerUnit).toFixed(6))}
        min={60 / secondsPerUnit * decimalScale} max={7200 / secondsPerUnit * decimalScale}
        scale={decimalScale} allowDecimals={timeoutUnit !== "seconds"} minVisibleDigits={3}
        disabled={disabled} errors={{ ...errors, number: t("forms.numberInvalid"), whole: t("settings.ai.advanced.timeoutPrecision"), range: t("settings.ai.advanced.timeoutRange") }}
        onValidityChange={setTimeoutValid}
        onChange={(value) => onChange({ ...profile, execution: { ...execution, timeoutSeconds: Math.round(value * secondsPerUnit) } })} />
        <Select value={timeoutUnit} disabled={disabled} onValueChange={(unit) => setTimeoutUnit(unit as TimeoutUnit)}>
          <SelectTrigger data-menu-align={rows ? "end" : undefined} className="w-fit" aria-label={t("settings.ai.advanced.timeoutUnit")}><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(TIMEOUT_UNITS) as TimeoutUnit[]).map((unit) =>
            <SelectItem key={unit} value={unit}>{t(`settings.ai.advanced.${unit}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  </div>;
}
