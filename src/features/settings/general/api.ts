import { invoke } from "@tauri-apps/api/core";

export type NotificationPermission = "granted" | "denied" | "notDetermined";

export interface GeneralSettings {
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission;
  permissionCheckError?: string;
}

export const generalSettings = () =>
  invoke<GeneralSettings>("general_settings");

export const saveGeneralSettings = (notificationsEnabled: boolean) =>
  invoke<GeneralSettings>("general_settings_save", { notificationsEnabled });

export const sendNotificationTest = () =>
  invoke<void>("notification_test");

export const openNotificationSettings = () =>
  invoke<void>("notification_open_settings");
