import { createContext, useContext } from "react";

import type { GeneralSettings, ThemePreference } from "@/features/settings/general/api";
import { en, type TranslationKey } from "./locales/en";
import { APP_LANGUAGE_LOCALES, AppLanguage, type TranslationParams } from "./types";

export interface I18nContextValue {
  language: AppLanguage;
  locale: string;
  themePreference: ThemePreference;
  resolvedTheme: "light" | "dark";
  appearanceSaving: boolean;
  updateAppearance: (changes: Partial<Pick<GeneralSettings, "language" | "themePreference">>) => Promise<GeneralSettings>;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

function fallbackTranslation(key: TranslationKey, params?: TranslationParams): string {
  const template = en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  );
}

export const I18nContext = createContext<I18nContextValue>({
  language: AppLanguage.English,
  locale: APP_LANGUAGE_LOCALES[AppLanguage.English],
  themePreference: "system",
  resolvedTheme: "light",
  appearanceSaving: false,
  updateAppearance: async () => { throw new Error("Appearance settings are unavailable"); },
  t: fallbackTranslation,
});

export function useI18n() {
  return useContext(I18nContext);
}
