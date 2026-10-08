import { APP_EVENT, getAppEventTimestamp } from "@/app/app-events";

export function shouldRefreshPullRequestCache(lastUpdatedAt?: number): boolean {
  if (lastUpdatedAt == null) return true;
  const integrationsChangedAt = getAppEventTimestamp(APP_EVENT.integrationsChanged);
  return integrationsChangedAt > 0 && lastUpdatedAt <= integrationsChangedAt;
}
