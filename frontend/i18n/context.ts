import { createContext, useContext } from "react";

import type { AppIconStyle, ButtonStyle, GeneralSettings, PanelStyle, ThemePreference } from "@/features/settings/general/api";
import { en, type TranslationKey } from "./locales/en";
import { APP_LANGUAGE_LOCALES, AppLanguage, type TranslationParams } from "./types";
import { defaultAppIconStyle } from "@/lib/app-icon";

export interface I18nContextValue {
  language: AppLanguage;
  locale: string;
  themePreference: ThemePreference;
  buttonStyle: ButtonStyle;
  buttonStyleSaving: boolean;
  panelStyle: PanelStyle;
  panelStyleSaving: boolean;
  appIconStyle: AppIconStyle;
  appIconStyleSaving: boolean;
  updateAppIconStyle: (style: AppIconStyle) => Promise<GeneralSettings>;
  resolvedTheme: "light" | "dark";
  appearanceSaving: boolean;
  updateAppearance: (changes: Partial<Pick<GeneralSettings, "language" | "themePreference">>) => Promise<GeneralSettings>;
  updateButtonStyle: (buttonStyle: ButtonStyle) => Promise<GeneralSettings>;
  updatePanelStyle: (panelStyle: PanelStyle) => Promise<GeneralSettings>;
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
  buttonStyle: "filled_borderless",
  buttonStyleSaving: false,
  panelStyle: "bordered",
  panelStyleSaving: false,
  appIconStyle: defaultAppIconStyle(),
  appIconStyleSaving: false,
  updateAppIconStyle: async () => { throw new Error("Application icon settings are unavailable"); },
  resolvedTheme: "light",
  appearanceSaving: false,
  updateAppearance: async () => { throw new Error("Appearance settings are unavailable"); },
  updateButtonStyle: async () => { throw new Error("Button style settings are unavailable"); },
  updatePanelStyle: async () => { throw new Error("Panel style settings are unavailable"); },
  t: fallbackTranslation,
});

export function useI18n() {
  return useContext(I18nContext);
}
