import { invoke } from "@tauri-apps/api/core";
import { AppLanguage } from "@/i18n/types";

export type NotificationPermission = "granted" | "denied" | "notDetermined";
export type ThemePreference = "system" | "light" | "dark";

export interface GeneralSettings {
  language: AppLanguage;
  themePreference: ThemePreference;
  notificationsEnabled: boolean;
  reviewNotificationsEnabled: boolean;
  authoredNotificationsEnabled: boolean;
  notificationPermission: NotificationPermission;
  permissionCheckError?: string;
}

export interface GeneralSettingsSaveInput {
  notificationsEnabled: boolean;
  reviewNotificationsEnabled: boolean;
  authoredNotificationsEnabled: boolean;
  language: AppLanguage;
  themePreference: ThemePreference;
}

export const generalSettings = () =>
  invoke<GeneralSettings>("general_settings");

export const saveGeneralSettings = (input: GeneralSettingsSaveInput) =>
  invoke<GeneralSettings>("general_settings_save", {
    notificationsEnabled: input.notificationsEnabled,
    reviewNotificationsEnabled: input.reviewNotificationsEnabled,
    authoredNotificationsEnabled: input.authoredNotificationsEnabled,
  });

export const saveAppearanceSettings = (language: AppLanguage, themePreference: ThemePreference) =>
  invoke<GeneralSettings>("general_appearance_save", { language, themePreference });

export const sendNotificationTest = () =>
  invoke<void>("notification_test");

export const openNotificationSettings = () =>
  invoke<void>("notification_open_settings");
