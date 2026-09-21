import type { ThemePreference } from "@/features/settings/general/api";

export const THEME_PREFERENCE_CACHE_KEY = "mework.appearance.theme.v1";

export function readCachedThemePreference(): ThemePreference | undefined {
  try {
    const value = window.localStorage.getItem(THEME_PREFERENCE_CACHE_KEY);
    return value === "system" || value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function cacheThemePreference(themePreference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, themePreference);
  } catch {
    // The Rust setting remains authoritative when web storage is unavailable.
  }
}
