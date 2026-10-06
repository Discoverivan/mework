import { useEffect, useRef, useState } from "react";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import { StatusToast } from "@/components/shared/StatusToast";
import { AiOverrideEditor } from "@/features/settings/AiOverrideEditor";
import { AiRetriesField } from "@/features/settings/AiRetriesField";
import { saveAiSettings } from "@/features/settings/api";
import { useI18n } from "@/i18n/context";
import type { AiSettingsPageData, AiSettingsProfile } from "@/shared/contracts/settings";

export function ModelTestingAiSettings({ data, disabled, onPendingChange }: { data: AiSettingsPageData; disabled: boolean; onPendingChange: (pending: boolean) => void }) {
  const { t } = useI18n();
  const [profile, setProfile] = useState(data.settings.tokenBurner ?? null);
  const [retries, setRetries] = useState(data.settings.retries.actions.tokenBurner);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const failedDraft = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setProfile(data.settings.tokenBurner ?? null);
    setRetries(data.settings.retries.actions.tokenBurner);
  }, [data.settings.tokenBurner, data.settings.retries.actions.tokenBurner]);

  const selected = data.providers.find((provider) => provider.id === profile?.provider
    && (provider.id !== "openai-compatible" || (provider.instanceId ?? "legacy") === (profile?.providerInstanceId ?? "legacy")));
  const ready = !profile || (selected?.available === true && selected.status === "connected" && selected.models.includes(profile.model));
  const draftKey = JSON.stringify([profile, retries]);
  const savedKey = JSON.stringify([data.settings.tokenBurner ?? null, data.settings.retries.actions.tokenBurner]);
  const loading = data.providers.some((provider) => provider.status === "loading");

  useEffect(() => {
    onPendingChange(saving || draftKey !== savedKey);
    return () => onPendingChange(false);
  }, [draftKey, onPendingChange, savedKey, saving]);

  useEffect(() => {
    if (disabled || loading || saving || !ready || draftKey === savedKey || failedDraft.current === draftKey) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      setSaved(false);
      setError(null);
      void saveAiSettings({
        ...data.settings,
        tokenBurner: profile,
        retries: { ...data.settings.retries, actions: { ...data.settings.retries.actions, tokenBurner: retries } },
      }).then((next) => {
        emitAppEvent(APP_EVENT.aiSettingsChanged, next);
        if (mounted.current) setSaved(true);
      }).catch((failure: unknown) => {
        failedDraft.current = draftKey;
        if (mounted.current) setError(t("settings.error.saveAi", { error: failure instanceof Error ? failure.message : String(failure) }));
      }).finally(() => { if (mounted.current) setSaving(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data.settings, disabled, draftKey, loading, profile, ready, retries, savedKey, saving, t]);

  function changeProfile(next: AiSettingsProfile | null) {
    setProfile(next);
    setRetries(next ? retries ?? data.settings.retries.default : null);
    setError(null);
    setSaved(false);
    failedDraft.current = null;
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
        noModelsLabel={t("settings.ai.noModels", { provider: t("settings.ai.selectedProvider") })}
        unavailableLabel={t("settings.ai.unavailableSuffix")}
        onChange={changeProfile}
        disabled={disabled || loading || saving}
      />
      {profile ? <AiRetriesField id="model-testing-ai-retries" value={retries ?? data.settings.retries.default} disabled={disabled || loading || saving} onChange={(value) => {
        setRetries(value);
        setError(null);
        setSaved(false);
        failedDraft.current = null;
      }} /> : null}
    </div>
    {error || !ready ? <p className={error ? "text-sm text-destructive" : "text-sm text-warning"} aria-live="polite">
      {error ?? t(selected?.status === "connected" ? "settings.ai.noModelSelected" : "settings.ai.notConnected")}
    </p> : null}
    {saving ? <StatusToast key="saving" variant="loading" message={t("settings.common.saving")} />
      : saved ? <StatusToast key="saved" message={t("settings.ai.saved")} onDismiss={() => setSaved(false)} /> : null}
  </section>;
}
