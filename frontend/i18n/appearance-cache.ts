import type { ButtonStyle, PanelStyle, ThemePreference } from "@/features/settings/general/api";

export const THEME_PREFERENCE_CACHE_KEY = "mework.appearance.theme.v1";
export const BUTTON_STYLE_CACHE_KEY = "mework.appearance.buttonStyle.v1";
export const PANEL_STYLE_CACHE_KEY = "mework.appearance.panelStyle.v1";

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

export function readCachedButtonStyle(): ButtonStyle | undefined {
  try {
    const value = window.localStorage.getItem(BUTTON_STYLE_CACHE_KEY);
    return value === "quiet" || value === "filled" || value === "filled_borderless" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function cacheButtonStyle(buttonStyle: ButtonStyle): void {
  try {
    window.localStorage.setItem(BUTTON_STYLE_CACHE_KEY, buttonStyle);
  } catch {
    // The Rust setting remains authoritative when web storage is unavailable.
  }
}

export function readCachedPanelStyle(): PanelStyle | undefined {
  try {
    const value = window.localStorage.getItem(PANEL_STYLE_CACHE_KEY);
    return value === "bordered" || value === "borderless" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function cachePanelStyle(panelStyle: PanelStyle): void {
  try {
    window.localStorage.setItem(PANEL_STYLE_CACHE_KEY, panelStyle);
  } catch {
    // The Rust setting remains authoritative when web storage is unavailable.
  }
}
