import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Filter, Loader2, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import type {
  BitbucketRepository,
  BitbucketUser,
  MyPullRequest,
  MyPullRequestDecision,
  MyPullRequestPage,
  PullRequestReviewChangedEvent,
  PullRequestReviewSeverity,
  PullRequestReviewSettings,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewState,
  listMyPullRequests,
  markAllPullRequestsRead,
  markPullRequestRead,
  refreshMyPullRequests,
  savePullRequestReviewSettings,
  searchBitbucketRepositories,
  searchBitbucketUsers,
  startPullRequestReview,
} from "./api";

const POLL_INTERVAL_MS = 300_000;

const decisionLabels: Record<MyPullRequestDecision, string> = {
  approved: "Approved",
  needs_work: "Needs work",
  not_reviewed: "Review pending",
};

type FilterTab = "blacklist" | "whitelist";
type FilterKind = "repository" | "creator";
type FilterField =
  | "repositoryBlacklist"
  | "creatorBlacklist"
  | "repositoryWhitelist"
  | "creatorWhitelist";

function filterField(tab: FilterTab, kind: FilterKind): FilterField {
  if (tab === "blacklist") return kind === "repository" ? "repositoryBlacklist" : "creatorBlacklist";
  return kind === "repository" ? "repositoryWhitelist" : "creatorWhitelist";
}

const reviewSeveritySections: Array<{
  key: PullRequestReviewSeverity;
  label: string;
  defaultOpen: boolean;
}> = [
  { key: "blocker", label: "Blocker", defaultOpen: true },
  { key: "high", label: "High", defaultOpen: true },
  { key: "medium", label: "Medium", defaultOpen: false },
  { key: "low", label: "Low", defaultOpen: false },
];


const emptySettings: PullRequestReviewSettings = {
  repositoryBlacklist: [],
  creatorBlacklist: [],
  repositoryWhitelist: [],
  creatorWhitelist: [],
  autoReviewEnabled: false,
};

function repositoryKey(pullRequest: MyPullRequest): string {
  return `${pullRequest.projectKey}/${pullRequest.repositorySlug}`;
}

function repositoryOptionKey(repository: BitbucketRepository): string {
  return `${repository.projectKey}/${repository.repositorySlug}`;
}

function repositoryOptionLabel(repository: BitbucketRepository): string {
  return `${repositoryOptionKey(repository)} · ${repository.repositoryName}`;
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function matchesSettings(pullRequest: MyPullRequest, settings: PullRequestReviewSettings): boolean {
  const whitelistValues = [...settings.repositoryWhitelist, ...settings.creatorWhitelist];
  const blacklistValues = [...settings.repositoryBlacklist, ...settings.creatorBlacklist];
  const repositoryWhitelistMatches = settings.repositoryWhitelist.some((value) =>
    [repositoryKey(pullRequest), pullRequest.repositorySlug, pullRequest.repositoryName]
      .some((candidate) => equalsIgnoreCase(value, candidate)),
  );
  const creatorWhitelistMatches = settings.creatorWhitelist.some((value) =>
    equalsIgnoreCase(value, pullRequest.authorDisplayName),
  );
  const repositoryBlacklistMatches = settings.repositoryBlacklist.some((value) =>
    [repositoryKey(pullRequest), pullRequest.repositorySlug, pullRequest.repositoryName]
      .some((candidate) => equalsIgnoreCase(value, candidate)),
  );
  const creatorBlacklistMatches = settings.creatorBlacklist.some((value) =>
    equalsIgnoreCase(value, pullRequest.authorDisplayName),
  );
  const whitelistMatches = repositoryWhitelistMatches || creatorWhitelistMatches;
  const blacklistMatches = repositoryBlacklistMatches || creatorBlacklistMatches;
  if (whitelistValues.length > 0) return whitelistMatches;
  if (blacklistValues.length > 0) return !blacklistMatches;
  return true;
}

function commandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const structured = error as { message?: unknown; code?: unknown };
    if (typeof structured.message === "string" && structured.message.trim()) return structured.message;
    if (typeof structured.code === "string" && structured.code.trim()) return `Command failed (${structured.code})`;
  }
  return "Unknown command error";
}

function pullRequestKey(
  pullRequest: Pick<MyPullRequest, "integrationId" | "projectKey" | "repositorySlug" | "pullRequestId">
): string {
  return `${pullRequest.integrationId}:${pullRequest.projectKey}:${pullRequest.repositorySlug}:${pullRequest.pullRequestId}`;
}

