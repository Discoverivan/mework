import { useEffect, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { IntegrationKind, IntegrationRedacted } from "@/shared/contracts/settings";
import { listIntegrations } from "../settings/api";

type IntegrationRequirement = IntegrationKind | "any";
type GateState = "loading" | "ready" | "blocked" | "error";

interface IntegrationDependencyGateProps {
  requirement: IntegrationRequirement;
  children: ReactNode;
  onSettled?: () => void;
}

function requirementTitle(requirement: IntegrationRequirement): string {
  return requirement === "any" ? "Connect an integration" : `Connect ${requirement[0].toUpperCase()}${requirement.slice(1)}`;
}

function requirementLabel(requirement: IntegrationRequirement): string {
  return requirement === "any" ? "an integration" : `a ${requirement} integration`;
}

function satisfies(requirement: IntegrationRequirement, integrations: IntegrationRedacted[]): boolean {
  return integrations.some(
    (integration) =>
      integration.enabled && integration.healthStatus === "working" &&
      (requirement === "any" || integration.kind === requirement),
  );
}

export function IntegrationDependencyGate({ requirement, children, onSettled }: IntegrationDependencyGateProps) {
  const [state, setState] = useState<GateState>("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState("loading");

    listIntegrations()
      .then((integrations) => {
        if (active) setState(satisfies(requirement, integrations) ? "ready" : "blocked");
      })
      .catch(() => {
        if (active) setState("error");
      })
      .finally(() => {
        if (active) onSettled?.();
      });

    return () => {
      active = false;
    };
  }, [onSettled, requirement, retry]);

  if (state === "ready") return <>{children}</>;

  if (state === "loading") {
    return (
      <section aria-label="Checking integration dependencies" className="space-y-4">
        <div role="status" className="space-y-3">
          <span className="sr-only">Checking integrations</span>
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
          <AlertTitle id="integration-dependency-title">Unable to check integrations</AlertTitle>
          <AlertDescription>
            <p>Integration status could not be checked. Try again or open Settings.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRetry((current) => current + 1)}>
                Retry checking integrations
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
        <AlertTitle id="integration-dependency-title">{requirementTitle(requirement)}</AlertTitle>
        <AlertDescription>
          <p>Configure {requirementLabel(requirement)} before opening this section.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href="#settings">Open Settings</a>
          </Button>
        </AlertDescription>
      </Alert>
    </section>
  );
}
