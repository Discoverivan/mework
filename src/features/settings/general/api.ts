import { invoke } from "@tauri-apps/api/core";
import { AppLanguage } from "@/i18n/types";

export type NotificationPermission = "granted" | "denied" | "notDetermined";
export type NotificationTestKind = "review" | "authored";
export type ThemePreference = "system" | "light" | "dark";

export interface GeneralSettings {
  language: AppLanguage;
  themePreference: ThemePreference;
  notificationsEnabled: boolean;
  reviewNotificationsEnabled: boolean;
  authoredNotificationsEnabled: boolean;
  taskTrackerNotificationsEnabled: boolean;
  notificationPermission: NotificationPermission;
  permissionCheckError?: string;
}

export interface GeneralSettingsSaveInput {
  notificationsEnabled: boolean;
  reviewNotificationsEnabled: boolean;
  authoredNotificationsEnabled: boolean;
  taskTrackerNotificationsEnabled: boolean;
  language: AppLanguage;
  themePreference: ThemePreference;
}

export const generalSettings = () =>
  invoke<GeneralSettings>("general_settings", {
    systemLanguage: typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru")
      ? AppLanguage.Russian
      : AppLanguage.English,
  });

export const saveGeneralSettings = (input: GeneralSettingsSaveInput) =>
  invoke<GeneralSettings>("general_settings_save", {
    notificationsEnabled: input.notificationsEnabled,
    reviewNotificationsEnabled: input.reviewNotificationsEnabled,
    authoredNotificationsEnabled: input.authoredNotificationsEnabled,
    taskTrackerNotificationsEnabled: input.taskTrackerNotificationsEnabled,
  });

export const saveAppearanceSettings = (language: AppLanguage, themePreference: ThemePreference) =>
  invoke<GeneralSettings>("general_appearance_save", { language, themePreference });

export const sendNotificationTest = (notificationKind: NotificationTestKind) =>
  invoke<void>("notification_test", { notificationKind });

export const requestNotificationPermission = () =>
  invoke<NotificationPermission>("notification_request_permission");

export const openNotificationSettings = () =>
  invoke<void>("notification_open_settings");
