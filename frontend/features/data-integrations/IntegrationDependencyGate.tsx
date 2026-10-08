import { useEffect, useRef, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AiSettingsPageData, IntegrationKind, IntegrationRedacted } from "@/shared/contracts/settings";
import { matchesSelectedAiProvider } from "@/shared/contracts/settings";
import { getAiSettings, listIntegrations } from "../settings/api";
import { useI18n } from "@/i18n/context";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";

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
    matchesSelectedAiProvider(data.settings, candidate)
      && candidate.available
      && candidate.status === "connected"
      && candidate.models.includes(model),
  );
}

function hasTransientAiFailure(data: AiSettingsPageData | null): boolean {
  if (!data?.settings.provider || !data.settings.model.trim()) return false;
  const provider = data.providers.find((candidate) => matchesSelectedAiProvider(data.settings, candidate));
  return provider?.status === "loading" || provider?.status === "unavailable" || provider?.status === "not_found";
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
  const stateRef = useRef<GateState>("loading");
  const [blockedReasons, setBlockedReasons] = useState<string[]>([]);
  const [settingsTargets, setSettingsTargets] = useState({ integration: false, ai: false });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const refresh = () => setRetry((current) => current + 1);
    const unsubscribeHealth = subscribeAppEvent(APP_EVENT.integrationsHealthRefreshed, (integrations) => {
      if (stateRef.current !== "ready" || !satisfiesIntegration(requirement, integrations)) refresh();
    });
    const unsubscribeIntegrations = subscribeAppEvent(APP_EVENT.integrationsChanged, refresh);
    const unsubscribeAi = subscribeAppEvent(APP_EVENT.aiSettingsChanged, refresh);
    return () => {
      unsubscribeHealth();
      unsubscribeIntegrations();
      unsubscribeAi();
    };
  }, [requirement]);

  useEffect(() => {
    let active = true;
    setState((current) => current === "ready" ? current : "loading");
    if (stateRef.current !== "ready") setBlockedReasons([]);

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
      const integrationError = integrationsResult.status === "rejected";
      const aiData = aiResult.status === "fulfilled" ? aiResult.value : null;
      const aiIssue = requireAiProvider && (aiData === null || !satisfiesAi(aiData));
      const aiError = requireAiProvider && (
        aiResult.status === "rejected"
        || hasTransientAiFailure(aiData)
      );
      if (integrationError || aiError) {
        setSettingsTargets({ integration: integrationError, ai: aiIssue });
        setState("error");
        return;
      }

      const reasons: string[] = [];
      const integrationBlocked = !satisfiesIntegration(requirement, integrationsResult.value);
      const aiBlocked = aiIssue;
      if (integrationBlocked) {
        reasons.push(requirement === "any"
          ? t("dependencies.integration.any")
          : t("dependencies.integration.kind", { kind: requirement }));
      }
      if (aiBlocked) {
        reasons.push(t("dependencies.ai"));
      }
      setSettingsTargets({ integration: integrationBlocked, ai: aiBlocked });
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
              {settingsTargets.integration ? <Button asChild variant="outline" size="sm">
                <a href="#settings/integrations">{t("nav.dataIntegrations")}</a>
              </Button> : null}
              {settingsTargets.ai ? <Button asChild variant="outline" size="sm">
                <a href="#settings/ai">{t("nav.aiSettings")}</a>
              </Button> : null}
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
          <div className="mt-3 flex flex-wrap gap-2">
            {settingsTargets.integration ? <Button asChild variant="outline" size="sm">
              <a href="#settings/integrations">{t("nav.dataIntegrations")}</a>
            </Button> : null}
            {settingsTargets.ai ? <Button asChild variant="outline" size="sm">
              <a href="#settings/ai">{t("nav.aiSettings")}</a>
            </Button> : null}
          </div>
        </AlertDescription>
      </Alert>
    </section>
  );
}
