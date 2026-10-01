import type { TranslationKey } from "@/i18n/locales/en";
import type { TranslationParams } from "@/i18n/types";

type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export function formatRelativeDate(timestamp?: number, t?: Translator): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return t ? t("pr.relative.unknown") : "Unknown update";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t ? t("pr.relative.justNow") : "just now";
  if (seconds < 3600) return t ? t("pr.relative.minutes", { count: Math.floor(seconds / 60) }) : `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return t ? t("pr.relative.hours", { count: Math.floor(seconds / 3600) }) : `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return t ? t("pr.relative.days", { count: Math.floor(seconds / 86_400) }) : `${Math.floor(seconds / 86_400)}d ago`;
  if (seconds < 31_536_000) return t ? t("pr.relative.months", { count: Math.floor(seconds / 2_592_000) }) : `${Math.floor(seconds / 2_592_000)}mo ago`;
  return t ? t("pr.relative.years", { count: Math.floor(seconds / 31_536_000) }) : `${Math.floor(seconds / 31_536_000)}y ago`;
}
