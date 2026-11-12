import type { AppIconStyle } from "@/features/settings/general/api";

// Startup hint only; Rust settings determine the persisted platform default.
export function defaultAppIconStyle(): AppIconStyle {
  return typeof navigator !== "undefined" && /\bMacintosh\b/.test(navigator.userAgent)
    ? "original"
    : "transparent";
}

export function appIconSource(style: AppIconStyle): string {
  return style === "original" ? "/mework-icon-original.png" : "/mework-icon.png";
}
