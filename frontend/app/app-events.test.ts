import { describe, expect, it, vi } from "vitest";

import type { IntegrationRedacted } from "@/shared/contracts/settings";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "./app-events";

describe("app events", () => {
  it("delivers a typed payload to subscribers and supports cleanup", () => {
    const integration: IntegrationRedacted = {
      id: "bitbucket-1",
      kind: "bitbucket",
      baseUrl: "https://bitbucket.example.invalid",
      enabled: true,
      healthStatus: "working",
      capabilities: {},
    };
    const listener = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.integrationsHealthRefreshed, listener);

    emitAppEvent(APP_EVENT.integrationsHealthRefreshed, [integration]);
    unsubscribe();
    emitAppEvent(APP_EVENT.integrationsHealthRefreshed, []);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([integration]);
  });
});
