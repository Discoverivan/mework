import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { ApplicationInfoPage } from "../ApplicationInfoPage";
import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import { I18nProvider } from "@/i18n/I18nProvider";

const { generalSettingsMock, commandBoardTerminalPreferencesMock, saveCommandBoardTerminalPreferenceMock, openNotificationSettingsMock, requestNotificationPermissionMock, saveAppearanceSettingsMock, saveButtonStyleMock, saveGeneralSettingsMock, sendNotificationTestMock, updaterCheckMock, installAvailableUpdateMock, openUrlMock, invokeMock, beginUpdateCheckMock, recordUpdateCheckResultMock } = vi.hoisted(() => ({
  generalSettingsMock: vi.fn(),
  commandBoardTerminalPreferencesMock: vi.fn(),
  saveCommandBoardTerminalPreferenceMock: vi.fn(),
  openNotificationSettingsMock: vi.fn(),
  requestNotificationPermissionMock: vi.fn(),
  saveAppearanceSettingsMock: vi.fn(),
  saveButtonStyleMock: vi.fn(),
  saveGeneralSettingsMock: vi.fn(),
  sendNotificationTestMock: vi.fn(),
  updaterCheckMock: vi.fn(),
  installAvailableUpdateMock: vi.fn(),
  openUrlMock: vi.fn(),
  invokeMock: vi.fn(),
  beginUpdateCheckMock: vi.fn().mockResolvedValue({ checkId: 1, snapshot: { availableVersion: null, lastCheckedAt: null, status: "checking", revision: 1 } }),
  recordUpdateCheckResultMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterCheckMock }));
vi.mock("@/components/shared/update-check", () => ({
  checkForAvailableUpdate: () => updaterCheckMock({ timeout: 10_000 }),
  beginUpdateCheck: beginUpdateCheckMock,
  recordUpdateCheckResult: recordUpdateCheckResultMock,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

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
  saveButtonStyle: saveButtonStyleMock,
  saveGeneralSettings: saveGeneralSettingsMock,
  sendNotificationTest: sendNotificationTestMock,
}));

vi.mock("@/components/shared/update-install", () => ({
  installAvailableUpdate: installAvailableUpdateMock,
}));

