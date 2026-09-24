import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  generalSettings,
  saveAppearanceSettings,
  saveButtonStyle,
  type ButtonStyle,
  type GeneralSettings,
  type ThemePreference,
} from "@/features/settings/general/api";
import { en, type TranslationKey } from "./locales/en";
import { ru } from "./locales/ru";
import { cacheButtonStyle, cacheThemePreference, readCachedButtonStyle, readCachedThemePreference } from "./appearance-cache";
import { APP_LANGUAGE_LOCALES, AppLanguage, type TranslationParams } from "./types";
import { I18nContext, type I18nContextValue } from "./context";

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  [AppLanguage.English]: en,
  [AppLanguage.Russian]: ru,
};

function translate(language: AppLanguage, key: TranslationKey, params?: TranslationParams): string {
  const template = translations[language][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(AppLanguage.English);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readCachedThemePreference() ?? "system");
  const [buttonStyle, setButtonStyle] = useState<ButtonStyle>(() => readCachedButtonStyle() ?? "quiet");
  const [buttonStyleSaving, setButtonStyleSaving] = useState(false);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const languageRef = useRef(language);
  const themePreferenceRef = useRef(themePreference);
  const buttonStyleRef = useRef(buttonStyle);
  const appearanceRevisionRef = useRef(0);
  const buttonStyleRevisionRef = useRef(0);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  useEffect(() => {
    const revision = appearanceRevisionRef.current;
    const buttonRevision = buttonStyleRevisionRef.current;
    void generalSettings().then((settings) => {
      if (appearanceRevisionRef.current === revision) {
        languageRef.current = settings.language;
        themePreferenceRef.current = settings.themePreference;
        cacheThemePreference(settings.themePreference);
        setLanguage(settings.language);
        setThemePreference(settings.themePreference);
      }
      if (buttonStyleRevisionRef.current === buttonRevision) {
        buttonStyleRef.current = settings.buttonStyle ?? "quiet";
        cacheButtonStyle(buttonStyleRef.current);
        setButtonStyle(buttonStyleRef.current);
      }
    }).catch(() => {
      // English remains the safe default when the Rust settings command is unavailable.
    });
  }, []);

  const updateButtonStyle = useCallback(async (requestedStyle: ButtonStyle) => {
    const revision = ++buttonStyleRevisionRef.current;
    const previousStyle = buttonStyleRef.current;
    buttonStyleRef.current = requestedStyle;
    cacheButtonStyle(requestedStyle);
    setButtonStyle(requestedStyle);
    setButtonStyleSaving(true);
    try {
      const saved = await saveButtonStyle(requestedStyle);
      if (buttonStyleRevisionRef.current === revision) {
        buttonStyleRef.current = saved.buttonStyle;
        cacheButtonStyle(saved.buttonStyle);
        setButtonStyle(saved.buttonStyle);
      }
      return saved;
    } catch (error) {
      if (buttonStyleRevisionRef.current === revision) {
        buttonStyleRef.current = previousStyle;
        cacheButtonStyle(previousStyle);
        setButtonStyle(previousStyle);
      }
      throw error;
    } finally {
      if (buttonStyleRevisionRef.current === revision) setButtonStyleSaving(false);
    }
  }, []);

  const updateAppearance = useCallback(async (
    changes: Partial<Pick<GeneralSettings, "language" | "themePreference">>,
  ) => {
    const revision = appearanceRevisionRef.current + 1;
    appearanceRevisionRef.current = revision;
    const previousLanguage = languageRef.current;
    const previousThemePreference = themePreferenceRef.current;
    const requestedLanguage = changes.language ?? previousLanguage;
    const requestedThemePreference = changes.themePreference ?? previousThemePreference;

    languageRef.current = requestedLanguage;
    themePreferenceRef.current = requestedThemePreference;
    cacheThemePreference(requestedThemePreference);
    setLanguage(requestedLanguage);
    setThemePreference(requestedThemePreference);
    setAppearanceSaving(true);

    try {
      const saved = await saveAppearanceSettings(requestedLanguage, requestedThemePreference);
      if (appearanceRevisionRef.current === revision) {
        languageRef.current = saved.language;
        themePreferenceRef.current = saved.themePreference;
        cacheThemePreference(saved.themePreference);
        setLanguage(saved.language);
        setThemePreference(saved.themePreference);
      }
      return saved;
    } catch (error) {
      if (appearanceRevisionRef.current === revision) {
        languageRef.current = previousLanguage;
        themePreferenceRef.current = previousThemePreference;
        cacheThemePreference(previousThemePreference);
        setLanguage(previousLanguage);
        setThemePreference(previousThemePreference);
      }
      throw error;
    } finally {
      if (appearanceRevisionRef.current === revision) setAppearanceSaving(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let unlistenNativeTheme: (() => void) | undefined;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    if (media) updateSystemTheme();
    if (media && typeof media.addEventListener === "function") {
      media.addEventListener("change", updateSystemTheme);
    } else if (media && typeof media.addListener === "function") {
      media.addListener(updateSystemTheme);
    }

    try {
      const appWindow = getCurrentWindow();
      void appWindow.theme()
        .then((theme) => {
          if (active && theme) setSystemTheme(theme);
        })
        .catch(() => undefined);
      void appWindow.onThemeChanged(({ payload }) => {
        if (active) setSystemTheme(payload);
      }).then((unlisten) => {
        if (active) unlistenNativeTheme = unlisten;
        else unlisten();
      }).catch(() => undefined);
    } catch {
      // Browsers and tests use matchMedia when the native Tauri window is unavailable.
    }

    return () => {
      active = false;
      if (media && typeof media.removeEventListener === "function") {
        media.removeEventListener("change", updateSystemTheme);
      } else if (media && typeof media.removeListener === "function") {
        media.removeListener(updateSystemTheme);
      }
      unlistenNativeTheme?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === AppLanguage.Russian ? "ru" : "en";
  }, [language]);

  const resolvedTheme = themePreference === "system" ? systemTheme : themePreference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.buttonStyle = buttonStyle;
  }, [buttonStyle]);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
    [language],
  );

  const value = useMemo<I18nContextValue>(() => ({
    language,
    locale: APP_LANGUAGE_LOCALES[language],
    themePreference,
    buttonStyle,
    buttonStyleSaving,
    resolvedTheme,
    appearanceSaving,
    updateAppearance,
    updateButtonStyle,
    t,
  }), [appearanceSaving, buttonStyle, buttonStyleSaving, language, resolvedTheme, t, themePreference, updateAppearance, updateButtonStyle]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
