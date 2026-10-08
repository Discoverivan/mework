import { describe, expect, it, vi } from "vitest";
import subscriptionModels, { loadSubscriptionModels } from "../../../backend/src/application/ai_providers/cli/pi-subscription-models";

describe("Pi subscription model discovery", () => {
  it("lists visible account models using Pi's resolved OAuth credential", async () => {
    const token = crypto.randomUUID();
    const registry = {
      getAll: () => [{ provider: "openai", id: "example-model" }],
      isUsingOAuth: () => true,
      getApiKeyForProvider: vi.fn(async () => token),
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [
      { slug: "example-model-b", visibility: "list" },
      { slug: "example-model-a", visibility: "list" },
      { slug: "example-hidden", visibility: "hidden" },
    ] })));
    vi.stubGlobal("fetch", request);
    let start: Parameters<Parameters<typeof subscriptionModels>[0]["on"]>[1] | undefined;
    subscriptionModels({ on: (_event, handler) => { start = handler; } });
    const notify = vi.fn();
    const shutdown = vi.fn();
    try {
      await start!({}, { modelRegistry: registry, ui: { notify }, shutdown });
    } finally { vi.unstubAllGlobals(); }
    const result = JSON.parse(notify.mock.calls[0][0]);
    expect(notify).toHaveBeenCalledWith(JSON.stringify(result), "info");
    expect(shutdown).toHaveBeenCalledOnce();
    expect(registry.getApiKeyForProvider).toHaveBeenCalledWith("openai");
    expect(request).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error",
    }));
    expect(result).toEqual({ type: "mework_subscription_models", status: "connected", models: [
      "openai/example-model-b", "openai/example-model-a",
    ] });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("never returns credentials or raw errors when OAuth resolution fails", async () => {
    const token = crypto.randomUUID();
    const request = vi.fn<typeof fetch>();
    const result = await loadSubscriptionModels({
      getAll: () => [{ provider: "openai", id: "example-model" }],
      isUsingOAuth: () => true,
      getApiKeyForProvider: async () => { throw new Error(token); },
    }, request);
    expect(result).toEqual({ type: "mework_subscription_models", status: "unavailable", models: [] });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