describe("GeneralSettingsPage", () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue({ reviewHistoryDays: 90, syncHistoryDays: 30, removedTaskDays: 30 });
    vi.clearAllMocks();
    const initialSettings = {
      language: "english",
      aiResponseLanguage: "sameAsUi",
      themePreference: "system",
      buttonStyle: "filled",
      notificationsEnabled: true,
      reviewNotificationsEnabled: true,
      authoredNotificationsEnabled: true,
      taskTrackerNotificationsEnabled: true,
      extraFunctionsEnabled: false,
      aiReviewAttempts: 3,
      notificationPermission: "denied",
    };
    generalSettingsMock.mockResolvedValue(initialSettings);
    beginUpdateCheckMock.mockReset();
    beginUpdateCheckMock.mockResolvedValue({ checkId: 1, snapshot: { availableVersion: null, lastCheckedAt: null, status: "checking", revision: 1 } });
    recordUpdateCheckResultMock.mockReset();
    recordUpdateCheckResultMock.mockImplementation(async (_checkId: number, availableVersion: string | null, succeeded: boolean) => ({
      accepted: true,
      snapshot: {
        availableVersion: succeeded ? availableVersion : null,
        lastCheckedAt: Date.now(),
        status: succeeded ? availableVersion ? "available" : "current" : "error",
        revision: _checkId + 1,
      },
    }));
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
    saveButtonStyleMock.mockImplementation(async (buttonStyle) => {
      persistedSettings = { ...persistedSettings, buttonStyle };
      return persistedSettings;
    });
    sendNotificationTestMock.mockResolvedValue(undefined);
    updaterCheckMock.mockResolvedValue(null);
    installAvailableUpdateMock.mockResolvedValue(undefined);
  });

  it("persists the opt-in developer feature toggle and notifies the app", async () => {
    const onChanged = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.extraFunctionsEnabledChanged, onChanged);
    render(<I18nProvider><GeneralSettingsPage /></I18nProvider>);
    const toggle = await screen.findByRole("switch", { name: "Model-testing" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ extraFunctionsEnabled: true })));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(true));
    unsubscribe();
  });

  it("shows the permission banner and supports settings and test notification controls", async () => {
    render(
      <I18nProvider>
        <GeneralSettingsPage />
      </I18nProvider>,
    );

    expect(await screen.findByRole("switch", { name: "Notifications" })).toBeChecked();
    const uiSelect = screen.getByRole("combobox", { name: "UI" });
    expect(uiSelect).toHaveTextContent("English");
    expect(screen.getByRole("combobox", { name: "Appearance" })).toHaveTextContent("System");
    const buttonStyleSelect = screen.getByRole("combobox", { name: "Action buttons" });
    expect(buttonStyleSelect).toHaveTextContent("Filled");
    fireEvent.click(buttonStyleSelect);
    fireEvent.click(screen.getByRole("option", { name: "Minimal" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-button-style", "quiet"));
    expect(saveButtonStyleMock).toHaveBeenCalledWith("quiet");
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
      extraFunctionsEnabled: false,
      language: "english",
      aiResponseLanguage: "sameAsUi",
      themePreference: "system",
    }));
    const notificationsCard = screen.getByRole("switch", { name: "Notifications" }).closest(".rounded-lg.border.bg-card");
    expect(notificationsCard).toContainElement(await screen.findByRole("heading", { name: "Notifications are not allowed" }));

    fireEvent.click(screen.getByRole("combobox", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));
    expect(saveAppearanceSettingsMock).toHaveBeenLastCalledWith("english", "dark");

    fireEvent.click(screen.getByRole("combobox", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("option", { name: "Light" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));

    fireEvent.click(screen.getByRole("button", { name: "Open notification settings" }));
    await waitFor(() => expect(openNotificationSettingsMock).toHaveBeenCalledOnce());

    const reviewTestButton = screen.getByRole("button", { name: "Test review notification" });
    expect(reviewTestButton).toHaveAttribute("data-tooltip", "Test review notification");
    expect(reviewTestButton).not.toHaveTextContent("Test review notification");
    expect(reviewTestButton.querySelector("svg.lucide-bell-ring")).not.toBeNull();
    fireEvent.click(reviewTestButton);
    await waitFor(() => expect(sendNotificationTestMock).toHaveBeenCalledWith("review"));

    const authoredTestButton = screen.getByRole("button", { name: "Test authored pull request notification" });
    expect(authoredTestButton).toHaveAttribute("data-tooltip", "Test authored pull request notification");
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
      extraFunctionsEnabled: false,
      language: "english",
      aiResponseLanguage: "sameAsUi",
      themePreference: "light",
    }));

    fireEvent.click(screen.getByRole("switch", { name: "Notifications" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Pull requests authored by you" })).toBeDisabled());

    fireEvent.click(uiSelect);
    fireEvent.click(screen.getByRole("option", { name: "Русский" }));
    expect(await screen.findByRole("heading", { name: "Язык" })).toBeInTheDocument();

    fireEvent.click(uiSelect);
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(await screen.findByRole("heading", { name: "Language" })).toBeInTheDocument();
  });

  it("sends a test notification for Task tracker", async () => {
    render(
      <I18nProvider>
        <GeneralSettingsPage />
      </I18nProvider>,
    );

    const testButton = await screen.findByRole("button", { name: "Test Task tracker notification" });
    expect(testButton).toHaveAttribute("data-tooltip", "Test Task tracker notification");
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
    expect(terminalSelect).toHaveTextContent("Default terminal");
    const appearanceSelect = await screen.findByRole("combobox", { name: "Appearance" });
    fireEvent.click(terminalSelect);
    expect(screen.getByRole("option", { name: "Default terminal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kitty" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "iTerm2" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ghostty" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "WezTerm" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alacritty" })).toBeInTheDocument();
    expect(terminalSelect.parentElement?.parentElement?.className).toBe(
      appearanceSelect.parentElement?.parentElement?.className,
    );
    expect(terminalSelect.parentElement?.parentElement?.firstElementChild).toHaveClass("min-w-0", "flex-1");
    fireEvent.click(screen.getByRole("option", { name: "Kitty" }));

    await waitFor(() => expect(saveCommandBoardTerminalPreferenceMock).toHaveBeenCalledWith("kitty"));
    expect(terminalSelect).toHaveTextContent("Kitty");
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
    expect(responseLanguage).toHaveTextContent("Same as UI");
    fireEvent.click(responseLanguage);
    fireEvent.click(screen.getByRole("option", { name: "Russian" }));

    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      language: "english",
      aiResponseLanguage: "russian",
    })));
  });

  it("shows update details and a single install action when a newer version is available", async () => {
    const update = {
      version: "0.1.5",
      body: "Release notes should not be rendered here.",
    };
    updaterCheckMock.mockResolvedValue(update);
    const updateAvailabilityListener = vi.fn();
    const unsubscribe = subscribeAppEvent(APP_EVENT.updateAvailabilityChanged, updateAvailabilityListener);

    try {
      render(<ApplicationInfoPage version="0.1.0" />);
      expect(screen.getByRole("heading", { name: "mework" })).toBeInTheDocument();
      expect(screen.getByText("0.1.0")).toHaveClass("application-info-version");
      expect(screen.queryByText("Application mework")).not.toBeInTheDocument();
      const releasesButton = screen.getByRole("button", { name: "Release notes" });
      const githubButton = screen.getByRole("button", { name: "View on GitHub" });
      expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
      fireEvent.click(githubButton);
      expect(openUrlMock).toHaveBeenCalledWith("https://github.com/Discoverivan/mework");

      fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
      const installButton = await screen.findByRole("button", { name: "Download & Install" });
      expect(screen.getByText("New version 0.1.5 is available")).toBeInTheDocument();
      expect(screen.queryByText("An update is available")).not.toBeInTheDocument();
      const checkButton = screen.getByRole("button", { name: "Check for updates" });
      expect(checkButton).toHaveTextContent("Check for updates");
      expect(checkButton.querySelector("svg.lucide-refresh-cw")).not.toBeNull();
      expect(screen.getByRole("button", { name: "View release notes" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Release notes" })).toBe(releasesButton);
      expect(await screen.findByText(/^Last checked: today,/)).toBeInTheDocument();
      await waitFor(() => expect(updateAvailabilityListener).toHaveBeenCalledWith(expect.objectContaining({
        availableVersion: "0.1.5",
        status: "available",
        lastCheckedAt: expect.any(Number),
        revision: 2,
      })));
      expect(beginUpdateCheckMock).toHaveBeenCalledOnce();
      expect(recordUpdateCheckResultMock).toHaveBeenCalledWith(1, "0.1.5", true);

      const updateBanner = installButton.closest(".application-update-banner");
      expect(updateBanner).toContainElement(screen.getByRole("button", { name: "View release notes" }));
      expect(updateBanner).toContainElement(installButton);
      expect(screen.getAllByRole("button", { name: "Download & Install" })).toHaveLength(1);
      fireEvent.click(installButton);
      await waitFor(() => expect(installAvailableUpdateMock).toHaveBeenCalledWith(update));
    } finally {
      unsubscribe();
    }
  });

  it("opens the local diagnostics folder from Troubleshooting", async () => {
    invokeMock.mockResolvedValue(undefined);
    render(<ApplicationInfoPage />);

    expect(screen.getByRole("heading", { name: "Troubleshooting" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open logs folder" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("application_open_logs_directory"));
  });

  it("shows the development build with a placeholder version badge", () => {
    render(<ApplicationInfoPage version="dev" />);
    expect(screen.getByRole("heading", { name: "mework-dev" })).toBeInTheDocument();
    expect(screen.getByText("0.0.0")).toHaveClass("application-info-version");
  });

  it("uses the placeholder version badge in mock mode", () => {
    render(<ApplicationInfoPage version="0.2.38" mockMode />);
    expect(screen.getByRole("heading", { name: "mework-dev" })).toBeInTheDocument();
    expect(screen.getByText("0.0.0")).toHaveClass("application-info-version");
  });

  it("checks immediately when About mework is opened from the version indicator", async () => {
    updaterCheckMock.mockResolvedValue({ version: "0.1.5", body: "ignored" });
    const page = render(<ApplicationInfoPage updateCheckRequest={0} />);
    page.rerender(<ApplicationInfoPage updateCheckRequest={1} />);

    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledOnce());
    expect(screen.getByText("New version 0.1.5 is available")).toBeInTheDocument();
  });

  it("checks for application updates and reports when the app is current", async () => {
    render(<ApplicationInfoPage />);

    const button = await screen.findByRole("button", { name: "Check for updates" });
    expect(button).toHaveTextContent("Check for updates");
    expect(button.querySelector("svg.lucide-refresh-cw")).not.toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(updaterCheckMock).toHaveBeenCalledWith({ timeout: 10_000 }));
    expect(await screen.findByText("You're up to date.")).toBeInTheDocument();
    expect(await screen.findByText(/^Last checked: today,/)).toBeInTheDocument();
  });

  it("shows an update-check failure in the application status", async () => {
    updaterCheckMock.mockRejectedValue(new Error("temporary updater failure"));
    render(<ApplicationInfoPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText("Unable to check for updates.")).toBeInTheDocument();
  });
});
