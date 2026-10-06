import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ManualNumberField } from "@/components/shared/ManualNumberField";
import { StatusToast } from "@/components/shared/StatusToast";
import { useI18n } from "@/i18n/context";
import type { DataRetentionSettings as Settings } from "@/shared/contracts/data-retention";

const FIELDS = ["reviewHistoryDays", "syncHistoryDays", "removedTaskDays"] as const;

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
      reviewHistoryDays: update("reviewHistoryDays"),
      syncHistoryDays: update("syncHistoryDays"),
      removedTaskDays: update("removedTaskDays"),
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

  const changed = saved && draft && FIELDS.some((field) => saved[field] !== draft[field]);
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
    <CardContent className="flex flex-col gap-4 px-4 pb-3.5">
      {draft ? <>
        <div className="flex flex-wrap gap-4 p-1">
          {FIELDS.map((field) => <ManualNumberField key={field} id={`retention-${field}`} label={t(`dataRetention.${field}`)}
            description={t(`dataRetention.${field}Help`)} value={draft[field]} min={0} max={3650} disabled={saving}
            onChange={(value) => setDraft((current) => current && { ...current, [field]: value })}
            onValidityChange={validityHandlers[field]}
            errors={{ required: t("forms.numberRequired"), number: t("forms.numberInvalid"), range: t("forms.numberRange", { min: 0, max: 3650 }), whole: t("forms.numberInvalid") }} />)}
        </div>
      </> : loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("dataRetention.loading")} /> : <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => { setNotice(null); setLoadRevision((value) => value + 1); }}>{t("tokenBurner.retry")}</Button>}
      {notice ? <StatusToast message={t(`dataRetention.${notice}`)} variant={notice === "saved" ? "success" : "error"} onDismiss={() => setNotice(null)} /> : null}
    </CardContent>
  </Card>;
}
