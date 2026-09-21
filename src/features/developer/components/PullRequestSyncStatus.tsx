import type { ReactNode } from "react";

import { formatRelativeDate } from "./PullRequestListItem";
import { useI18n } from "@/i18n/context";

const POLL_INTERVAL_MS = 300_000;

export function formatSyncTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function nextSyncLabel(lastSyncAt: number | undefined, now = Date.now()): string {
  if (lastSyncAt == null) return "after the first successful sync";
  const remaining = Math.max(0, lastSyncAt + POLL_INTERVAL_MS - now);
  if (remaining === 0) return "now";
  return `in ${Math.ceil(remaining / 60_000)} min`;
}

export function PullRequestSyncStatus({
  lastSyncAt,
  now,
  children,
}: {
  lastSyncAt?: number;
  now?: number;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  if (lastSyncAt == null) return null;
  const remaining = Math.max(0, lastSyncAt + POLL_INTERVAL_MS - (now ?? Date.now()));
  const nextUpdate = remaining === 0
    ? t("pr.sync.now")
    : t("pr.sync.inMinutes", { count: Math.ceil(remaining / 60_000) });
  const formattedLastSync = formatSyncTimestamp(lastSyncAt);
  const relativeLastSync = formatRelativeDate(lastSyncAt, t);
  return (
    <p className="text-xs text-muted-foreground">
      <time
        dateTime={new Date(lastSyncAt).toISOString()}
        title={t("pr.sync.next", { next: nextUpdate })}
        aria-label={t("pr.sync.aria", { last: formattedLastSync, next: nextUpdate })}
      >
        {t("pr.sync.label", { last: relativeLastSync, next: nextUpdate })}
      </time>
      {children}
    </p>
  );
}