function activityLabel(activity: MyPullRequest["activity"]): string | undefined {
  if (activity === "new") return "NEW";
  if (activity === "updated") return "UPDATED";
  return undefined;
}

function activityRank(activity: MyPullRequest["activity"]): number {
  if (activity === "new") return 0;
  if (activity === "updated") return 1;
  return 2;
}

function sortPullRequests(values: MyPullRequest[]): MyPullRequest[] {
  return [...values].sort((left, right) => {
    const activityOrder = activityRank(left.activity) - activityRank(right.activity);
    if (activityOrder !== 0) return activityOrder;
    const leftUpdated = left.updatedDate ?? Number.NEGATIVE_INFINITY;
    const rightUpdated = right.updatedDate ?? Number.NEGATIVE_INFINITY;
    return rightUpdated - leftUpdated || left.pullRequestId.localeCompare(right.pullRequestId);
  });
}

function formatRelativeDate(timestamp?: number): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "Unknown update";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`;
  if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)}mo ago`;
  return `${Math.floor(seconds / 31_536_000)}y ago`;
}

function formatSyncTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function nextSyncLabel(lastSyncAt: number | undefined, now = Date.now()): string {
  if (lastSyncAt == null) return "after the first successful sync";
  const remaining = Math.max(0, lastSyncAt + POLL_INTERVAL_MS - now);
  if (remaining === 0) return "now";
  return `in ${Math.ceil(remaining / 60_000)} min`;
}

function creatorInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

