import type { ReleaseNote } from "./index";

export const mockReleaseNotes: ReleaseNote[] = [
  {
    version: "0.0.0-preview.2",
    entries: [
      {
        en: "See a summary of changes after an update.",
        ru: "Смотрите краткую сводку изменений после обновления.",
      },
    ],
  },
  {
    version: "0.0.0-preview.1",
    entries: [
      {
        en: "Open past changes again from About.",
        ru: "Открывайте прошлые изменения повторно в разделе «О приложении».",
      },
    ],
  },
];
