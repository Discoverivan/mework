import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { I18nProvider } from "@/i18n/I18nProvider";

const { generalSettingsMock, openNotificationSettingsMock, saveAppearanceSettingsMock, saveGeneralSettingsMock, sendNotificationTestMock, updaterCheckMock, installAvailableUpdateMock } = vi.hoisted(() => ({
  generalSettingsMock: vi.fn(),
  openNotificationSettingsMock: vi.fn(),
  saveAppearanceSettingsMock: vi.fn(),
  saveGeneralSettingsMock: vi.fn(),
  sendNotificationTestMock: vi.fn(),
  updaterCheckMock: vi.fn(),
  installAvailableUpdateMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterCheckMock }));

vi.mock("./api", () => ({
  generalSettings: generalSettingsMock,
  openNotificationSettings: openNotificationSettingsMock,
  saveAppearanceSettings: saveAppearanceSettingsMock,
  saveGeneralSettings: saveGeneralSettingsMock,
  sendNotificationTest: sendNotificationTestMock,
}));

vi.mock("@/components/shared/update-install", () => ({
  installAvailableUpdate: installAvailableUpdateMock,
}));

describe("GeneralSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const initialSettings = {
      language: "english",
      themePreference: "system",
      notificationsEnabled: true,
      reviewNotificationsEnabled: true,
      authoredNotificationsEnabled: true,
      notificationPermission: "denied",
    };
    generalSettingsMock.mockResolvedValue(initialSettings);
    openNotificationSettingsMock.mockResolvedValue(undefined);
    saveGeneralSettingsMock.mockImplementation(async (input) => ({
      ...initialSettings,
      ...input,
    }));
    saveAppearanceSettingsMock.mockImplementation(async (language, themePreference) => ({
      ...initialSettings,
      language,
      themePreference,
    }));
    sendNotificationTestMock.mockResolvedValue(undefined);
    updaterCheckMock.mockResolvedValue(null);
    installAvailableUpdateMock.mockResolvedValue(undefined);
  });

  it("shows the permission banner and supports settings and test notification controls", async () => {
    render(
      <I18nProvider>
        <GeneralSettingsPage />
      </I18nProvider>,
    );

    expect(await screen.findByRole("switch", { name: "Notifications" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("english");
    expect(screen.getByRole("combobox", { name: "Appearance" })).toHaveValue("system");
    expect(screen.getByRole("switch", { name: "Pull requests awaiting your review" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Pull requests authored by you" })).toBeChecked();
    expect(await screen.findByRole("heading", { name: "Notifications are not allowed" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Appearance" }), {
      target: { value: "dark" },
    });
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(saveAppearanceSettingsMock).toHaveBeenLastCalledWith("english", "dark");

    fireEvent.change(screen.getByRole("combobox", { name: "Appearance" }), {
      target: { value: "light" },
    });
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));

    fireEvent.click(screen.getByRole("button", { name: "Open notification settings" }));
    await waitFor(() => expect(openNotificationSettingsMock).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Test notification" }));
    await waitFor(() => expect(sendNotificationTestMock).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("switch", { name: "Pull requests awaiting your review" }));
    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenLastCalledWith({
      notificationsEnabled: true,
      reviewNotificationsEnabled: false,
      authoredNotificationsEnabled: true,
      language: "english",
      themePreference: "light",
    }));

    fireEvent.click(screen.getByRole("switch", { name: "Notifications" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Pull requests authored by you" })).toBeDisabled());

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "russian" },
    });
    expect(await screen.findByRole("heading", { name: "Настройки приложения" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Язык" }), {
      target: { value: "english" },
    });
    expect(await screen.findByRole("heading", { name: "Application preferences" })).toBeInTheDocument();
  });

  it("offers Update now when a newer application version is available", async () => {
    const update = {
      version: "0.1.5",
      body: "Release notes should not be rendered here.",
    };
    updaterCheckMock.mockResolvedValue(update);

    render(<GeneralSettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("MeWork 0.1.5 is available.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(installAvailableUpdateMock).toHaveBeenCalledWith(update));
  });

  it("checks for application updates and reports when the app is current", async () => {
    render(<GeneralSettingsPage />);

    const button = await screen.findByRole("button", { name: "Check for updates" });
    fireEvent.click(button);
    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledWith({ timeout: 10_000 }));
    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
  });
});
