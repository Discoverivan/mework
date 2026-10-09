import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { AiProvider, AiSettingsProfile, ReviewArbitrationSettings as Settings } from "@/shared/contracts/settings";
import { AiOverrideEditor } from "./AiOverrideEditor";

const reviewModeOptionClassName = "review-mode-option relative z-10 h-[30px] whitespace-nowrap rounded-none bg-transparent px-[14px] text-muted-foreground transition-colors duration-150 hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-transparent data-[state=on]:hover:text-primary-foreground focus-visible:ring-inset focus-visible:ring-offset-0 disabled:opacity-100 motion-reduce:transition-none";

export function ReviewModeControl({ settings, disabled, onChange }: {
  settings: Settings;
  disabled: boolean;
  onChange: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  const singleLabel = t("settings.ai.reviewModeSingle");
  const arbiterLabel = t("settings.ai.reviewModeArbiter");
  const singleRef = useRef<HTMLButtonElement>(null);
  const arbiterRef = useRef<HTMLButtonElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [hovered, setHovered] = useState<{ mode: "single" | "arbiter"; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const selected = settings.enabled ? arbiterRef.current : singleRef.current;
      if (!selected) return;
      const next = { left: selected.offsetLeft, width: selected.offsetWidth };
      setIndicator((previous) => previous.left === next.left && previous.width === next.width ? previous : next);
      setHovered((previous) => {
        if (!previous) return previous;
        const target = previous.mode === "arbiter" ? arbiterRef.current : singleRef.current;
        if (!target || (previous.left === target.offsetLeft && previous.width === target.offsetWidth)) return previous;
        return { ...previous, left: target.offsetLeft, width: target.offsetWidth };
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (singleRef.current) observer.observe(singleRef.current);
    if (arbiterRef.current) observer.observe(arbiterRef.current);
    return () => observer.disconnect();
  }, [settings.enabled, singleLabel, arbiterLabel]);

  const hoverBorderColor = hovered?.mode === (settings.enabled ? "arbiter" : "single")
    ? "var(--review-active-border)"
    : "var(--primary)";

  return <ToggleGroup type="single" size="sm" role="radiogroup" aria-label={t("settings.ai.reviewMode")}
    value={settings.enabled ? "arbiter" : "single"} disabled={disabled}
    onValueChange={(mode) => { if (mode === "single" || mode === "arbiter") onChange({ ...settings, enabled: mode === "arbiter" }); }}
    onPointerLeave={() => setHovered(null)}
    className={cn("relative isolate flex w-fit gap-0 rounded-full border border-input bg-input/50 [--review-active-border:var(--foreground)] dark:[--review-active-border:color-mix(in_srgb,var(--foreground)_65%,var(--primary))]", disabled && "opacity-50")}>
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <span aria-hidden="true" hidden={indicator.width === 0}
        className="pointer-events-none absolute inset-y-0 -left-3 transition-[transform,width] duration-150 ease-out motion-reduce:transition-none"
        style={{
          width: `calc(${indicator.width}px + 1.5rem)`,
          transform: `translateX(${indicator.left}px)`,
          backgroundImage: `linear-gradient(to ${settings.enabled ? "left" : "right"}, var(--primary), var(--primary) calc(100% - 1.5rem), transparent)`,
        }} />
    </span>
    <span aria-hidden="true"
      className={cn("pointer-events-none absolute -inset-px z-20 rounded-[inherit] p-px transition-opacity duration-150 motion-reduce:transition-none", hovered && !disabled ? "opacity-100" : "opacity-0")}
      style={{
        backgroundImage: hovered?.mode === "arbiter"
          ? `linear-gradient(to right, transparent calc(${hovered.left + 1}px - 0.75rem), ${hoverBorderColor} calc(${hovered.left + 1}px + 0.75rem))`
          : `linear-gradient(to right, ${hoverBorderColor} calc(${(hovered?.left ?? 0) + (hovered?.width ?? 0) + 1}px - 0.75rem), transparent calc(${(hovered?.left ?? 0) + (hovered?.width ?? 0) + 1}px + 0.75rem))`,
        mask: "linear-gradient(black, black) content-box, linear-gradient(black, black)",
        maskComposite: "exclude",
      }} />
    <ToggleGroupItem ref={singleRef} onPointerEnter={(event) => setHovered({ mode: "single", left: event.currentTarget.offsetLeft, width: event.currentTarget.offsetWidth })} value="single" title={t("settings.ai.reviewModeSingleHelp")} className={reviewModeOptionClassName}>
      {singleLabel}
    </ToggleGroupItem>
    <ToggleGroupItem ref={arbiterRef} onPointerEnter={(event) => setHovered({ mode: "arbiter", left: event.currentTarget.offsetLeft, width: event.currentTarget.offsetWidth })} value="arbiter" title={t("settings.ai.reviewModeArbiterHelp")} className={reviewModeOptionClassName}>
      {arbiterLabel}
    </ToggleGroupItem>
  </ToggleGroup>;
}

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
  return <div className="@container flex flex-col gap-6">
    {!settings.enabled ? children : <div className="flex flex-col gap-6">
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
