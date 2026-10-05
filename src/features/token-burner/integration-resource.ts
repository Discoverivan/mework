import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import type { IntegrationRedacted } from "@/shared/contracts/settings";
import type { TokenBurnerRepository } from "@/shared/contracts/token-burner";
import { isTokenBurnerIntegrationAvailable, listTokenBurnerRepositories } from "./api";

interface IntegrationState {
  available: boolean;
  repositories: TokenBurnerRepository[];
  error: unknown;
}

let state: IntegrationState = { available: false, repositories: [], error: null };
const listeners = new Set<(state: IntegrationState) => void>();
let cleanup: (() => void) | undefined;
let request: Promise<void> | undefined;
let revision = 0;
let epoch = 0;
let healthSignature: string | undefined;

function publish(next: IntegrationState) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

function refresh() {
  revision += 1;
  if (request) return request;
  const currentEpoch = epoch;
  // One owner coalesces invalidations and discards stale responses after edits.
  const sharedRequest = Promise.resolve().then(async () => {
    let loadedRevision: number;
    do {
      loadedRevision = revision;
      try {
        const available = await isTokenBurnerIntegrationAvailable();
        if (currentEpoch !== epoch || listeners.size === 0) return;
        const repositories = available ? await listTokenBurnerRepositories() : [];
        if (loadedRevision === revision && currentEpoch === epoch) publish({ available, repositories, error: null });
      } catch (error) {
        if (loadedRevision === revision && currentEpoch === epoch) publish({ available: false, repositories: [], error });
      }
    } while (loadedRevision !== revision && listeners.size > 0 && currentEpoch === epoch);
  }).finally(() => { if (request === sharedRequest) request = undefined; });
  request = sharedRequest;
  return request;
}

function healthChanged(integrations: IntegrationRedacted[]) {
  const signature = JSON.stringify(integrations.filter((item) => item.kind === "bitbucket")
    .map(({ id, enabled, healthStatus, baseUrl, allowInsecureTls }) =>
      ({ id, enabled, healthStatus, baseUrl, allowInsecureTls }))
    .sort((a, b) => a.id.localeCompare(b.id)));
  if (signature === healthSignature) return;
  healthSignature = signature;
  void refresh();
}

export function subscribeModelTestingIntegrations(listener: (state: IntegrationState) => void) {
  listeners.add(listener);
  listener(state);
  if (!cleanup) {
    const unsubscribeChanges = subscribeAppEvent(APP_EVENT.integrationsChanged, () => { void refresh(); });
    const unsubscribeHealth = subscribeAppEvent(APP_EVENT.integrationsHealthRefreshed, healthChanged);
    cleanup = () => { unsubscribeChanges(); unsubscribeHealth(); };
    // Always revalidate when opening the page; the app event bus does not replay.
    void refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      cleanup?.();
      cleanup = undefined;
      healthSignature = undefined;
      epoch += 1;
      request = undefined;
      state = { available: false, repositories: [], error: null };
    }
  };
}
