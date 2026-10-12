import { expect, it } from "vitest";
import { formatDisplayDate, formatDisplayDateTime } from "./display-date";

it("uses dotted local dates in both supported languages and compact date labels", () => {
  const date = new Date(2026, 9, 12, 14, 5);
  expect(formatDisplayDate(date)).toBe("12.10.2026");
  expect(formatDisplayDate(date, { year: false })).toBe("12.10");
  for (const locale of ["en-US", "ru-RU"]) {
    expect(formatDisplayDateTime(date, locale, { hour12: false })).toBe("12.10.2026, 14:05");
  }
});
