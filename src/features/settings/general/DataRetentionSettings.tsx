import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { StatusToast } from "@/components/shared/StatusToast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import type { DataRetentionSettings as Settings, RetentionMode, RetentionUnit } from "@/shared/contracts/data-retention";

const FIELDS = ["reviewHistory", "syncHistory", "removedTasks", "diagnosticLogs"] as const;
const UNITS: RetentionUnit[] = ["minutes", "hours", "days", "months"];
const MAXIMUM: Record<RetentionUnit, number> = { minutes: 5_256_000, hours: 87_600, days: 3650, months: 120 };
const MODES: RetentionMode[] = ["period", "indefinite", "disabled"];
const MAX_LOG_MIB = 1_048_576;

export function DataRetentionSettings() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<"loadError" | "saveError" | "saved" | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadRevision, setLoadRevision] = useState(0);
  const validityHandlers = useMemo(() => {
    const update = (field: typeof FIELDS[number]) => (value: boolean) =>
      setValid((current) => current[field] === value ? current : { ...current, [field]: value });
    return {
      reviewHistory: update("reviewHistory"),
      syncHistory: update("syncHistory"),
      removedTasks: update("removedTasks"),
      diagnosticLogs: update("diagnosticLogs"),
      diagnosticLogMaxMiB: (value: boolean) => setValid((current) => current.diagnosticLogMaxMiB === value ? current : { ...current, diagnosticLogMaxMiB: value }),
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
    || (draft.diagnosticLogs.mode !== "disabled" && draft.diagnosticLogMaxMiB !== null && valid.diagnosticLogMaxMiB === false));
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
      <Button type="button" size="sm" actionTone="edit" className="shrink-0" onClick={() => void save()} disabled={!changed || saving || Boolean(invalid)}>
        {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t("settings.common.save")}
      </Button>
    </CardHeader>
    <CardContent className="@container/retention flex flex-col gap-4 px-4 pb-3.5">
      {draft ? <>
        <div className="grid gap-4 @min-[40rem]/retention:grid-cols-2">
          {FIELDS.map((field) => {
            const period = draft[field];
            const max = MAXIMUM[period.unit];
            const label = t(`dataRetention.${field}`);
            return <div key={field} role="group" aria-labelledby={`retention-${field}-label`}
              className="flex flex-col gap-3 rounded-lg border bg-background p-4">
              <Hint content={t(`dataRetention.${field}Help`)}><span id={`retention-${field}-label`} className="text-sm font-medium leading-none">{label}</span></Hint>
              <Select value={period.mode} disabled={saving} onValueChange={(mode) => {
                setValid((current) => ({ ...current, [field]: true }));
                setDraft((current) => current && { ...current, [field]: { ...current[field], mode: mode as RetentionMode } });
              }}>
                <SelectTrigger className="h-9 w-fit" aria-label={t("dataRetention.modeFor", { field: label })}><SelectValue /></SelectTrigger>
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
              {field === "diagnosticLogs" && period.mode !== "disabled" ? <>
                <Select value={draft.diagnosticLogMaxMiB === null ? "unlimited" : "limited"} disabled={saving} onValueChange={(mode) => {
                  setValid((current) => ({ ...current, diagnosticLogMaxMiB: true }));
                  setDraft((current) => current && { ...current, diagnosticLogMaxMiB: mode === "unlimited" ? null : 100 });
                }}>
                  <SelectTrigger className="h-9 w-fit" aria-label={t("dataRetention.sizeMode")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limited">{t("dataRetention.limitedSize")}</SelectItem>
                    <SelectItem value="unlimited">{t("dataRetention.unlimitedSize")}</SelectItem>
                  </SelectContent>
                </Select>
                {draft.diagnosticLogMaxMiB !== null ? <div className="flex items-end gap-2">
                  <ManualNumberField id="retention-log-size" label={t("dataRetention.logSize")} description={t("dataRetention.logSizeHelp")}
                    value={draft.diagnosticLogMaxMiB} min={1} max={MAX_LOG_MIB} minVisibleDigits={1} disabled={saving}
                    onChange={(value) => setDraft((current) => current && { ...current, diagnosticLogMaxMiB: value })}
                    onValidityChange={validityHandlers.diagnosticLogMaxMiB}
                    errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 1, max: MAX_LOG_MIB }), whole: t("forms.numberInvalid") }} />
                  <span className="pb-2 text-sm text-muted-foreground">{t("dataRetention.mib")}</span>
                </div> : null}
              </> : null}
              {period.mode === "disabled" ? <p className="text-sm text-muted-foreground">{t(field === "diagnosticLogs" ? "dataRetention.logsDisabledHelp" : "dataRetention.historyDisabledHelp")}</p> : null}
            </div>;
          })}
        </div>
      </> : loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("dataRetention.loading")} /> : <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => { setNotice(null); setLoadRevision((value) => value + 1); }}>{t("tokenBurner.retry")}</Button>}
      {notice ? <StatusToast message={t(`dataRetention.${notice}`)} variant={notice === "saved" ? "success" : "error"} onDismiss={() => setNotice(null)} /> : null}
    </CardContent>
  </Card>;
}
