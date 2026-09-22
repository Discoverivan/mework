import { useCallback, useState } from "react";

import type { PullRequestSortOrder } from "./components/pull-request-projects";

export type PullRequestDisplayScope = "reviewer" | "authored";

export interface PullRequestDisplayPreferences {
  groupByProject: boolean;
  expandProjectsByDefault: boolean;
  sortOrder: PullRequestSortOrder;
}

export const DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES: PullRequestDisplayPreferences = {
  groupByProject: true,
  expandProjectsByDefault: false,
  sortOrder: "newest",
};

const STORAGE_PREFIX = "mework.pull-request-display-options.v1";

function storageKey(scope: PullRequestDisplayScope): string {
  return `${STORAGE_PREFIX}.${scope}`;
}

function isSortOrder(value: unknown): value is PullRequestSortOrder {
  return value === "newest" || value === "oldest";
}

export function readPullRequestDisplayPreferences(scope: PullRequestDisplayScope): PullRequestDisplayPreferences {
  if (typeof window === "undefined") return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
    const value = parsed as Partial<PullRequestDisplayPreferences>;
    return {
      groupByProject: typeof value.groupByProject === "boolean"
        ? value.groupByProject
        : DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES.groupByProject,
      expandProjectsByDefault: typeof value.expandProjectsByDefault === "boolean"
        ? value.expandProjectsByDefault
        : DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES.expandProjectsByDefault,
      sortOrder: isSortOrder(value.sortOrder)
        ? value.sortOrder
        : DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES.sortOrder,
    };
  } catch {
    return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
  }
}

export function writePullRequestDisplayPreferences(
  scope: PullRequestDisplayScope,
  preferences: PullRequestDisplayPreferences,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(preferences));
  } catch {
    // Local storage is an optional persistence layer.
  }
}

export function usePullRequestDisplayPreferences(scope: PullRequestDisplayScope) {
  const [preferences, setPreferences] = useState<PullRequestDisplayPreferences>(() =>
    readPullRequestDisplayPreferences(scope),
  );
  const updatePreferences = useCallback((patch: Partial<PullRequestDisplayPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writePullRequestDisplayPreferences(scope, next);
      return next;
    });
  }, [scope]);
  return [preferences, updatePreferences] as const;
}

export function clearPullRequestDisplayPreferencesForTests(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey("reviewer"));
    window.localStorage.removeItem(storageKey("authored"));
  } catch {
    // Local storage is an optional persistence layer.
  }
}
