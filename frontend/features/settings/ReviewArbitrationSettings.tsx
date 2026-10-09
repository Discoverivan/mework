import type { ReactNode } from "react";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import type { AiProvider, AiSettingsProfile, ReviewArbitrationSettings as Settings } from "@/shared/contracts/settings";
import { AiOverrideEditor } from "./AiOverrideEditor";

const modeOptionClassName = "pr-filter-mode-option review-mode-option relative border border-transparent data-[state=on]:z-10 data-[state=on]:rounded-b-none data-[state=on]:border-border data-[state=on]:border-b-transparent data-[state=on]:after:absolute data-[state=on]:after:inset-x-0 data-[state=on]:after:bottom-0 data-[state=on]:after:h-px data-[state=on]:after:bg-background data-[state=on]:after:content-['']";

export function ReviewArbitrationSettings({ settings, profile, providers, disabled, fieldErrors, onChange, onProfileChange, onReviewCountValidityChange, reviewCountReset, children, arbiterStatus, arbiterInstructions, arbiterRetries }: {
  children: ReactNode;
  arbiterStatus?: ReactNode;
  arbiterInstructions?: ReactNode;
  arbiterRetries?: ReactNode;
  settings: Settings;
  profile: AiSettingsProfile | null | undefined;
  providers: AiProvider[];
  disabled: boolean;
  fieldErrors?: { provider?: string; model?: string };
  onChange: (settings: Settings) => void;
  onProfileChange: (profile: AiSettingsProfile | null) => void;
  onReviewCountValidityChange: (valid: boolean) => void;
  reviewCountReset: number;
}) {
  const { t } = useI18n();
  return <div className="@container flex flex-col [&_[role=combobox]]:bg-card [&_input]:bg-card">
    <div className="w-full">
      <ToggleGroup type="single" size="sm" role="radiogroup" aria-label={t("settings.ai.reviewMode")}
        value={settings.enabled ? "arbiter" : "single"} disabled={disabled}
        onValueChange={(mode) => { if (mode === "single" || mode === "arbiter") onChange({ ...settings, enabled: mode === "arbiter" }); }}
        className="pr-filter-mode -mb-px flex w-full items-end justify-evenly gap-0">
        <ToggleGroupItem value="single" title={t("settings.ai.reviewModeSingleHelp")} className={modeOptionClassName}>
          {t("settings.ai.reviewModeSingle")}
        </ToggleGroupItem>
        <ToggleGroupItem value="arbiter" title={t("settings.ai.reviewModeArbiterHelp")} className={modeOptionClassName}>
          {t("settings.ai.reviewModeArbiter")}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
    {!settings.enabled ? <section aria-labelledby="ai-reviewer-title" className="flex flex-col gap-4 rounded-md border border-border bg-background p-4">
      <h4 id="ai-reviewer-title" className="text-sm font-medium">{t("settings.ai.reviewer")}</h4>
      <div className="ml-4">{children}</div>
    </section> : <div className="flex flex-col gap-4 rounded-md border border-border bg-background p-4">
      <section aria-labelledby="ai-review-arbiter-title" className="flex min-w-0 flex-col gap-4">
        <h4 id="ai-review-arbiter-title" className="text-sm font-medium">{t("settings.ai.reviewArbiter")}</h4>
        <div className="ml-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <AiOverrideEditor idPrefix="ai-review-arbiter" profile={profile} providers={providers}
              inheritedLabel={t("settings.ai.inheritDefault")}
              providerLabel={t("settings.ai.provider")} modelLabel={t("settings.ai.arbiterModel")}
              reasoningLabel={t("settings.ai.reasoning")} noModelsLabel={t("settings.ai.noModels", { provider: t("settings.ai.selectedProvider") })}
              unavailableLabel={t("settings.ai.unavailableSuffix")} disabled={disabled} fieldErrors={fieldErrors} onChange={onProfileChange} />
            {profile ? arbiterRetries : null}
            {arbiterInstructions}
          </div>
          {arbiterStatus}
        </div>
      </section>
      <div className="ml-4"><Separator /></div>
      <section aria-labelledby="ai-reviewers-title" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 [&_input]:h-6 [&_input]:w-6 [&_input]:min-w-0 [&_input]:p-0.5 [&_input]:text-center [&_input]:leading-none">
          <h4 id="ai-reviewers-title" className="text-sm font-medium">{t("settings.ai.independentReviewers")}</h4>
          <span id="ai-review-count-label" className="sr-only">{t("settings.ai.reviewCount")}</span>
          <ManualNumberField key={reviewCountReset} id="ai-review-count" label={t("settings.ai.reviewCount")} labelledBy="ai-review-count-label"
            value={settings.reviewCount} min={2} max={9} disabled={disabled}
            errors={{ required: t("settings.ai.reviewCountRequired"), number: t("settings.ai.reviewCountInteger"), range: t("settings.ai.reviewCountRange") }}
            onChange={(reviewCount) => onChange({ ...settings, reviewCount })} onValidityChange={onReviewCountValidityChange} />
        </div>
        <div className="ml-4">{children}</div>
      </section>
    </div>}
  </div>;
}
