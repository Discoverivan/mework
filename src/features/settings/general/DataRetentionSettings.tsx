import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { StatusToast } from "@/components/shared/StatusToast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/i18n/context";
import type { DataRetentionSettings as Settings, RetentionUnit } from "@/shared/contracts/data-retention";

const FIELDS = ["reviewHistory", "syncHistory", "removedTasks"] as const;
const UNITS: RetentionUnit[] = ["minutes", "hours", "days", "months"];
const MAXIMUM: Record<RetentionUnit, number> = { minutes: 5_256_000, hours: 87_600, days: 3650, months: 120 };

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

  const changed = saved && draft && FIELDS.some((field) => saved[field].value !== draft[field].value || saved[field].unit !== draft[field].unit);
  async function save() {
    if (!draft || !changed || saving || Object.values(valid).includes(false)) return;
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
      <Button type="button" size="sm" actionTone="edit" className="shrink-0" onClick={() => void save()} disabled={!changed || saving || Object.values(valid).includes(false)}>
        {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{t("settings.common.save")}
      </Button>
    </CardHeader>
    <CardContent className="@container/retention flex flex-col gap-4 px-4 pb-3.5">
      {draft ? <>
        <div className="flex flex-col gap-4 p-1 @min-[40rem]/retention:flex-row">
          {FIELDS.map((field, index) => {
            const period = draft[field];
            const max = MAXIMUM[period.unit];
            const label = t(`dataRetention.${field}`);
            return <Fragment key={field}>
              {index > 0 ? <Separator orientation="vertical" className="hidden h-auto self-stretch @min-[40rem]/retention:block" /> : null}
              <div role="group" aria-labelledby={`retention-${field}-label`}
              className="grid w-fit grid-cols-[3.5rem_auto] gap-x-2 gap-y-2.5 [&>div[role=group]]:contents [&_[id$='-label']]:col-span-2">
              <ManualNumberField id={`retention-${field}`} label={label}
                description={t(`dataRetention.${field}Help`)} value={period.value} min={0} max={max} disabled={saving}
                onChange={(value) => setDraft((current) => current && { ...current, [field]: { ...current[field], value } })}
                onValidityChange={validityHandlers[field]}
                errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 0, max }), whole: t("forms.numberInvalid") }} />
              <Select value={period.unit} disabled={saving} onValueChange={(unit) => setDraft((current) => current && {
                ...current, [field]: { ...current[field], unit: unit as RetentionUnit },
              })}>
                <SelectTrigger className="h-9 w-fit gap-1.5 px-2" aria-label={t("dataRetention.unitFor", { field: label })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{UNITS.map((unit) => <SelectItem key={unit} value={unit}>{t(`dataRetention.${unit}`)}</SelectItem>)}</SelectContent>
              </Select>
              </div>
            </Fragment>;
          })}
        </div>
      </> : loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("dataRetention.loading")} /> : <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => { setNotice(null); setLoadRevision((value) => value + 1); }}>{t("tokenBurner.retry")}</Button>}
      {notice ? <StatusToast message={t(`dataRetention.${notice}`)} variant={notice === "saved" ? "success" : "error"} onDismiss={() => setNotice(null)} /> : null}
    </CardContent>
  </Card>;
}
