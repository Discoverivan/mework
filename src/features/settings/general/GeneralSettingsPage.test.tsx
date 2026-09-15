import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

const { generalSettingsMock, openNotificationSettingsMock, saveGeneralSettingsMock, sendNotificationTestMock, updaterCheckMock, installAvailableUpdateMock } = vi.hoisted(() => ({
  generalSettingsMock: vi.fn(),
  openNotificationSettingsMock: vi.fn(),
  saveGeneralSettingsMock: vi.fn(),
  sendNotificationTestMock: vi.fn(),
  updaterCheckMock: vi.fn(),
  installAvailableUpdateMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterCheckMock }));

vi.mock("./api", () => ({
  generalSettings: generalSettingsMock,
  openNotificationSettings: openNotificationSettingsMock,
  saveGeneralSettings: saveGeneralSettingsMock,
  sendNotificationTest: sendNotificationTestMock,
}));

vi.mock("@/components/shared/update-install", () => ({
  installAvailableUpdate: installAvailableUpdateMock,
}));

describe("GeneralSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generalSettingsMock.mockResolvedValue({
      notificationsEnabled: true,
      notificationPermission: "denied",
    });
    openNotificationSettingsMock.mockResolvedValue(undefined);
    saveGeneralSettingsMock.mockResolvedValue({
      notificationsEnabled: true,
      notificationPermission: "denied",
    });
    sendNotificationTestMock.mockResolvedValue(undefined);
    updaterCheckMock.mockResolvedValue(null);
    installAvailableUpdateMock.mockResolvedValue(undefined);
  });

  it("shows the permission banner and supports settings and test notification controls", async () => {
    render(<GeneralSettingsPage />);

    expect(await screen.findByRole("checkbox", { name: "Notifications" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "Notifications are not allowed" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Notification Settings" }));
    await waitFor(() => expect(openNotificationSettingsMock).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Test notification" }));
    await waitFor(() => expect(sendNotificationTestMock).toHaveBeenCalledOnce());

    saveGeneralSettingsMock.mockResolvedValue({
      notificationsEnabled: false,
      notificationPermission: "denied",
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Notifications" }));
    await waitFor(() => expect(saveGeneralSettingsMock).toHaveBeenCalledWith(false));
  });

  it("offers Update now when a newer application version is available", async () => {
    const update = {
      version: "0.1.5",
      body: "Release notes should not be rendered here.",
    };
    updaterCheckMock.mockResolvedValue(update);

    render(<GeneralSettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("mework 0.1.5 is available.")).toBeInTheDocument();

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
