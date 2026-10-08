import type { ReleaseNote } from "./index";

export function mockReleaseNotes(language: "en" | "ru"): ReleaseNote[] {
  const english = language === "en";
  return [
    {
      version: "0.0.0-preview.2",
      language,
      markdown: english
        ? "## Added\n\n- Browse release notes by version from About.\n\n## Changed\n\n- The newest updated version opens first."
        : "## Добавлено\n\n- Просматривайте заметки по версиям в разделе «О приложении».\n\n## Изменено\n\n- После обновления первой открывается заметка о самой новой версии.",
    },
    {
      version: "0.0.0-preview.1",
      language,
      markdown: english
        ? "## Fixed\n\n- Previously loaded notes remain readable without a network connection.\n\n## Removed\n\n- Removed an unused example shortcut."
        : "## Исправлено\n\n- Ранее загруженные заметки остаются доступны без подключения к сети.\n\n## Удалено\n\n- Удалён неиспользуемый демонстрационный ярлык.",
    },
  ];
}
