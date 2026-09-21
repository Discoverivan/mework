import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { CheckCheck, Filter, RefreshCw, Settings2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Separator } from "@/components/ui/separator";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import type {
  BitbucketRepository,
  BitbucketUser,
  MyPullRequest,
  MyPullRequestPage,
  PullRequestReviewChangedEvent,
  PullRequestReviewComment,
  PullRequestReviewSettings,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

import { PullRequestListItem } from "./components/PullRequestListItem";
import { PullRequestDisplayOptionsDialog } from "./components/PullRequestDisplayOptionsDialog";
import { PullRequestProjectSection } from "./components/PullRequestProjectSection";
import { PullRequestReviewDialog } from "./components/PullRequestReviewDialog";
import { PullRequestStatus } from "./components/PullRequestStatus";
import {
  groupPullRequestsByProject,
  sortPullRequestsByUpdatedDate,
  type PullRequestSortOrder,
} from "./components/pull-request-projects";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/i18n/context";

import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewState,
  listMyPullRequests,
  markAllPullRequestsRead,
  markPullRequestRead,
  publishPullRequestComment,
  refreshMyPullRequests,
  savePullRequestReviewSettings,
  setPullRequestDecision,
  searchBitbucketRepositories,
  searchBitbucketUsers,
  startPullRequestReview,
} from "./api";

const PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT = "pull_request_review_activity_changed";

type FilterTab = "blacklist" | "whitelist";
type QuickFilter = "all" | "pending";
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


