export enum AppLanguage {
  English = "english",
  Russian = "russian",
}

export const APP_LANGUAGE_LOCALES: Record<AppLanguage, string> = {
  [AppLanguage.English]: "en-GB",
  [AppLanguage.Russian]: "ru-RU",
};

export type TranslationParams = Record<string, string | number>;
