/** Human-readable local dates; machine timestamps and filenames keep their own formats. */
export function formatDisplayDate(value: Date | number | string, { year = true }: { year?: boolean } = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  const dayMonth = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  return year ? `${dayMonth}.${date.getFullYear()}` : dayMonth;
}

export function formatDisplayDateTime(value: Date | number | string, locale: string, { seconds = false, hour12 }: { seconds?: boolean; hour12?: boolean } = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: seconds ? "medium" : "short", hour12 }).format(date);
  return `${formatDisplayDate(date)}, ${time}`;
}
