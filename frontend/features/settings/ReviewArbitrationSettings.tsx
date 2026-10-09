import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import type { AiProvider, AiSettingsProfile, ReviewArbitrationSettings as Settings } from "@/shared/contracts/settings";
import { AiOverrideEditor } from "./AiOverrideEditor";

const modeOptionClassName = "pr-filter-mode-option review-mode-option relative border border-transparent data-[state=on]:z-10 data-[state=on]:rounded-b-none data-[state=on]:border-border data-[state=on]:border-b-transparent data-[state=on]:after:absolute data-[state=on]:after:inset-x-0 data-[state=on]:after:bottom-0 data-[state=on]:after:h-px data-[state=on]:after:bg-background data-[state=on]:after:content-['']";

export function ReviewArbitrationSettings({ settings, profile, providers, disabled, fieldErrors, onChange, onProfileChange, children, arbiterStatus, arbiterInstructions }: {
  children: ReactNode;
  arbiterStatus?: ReactNode;
  arbiterInstructions?: ReactNode;
  settings: Settings;
  profile: AiSettingsProfile | null | undefined;
  providers: AiProvider[];
  disabled: boolean;
  fieldErrors?: { provider?: string; model?: string };
  onChange: (settings: Settings) => void;
  onProfileChange: (profile: AiSettingsProfile | null) => void;
}) {
  const { t } = useI18n();
  return <div className="@container flex flex-col [&_[role=combobox]]:bg-card">
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
            {arbiterInstructions}
            <div className="grid gap-2.5">
              <Label id="ai-review-count-label">{t("settings.ai.reviewCount")}</Label>
              <Select value={String(settings.reviewCount)} disabled={disabled} onValueChange={(value) => onChange({ ...settings, reviewCount: Number(value) })}>
                <SelectTrigger id="ai-review-count" aria-labelledby="ai-review-count-label" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{[2, 3, 4, 5].map((count) => <SelectItem key={count} value={String(count)}>{count}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {arbiterStatus}
        </div>
      </section>
      <div className="ml-4"><Separator /></div>
      <section aria-labelledby="ai-reviewers-title" className="flex min-w-0 flex-col gap-4">
        <h4 id="ai-reviewers-title" className="text-sm font-medium">{t("settings.ai.independentReviewer")}</h4>
        <div className="ml-4">{children}</div>
      </section>
    </div>}
  </div>;
}