function CreatorAvatar({ pullRequest }: { pullRequest: MyPullRequest }) {
  const [failed, setFailed] = useState(false);
  if (pullRequest.authorAvatarUrl && !failed) {
    return (
      <img
        src={pullRequest.authorAvatarUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium" aria-hidden="true">
      {creatorInitials(pullRequest.authorDisplayName)}
    </span>
  );
}

export function MyPullRequestsPage() {
  const [pullRequests, setPullRequests] = useState<MyPullRequest[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettingsPageData | null>(null);
  const [settings, setSettings] = useState<PullRequestReviewSettings>(emptySettings);
  const [draftSettings, setDraftSettings] = useState<PullRequestReviewSettings>(emptySettings);
  const [repositoryInput, setRepositoryInput] = useState("");
  const [repositorySearchResults, setRepositorySearchResults] = useState<BitbucketRepository[]>([]);
  const [repositorySearchLoading, setRepositorySearchLoading] = useState(false);
  const [repositorySearchError, setRepositorySearchError] = useState<string>();
  const [creatorInput, setCreatorInput] = useState("");
  const [creatorSearchResults, setCreatorSearchResults] = useState<BitbucketUser[]>([]);
  const [creatorSearchLoading, setCreatorSearchLoading] = useState(false);
  const [creatorSearchError, setCreatorSearchError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("whitelist");
  const [saving, setSaving] = useState(false);
  const [autoReviewSaving, setAutoReviewSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();
  const [total, setTotal] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [polling, setPolling] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [readAllPending, setReadAllPending] = useState(false);
  const [reviewStartingKeys, setReviewStartingKeys] = useState<Set<string>>(() => new Set());
  const [reviewDialogKey, setReviewDialogKey] = useState<string>();

  const applyPage = useCallback((page: MyPullRequestPage) => {
    setPullRequests((current) => {
      const currentByKey = new Map(current.map((item) => [pullRequestKey(item), item]));
      const nextValues = (Array.isArray(page.values) ? page.values : []).map((item) => {
        const previous = currentByKey.get(pullRequestKey(item));
        const preservedReview = previous?.review?.status === "running"
          && previous.latestCommit === item.latestCommit
          && item.review == null
          ? previous.review
          : item.review;
        if (previous?.activity === "read" && previous.latestCommit === item.latestCommit) {
          return { ...item, activity: "read" as const, review: preservedReview };
        }
        return { ...item, review: preservedReview };
      });
      return sortPullRequests(nextValues);
    });
    setTotal(page.total ?? undefined);
    if (page.lastUpdatedAt != null) {
      setLastSyncAt(page.lastUpdatedAt);
      setNow(page.lastUpdatedAt);
    }
  }, []);

  const aiReviewReady = aiSettings?.settings.provider !== null && aiSettings?.providers.some((provider) =>
    provider.id === aiSettings.settings.provider
      && provider.available
      && provider.status === "connected"
      && provider.models.includes(aiSettings.settings.model),
  ) === true;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setAiSettings(null);
    void Promise.all([listMyPullRequests(0, 100), getPullRequestReviewSettings()])
      .then(([page, savedSettings]) => {
        if (!active) return;
        applyPage(page);
        setSettings(savedSettings ?? emptySettings);
      })
      .catch((reason) => {
        if (active) {
          setPullRequests([]);
          setError(commandError(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void getAiSettings()
      .then((savedAiSettings) => {
        if (active) setAiSettings(savedAiSettings);
      })
      .catch(() => {
        if (active) setAiSettings(null);
      });
    return () => {
      active = false;
    };
  }, [applyPage]);

  const syncPullRequests = useCallback(async () => {
    setPolling(true);
    setError(undefined);
    try {
      const page = await refreshMyPullRequests(0, 100);
      applyPage(page);
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setPolling(false);
    }
  }, [applyPage]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<MyPullRequestPage>("pull_request_review_updated", (event) => {
      if (active) applyPage(event.payload);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => {
      // The event bridge is unavailable in non-Tauri test environments.
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyPage]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<PullRequestReviewChangedEvent>("pull_request_review_changed", (event) => {
      if (!active) return;
      const { key, review } = event.payload;
      setReviewStartingKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, review } : item,
      )));
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => {
      // The event bridge is unavailable in non-Tauri test environments.
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const runningPullRequests = pullRequests.filter((pullRequest) => pullRequest.review?.status === "running");
    if (runningPullRequests.length === 0) return;
    let active = true;

    const reconcile = async () => {
      const updates = await Promise.all(runningPullRequests.map(async (pullRequest) => {
        try {
          return {
            key: pullRequestKey(pullRequest),
            runId: pullRequest.review?.runId,
            review: await getPullRequestReviewState(pullRequest),
          };
        } catch {
          return null;
        }
      }));
      if (!active) return;
      const availableUpdates = updates.filter((update): update is {
        key: string;
        runId: string;
        review: PullRequestReviewState;
      } => update?.review != null && update.runId != null && update.review.runId === update.runId);
      if (availableUpdates.length === 0) return;
      setPullRequests((current) => {
        let changed = false;
        const next = current.map((pullRequest) => {
          const key = pullRequestKey(pullRequest);
          const update = availableUpdates.find((candidate) => candidate.key === key);
          if (!update || pullRequest.review?.runId !== update.runId) return pullRequest;
          changed = true;
          return { ...pullRequest, review: update.review };
        });
        return changed ? sortPullRequests(next) : current;
      });
    };

    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pullRequests]);

  useEffect(() => {
    const query = repositoryInput.trim();
    if (!settingsOpen || query.length < 3) {
      setRepositorySearchResults([]);
      setRepositorySearchLoading(false);
      setRepositorySearchError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setRepositorySearchLoading(true);
      setRepositorySearchError(undefined);
      searchBitbucketRepositories(query)
        .then((repositories) => {
          if (active) setRepositorySearchResults(repositories);
        })
        .catch((reason) => {
          if (active) {
            setRepositorySearchResults([]);
            setRepositorySearchError(commandError(reason));
          }
        })
        .finally(() => {
          if (active) setRepositorySearchLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [repositoryInput, settingsOpen]);

  useEffect(() => {
    const query = creatorInput.trim();
    if (!settingsOpen || query.length < 3) {
      setCreatorSearchResults([]);
      setCreatorSearchLoading(false);
      setCreatorSearchError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setCreatorSearchLoading(true);
      setCreatorSearchError(undefined);
      searchBitbucketUsers(query)
        .then((users) => {
          if (active) setCreatorSearchResults(users);
        })
        .catch((reason) => {
          if (active) {
            setCreatorSearchResults([]);
            setCreatorSearchError(commandError(reason));
          }
        })
        .finally(() => {
          if (active) setCreatorSearchLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [creatorInput, settingsOpen]);

  const repositorySearchMatch = repositorySearchResults.find((repository) =>
    equalsIgnoreCase(repositoryOptionKey(repository), repositoryInput),
  );
  const creatorSearchMatch = creatorSearchResults.find((user) =>
    Boolean(user.displayName && equalsIgnoreCase(user.displayName, creatorInput)),
  );
  const filteredPullRequests = pullRequests.filter((pullRequest) => matchesSettings(pullRequest, settings));
  const reviewDialogPullRequest = reviewDialogKey
    ? pullRequests.find((pullRequest) => pullRequestKey(pullRequest) === reviewDialogKey)
    : undefined;
  const reviewDialogReview: PullRequestReviewState | undefined = reviewDialogPullRequest?.review;

  function openSettings() {
    setDraftSettings({
      repositoryBlacklist: [...settings.repositoryBlacklist],
      creatorBlacklist: [...settings.creatorBlacklist],
      repositoryWhitelist: [...settings.repositoryWhitelist],
      creatorWhitelist: [...settings.creatorWhitelist],
      autoReviewEnabled: settings.autoReviewEnabled,
    });
    setFilterTab("whitelist");
    setRepositoryInput("");
    setRepositorySearchResults([]);
    setRepositorySearchError(undefined);
    setCreatorInput("");
    setCreatorSearchResults([]);
    setCreatorSearchError(undefined);
    setSettingsError(undefined);
    setSettingsOpen(true);
  }

  function addValue(kind: FilterKind, selectedValue?: string) {
    const field = filterField(filterTab, kind);
    const input = kind === "repository" ? repositoryInput : creatorInput;
    const value = (selectedValue ?? input).trim();
    if (!value) return;
    setDraftSettings((current) => {
      if (current[field].some((existing) => equalsIgnoreCase(existing, value))) return current;
      return { ...current, [field]: [...current[field], value] };
    });
    if (kind === "repository") setRepositoryInput("");
    else {
      setCreatorInput("");
      setCreatorSearchResults([]);
    }
  }

  function removeValue(kind: FilterKind, value: string) {
    const field = filterField(filterTab, kind);
    setDraftSettings((current) => ({
      ...current,
      [field]: current[field].filter((existing) => existing !== value),
    }));
  }

  async function saveSettings() {
    setSaving(true);
    setSettingsError(undefined);
    try {
      const saved = await savePullRequestReviewSettings(draftSettings);
      setSettings(saved);
      setSettingsOpen(false);
      await syncPullRequests();
    } catch (reason) {
      setSettingsError(commandError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function toggleAutoReview(enabled: boolean) {
    setAutoReviewSaving(true);
    setError(undefined);
    try {
      const saved = await savePullRequestReviewSettings({ ...settings, autoReviewEnabled: enabled });
      setSettings(saved);
      setDraftSettings((current) => ({ ...current, autoReviewEnabled: saved.autoReviewEnabled }));
    } catch (reason) {
      setError(`Unable to save AI auto-review setting. ${commandError(reason)}`);
    } finally {
      setAutoReviewSaving(false);
    }
  }

  async function markRead(pullRequest: MyPullRequest) {
    const key = pullRequestKey(pullRequest);
    setError(undefined);
    try {
      const readState = await markPullRequestRead(
        pullRequest.integrationId,
        pullRequest.projectKey,
        pullRequest.repositorySlug,
        pullRequest.pullRequestId,
        pullRequest.latestCommit,
      );
      setPullRequests((current) => sortPullRequests(current.map((item) => pullRequestKey(item) === key ? { ...item, activity: readState.activity } : item)));
    } catch (reason) {
      setError(commandError(reason));
    }
  }

  async function markAllRead() {
    setReadAllPending(true);
    setError(undefined);
    try {
      await markAllPullRequestsRead();
      setPullRequests((current) => sortPullRequests(current.map((item) => ({ ...item, activity: "read" }))));
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setReadAllPending(false);
    }
  }

  async function startReview(pullRequest: MyPullRequest) {
    const key = pullRequestKey(pullRequest);
    if (!aiReviewReady) {
      setError("Select a connected AI provider in Settings → Integrations before starting a review.");
      return;
    }
    if (!pullRequest.url || !pullRequest.latestCommit) {
      setError("This pull request has no reviewable URL or latest commit.");
      return;
    }
    setError(undefined);
    setReviewStartingKeys((current) => new Set(current).add(key));
    try {
      const review = await startPullRequestReview(pullRequest);
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, review } : item,
      )));
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setReviewStartingKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  const activeRepositoryField = filterField(filterTab, "repository");
  const activeCreatorField = filterField(filterTab, "creator");
  const activeTabLabel = filterTab === "blacklist" ? "Blacklist" : "Whitelist";

  return (
    <section aria-labelledby="pull-request-review-title" className="space-y-4">
      <header className="page-header">
        <div>
          <p className="eyebrow">Developer</p>
          <h1 id="pull-request-review-title">Pull Request Review</h1>
          {!loading && !error ? (
            <p className="text-sm text-muted-foreground">
              {total ?? pullRequests.length} review requests · {settings.repositoryBlacklist.length + settings.creatorBlacklist.length + settings.repositoryWhitelist.length + settings.creatorWhitelist.length} permanent filters · sorted by PR update date
              {polling ? " · Checking for updates…" : ""}
            </p>
          ) : null}
          {lastSyncAt != null ? (
            <p className="text-xs text-muted-foreground">
              <time
                dateTime={new Date(lastSyncAt).toISOString()}
                title={`Next update: ${nextSyncLabel(lastSyncAt, now)}`}
                aria-label={`Last updated ${formatSyncTimestamp(lastSyncAt)}. Next update: ${nextSyncLabel(lastSyncAt, now)}`}
              >
                Last updated: {formatRelativeDate(lastSyncAt)} · Next update: {nextSyncLabel(lastSyncAt, now)}
              </time>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <input
              type="checkbox"
              aria-label="AI auto-review"
              checked={settings.autoReviewEnabled}
              onChange={(event) => void toggleAutoReview(event.target.checked)}
              disabled={loading || autoReviewSaving}
            />
            <Sparkles aria-hidden="true" className="size-4" />
            AI auto-review
          </label>
          <Button type="button" variant="outline" onClick={() => void syncPullRequests()} disabled={loading || polling}>
            {polling ? "Updating…" : "Update now"}
          </Button>
          <Button type="button" variant="outline" onClick={openSettings} disabled={loading}>
            <Filter aria-hidden="true" />
            Permanent filters
          </Button>
          <Button type="button" variant="outline" onClick={() => void markAllRead()} disabled={loading || readAllPending || pullRequests.every((item) => item.activity === "read")}>
            {readAllPending ? "Saving…" : "Read all"}
          </Button>
        </div>
      </header>

      {loading ? <div role="status" aria-label="Loading pull request review">Loading pull requests…</div> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Pull Request Review unavailable</AlertTitle>
          <AlertDescription>Unable to load pull request review. {error}</AlertDescription>
        </Alert>
      ) : null}
      {!loading && !error && pullRequests.length === 0 ? (
        <Card><CardContent className="pt-6"><p>No open pull requests have you as a reviewer.</p></CardContent></Card>
      ) : null}
      {!loading && !error && pullRequests.length > 0 && filteredPullRequests.length === 0 ? (
        <Card><CardContent className="pt-6"><p>No pull requests match the permanent filters.</p></CardContent></Card>
      ) : null}

      <div className="inbox-list" aria-live="polite">
        {filteredPullRequests.map((pullRequest) => {
          const activity = activityLabel(pullRequest.activity);
          const itemKey = pullRequestKey(pullRequest);
          const review = pullRequest.review;
          const reviewRunning = reviewStartingKeys.has(itemKey) || review?.status === "running";
          const reviewCompleted = review?.status === "completed" && review.result != null;
          return (
            <Card
              key={itemKey}
              className={pullRequest.activity === "new" ? "border-l-4 border-l-primary" : pullRequest.activity === "updated" ? "border-l-4 border-l-amber-500" : undefined}
            >
              <CardContent className="space-y-2.5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="truncate font-semibold">{pullRequest.projectKey}/{pullRequest.repositoryName}</span>
                    <span className="shrink-0 text-muted-foreground">#{pullRequest.pullRequestId}</span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {activity ? <Badge variant={pullRequest.activity === "new" ? "default" : "secondary"}>{activity}</Badge> : null}
                    <Badge variant="outline">{decisionLabels[pullRequest.myDecision]}</Badge>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 flex-1 break-words text-base font-semibold leading-5">
                    {pullRequest.url ? (
                      <a
                        href={pullRequest.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => void markRead(pullRequest)}
                        className="hover:underline"
                      >
                        {pullRequest.title}
                      </a>
                    ) : pullRequest.title}
                  </h2>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => reviewCompleted ? setReviewDialogKey(itemKey) : void startReview(pullRequest)}
                      disabled={reviewRunning || (!reviewCompleted && !aiReviewReady)}
                      title={reviewCompleted ? undefined : !aiReviewReady ? "Select a connected AI provider in Settings → Integrations" : review?.status === "failed" ? review.error ?? undefined : undefined}
                    >
                      {reviewRunning ? <><Loader2 aria-hidden="true" className="animate-spin" /> Reviewing</> : reviewCompleted ? "Review Results" : <><Sparkles aria-hidden="true" /> PR Review</>}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{pullRequest.sourceBranch} <span aria-hidden="true">→</span> {pullRequest.targetBranch}</span>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CreatorAvatar pullRequest={pullRequest} />
                  <span className="font-medium text-foreground">{pullRequest.authorDisplayName}</span>
                  <span aria-hidden="true">•</span>
                  <time dateTime={pullRequest.updatedDate != null ? new Date(pullRequest.updatedDate).toISOString() : undefined}>
                    {formatRelativeDate(pullRequest.updatedDate)}
                  </time>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={Boolean(reviewDialogKey && reviewDialogReview?.status === "completed" && reviewDialogReview.result)}
        onOpenChange={(open) => {
          if (!open) setReviewDialogKey(undefined);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review results</DialogTitle>
            <DialogDescription className="break-words">
              {reviewDialogPullRequest?.projectKey}/{reviewDialogPullRequest?.repositoryName} #{reviewDialogPullRequest?.pullRequestId} · {reviewDialogPullRequest?.title}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            {reviewDialogReview?.result ? (
              <>
                <div className="rounded-md border p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall result</p>
                  <p className={reviewDialogReview.result.verdict === "ok" ? "mt-1 text-2xl font-bold text-emerald-600" : "mt-1 text-2xl font-bold text-destructive"}>
                    {reviewDialogReview.result.verdict === "ok" ? "OK" : "Needs changes"}
                  </p>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">PR description</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">{reviewDialogReview.result.description}</p>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Review summary</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">{reviewDialogReview.result.summary}</p>
                </div>
                <div className="space-y-2">
                  {reviewSeveritySections.map((section) => {
                    const comments = reviewDialogReview.result?.comments.filter((comment) => comment.severity === section.key) ?? [];
                    return (
                      <details key={section.key} open={section.defaultOpen} className="rounded-md border">
                        <summary className="cursor-pointer list-inside px-3 py-2 text-sm font-semibold">
                          {section.label} ({comments.length})
                        </summary>
                        <div className="border-t px-3 py-2">
                          {comments.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No comments.</p>
                          ) : (
                            <ul className="space-y-2">
                              {comments.map((comment, index) => (
                                <li key={`${comment.file}:${comment.line ?? "na"}:${index}`} className="space-y-1 rounded-md border p-3">
                                  <p className="break-words text-xs font-medium text-muted-foreground">
                                    {comment.file}{comment.line != null ? `:${comment.line}` : ""}
                                  </p>
                                  <p className="whitespace-pre-wrap break-words text-sm">{comment.comment}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter className="justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (reviewDialogPullRequest) {
                  setReviewDialogKey(undefined);
                  void startReview(reviewDialogPullRequest);
                }
              }}
              disabled={!reviewDialogPullRequest}
            >
              Restart review
            </Button>
            <div className="flex items-center gap-2">
              {reviewDialogPullRequest?.url ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <a
                    href={reviewDialogPullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void markRead(reviewDialogPullRequest)}
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                    Open PR
                  </a>
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setReviewDialogKey(undefined)}>Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Permanent PR filters</DialogTitle>
            <DialogDescription>
              Configure both lists independently. Whitelist has priority over Blacklist when a pull request matches both.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6">
            <div role="tablist" aria-label="Permanent PR filter lists" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              <Button
                type="button"
                role="tab"
                variant={filterTab === "blacklist" ? "default" : "ghost"}
                aria-selected={filterTab === "blacklist"}
                onClick={() => setFilterTab("blacklist")}
              >
                Blacklist
              </Button>
              <Button
                type="button"
                role="tab"
                variant={filterTab === "whitelist" ? "default" : "ghost"}
                aria-selected={filterTab === "whitelist"}
                onClick={() => setFilterTab("whitelist")}
              >
                Whitelist
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {activeTabLabel === "Blacklist"
                ? "Matching repositories or creators are hidden unless they also match a whitelist filter."
                : "When Whitelist contains entries, only matching repositories or creators are shown."}
            </p>

            <div className="space-y-3">
              <Label htmlFor={`${filterTab}-repository-input`}>Repository filters</Label>
              <p className="text-sm text-muted-foreground">Search by project or repository name and select a result.</p>
              <div className="flex gap-2">
                <Input
                  id={`${filterTab}-repository-input`}
                  value={repositoryInput}
                  onChange={(event) => setRepositoryInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && repositorySearchMatch) {
                      event.preventDefault();
                      addValue("repository", repositoryOptionKey(repositorySearchMatch));
                    }
                  }}
                  placeholder="Search Bitbucket project or repository"
                />
                <Button type="button" variant="outline" onClick={() => repositorySearchMatch && addValue("repository", repositoryOptionKey(repositorySearchMatch))} disabled={!repositorySearchMatch}>
                  Add
                </Button>
              </div>
              {repositorySearchLoading ? <p role="status" className="text-sm text-muted-foreground">Searching repositories…</p> : null}
              {repositorySearchError ? <p role="alert" className="text-sm text-destructive">{repositorySearchError}</p> : null}
              {repositorySearchResults.length > 0 ? (
                <ul aria-label="Bitbucket repository search results" className="space-y-1">
                  {repositorySearchResults.map((repository) => (
                    <li key={repositoryOptionKey(repository)}>
                      <button type="button" aria-label={repositoryOptionLabel(repository)} className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addValue("repository", repositoryOptionKey(repository))}>
                        <span className="font-medium">{repositoryOptionKey(repository)}</span>
                        <span className="ml-2 text-muted-foreground">· {repository.repositoryName} ({repository.projectName})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul aria-label={`${activeTabLabel} repository filters`} className="flex flex-wrap gap-2">
                {draftSettings[activeRepositoryField].map((value) => (
                  <li key={value} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <span>{value}</span>
                    <button type="button" aria-label={`Remove ${activeTabLabel.toLowerCase()} repository filter ${value}`} onClick={() => removeValue("repository", value)}>×</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <Label htmlFor={`${filterTab}-creator-input`}>Creator filters</Label>
              <p className="text-sm text-muted-foreground">Search and select a Bitbucket display name.</p>
              <div className="flex gap-2">
                <Input
                  id={`${filterTab}-creator-input`}
                  value={creatorInput}
                  onChange={(event) => setCreatorInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && creatorSearchMatch?.displayName) {
                      event.preventDefault();
                      addValue("creator", creatorSearchMatch.displayName);
                    }
                  }}
                  placeholder="Search Bitbucket display name"
                />
                <Button type="button" variant="outline" onClick={() => creatorSearchMatch?.displayName && addValue("creator", creatorSearchMatch.displayName)} disabled={!creatorSearchMatch?.displayName}>
                  Add
                </Button>
              </div>
              {creatorSearchLoading ? <p role="status" className="text-sm text-muted-foreground">Searching creators…</p> : null}
              {creatorSearchError ? <p role="alert" className="text-sm text-destructive">{creatorSearchError}</p> : null}
              {creatorSearchResults.length > 0 ? (
                <ul aria-label="Bitbucket creator search results" className="space-y-1">
                  {creatorSearchResults.map((user) => {
                    const displayName = user.displayName ?? user.name ?? user.slug;
                    if (!displayName) return null;
                    const account = user.name ?? user.slug;
                    return (
                      <li key={`${user.name ?? ""}:${user.slug ?? ""}:${displayName}`}>
                        <button type="button" aria-label={`${displayName}${account ? ` (${account})` : ""}`} className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addValue("creator", displayName)}>
                          <span className="font-medium">{displayName}</span>
                          {account ? <span className="ml-2 text-muted-foreground">({account})</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <ul aria-label={`${activeTabLabel} creator filters`} className="flex flex-wrap gap-2">
                {draftSettings[activeCreatorField].map((value) => (
                  <li key={value} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <span>{value}</span>
                    <button type="button" aria-label={`Remove ${activeTabLabel.toLowerCase()} creator filter ${value}`} onClick={() => removeValue("creator", value)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
            {settingsError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Unable to save permanent filters</AlertTitle>
                <AlertDescription>{settingsError}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={() => void saveSettings()} disabled={saving}>{saving ? "Saving…" : "Save filters"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
