import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

const { generalSettingsMock, openNotificationSettingsMock, saveGeneralSettingsMock, sendNotificationTestMock } = vi.hoisted(() => ({
  generalSettingsMock: vi.fn(),
  openNotificationSettingsMock: vi.fn(),
  saveGeneralSettingsMock: vi.fn(),
  sendNotificationTestMock: vi.fn(),
}));

vi.mock("./api", () => ({
  generalSettings: generalSettingsMock,
  openNotificationSettings: openNotificationSettingsMock,
  saveGeneralSettings: saveGeneralSettingsMock,
  sendNotificationTest: sendNotificationTestMock,
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
});
