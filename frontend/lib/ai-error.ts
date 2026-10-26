import type { I18nContextValue } from "@/i18n/context";

export function formatAiError(message: string, t: I18nContextValue["t"]): string {
  const errors = [
    ["ai_output_token_limit_reached", "ai.error.outputTokenLimit"],
    ["ai_input_context_limit", "ai.error.inputContextLimit"],
    ["ai_provider_rate_limit", "ai.error.providerRateLimit"],
    ["ai_provider_authentication", "ai.error.providerAuthentication"],
    ["ai_cli_update_required", "ai.error.cliUpdateRequired"],
    ["ai_cli_workspace_route_unsupported", "ai.error.workspaceRouteUnsupported"],
    ["review_source_changed", "ai.error.reviewSourceChanged"],
    ["review_source_", "ai.error.reviewSource"],
    ["review_session_incomplete", "ai.error.workspaceIncomplete"],
    ["review_session_timed_out", "ai.error.reviewSessionTimeout"],
    ["review_session_repeated_tool_errors", "ai.error.reviewSessionRequests"],
    ["review_session_tool_limit", "ai.error.reviewSessionLimit"],
    ["review_session_", "ai.error.reviewSession"],
    ["review_workspace_provider_failed", "ai.error.workspaceProviderFailed"],
    ["review_workspace_incomplete", "ai.error.workspaceIncomplete"],
    ["review_workspace_input_limit", "ai.error.workspaceInputLimit"],
    ["review_workspace_line_too_large", "ai.error.workspaceInputLimit"],
    ["review_workspace_invalid_response", "ai.error.workspaceInvalidResponse"],
    ["review_workspace_", "ai.error.workspaceProtocol"],
  ] as const;
  const match = errors.find(([code]) => message.includes(code));
  return match ? t(match[1]) : message;
}
