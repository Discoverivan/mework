import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { AiProvider, AiSettingsProfile, ReviewArbitrationSettings as Settings } from "@/shared/contracts/settings";
import { AiOverrideEditor } from "./AiOverrideEditor";

const reviewModeOptionClassName = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "review-mode-option relative h-[30px] bg-background px-[14px] text-muted-foreground transition-none hover:bg-background hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground/80",
);

export function ReviewModeControl({ settings, disabled, onChange }: {
  settings: Settings;
  disabled: boolean;
  onChange: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  const singleLabel = t("settings.ai.reviewModeSingle");
  const arbiterLabel = t("settings.ai.reviewModeArbiter");
  return <ToggleGroup type="single" size="sm" role="radiogroup" aria-label={t("settings.ai.reviewMode")}
    value={settings.enabled ? "arbiter" : "single"} disabled={disabled}
    onValueChange={() => onChange({ ...settings, enabled: !settings.enabled })}
    className="w-fit gap-0">
    <ToggleGroupItem value="single" title={t("settings.ai.reviewModeSingleHelp")}
      className={cn(reviewModeOptionClassName, "rounded-r-none")}>
      {singleLabel}
    </ToggleGroupItem>
    <ToggleGroupItem value="arbiter" title={t("settings.ai.reviewModeArbiterHelp")}
      className={cn(reviewModeOptionClassName, "-ml-px rounded-l-none")}>
      {arbiterLabel}
    </ToggleGroupItem>
  </ToggleGroup>;
}

export function ReviewArbitrationSettings({ settings, profile, providers, disabled, fieldErrors, fieldWarnings, onChange, onProfileChange, onReviewCountValidityChange, reviewCountReset, children, arbiterStatus, arbiterInstructions, arbiterRetries }: {
  children: ReactNode;
  arbiterStatus?: ReactNode;
  arbiterInstructions?: ReactNode;
  arbiterRetries?: ReactNode;
  settings: Settings;
  profile: AiSettingsProfile | null | undefined;
  providers: AiProvider[];
  disabled: boolean;
  fieldErrors?: { provider?: string; model?: string };
  fieldWarnings?: { provider?: string; model?: string };
  onChange: (settings: Settings) => void;
  onProfileChange: (profile: AiSettingsProfile | null) => void;
  onReviewCountValidityChange: (valid: boolean) => void;
  reviewCountReset: number;
}) {
  const { t } = useI18n();
  return <div className="@container flex flex-col gap-3">
    {!settings.enabled ? children : <div className="flex flex-col gap-4">
      <section aria-labelledby="ai-review-arbiter-title" className="flex min-w-0 flex-col gap-3">
        <h4 id="ai-review-arbiter-title" className="text-sm font-medium">{t("settings.ai.reviewArbiter")}</h4>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <AiOverrideEditor idPrefix="ai-review-arbiter" profile={profile} providers={providers}
              inheritedLabel={t("settings.ai.inheritDefault")}
              providerLabel={t("settings.ai.provider")} modelLabel={t("settings.ai.arbiterModel")}
              reasoningLabel={t("settings.ai.reasoning")} noModelsLabel={t("settings.ai.noModels")}
              unavailableLabel={t("settings.ai.unavailableSuffix")} disabled={disabled} fieldErrors={fieldErrors} fieldWarnings={fieldWarnings} onChange={onProfileChange} />
            {profile ? arbiterRetries : null}
            {arbiterInstructions}
          </div>
          {arbiterStatus}
        </div>
      </section>
      <Separator />
      <section aria-labelledby="ai-reviewers-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 [&_input]:h-6 [&_input]:w-6 [&_input]:min-w-0 [&_input]:p-0.5 [&_input]:text-center [&_input]:leading-none">
          <h4 id="ai-reviewers-title" className="text-sm font-medium">{t("settings.ai.independentReviewers")}</h4>
          <span id="ai-review-count-label" className="sr-only">{t("settings.ai.reviewCount")}</span>
          <ManualNumberField key={reviewCountReset} id="ai-review-count" label={t("settings.ai.reviewCount")} labelledBy="ai-review-count-label"
            value={settings.reviewCount} min={2} max={9} disabled={disabled}
            errors={{ required: t("settings.ai.reviewCountRequired"), number: t("settings.ai.reviewCountInteger"), range: t("settings.ai.reviewCountRange") }}
            onChange={(reviewCount) => onChange({ ...settings, reviewCount })} onValidityChange={onReviewCountValidityChange} />
        </div>
        {children}
      </section>
    </div>}
  </div>;
}
