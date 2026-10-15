import type { I18nContextValue } from "@/i18n/context";

export function formatAiError(message: string, t: I18nContextValue["t"]): string {
  return message.includes("ai_output_token_limit_reached") ? t("ai.error.outputTokenLimit") : message;
}
