import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { I18nProvider } from "@/i18n/I18nProvider";

const { generalSettingsMock, commandBoardTerminalPreferencesMock, saveCommandBoardTerminalPreferenceMock, openNotificationSettingsMock, requestNotificationPermissionMock, saveAppearanceSettingsMock, saveGeneralSettingsMock, sendNotificationTestMock, updaterCheckMock, installAvailableUpdateMock } = vi.hoisted(() => ({
  generalSettingsMock: vi.fn(),
  commandBoardTerminalPreferencesMock: vi.fn(),
  saveCommandBoardTerminalPreferenceMock: vi.fn(),
  openNotificationSettingsMock: vi.fn(),
  requestNotificationPermissionMock: vi.fn(),
  saveAppearanceSettingsMock: vi.fn(),
  saveGeneralSettingsMock: vi.fn(),
  sendNotificationTestMock: vi.fn(),
  updaterCheckMock: vi.fn(),
  installAvailableUpdateMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterCheckMock }));

vi.mock("./api", () => ({
  AiResponseLanguage: {
    SameAsUi: "sameAsUi",
    English: "english",
    Russian: "russian",
  },
  generalSettings: generalSettingsMock,
  commandBoardTerminalPreferences: commandBoardTerminalPreferencesMock,
  saveCommandBoardTerminalPreference: saveCommandBoardTerminalPreferenceMock,
  openNotificationSettings: openNotificationSettingsMock,
  requestNotificationPermission: requestNotificationPermissionMock,
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
      aiResponseLanguage: "sameAsUi",
      themePreference: "system",
      notificationsEnabled: true,
      reviewNotificationsEnabled: true,
      authoredNotificationsEnabled: true,
      taskTrackerNotificationsEnabled: true,
      notificationPermission: "denied",
    };
    generalSettingsMock.mockResolvedValue(initialSettings);
    const terminalPreferences = {
      selectedTerminal: "system",
      options: [
        { id: "system", label: "Default terminal", available: true },
        { id: "kitty", label: "Kitty", available: true },
        { id: "iterm2", label: "iTerm2", available: true },
        { id: "ghostty", label: "Ghostty", available: true },
        { id: "wezterm", label: "WezTerm", available: true },
        { id: "alacritty", label: "Alacritty", available: true },
      ],
    };
    commandBoardTerminalPreferencesMock.mockResolvedValue(terminalPreferences);
    saveCommandBoardTerminalPreferenceMock.mockImplementation(async (selectedTerminal) => ({
      ...terminalPreferences,
      selectedTerminal,
    }));
    openNotificationSettingsMock.mockResolvedValue(undefined);
    requestNotificationPermissionMock.mockResolvedValue("granted");
    let persistedSettings = initialSettings;
    saveGeneralSettingsMock.mockImplementation(async (input) => {
      persistedSettings = { ...persistedSettings, ...input };
      return persistedSettings;
    });
    saveAppearanceSettingsMock.mockImplementation(async (language, themePreference) => {
      persistedSettings = { ...persistedSettings, language, themePreference };
      return persistedSettings;
    });
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
    expect(screen.getByRole("combobox", { name: "UI" })).toHaveValue("english");
    expect(screen.getByRole("combobox", { name: "Appearance" })).toHaveValue("system");
    expect(screen.getByRole("switch", { name: "Pull requests awaiting your review" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Pull requests authored by you" })).toBeChecked();
    const taskTrackerNotifications = screen.getByRole("switch", { name: "Task tracker" });
    expect(taskTrackerNotifications).toBeChecked();
    fireEvent.click(taskTrackerNotifications);
    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenLastCalledWith({
      notificationsEnabled: true,
      reviewNotificationsEnabled: true,
      authoredNotificationsEnabled: true,
      taskTrackerNotificationsEnabled: false,
      language: "english",
      aiResponseLanguage: "sameAsUi",
      themePreference: "system",
    }));
    const notificationsCard = screen.getByRole("switch", { name: "Notifications" }).closest(".rounded-lg.border.bg-card");
    expect(notificationsCard).toContainElement(await screen.findByRole("heading", { name: "Notifications are not allowed" }));

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

    const reviewTestButton = screen.getByRole("button", { name: "Test review notification" });
    expect(reviewTestButton).toHaveAttribute("title", "Test review notification");
    expect(reviewTestButton).not.toHaveTextContent("Test review notification");
    expect(reviewTestButton.querySelector("svg.lucide-bell-ring")).not.toBeNull();
    fireEvent.click(reviewTestButton);
    await waitFor(() => expect(sendNotificationTestMock).toHaveBeenCalledWith("review"));

    const authoredTestButton = screen.getByRole("button", { name: "Test authored pull request notification" });
    expect(authoredTestButton).toHaveAttribute("title", "Test authored pull request notification");
    expect(authoredTestButton.querySelector("svg.lucide-bell-ring")).not.toBeNull();
    fireEvent.click(authoredTestButton);
    await waitFor(() => expect(sendNotificationTestMock).toHaveBeenLastCalledWith("authored"));
    expect(sendNotificationTestMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("switch", { name: "Pull requests awaiting your review" }));
    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenLastCalledWith({
      notificationsEnabled: true,
      reviewNotificationsEnabled: false,
      authoredNotificationsEnabled: true,
      taskTrackerNotificationsEnabled: false,
      language: "english",
      aiResponseLanguage: "sameAsUi",
      themePreference: "light",
    }));

    fireEvent.click(screen.getByRole("switch", { name: "Notifications" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Pull requests authored by you" })).toBeDisabled());

    fireEvent.change(screen.getByRole("combobox", { name: "UI" }), {
      target: { value: "russian" },
    });
    expect(await screen.findByRole("heading", { name: "Настройки приложения" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "UI" }), {
      target: { value: "english" },
    });
    expect(await screen.findByRole("heading", { name: "Application preferences" })).toBeInTheDocument();
  });

  it("sends a test notification for Task tracker", async () => {
    render(
      <I18nProvider>
        <GeneralSettingsPage />
      </I18nProvider>,
    );

    const testButton = await screen.findByRole("button", { name: "Test Task tracker notification" });
    expect(testButton).toHaveAttribute("title", "Test Task tracker notification");
    expect(testButton.querySelector("svg.lucide-bell-ring")).not.toBeNull();
    fireEvent.click(testButton);

    await waitFor(() => expect(sendNotificationTestMock).toHaveBeenCalledWith("taskTracker"));
    await waitFor(() => expect(testButton.querySelector("svg.lucide-circle-check")).not.toBeNull());
  });

  it("lets the user choose a detected terminal for Command Board scripts", async () => {
    render(
      <I18nProvider>
        <GeneralSettingsPage />
      </I18nProvider>,
    );

    const terminalSelect = await screen.findByRole("combobox", { name: "Terminal" });
    expect(terminalSelect).toHaveValue("system");
    expect(screen.getByRole("option", { name: "Default terminal" })).toBeInTheDocument();
    const appearanceSelect = await screen.findByRole("combobox", { name: "Appearance" });
    expect(screen.getByRole("option", { name: "Kitty" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "iTerm2" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ghostty" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "WezTerm" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alacritty" })).toBeInTheDocument();
    expect(terminalSelect.parentElement?.parentElement?.className).toBe(
      appearanceSelect.parentElement?.parentElement?.className,
    );
    expect(terminalSelect.parentElement?.parentElement?.firstElementChild).toHaveClass("min-w-0", "flex-1");
    fireEvent.change(terminalSelect, { target: { value: "kitty" } });

    await waitFor(() => expect(saveCommandBoardTerminalPreferenceMock).toHaveBeenCalledWith("kitty"));
    expect(terminalSelect).toHaveValue("kitty");
  });

  it("requests notification permission inside the Notifications card", async () => {
    generalSettingsMock.mockResolvedValueOnce({
      language: "english", themePreference: "system", notificationsEnabled: true,
      reviewNotificationsEnabled: true, authoredNotificationsEnabled: true,
      notificationPermission: "notDetermined",
    });
    render(<GeneralSettingsPage />);
    const notificationsCard = screen.getByRole("switch", { name: "Notifications" }).closest(".rounded-lg.border.bg-card");
    const allowButton = await screen.findByRole("button", { name: "Allow notifications" });
    expect(notificationsCard).toContainElement(allowButton);
    fireEvent.click(allowButton);
    await waitFor(() => expect(requestNotificationPermissionMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("heading", { name: "Notifications are not allowed" })).not.toBeInTheDocument();
  });

  it("saves the AI response language independently from the UI language", async () => {
    render(<GeneralSettingsPage />);

    const responseLanguage = await screen.findByRole("combobox", { name: "AI agent response language" });
    expect(responseLanguage).toHaveValue("sameAsUi");
    fireEvent.change(responseLanguage, { target: { value: "russian" } });

    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      language: "english",
      aiResponseLanguage: "russian",
    })));
  });

  it("offers a stable install action when a newer application version is available", async () => {
    const update = {
      version: "0.1.5",
      body: "Release notes should not be rendered here.",
    };
    updaterCheckMock.mockResolvedValue(update);
    const updateAvailabilityListener = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.updateAvailabilityChanged, updateAvailabilityListener);

    try {
      render(<GeneralSettingsPage />);

      fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
      const updateButton = await screen.findByRole("button", { name: "Update to 0.1.5" });
      expect(screen.getByText("New version 0.1.5 found")).toBeInTheDocument();
      expect(screen.queryByText("mework 0.1.5 is available.")).not.toBeInTheDocument();
      await waitFor(() => expect(updateAvailabilityListener).toHaveBeenCalledWith("0.1.5"));

      expect(updateButton).toHaveAttribute("title", "Update to 0.1.5");
      expect(updateButton).not.toHaveTextContent("Update to 0.1.5");
      expect(updateButton.querySelector("svg.lucide-download")).not.toBeNull();
      const checkButton = screen.getByRole("button", { name: "Check for updates" });
      expect(updateButton.parentElement).toContainElement(checkButton);
      expect(updateButton.nextElementSibling).toBe(checkButton);
      fireEvent.click(updateButton);
      await waitFor(() => expect(installAvailableUpdateMock).toHaveBeenCalledWith(update));
    } finally {
      unsubscribe();
    }
  });

  it("checks immediately when General Settings is opened from the version indicator", async () => {
    updaterCheckMock.mockResolvedValue({ version: "0.1.5", body: "ignored" });

    const page = render(<GeneralSettingsPage updateCheckRequest={0} />);
    page.rerender(<GeneralSettingsPage updateCheckRequest={1} />);

    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledOnce());
    expect(screen.getByText("New version 0.1.5 found")).toBeInTheDocument();
  });

  it("checks for application updates and reports when the app is current", async () => {
    render(<GeneralSettingsPage />);

    const button = await screen.findByRole("button", { name: "Check for updates" });
    expect(button).toHaveAttribute("title", "Check for updates");
    expect(button).not.toHaveTextContent("Check for updates");
    expect(button.querySelector("svg.lucide-refresh-cw")).not.toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledWith({ timeout: 10_000 }));
    const currentStatus = (await screen.findByText("You're up to date.")).closest('[role="status"]');
    expect(currentStatus).toHaveClass("fixed");
  });

  it("reports an update-check failure in a temporary toast instead of the updates card", async () => {
    updaterCheckMock.mockRejectedValue(new Error("temporary updater failure"));
    render(<GeneralSettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));

    const errorToast = (await screen.findByText("Unable to check for updates.")).closest('[role="alert"]');
    if (!errorToast) throw new Error("Expected update error toast");
    expect(errorToast).toHaveClass("fixed");
    expect(errorToast.closest(".space-y-4.px-4.py-3\\.5")).toBeNull();
  });
});
