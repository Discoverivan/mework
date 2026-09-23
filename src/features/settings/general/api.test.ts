import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { generalSettings } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("general settings startup locale", () => {
  it("passes the supported system language and falls back to English", async () => {
    const originalLanguage = Object.getOwnPropertyDescriptor(navigator, "language");
    vi.mocked(invoke).mockResolvedValue({} as never);

    try {
      Object.defineProperty(navigator, "language", { configurable: true, value: "ru-RU" });
      await generalSettings();
      expect(invoke).toHaveBeenLastCalledWith("general_settings", { systemLanguage: "russian" });

      Object.defineProperty(navigator, "language", { configurable: true, value: "fr-FR" });
      await generalSettings();
      expect(invoke).toHaveBeenLastCalledWith("general_settings", { systemLanguage: "english" });
    } finally {
      if (originalLanguage) Object.defineProperty(navigator, "language", originalLanguage);
    }
  });
});
