import { useEffect, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AiSettingsPageData, IntegrationKind, IntegrationRedacted } from "@/shared/contracts/settings";
import { INTEGRATIONS_HEALTH_REFRESHED_EVENT } from "../settings/health-events";
import { getAiSettings, listIntegrations } from "../settings/api";
import { useI18n } from "@/i18n/context";

type IntegrationRequirement = IntegrationKind | "any";
type GateState = "loading" | "ready" | "blocked" | "error";
const TRANSIENT_AI_RETRY_DELAY_MS = 250;

interface IntegrationDependencyGateProps {
  requirement: IntegrationRequirement;
  requireAiProvider?: boolean;
  children: ReactNode;
  onSettled?: () => void;
}

function satisfiesIntegration(requirement: IntegrationRequirement, integrations: IntegrationRedacted[]): boolean {
  return integrations.some(
    (integration) =>
      integration.enabled && integration.healthStatus === "working" &&
      (requirement === "any" || integration.kind === requirement),
  );
}

function satisfiesAi(data: AiSettingsPageData): boolean {
  const { provider, model } = data.settings;
  if (!provider || !model.trim()) return false;
  return data.providers.some((candidate) =>
    candidate.id === provider
      && candidate.available
      && candidate.status === "connected"
      && candidate.models.includes(model),
  );
}

function hasTransientAiFailure(data: AiSettingsPageData | null): boolean {
  if (!data?.settings.provider || !data.settings.model.trim()) return false;
  const provider = data.providers.find((candidate) => candidate.id === data.settings.provider);
  return provider?.status === "loading" || provider?.status === "unavailable";
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function waitForTransientRetry(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, TRANSIENT_AI_RETRY_DELAY_MS));
}

export function IntegrationDependencyGate({
  requirement,
  requireAiProvider = false,
  children,
  onSettled,
}: IntegrationDependencyGateProps) {
  const { t } = useI18n();
  const [state, setState] = useState<GateState>("loading");
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const onHealthRefreshed = () => setRetry((current) => current + 1);
    window.addEventListener(INTEGRATIONS_HEALTH_REFRESHED_EVENT, onHealthRefreshed);
    return () => window.removeEventListener(INTEGRATIONS_HEALTH_REFRESHED_EVENT, onHealthRefreshed);
  }, []);

  useEffect(() => {
    let active = true;
    setState("loading");
    setBlockedReasons([]);

    void (async () => {
      const aiCheck = requireAiProvider ? getAiSettings() : Promise.resolve(null);
      const [integrationsResult, initialAiResult] = await Promise.all([
        settle(listIntegrations()),
        settle(aiCheck),
      ]);
      let aiResult: PromiseSettledResult<AiSettingsPageData | null> = initialAiResult;

      if (requireAiProvider && (
        aiResult.status === "rejected"
        || hasTransientAiFailure(aiResult.value)
      )) {
        await waitForTransientRetry();
        if (!active) return;
        aiResult = await settle(getAiSettings());
      }

      if (!active) return;
      if (integrationsResult.status === "rejected" || aiResult.status === "rejected") {
        setState("error");
        return;
      }
      if (requireAiProvider && hasTransientAiFailure(aiResult.value)) {
        setState("error");
        return;
      }

      const reasons: string[] = [];
      if (!satisfiesIntegration(requirement, integrationsResult.value)) {
        reasons.push(requirement === "any"
          ? t("dependencies.integration.any")
          : t("dependencies.integration.kind", { kind: requirement }));
      }
      if (requireAiProvider && (aiResult.value === null || !satisfiesAi(aiResult.value))) {
        reasons.push(t("dependencies.ai"));
      }
      setBlockedReasons(reasons);
      setState(reasons.length === 0 ? "ready" : "blocked");
    })().finally(() => {
      if (active) onSettled?.();
    });

    return () => {
      active = false;
    };
  }, [onSettled, requirement, requireAiProvider, retry, t]);

  if (state === "ready") return <>{children}</>;

  if (state === "loading") {
    return (
      <section aria-label={t("dependencies.checking")} className="space-y-4">
        <div role="status" className="space-y-3">
          <span className="sr-only">{t("dependencies.checkingDetails")}</span>
          <div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
          <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section aria-labelledby="integration-dependency-title" className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle id="integration-dependency-title">{t("dependencies.errorTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("dependencies.errorDescription")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRetry((current) => current + 1)}>
                {t("dependencies.retry")}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="#settings">{t("dependencies.openSettings")}</a>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section aria-labelledby="integration-dependency-title" className="space-y-4">
      <Alert>
        <AlertTitle id="integration-dependency-title">{t("dependencies.required")}</AlertTitle>
        <AlertDescription>
          <p>{t("dependencies.configure", { reasons: blockedReasons.join(t("dependencies.and")) })}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href="#settings">{t("dependencies.openSettings")}</a>
          </Button>
        </AlertDescription>
      </Alert>
    </section>
  );
}
