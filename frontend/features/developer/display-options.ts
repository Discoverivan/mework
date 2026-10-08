import { useCallback, useEffect, useState } from "react";

import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";

import type { PullRequestSortOrder } from "./components/pull-request-projects";

export type PullRequestDisplayScope = "reviewer" | "authored";
export type PullRequestQuickFilter = "all" | "pending" | "needs_action";
export type PullRequestGrouping = "none" | "project" | "person";

export interface PullRequestDisplayPreferences {
  grouping: PullRequestGrouping;
  expandProjectsByDefault: boolean;
  sortOrder: PullRequestSortOrder;
}

export const DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES: PullRequestDisplayPreferences = {
  grouping: "project",
  expandProjectsByDefault: false,
  sortOrder: "newest",
};

const STORAGE_PREFIX = "mework.pull-request-display-options.v1";
const QUICK_FILTER_STORAGE_PREFIX = "mework.pull-request-quick-filter.v1";

function storageKey(scope: PullRequestDisplayScope): string {
  return `${STORAGE_PREFIX}.${scope}`;
}

function isSortOrder(value: unknown): value is PullRequestSortOrder {
  return value === "newest" || value === "oldest";
}

function isGrouping(value: unknown): value is PullRequestGrouping {
  return value === "none" || value === "project" || value === "person";
}

export function readPullRequestDisplayPreferences(scope: PullRequestDisplayScope): PullRequestDisplayPreferences {
  if (typeof window === "undefined") return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES;
    const value = parsed as Partial<PullRequestDisplayPreferences> & { groupByProject?: boolean };
    return {
      grouping: isGrouping(value.grouping)
        ? value.grouping
        : typeof value.groupByProject === "boolean" ? (value.groupByProject ? "project" : "none") : DEFAULT_PULL_REQUEST_DISPLAY_PREFERENCES.grouping,
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

function defaultQuickFilter(scope: PullRequestDisplayScope): PullRequestQuickFilter {
  return scope === "reviewer" ? "pending" : "needs_action";
}

function readQuickFilter(scope: PullRequestDisplayScope): PullRequestQuickFilter {
  if (typeof window === "undefined") return defaultQuickFilter(scope);
  try {
    const saved = window.localStorage.getItem(`${QUICK_FILTER_STORAGE_PREFIX}.${scope}`);
    if (saved === "all" || (scope === "reviewer" && saved === "pending") || (scope === "authored" && saved === "needs_action")) return saved;
  } catch {
    // Local storage is an optional persistence layer.
  }
  return defaultQuickFilter(scope);
}

export function usePullRequestQuickFilter(scope: PullRequestDisplayScope) {
  const [filter, setFilter] = useState<PullRequestQuickFilter>(() => readQuickFilter(scope));
  useEffect(() => subscribeAppEvent(APP_EVENT.pullRequestQuickFilterChanged, (change) => {
    if (change.scope === scope) setFilter(change.filter);
  }), [scope]);
  const updateFilter = useCallback((value: PullRequestQuickFilter) => {
    setFilter(value);
    try {
      window.localStorage.setItem(`${QUICK_FILTER_STORAGE_PREFIX}.${scope}`, value);
    } catch {
      // Local storage is an optional persistence layer.
    }
    emitAppEvent(APP_EVENT.pullRequestQuickFilterChanged, { scope, filter: value });
  }, [scope]);
  return [filter, updateFilter] as const;
}

export function clearPullRequestDisplayPreferencesForTests(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey("reviewer"));
    window.localStorage.removeItem(storageKey("authored"));
    window.localStorage.removeItem(`${QUICK_FILTER_STORAGE_PREFIX}.reviewer`);
    window.localStorage.removeItem(`${QUICK_FILTER_STORAGE_PREFIX}.authored`);
  } catch {
    // Local storage is an optional persistence layer.
  }
}
