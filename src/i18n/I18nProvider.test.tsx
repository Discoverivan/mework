import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useI18n } from "./context";
import { I18nProvider } from "./I18nProvider";
import { THEME_PREFERENCE_CACHE_KEY } from "./appearance-cache";

const { generalSettingsMock } = vi.hoisted(() => ({
  generalSettingsMock: vi.fn(),
}));

vi.mock("@/features/settings/general/api", () => ({
  generalSettings: generalSettingsMock,
  saveAppearanceSettings: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    theme: vi.fn().mockResolvedValue("light"),
    onThemeChanged: vi.fn().mockResolvedValue(vi.fn()),
  }),
}));

function ThemeProbe() {
  const { resolvedTheme } = useI18n();
  return <span>{resolvedTheme}</span>;
}

describe("I18nProvider startup appearance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    generalSettingsMock.mockImplementation(() => new Promise(() => undefined));
  });

  it("uses the cached theme while Rust settings are loading", () => {
    window.localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, "dark");

    render(
      <I18nProvider>
        <ThemeProbe />
      </I18nProvider>,
    );

    expect(screen.getByText("dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-button-style", "filled");
  });
});