const emptySettings: PullRequestReviewSettings = {
  repositoryBlacklist: [],
  creatorBlacklist: [],
  repositoryWhitelist: [],
  creatorWhitelist: [],
  autoReviewEnabled: false,
  authoredAutoReviewEnabled: false,
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

export function MyPullRequestsPage() {
  const { t } = useI18n();
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
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const [groupByProject, setGroupByProject] = useState(true);
  const [expandProjectsByDefault, setExpandProjectsByDefault] = useState(false);
  const [sortOrder, setSortOrder] = useState<PullRequestSortOrder>("newest");
  const [filterTab, setFilterTab] = useState<FilterTab>("whitelist");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
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
      window.dispatchEvent(new Event(PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT));
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
  const visiblePullRequests = sortPullRequestsByUpdatedDate(
    filteredPullRequests.filter((pullRequest) =>
      quickFilter === "all" || pullRequest.myDecision === "not_reviewed",
    ),
    sortOrder,
  );
  const projectGroups = groupPullRequestsByProject(visiblePullRequests);
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
      authoredAutoReviewEnabled: settings.authoredAutoReviewEnabled,
    });
    setFilterTab("blacklist");
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
      setError(t("pr.autoReviewSaveError", { error: commandError(reason) }));
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
      window.dispatchEvent(new Event(PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT));
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
      window.dispatchEvent(new Event(PULL_REQUEST_REVIEW_ACTIVITY_CHANGED_EVENT));
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setReadAllPending(false);
    }
  }

  async function startReview(pullRequest: MyPullRequest) {
    const key = pullRequestKey(pullRequest);
    if (!aiReviewReady) {
      setError(t("pr.aiProviderRequired"));
      return;
    }
    if (!pullRequest.url || !pullRequest.latestCommit) {
      setError(t("pr.reviewSourceMissing"));
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

  async function publishReviewComment(pullRequest: MyPullRequest, comment: PullRequestReviewComment) {
    try {
      await publishPullRequestComment(pullRequest, comment);
    } catch (reason) {
      throw new Error(commandError(reason));
    }
  }

  async function updateReviewDecision(pullRequest: MyPullRequest, action: "approve" | "needs_work") {
    try {
      const status = await setPullRequestDecision(pullRequest, action);
      const key = pullRequestKey(pullRequest);
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, myDecision: status.myDecision } : item,
      )));
    } catch (reason) {
      throw new Error(commandError(reason));
    }
  }

  const activeRepositoryField = filterField(filterTab, "repository");
  const activeCreatorField = filterField(filterTab, "creator");
  const activeTabLabel = t(filterTab === "blacklist" ? "pr.filters.blacklist" : "pr.filters.whitelist");

  function renderPullRequest(pullRequest: MyPullRequest, showProjectKey: boolean) {
    const itemKey = pullRequestKey(pullRequest);
    return (
      <PullRequestListItem
        key={itemKey}
        pullRequest={pullRequest}
        mode="reviewer"
        aiReviewReady={aiReviewReady}
        reviewStarting={reviewStartingKeys.has(itemKey)}
        showProjectKey={showProjectKey}
        onOpenPullRequest={(item) => void markRead(item)}
        onMarkViewed={(item) => void markRead(item)}
        onStartReview={(item) => void startReview(item)}
        onOpenResults={(item) => {
          if (item.activity !== "read") void markRead(item);
          setReviewDialogKey(pullRequestKey(item));
        }}
      />
    );
  }

  return (
    <section aria-labelledby="pull-request-review-title" className="space-y-4">
      <PageHeader
        title={t("page.prsToReview")}
        titleId="pull-request-review-title"
        description={!loading && !error ? (
          <PullRequestStatus
            kind="review"
            count={total ?? pullRequests.length}
            activeFilterCount={settings.repositoryBlacklist.length + settings.creatorBlacklist.length + settings.repositoryWhitelist.length + settings.creatorWhitelist.length}
            sortOrder={sortOrder}
            lastSyncAt={lastSyncAt}
            now={now}
            polling={polling}
          />
        ) : undefined}
      />

      <div role="tablist" aria-label={t("pr.quickFilters.review")} className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          role="tab"
          size="sm"
          variant={quickFilter === "all" ? "default" : "outline"}
          aria-selected={quickFilter === "all"}
          onClick={() => setQuickFilter("all")}
        >
          {t("pr.filter.all")}
        </Button>
        <Button
          type="button"
          role="tab"
          size="sm"
          variant={quickFilter === "pending" ? "default" : "outline"}
          aria-selected={quickFilter === "pending"}
          onClick={() => setQuickFilter("pending")}
        >
          {t("pr.filter.pending")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("pr.permanentFilters")}
            title={t("pr.permanentFilters")}
            onClick={openSettings}
            disabled={loading}
          >
            <Filter aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("pr.displayOptions")}
            title={t("pr.displayOptions")}
            onClick={() => setDisplayOptionsOpen(true)}
            disabled={loading}
          >
            <Settings2 aria-hidden="true" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={polling ? t("pr.updating") : t("pr.updateNow")}
            title={polling ? t("pr.updating") : t("pr.updateNow")}
            onClick={() => void syncPullRequests()}
            disabled={loading || polling}
          >
            <RefreshCw className={polling ? "animate-spin" : undefined} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("pr.readAll")}
            title={t("pr.readAll")}
            onClick={() => void markAllRead()}
            disabled={loading || readAllPending || pullRequests.every((item) => item.activity === "read")}
          >
            {readAllPending ? <RefreshCw className="animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {loading ? <div role="status" aria-label={t("pr.loadingReview")}>{t("pr.loading")}</div> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("pr.reviewUnavailable")}</AlertTitle>
          <AlertDescription>{t("pr.reviewLoadError", { error })}</AlertDescription>
        </Alert>
      ) : null}
      {!loading && !error && pullRequests.length === 0 ? (
        <Card><CardContent className="pt-6"><p>{t("pr.emptyReview")}</p></CardContent></Card>
      ) : null}
      {!loading && !error && pullRequests.length > 0 && visiblePullRequests.length === 0 ? (
        <Card><CardContent className="pt-6"><p>{t("pr.emptyFiltered")}</p></CardContent></Card>
      ) : null}

      <div className={`${groupByProject ? "space-y-5" : "inbox-list"} pt-1`} aria-live="polite">
        {groupByProject
          ? projectGroups.map((group) => (
              <PullRequestProjectSection
                key={group.key}
                projectKey={group.projectKey}
                pullRequestCount={group.pullRequests.length}
                expandedByDefault={expandProjectsByDefault}
              >
                {group.pullRequests.map((pullRequest) => renderPullRequest(pullRequest, false))}
              </PullRequestProjectSection>
            ))
          : visiblePullRequests.map((pullRequest) => renderPullRequest(pullRequest, true))}
      </div>

      <PullRequestReviewDialog
        open={Boolean(reviewDialogKey && reviewDialogReview?.status === "completed" && reviewDialogReview.result)}
        pullRequest={reviewDialogPullRequest}
        review={reviewDialogReview}
        reviewerActions
        onOpenChange={(open) => {
          if (!open) setReviewDialogKey(undefined);
        }}
        onOpenPullRequest={(item) => void markRead(item)}
        onRerunReview={(item) => void startReview(item)}
        onPublishComment={publishReviewComment}
        onSetDecision={updateReviewDecision}
      />

      <PullRequestDisplayOptionsDialog
        open={displayOptionsOpen}
        groupByProject={groupByProject}
        expandProjectsByDefault={expandProjectsByDefault}
        sortOrder={sortOrder}
        autoReviewEnabled={settings.autoReviewEnabled}
        autoReviewDisabled={loading || autoReviewSaving}
        onOpenChange={setDisplayOptionsOpen}
        onGroupByProjectChange={setGroupByProject}
        onExpandProjectsByDefaultChange={setExpandProjectsByDefault}
        onSortOrderChange={setSortOrder}
        onAutoReviewChange={(enabled) => void toggleAutoReview(enabled)}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("pr.filters.title")}</DialogTitle>
            <DialogDescription>
              {t("pr.filters.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6">
            <div role="tablist" aria-label={t("pr.filters.lists")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              <Button
                type="button"
                role="tab"
                variant={filterTab === "blacklist" ? "default" : "ghost"}
                aria-selected={filterTab === "blacklist"}
                onClick={() => setFilterTab("blacklist")}
              >
                {t("pr.filters.blacklist")}
              </Button>
              <Button
                type="button"
                role="tab"
                variant={filterTab === "whitelist" ? "default" : "ghost"}
                aria-selected={filterTab === "whitelist"}
                onClick={() => setFilterTab("whitelist")}
              >
                {t("pr.filters.whitelist")}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(filterTab === "blacklist" ? "pr.filters.blacklistDescription" : "pr.filters.whitelistDescription")}
            </p>

            <div className="space-y-3">
              <Label htmlFor={`${filterTab}-repository-input`}>{t("pr.filters.repositories")}</Label>
              <p className="text-sm text-muted-foreground">{t("pr.filters.repositoriesDescription")}</p>
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
                  placeholder={t("pr.filters.repositoryPlaceholder")}
                />
                <Button type="button" variant="outline" onClick={() => repositorySearchMatch && addValue("repository", repositoryOptionKey(repositorySearchMatch))} disabled={!repositorySearchMatch}>
                  {t("pr.filters.add")}
                </Button>
              </div>
              {repositorySearchLoading ? <p role="status" className="text-sm text-muted-foreground">{t("pr.filters.searchingRepositories")}</p> : null}
              {repositorySearchError ? <p role="alert" className="text-sm text-destructive">{repositorySearchError}</p> : null}
              {repositorySearchResults.length > 0 ? (
                <ul aria-label={t("pr.filters.repositoryResults")} className="space-y-1">
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
              <ul aria-label={t("pr.filters.repositoryList", { list: activeTabLabel })} className="flex flex-wrap gap-2">
                {draftSettings[activeRepositoryField].map((value) => (
                  <li key={value} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <span>{value}</span>
                    <button type="button" aria-label={t("pr.filters.removeRepository", { list: activeTabLabel, value })} onClick={() => removeValue("repository", value)}>×</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <Label htmlFor={`${filterTab}-creator-input`}>{t("pr.filters.creators")}</Label>
              <p className="text-sm text-muted-foreground">{t("pr.filters.creatorsDescription")}</p>
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
                  placeholder={t("pr.filters.creatorPlaceholder")}
                />
                <Button type="button" variant="outline" onClick={() => creatorSearchMatch?.displayName && addValue("creator", creatorSearchMatch.displayName)} disabled={!creatorSearchMatch?.displayName}>
                  {t("pr.filters.add")}
                </Button>
              </div>
              {creatorSearchLoading ? <p role="status" className="text-sm text-muted-foreground">{t("pr.filters.searchingCreators")}</p> : null}
              {creatorSearchError ? <p role="alert" className="text-sm text-destructive">{creatorSearchError}</p> : null}
              {creatorSearchResults.length > 0 ? (
                <ul aria-label={t("pr.filters.creatorResults")} className="space-y-1">
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
              <ul aria-label={t("pr.filters.creatorList", { list: activeTabLabel })} className="flex flex-wrap gap-2">
                {draftSettings[activeCreatorField].map((value) => (
                  <li key={value} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <span>{value}</span>
                    <button type="button" aria-label={t("pr.filters.removeCreator", { list: activeTabLabel, value })} onClick={() => removeValue("creator", value)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
            {settingsError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{t("pr.filters.saveError")}</AlertTitle>
                <AlertDescription>{settingsError}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)} disabled={saving}>{t("settings.common.cancel")}</Button>
            <Button type="button" onClick={() => void saveSettings()} disabled={saving}>{saving ? t("settings.common.saving") : t("pr.filters.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
