import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Field, FieldLabel } from "@/components/ui/field";
import { useI18n } from "@/i18n/context";
import { getAiReviewAttempts, getCachedAiReviewAttempts, saveAiReviewAttempts } from "./general/api";

export function ReviewAttemptsSetting({ onSaved, onSavingChange, onLoadingChange }: {
  onSaved: () => void;
  onSavingChange: (saving: boolean) => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const { t } = useI18n();
  const [attempts, setAttempts] = useState<number | null>(getCachedAiReviewAttempts);
  const [draft, setDraft] = useState(() => String(getCachedAiReviewAttempts() ?? ""));
  const [messageDismissed, setMessageDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [loading, setLoading] = useState(() => getCachedAiReviewAttempts() === null);
  useEffect(() => {
    let active = true;
    void getAiReviewAttempts().then((value) => { if (active) { setAttempts(value); setDraft(String(value)); } })
      .catch(() => { if (active) setError("load"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    onSavingChange(saving);
    return () => onSavingChange(false);
  }, [saving, onSavingChange]);
  useEffect(() => {
    onLoadingChange(loading);
    return () => onLoadingChange(false);
  }, [loading, onLoadingChange]);

  const value = Number(draft.trim());
  const invalid = !loading && attempts !== null &&
    (!/^\d+$/.test(draft.trim()) || !Number.isInteger(value) || value < 1 || value > 10);

  const message = invalid ? t("settings.ai.reviewAttemptsValidation") : error
    ? t(error === "load" ? "settings.ai.reviewAttemptsLoadError" : "settings.ai.reviewAttemptsSaveError") : null;

  async function save() {
    if (invalid || loading || attempts === null || saving || value === attempts) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAiReviewAttempts(value);
      setAttempts(saved);
      setDraft(String(saved));
      onSaved();
    } catch { setError("save"); setMessageDismissed(false); }
    finally { setSaving(false); }
  }

  return <Field className="w-max shrink-0 gap-2.5" data-invalid={invalid} data-disabled={loading || saving || attempts === null}>
    <FieldLabel className="whitespace-nowrap pl-1 leading-none" htmlFor="ai-review-attempts">{t("settings.ai.reviewAttempts")}</FieldLabel>
    <Popover open={Boolean(message) && !messageDismissed} onOpenChange={(open) => { if (!open) setMessageDismissed(true); }}>
      <PopoverAnchor asChild>
        <div className="relative h-9">
          <Input id="ai-review-attempts" type="text" inputMode="numeric" className="absolute inset-0 h-9 w-full aria-invalid:border-destructive aria-invalid:text-destructive aria-invalid:focus-visible:ring-destructive"
            value={draft} disabled={loading || saving || attempts === null} aria-invalid={invalid}
            title={t("settings.ai.reviewAttemptsDescription")}
            aria-describedby={message ? "ai-review-attempts-validation" : "ai-review-attempts-help"}
            onChange={(event) => { setDraft(event.target.value); setError(null); setMessageDismissed(false); }}
            onFocus={() => setMessageDismissed(false)}
            onBlur={() => void save()}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
        </div>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="start" sideOffset={6} className="w-56 border-destructive p-3 text-sm text-destructive"
        onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => { if (event.target instanceof Element && event.target.closest("#ai-review-attempts")) event.preventDefault(); }}>
        <p role="alert">{message}</p>
      </PopoverContent>
    </Popover>
    <p id="ai-review-attempts-help" className="sr-only">{t("settings.ai.reviewAttemptsDescription")}</p>
    {message ? <p id="ai-review-attempts-validation" className="sr-only">{message}</p> : null}
  </Field>;
}
