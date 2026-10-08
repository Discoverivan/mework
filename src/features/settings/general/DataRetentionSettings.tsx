import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { StatusToast } from "@/components/shared/StatusToast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/i18n/context";
import type { DataRetentionSettings as Settings, LogSizeUnit, RetentionMode, RetentionUnit } from "@/shared/contracts/data-retention";
import { SettingsReveal } from "./SettingsReveal";

const FIELDS = ["reviewHistory", "syncHistory", "removedTasks", "diagnosticLogs"] as const;
const UNITS: RetentionUnit[] = ["minutes", "hours", "days", "months"];
const MAXIMUM: Record<RetentionUnit, number> = { minutes: 5_256_000, hours: 87_600, days: 3650, months: 120 };
const MODES: RetentionMode[] = ["period", "indefinite", "disabled"];
const SIZE_UNITS: LogSizeUnit[] = ["kib", "mib", "gib"];
const MAX_LOG_SIZE: Record<LogSizeUnit, number> = { kib: 1_073_741_824, mib: 1_048_576, gib: 1024 };

export function DataRetentionSettings() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<"loadError" | "saveError" | "saved" | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadRevision, setLoadRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const validityHandlers = useMemo(() => {
    const update = (field: typeof FIELDS[number]) => (value: boolean) =>
      setValid((current) => current[field] === value ? current : { ...current, [field]: value });
    return {
      reviewHistory: update("reviewHistory"),
      syncHistory: update("syncHistory"),
      removedTasks: update("removedTasks"),
      diagnosticLogs: update("diagnosticLogs"),
      diagnosticLogSizeLimit: (value: boolean) => setValid((current) => current.diagnosticLogSizeLimit === value ? current : { ...current, diagnosticLogSizeLimit: value }),
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void invoke<Settings>("data_retention_settings").then((settings) => {
      if (active) { setSaved(settings); setDraft(settings); }
    }).catch(() => { if (active) setNotice("loadError"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadRevision]);

  const changed = saved && draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const invalid = draft && (FIELDS.some((field) => draft[field].mode === "period" && valid[field] === false)
    || (draft.diagnosticLogs.mode !== "disabled" && draft.diagnosticLogSizeLimit !== null && valid.diagnosticLogSizeLimit === false));
  async function save() {
    if (!draft || !changed || saving || invalid) return;
    setSaving(true);
    try {
      const settings = await invoke<Settings>("data_retention_settings_save", { settings: draft });
      setSaved(settings);
      setDraft(settings);
      setNotice("saved");
    } catch { setNotice("saveError"); }
    finally { setSaving(false); }
  }

  return <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-4 py-3.5">
      <div className="min-w-0 space-y-1.5">
        <CardTitle className="text-base font-semibold leading-tight">{t("dataRetention.title")}</CardTitle>
        <CardDescription className="leading-snug">{t("dataRetention.description")}</CardDescription>
      </div>
      <div className="flex shrink-0 items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={saving || (!changed && !invalid)} onClick={() => {
        setDraft(saved);
        setValid({});
        setDraftRevision((value) => value + 1);
        setNotice(null);
      }}>{t("settings.common.cancel")}</Button>
      <Button type="button" size="sm" actionTone="edit" onClick={() => void save()} disabled={!changed || saving || Boolean(invalid)}>
        {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t("settings.common.save")}
      </Button>
      <Button type="button" variant="outline" size="icon" className="size-9" disabled={saving}
        aria-expanded={expanded} aria-controls="data-retention-details"
        aria-label={t(expanded ? "dataRetention.collapse" : "dataRetention.expand")}
        title={t(expanded ? "dataRetention.collapse" : "dataRetention.expand")}
        onClick={() => setExpanded((value) => !value)}>
        <ChevronDown className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </Button>
      </div>
    </CardHeader>
    <SettingsReveal open={expanded} id="data-retention-details">
    <CardContent key={draftRevision} className="@container/retention flex flex-col gap-4 px-4 pb-3.5">
      {draft ? <>
        <div className="flex flex-col">
          {FIELDS.map((field) => {
            const period = draft[field];
            const max = MAXIMUM[period.unit];
            const label = t(`dataRetention.${field}`);
            return <Fragment key={field}>
              <div className={field === FIELDS[0] ? undefined : "pl-4"}><Separator /></div>
              <div role="group" aria-labelledby={`retention-${field}-label`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3 pl-4 last:pb-0">
              <Hint content={t(`dataRetention.${field}Help`)}><span id={`retention-${field}-label`} className="text-sm font-medium leading-none">{label}</span></Hint>
              <div className="flex flex-wrap items-center gap-3">
              <Select value={period.mode} disabled={saving} onValueChange={(mode) => {
                setValid((current) => ({ ...current, [field]: true }));
                setDraft((current) => current && { ...current, [field]: { ...current[field], mode: mode as RetentionMode } });
              }}>
                <SelectTrigger className="h-9 w-fit" aria-label={t("dataRetention.modeFor", { field: label })}
                  title={period.mode === "disabled" ? t(field === "diagnosticLogs" ? "dataRetention.logsDisabledHelp" : "dataRetention.historyDisabledHelp") : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>{MODES.map((mode) => <SelectItem key={mode} value={mode}>{t(`dataRetention.${mode}`)}</SelectItem>)}</SelectContent>
              </Select>
              {period.mode === "period" ? <div className="flex items-center gap-2">
              <ManualNumberField id={`retention-${field}`} label={label} labelledBy={`retention-${field}-label`}
                description={t(`dataRetention.${field}Help`)} value={period.value} min={1} max={max} minVisibleDigits={1} disabled={saving}
                onChange={(value) => setDraft((current) => current && { ...current, [field]: { ...current[field], value } })}
                onValidityChange={validityHandlers[field]}
                errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 1, max }), whole: t("forms.numberInvalid") }} />
              <Select value={period.unit} disabled={saving} onValueChange={(unit) => setDraft((current) => current && {
                ...current, [field]: { ...current[field], unit: unit as RetentionUnit },
              })}>
                <SelectTrigger className="h-9 w-fit gap-1.5 px-2" aria-label={t("dataRetention.unitFor", { field: label })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{UNITS.map((unit) => <SelectItem key={unit} value={unit}>{t(`dataRetention.${unit}`)}</SelectItem>)}</SelectContent>
              </Select>
              </div> : null}
              </div>
              {field === "diagnosticLogs" && period.mode !== "disabled" ? <div className="flex basis-full flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <span id="retention-log-size-label" className="sr-only">{t("dataRetention.logSize")}</span>
                <div className="ml-auto flex flex-wrap items-center gap-3">
                <Select value={draft.diagnosticLogSizeLimit === null ? "unlimited" : "limited"} disabled={saving} onValueChange={(mode) => {
                  setValid((current) => ({ ...current, diagnosticLogSizeLimit: true }));
                  setDraft((current) => current && { ...current, diagnosticLogSizeLimit: mode === "unlimited" ? null : { value: 100, unit: "mib" } });
                }}>
                  <SelectTrigger className="h-9 w-fit" aria-label={t("dataRetention.sizeMode")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limited">{t("dataRetention.limitedSize")}</SelectItem>
                    <SelectItem value="unlimited">{t("dataRetention.unlimitedSize")}</SelectItem>
                  </SelectContent>
                </Select>
                {draft.diagnosticLogSizeLimit !== null ? <div className="flex items-center gap-2">
                  <ManualNumberField id="retention-log-size" label={t("dataRetention.logSize")} labelledBy="retention-log-size-label" description={t("dataRetention.logSizeHelp")}
                    value={draft.diagnosticLogSizeLimit.value} min={1} max={MAX_LOG_SIZE[draft.diagnosticLogSizeLimit.unit]} minVisibleDigits={1} disabled={saving}
                    onChange={(value) => setDraft((current) => current && { ...current, diagnosticLogSizeLimit: current.diagnosticLogSizeLimit && { ...current.diagnosticLogSizeLimit, value } })}
                    onValidityChange={validityHandlers.diagnosticLogSizeLimit}
                    errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 1, max: MAX_LOG_SIZE[draft.diagnosticLogSizeLimit.unit] }), whole: t("forms.numberInvalid") }} />
                  <Select value={draft.diagnosticLogSizeLimit.unit} disabled={saving} onValueChange={(unit) => setDraft((current) => current && {
                    ...current, diagnosticLogSizeLimit: current.diagnosticLogSizeLimit && { ...current.diagnosticLogSizeLimit, unit: unit as LogSizeUnit },
                  })}>
                    <SelectTrigger className="h-9 w-fit gap-1.5 px-2" aria-label={t("dataRetention.sizeUnit")}><SelectValue /></SelectTrigger>
                    <SelectContent>{SIZE_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{t(`dataRetention.${unit}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div> : null}
                </div>
              </div> : null}
            </div>
            </Fragment>;
          })}
        </div>
      </> : loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("dataRetention.loading")} /> : <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => { setNotice(null); setLoadRevision((value) => value + 1); }}>{t("tokenBurner.retry")}</Button>}
    </CardContent>
    </SettingsReveal>
    {notice ? <StatusToast message={t(`dataRetention.${notice}`)} variant={notice === "saved" ? "success" : "error"} onDismiss={() => setNotice(null)} /> : null}
  </Card>;
}
