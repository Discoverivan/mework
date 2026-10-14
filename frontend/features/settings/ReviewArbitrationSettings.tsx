import type { AiAdvancedSettingsExtras } from "./AiAdvancedSettingsDialog";
import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { AiProvider, AiSettingsProfile, ReviewArbitrationSettings as Settings } from "@/shared/contracts/settings";
import { AiOverrideEditor } from "./AiOverrideEditor";

function AnimatedReviewSection({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return <div aria-hidden={!expanded} inert={!expanded} className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none", expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>;
}

export function ReviewModeControl({ settings, disabled, onChange }: {
  settings: Settings;
  disabled: boolean;
  onChange: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  return <Select
    value={settings.enabled ? "arbiter" : "single"} disabled={disabled}
    onValueChange={value => onChange({ ...settings, enabled: value === "arbiter" })}>
    <SelectTrigger aria-label={t("settings.ai.reviewMode")} title={t(settings.enabled ? "settings.ai.reviewModeArbiterHelp" : "settings.ai.reviewModeSingleHelp")} className="h-9">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="single">{t("settings.ai.reviewModeSingle")}</SelectItem>
      <SelectItem value="arbiter">{t("settings.ai.reviewModeArbiter")}</SelectItem>
    </SelectContent>
  </Select>;
}

export function ReviewArbitrationSettings({ settings, profile, providers, disabled, fieldErrors, fieldWarnings, onChange, onProfileChange, onReviewCountValidityChange, reviewCountReset, children, arbiterStatus, arbiterAdvanced }: {
  children: ReactNode;
  arbiterStatus?: ReactNode;
  arbiterAdvanced?: AiAdvancedSettingsExtras;
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
    <div>
      <AnimatedReviewSection expanded={settings.enabled}>
      <div className="space-y-4 pb-2">
      <section aria-labelledby="ai-review-arbiter-title" className="flex min-w-0 flex-col gap-3">
        <h4 id="ai-review-arbiter-title" className="text-sm font-medium">{t("settings.ai.reviewArbiter")}</h4>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <AiOverrideEditor idPrefix="ai-review-arbiter" profile={profile} providers={providers}
              inheritedLabel={t("settings.ai.inheritDefault")}
              providerLabel={t("settings.ai.provider")} modelLabel={t("settings.ai.arbiterModel")}
              reasoningLabel={t("settings.ai.reasoning")} noModelsLabel={t("settings.ai.noModels")}
              unavailableLabel={t("settings.ai.unavailableSuffix")} disabled={disabled} fieldErrors={fieldErrors} fieldWarnings={fieldWarnings} onChange={onProfileChange} advancedExtras={arbiterAdvanced} />
          </div>
          {arbiterAdvanced?.inline}
          {arbiterStatus}
        </div>
      </section>
      <Separator />
      </div>
      </AnimatedReviewSection>
      <section aria-labelledby={settings.enabled ? "ai-reviewers-title" : undefined} className="flex min-w-0 flex-col">
      <AnimatedReviewSection expanded={settings.enabled}>
        <div className="flex flex-wrap items-center gap-3 pb-3 [&_input]:text-center">
          <h4 id="ai-reviewers-title" className="text-sm font-medium">{t("settings.ai.independentReviewers")}</h4>
          <span id="ai-review-count-label" className="sr-only">{t("settings.ai.reviewCount")}</span>
          <ManualNumberField key={reviewCountReset} id="ai-review-count" label={t("settings.ai.reviewCount")} labelledBy="ai-review-count-label"
            value={settings.reviewCount} min={2} max={9} minVisibleDigits={1} size="compact" disabled={disabled}
            errors={{ required: t("settings.ai.reviewCountRequired"), number: t("settings.ai.reviewCountInteger"), range: t("settings.ai.reviewCountRange") }}
            onChange={(reviewCount) => onChange({ ...settings, reviewCount })} onValidityChange={onReviewCountValidityChange} />
        </div>
      </AnimatedReviewSection>
        {children}
      </section>
    </div>
  </div>;
}
