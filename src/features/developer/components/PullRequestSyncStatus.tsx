import type { ReactNode } from "react";

import { formatRelativeDate } from "./PullRequestListItem";

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
  if (lastSyncAt == null) return null;
  const nextUpdate = nextSyncLabel(lastSyncAt, now);
  return (
    <p className="text-xs text-muted-foreground">
      <time
        dateTime={new Date(lastSyncAt).toISOString()}
        title={`Next update: ${nextUpdate}`}
        aria-label={`Last updated ${formatSyncTimestamp(lastSyncAt)}. Next update: ${nextUpdate}`}
      >
        Last updated: {formatRelativeDate(lastSyncAt)} · Next update: {nextUpdate}
      </time>
      {children}
    </p>
  );
}
