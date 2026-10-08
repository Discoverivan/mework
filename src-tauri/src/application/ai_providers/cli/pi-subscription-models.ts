// Loaded explicitly by the Rust Pi transport; discovered extensions stay disabled.
// Pi owns OAuth resolution/refresh. Only model IDs and fixed status codes leave it.
interface PiModel { provider: string; id: string }
interface PiRegistry {
  getAll(): PiModel[];
  isUsingOAuth(model: PiModel): boolean;
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

export interface SubscriptionModels {
  type: "mework_subscription_models";
  status: "not_oauth" | "connected" | "auth_required" | "unavailable";
  models: string[];
}

export async function loadSubscriptionModels(registry: PiRegistry, request = fetch): Promise<SubscriptionModels> {
  const result = (status: SubscriptionModels["status"], models: string[] = []): SubscriptionModels =>
    ({ type: "mework_subscription_models", status, models });
  try {
    const model = registry.getAll().find((model) => model.provider === "openai");
    if (!model || !registry.isUsingOAuth(model)) return result("not_oauth");
    const token = await registry.getApiKeyForProvider("openai");
    if (!token) return result("auth_required");
    const response = await request("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) return result("auth_required");
    if (!response.ok) return result("unavailable");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("models" in body) || !Array.isArray(body.models)) {
      return result("unavailable");
    }
    const models = body.models.filter((entry: unknown): entry is { slug: string; visibility: string } => {
      if (!entry || typeof entry !== "object" || !("visibility" in entry) || entry.visibility !== "list") return false;
      return "slug" in entry && typeof entry.slug === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/.test(entry.slug);
    }).map((entry) => `openai/${entry.slug}`);
    return result("connected", [...new Set(models)]);
  } catch {
    // OAuth/provider errors can contain tokens or response bodies. Never serialize them.
    return result("unavailable");
  }
}

interface PiExtension {
  on(name: "session_start", handler: (event: unknown, context: {
    modelRegistry: PiRegistry;
    ui: { notify(message: string, type: "info"): void };
    shutdown(): void;
  }) => Promise<void>): void;
}

export default function subscriptionModels(pi: PiExtension): void {
  pi.on("session_start", async (_event, context) => {
    const result = await loadSubscriptionModels(context.modelRegistry);
    // RPC redirects extension stdout to stderr. Its UI transport owns JSONL stdout.
    context.ui.notify(JSON.stringify(result), "info");
    context.shutdown();
  });
}
