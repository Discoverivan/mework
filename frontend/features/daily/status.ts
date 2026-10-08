export type DailyStatusTone = "backlog" | "progress" | "done" | "blocked" | "review" | "default";

export function dailyStatusTone(status: string): DailyStatusTone {
  const normalized = status.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(done|closed|resolved|complete|completed)\b/.test(normalized)) return "done";
  if (/\b(in progress|implementing|started|development)\b/.test(normalized)) return "progress";
  if (/\b(blocked|阻塞)\b/.test(normalized)) return "blocked";
  if (/\b(review|in review|code review|testing|qa)\b/.test(normalized)) return "review";
  if (/\b(sprint backlog|backlog|to do|open|selected for development)\b/.test(normalized)) return "backlog";
  return "default";
}
