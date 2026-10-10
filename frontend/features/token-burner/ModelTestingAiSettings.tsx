import { useEffect, useRef, useState } from "react";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { StatusToast } from "@/components/shared/StatusToast";
import { Button } from "@/components/ui/button";
import { AiOverrideEditor } from "@/features/settings/AiOverrideEditor";
import { AiRetriesField } from "@/features/settings/AiRetriesField";
import { saveAiSettings } from "@/features/settings/api";
import { useI18n } from "@/i18n/context";
import { isAiSettingsFieldError, type AiSettings, type AiSettingsPageData, type AiSettingsProfile } from "@/shared/contracts/settings";

function modelTestingDraft(settings: AiSettings) {
  return { profile: settings.tokenBurner ?? null, retries: settings.retries.actions.tokenBurner };
}

export function ModelTestingAiSettings({ data, disabled, onPendingChange }: { data: AiSettingsPageData; disabled: boolean; onPendingChange: (pending: boolean) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => modelTestingDraft(data.settings));
  const { profile, retries } = draft;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"provider" | "model", string>>>({});
  const [saved, setSaved] = useState(false);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const savedKey = JSON.stringify(modelTestingDraft(data.settings));
  const previousSavedKey = useRef(savedKey);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const previous = previousSavedKey.current;
    previousSavedKey.current = savedKey;
    // Provider refreshes must not discard edits waiting for autosave.
    setDraft((current) => JSON.stringify(current) === previous ? modelTestingDraft(data.settings) : current);
  }, [data.settings, savedKey]);

  const selected = data.providers.find((provider) => provider.id === profile?.provider
    && (provider.id !== "openai-compatible" || (provider.instanceId ?? "legacy") === (profile?.providerInstanceId ?? "legacy")));
  const ready = !profile || (selected?.available === true && selected.status === "connected" && selected.models.includes(profile.model));
  const draftKey = JSON.stringify(draft);
  const loading = data.providers.some((provider) => provider.status === "loading");

  useEffect(() => {
    onPendingChange(saving || draftKey !== savedKey);
    return () => onPendingChange(false);
  }, [draftKey, onPendingChange, savedKey, saving]);

  useEffect(() => {
    if (disabled || loading || saving || !ready || draftKey === savedKey || failedDraft === draftKey) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      setSaved(false);
      setError(null);
      setFieldErrors({});
      void saveAiSettings({
        ...data.settings,
        tokenBurner: profile,
        retries: { ...data.settings.retries, actions: { ...data.settings.retries.actions, tokenBurner: retries } },
      }).then((next) => {
        emitAppEvent(APP_EVENT.aiSettingsChanged, next);
        if (mounted.current) {
          setDraft(modelTestingDraft(next.settings));
          setSaved(true);
        }
      }).catch((failure: unknown) => {
        if (mounted.current) {
          setFailedDraft(draftKey);
          if (isAiSettingsFieldError(failure)) {
            const message = t(failure.field === "model" ? "settings.ai.modelInvalid" : "settings.ai.providerInvalid");
            if (failure.scope === "tokenBurner") setFieldErrors({ [failure.field]: message });
            else setError(t("settings.error.saveAi", { error: message }));
          } else {
            const message = failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string"
              ? failure.message : String(failure);
            setError(t("settings.error.saveAi", { error: message }));
          }
        }
      }).finally(() => { if (mounted.current) setSaving(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data.settings, disabled, draftKey, failedDraft, loading, profile, ready, retries, savedKey, saving, t]);

  function changeProfile(next: AiSettingsProfile | null) {
    setDraft({ profile: next, retries: next ? retries ?? data.settings.retries.default : null });
    setError(null);
    setFieldErrors({});
    setSaved(false);
    setFailedDraft(null);
  }

  return <section className="flex flex-col gap-4" aria-label={t("tokenBurner.aiConfiguration")}>
    <div className="flex flex-wrap items-start gap-4">
      <AiOverrideEditor
        idPrefix="model-testing-ai"
        profile={profile}
        providers={data.providers}
        inheritedLabel={t("settings.ai.inheritDefault")}
        providerLabel={t("settings.ai.provider")}
        modelLabel={t("settings.ai.model")}
        reasoningLabel={t("settings.ai.reasoning")}
        noModelsLabel={t("settings.ai.noModels")}
        unavailableLabel={t("settings.ai.unavailableSuffix")}
        onChange={changeProfile}
        disabled={disabled || loading || saving}
        fieldErrors={fieldErrors}
        fieldWarnings={profile && !loading && !ready ? selected?.available && selected.status === "connected"
          ? { model: t("settings.ai.noModelSelected") }
          : { provider: t("settings.ai.notConnected") } : undefined}
      />
      {profile ? <AiRetriesField id="model-testing-ai-retries" value={retries ?? data.settings.retries.default} disabled={disabled || loading || saving} onChange={(value) => {
        setDraft((current) => ({ ...current, retries: value }));
        setError(null);
        setFieldErrors({});
        setSaved(false);
        setFailedDraft(null);
      }} /> : null}
    </div>
    {error ? <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-destructive" aria-live="polite">
        {error}
      </p>
      <Button type="button" variant="outline" size="sm" disabled={disabled || loading || saving || !ready} onClick={() => {
        setFailedDraft(null);
        setError(null);
      }}>{t("settings.ai.retrySave")}</Button>
    </div> : null}
    {saving ? <StatusToast key="saving" variant="loading" message={t("settings.common.saving")} />
      : saved ? <StatusToast key="saved" message={t("settings.ai.saved")} onDismiss={() => setSaved(false)} /> : null}
  </section>;
}
