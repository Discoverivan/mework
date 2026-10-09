import { DEFAULT_REVIEW_ARBITRATION, type AiActionSettingsScope, type AiSettings } from "@/shared/contracts/settings";

export const ACTION_SETTINGS_SCOPES: AiActionSettingsScope[] = ["default", "pullRequestReview", "taskCreation", "sprintSummary", "tokenBurner"];

export function copyAiSection(target: AiSettings, source: AiSettings, scope: AiActionSettingsScope): AiSettings {
  if (scope === "default") return {
    ...target, provider: source.provider, providerInstanceId: source.providerInstanceId ?? null,
    model: source.model, reasoning: source.reasoning, fastMode: source.fastMode,
    retries: { ...target.retries, default: source.retries.default },
  };
  return {
    ...target, [scope]: source[scope] ?? null,
    ...(scope === "pullRequestReview" ? { reviewArbiter: source.reviewArbiter ?? null, reviewArbitration: source.reviewArbitration ?? DEFAULT_REVIEW_ARBITRATION } : {}),
    retries: { ...target.retries, actions: { ...target.retries.actions, [scope]: source.retries.actions[scope], ...(scope === "pullRequestReview" ? { reviewArbiter: source.retries.actions.reviewArbiter ?? null } : {}) } },
  };
}

export function aiSectionChanged(draft: AiSettings, saved: AiSettings, scope: AiActionSettingsScope): boolean {
  // Normalize optional fields so old persisted settings do not become dirty on load.
  return JSON.stringify(copyAiSection(saved, draft, scope)) !== JSON.stringify(copyAiSection(saved, saved, scope));
}

export function rebaseAiDraft(draft: AiSettings, previous: AiSettings, next: AiSettings): AiSettings {
  return ACTION_SETTINGS_SCOPES.reduce((current, scope) => aiSectionChanged(draft, previous, scope) ? current : copyAiSection(current, next, scope), draft);
}
