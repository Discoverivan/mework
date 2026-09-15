import { useEffect, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AiSettingsPageData, IntegrationKind, IntegrationRedacted } from "@/shared/contracts/settings";
import { INTEGRATIONS_HEALTH_REFRESHED_EVENT } from "../settings/health-events";
import { getAiSettings, listIntegrations } from "../settings/api";

type IntegrationRequirement = IntegrationKind | "any";
type GateState = "loading" | "ready" | "blocked" | "error";

interface IntegrationDependencyGateProps {
  requirement: IntegrationRequirement;
  requireAiProvider?: boolean;
  children: ReactNode;
  onSettled?: () => void;
}

function requirementLabel(requirement: IntegrationRequirement): string {
  return requirement === "any" ? "an integration" : `a ${requirement} integration`;
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

export function IntegrationDependencyGate({
  requirement,
  requireAiProvider = false,
  children,
  onSettled,
}: IntegrationDependencyGateProps) {
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

    const aiCheck = requireAiProvider ? getAiSettings() : Promise.resolve(null);
    void Promise.allSettled([listIntegrations(), aiCheck]).then(([integrationsResult, aiResult]) => {
      if (!active) return;
      if (integrationsResult.status === "rejected" || aiResult.status === "rejected") {
        setState("error");
        return;
      }

      const reasons: string[] = [];
      if (!satisfiesIntegration(requirement, integrationsResult.value)) {
        reasons.push(`a working ${requirementLabel(requirement)}`);
      }
      if (requireAiProvider && (aiResult.value === null || !satisfiesAi(aiResult.value))) {
        reasons.push("a connected AI provider with an available model");
      }
      setBlockedReasons(reasons);
      setState(reasons.length === 0 ? "ready" : "blocked");
    }).finally(() => {
      if (active) onSettled?.();
    });

    return () => {
      active = false;
    };
  }, [onSettled, requirement, requireAiProvider, retry]);

  if (state === "ready") return <>{children}</>;

  if (state === "loading") {
    return (
      <section aria-label="Checking integration dependencies" className="space-y-4">
        <div role="status" className="space-y-3">
          <span className="sr-only">Checking integrations and AI provider</span>
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
          <AlertTitle id="integration-dependency-title">Unable to check dependencies</AlertTitle>
          <AlertDescription>
            <p>Integration or AI provider status could not be checked. Try again or open Settings.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRetry((current) => current + 1)}>
                Retry checking dependencies
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="#settings">Open Settings</a>
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
        <AlertTitle id="integration-dependency-title">Dependencies required</AlertTitle>
        <AlertDescription>
          <p>Configure {blockedReasons.join(" and ")} in Settings before opening this section.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href="#settings">Open Settings</a>
          </Button>
        </AlertDescription>
      </Alert>
    </section>
  );
}
