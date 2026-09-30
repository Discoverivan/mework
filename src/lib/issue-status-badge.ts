export function issueStatusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (["done", "closed", "resolved"].some((value) => normalized.includes(value))) return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (["progress", "review", "testing"].some((value) => normalized.includes(value))) return "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-300";
  if (["todo", "to do", "open", "backlog"].some((value) => normalized.includes(value))) return "border-transparent bg-muted text-muted-foreground";
  return "border-transparent bg-secondary text-secondary-foreground";
}
