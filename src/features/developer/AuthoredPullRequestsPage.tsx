import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { CheckCheck, RefreshCw, Settings2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PullRequestDisplayOptionsDialog } from "./components/PullRequestDisplayOptionsDialog";
import { PullRequestListItem } from "./components/PullRequestListItem";
import { PullRequestProjectSection } from "./components/PullRequestProjectSection";
import { PullRequestReviewDialog } from "./components/PullRequestReviewDialog";
import { PullRequestStatus } from "./components/PullRequestStatus";
import {
  groupPullRequestsByProject,
  sortPullRequestsByUpdatedDate,
  type PullRequestSortOrder,
} from "./components/pull-request-projects";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import type { PullRequestReviewSettings } from "@/shared/contracts/developer";
import type {
  MyPullRequest,
  MyPullRequestPage,
  PullRequestReviewChangedEvent,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

import { getAiSettings } from "../settings/api";
import {
  getPullRequestReviewSettings,
  getPullRequestReviewState,
  listAuthoredPullRequests,
  markAllAuthoredPullRequestsRead,
  markAuthoredPullRequestRead,
  refreshAuthoredPullRequests,
  savePullRequestReviewSettings,
  startPullRequestReview,
} from "./api";

const AUTHOR_ACTIVITY_CHANGED_EVENT = "my_pull_requests_updated";
const LOCAL_ACTIVITY_CHANGED_EVENT = "pull_request_review_activity_changed";
const REVIEW_CHANGED_EVENT = "pull_request_review_changed";

type AuthoredPullRequestEvent = MyPullRequestPage;
type QuickFilter = "all" | "needs_action";

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

function pullRequestKey(pullRequest: Pick<MyPullRequest, "integrationId" | "projectKey" | "repositorySlug" | "pullRequestId">): string {
  return `${pullRequest.integrationId}:${pullRequest.projectKey}:${pullRequest.repositorySlug}:${pullRequest.pullRequestId}`;
}

function authorActivityRank(activity: MyPullRequest["activity"]): number {
  if (activity === "new") return 0;
  if (activity === "updated") return 1;
  return 2;
}

function sortPullRequests(values: MyPullRequest[]): MyPullRequest[] {
  return [...values].sort((left, right) => {
    const actionOrder = Number(Boolean(right.needsAction)) - Number(Boolean(left.needsAction));
    if (actionOrder !== 0) return actionOrder;
    const activityOrder = authorActivityRank(left.activity) - authorActivityRank(right.activity);
    if (activityOrder !== 0) return activityOrder;
    const leftUpdated = left.updatedDate ?? Number.NEGATIVE_INFINITY;
    const rightUpdated = right.updatedDate ?? Number.NEGATIVE_INFINITY;
    return rightUpdated - leftUpdated || left.pullRequestId.localeCompare(right.pullRequestId);
  });
}

export function AuthoredPullRequestsPage() {
  const { t } = useI18n();
  const [pullRequests, setPullRequests] = useState<MyPullRequest[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettingsPageData | null>(null);
  const [reviewSettings, setReviewSettings] = useState<PullRequestReviewSettings>();
  const [autoReviewSaving, setAutoReviewSaving] = useState(false);
  const [readAllPending, setReadAllPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string>();
  const [total, setTotal] = useState<number>();
  const [lastSyncAt, setLastSyncAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [reviewStartingKeys, setReviewStartingKeys] = useState<Set<string>>(() => new Set());
  const [reviewDialogKey, setReviewDialogKey] = useState<string>();
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const [groupByProject, setGroupByProject] = useState(true);
  const [expandProjectsByDefault, setExpandProjectsByDefault] = useState(false);
  const [sortOrder, setSortOrder] = useState<PullRequestSortOrder>("newest");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const applyPage = useCallback((page: AuthoredPullRequestEvent) => {
    setPullRequests((current) => {
      const currentByKey = new Map(current.map((item) => [pullRequestKey(item), item]));
      return sortPullRequests((Array.isArray(page.values) ? page.values : []).map((item) => {
        const previous = currentByKey.get(pullRequestKey(item));
        const preservedReview = previous?.review?.status === "running"
          && previous.latestCommit === item.latestCommit
          && item.review == null
          ? previous.review
          : item.review;
        if (previous?.activity === "read" && item.activity === "read" && previous.latestCommit === item.latestCommit) {
          return { ...item, activity: "read" as const, review: preservedReview };
        }
        return { ...item, review: preservedReview };
      }));
    });
    setTotal(page.total ?? undefined);
    if (page.lastUpdatedAt != null) setLastSyncAt(page.lastUpdatedAt);
  }, []);

  const aiReviewReady = aiSettings?.settings.provider !== null && aiSettings?.providers.some((provider) =>
    provider.id === aiSettings.settings.provider
      && provider.available
      && provider.status === "connected"
      && provider.models.includes(aiSettings.settings.model),
  ) === true;

  const syncPullRequests = useCallback(async () => {
    setPolling(true);
    setError(undefined);
    try {
      applyPage(await refreshAuthoredPullRequests(0, 100));
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setPolling(false);
    }
  }, [applyPage, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([listAuthoredPullRequests(0, 100), getAiSettings()])
      .then(([page, savedAiSettings]) => {
        if (!active) return;
        applyPage(page);
        setAiSettings(savedAiSettings);
      })
      .catch((reason) => {
        if (!active) return;
        setPullRequests([]);
        setError(commandError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void getPullRequestReviewSettings()
      .then((savedReviewSettings) => {
        if (active) setReviewSettings(savedReviewSettings);
      })
      .catch((reason) => {
        if (active) setError(t("pr.autoReviewLoadError", { error: commandError(reason) }));
      });
    return () => {
      active = false;
    };
  }, [applyPage]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<AuthoredPullRequestEvent>(AUTHOR_ACTIVITY_CHANGED_EVENT, (event) => {
      if (active) applyPage(event.payload);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyPage]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<PullRequestReviewChangedEvent>(REVIEW_CHANGED_EVENT, (event) => {
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
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const running = pullRequests.filter((item) => item.review?.status === "running");
    if (running.length === 0) return;
    let active = true;
    const reconcile = async () => {
      const updates = await Promise.all(running.map(async (pullRequest) => {
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
      const available = updates.filter((update): update is {
        key: string;
        runId: string;
        review: PullRequestReviewState;
      } => update?.review != null && update.runId != null && update.review.runId === update.runId);
      if (available.length === 0) return;
      setPullRequests((current) => sortPullRequests(current.map((item) => {
        const update = available.find((candidate) => candidate.key === pullRequestKey(item));
        return update && item.review?.runId === update.runId ? { ...item, review: update.review } : item;
      })));
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pullRequests]);

  async function markRead(pullRequest: MyPullRequest) {
    const key = `${pullRequest.projectKey}/${pullRequest.repositorySlug}/${pullRequest.pullRequestId}`;
    try {
      const marked = await markAuthoredPullRequestRead(pullRequest.integrationId, key, pullRequest.latestCommit ?? undefined);
      if (!marked) {
        setError(t("pr.changedBeforeViewed"));
        return;
      }
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === pullRequestKey(pullRequest)
          ? { ...item, activity: "read" as const }
          : item,
      )));
      window.dispatchEvent(new Event(LOCAL_ACTIVITY_CHANGED_EVENT));
    } catch (reason) {
      setError(commandError(reason));
    }
  }

  async function markAllRead() {
    setReadAllPending(true);
    setError(undefined);
    try {
      await markAllAuthoredPullRequestsRead();
      setPullRequests((current) => sortPullRequests(current.map((item) => ({ ...item, activity: "read" as const }))));
      window.dispatchEvent(new Event(LOCAL_ACTIVITY_CHANGED_EVENT));
    } catch (reason) {
      setError(commandError(reason));
    } finally {
      setReadAllPending(false);
    }
  }

  async function startReview(pullRequest: MyPullRequest) {
    const key = pullRequestKey(pullRequest);
    setError(undefined);
    setReviewStartingKeys((current) => new Set(current).add(key));
    try {
      const review = await startPullRequestReview(pullRequest);
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, review } : item,
      )));
    } catch (reason) {
      setReviewStartingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setError(commandError(reason));
    }
  }

  async function toggleAuthoredAutoReview(enabled: boolean) {
    if (!reviewSettings) return;
    setAutoReviewSaving(true);
    setError(undefined);
    try {
      const saved = await savePullRequestReviewSettings({
        ...reviewSettings,
        authoredAutoReviewEnabled: enabled,
      });
      setReviewSettings(saved);
    } catch (reason) {
      setError(t("pr.autoReviewSaveError", { error: commandError(reason) }));
    } finally {
      setAutoReviewSaving(false);
    }
  }

  const reviewDialogPullRequest = reviewDialogKey
    ? pullRequests.find((item) => pullRequestKey(item) === reviewDialogKey)
    : undefined;
  const visiblePullRequests = sortPullRequestsByUpdatedDate(
    pullRequests.filter((pullRequest) =>
      quickFilter === "all"
        || pullRequest.needsAction
        || (pullRequest.reviewSummary?.needsWork ?? 0) > 0,
    ),
    sortOrder,
  );
  const projectGroups = groupPullRequestsByProject(visiblePullRequests);

  function renderPullRequest(pullRequest: MyPullRequest, showProjectKey: boolean) {
    const key = pullRequestKey(pullRequest);
    return (
      <PullRequestListItem
        key={key}
        pullRequest={pullRequest}
        mode="author"
        aiReviewReady={aiReviewReady}
        reviewStarting={reviewStartingKeys.has(key)}
        completedLabel={t("pr.viewResults")}
        showProjectKey={showProjectKey}
        onOpenPullRequest={(item) => void markRead(item)}
        onMarkViewed={(item) => void markRead(item)}
        onStartReview={(item) => void startReview(item)}
        onOpenResults={(item) => {
          void markRead(item);
          setReviewDialogKey(pullRequestKey(item));
        }}
      />
    );
  }

  return (
    <section aria-labelledby="my-pull-requests-title" className="space-y-4">
      <PageHeader
        title={t("page.yourPrs")}
        titleId="my-pull-requests-title"
        description={!loading && !error ? (
          <PullRequestStatus
            kind="authored"
            count={total ?? pullRequests.length}
            sortOrder={sortOrder}
            lastSyncAt={lastSyncAt}
            now={now}
            polling={polling}
          />
        ) : undefined}
      />

      <div role="tablist" aria-label={t("pr.quickFilters.authored")} className="flex flex-wrap items-center gap-2">
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
          variant={quickFilter === "needs_action" ? "default" : "outline"}
          aria-selected={quickFilter === "needs_action"}
          onClick={() => setQuickFilter("needs_action")}
        >
          {t("pr.filter.needsAction")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
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

      {loading ? <div role="status" aria-label={t("pr.loadingAuthored")}>{t("pr.loading")}</div> : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("pr.authoredUnavailable")}</AlertTitle>
          <AlertDescription>{t("pr.authoredLoadError", { error })}</AlertDescription>
        </Alert>
      ) : null}
      {!loading && !error && pullRequests.length === 0 ? (
        <Card><CardContent className="pt-6"><p>{t("pr.emptyAuthored")}</p></CardContent></Card>
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
        open={Boolean(reviewDialogKey && reviewDialogPullRequest?.review?.status === "completed" && reviewDialogPullRequest.review.result)}
        pullRequest={reviewDialogPullRequest}
        review={reviewDialogPullRequest?.review}
        reviewerActions={false}
        onOpenChange={(open) => {
          if (!open) setReviewDialogKey(undefined);
        }}
        onOpenPullRequest={(item) => void markRead(item)}
        onRerunReview={(item) => void startReview(item)}
      />

      <PullRequestDisplayOptionsDialog
        open={displayOptionsOpen}
        groupByProject={groupByProject}
        expandProjectsByDefault={expandProjectsByDefault}
        sortOrder={sortOrder}
        autoReviewEnabled={reviewSettings?.authoredAutoReviewEnabled ?? false}
        autoReviewDisabled={loading || reviewSettings == null || autoReviewSaving}
        onOpenChange={setDisplayOptionsOpen}
        onGroupByProjectChange={setGroupByProject}
        onExpandProjectsByDefaultChange={setExpandProjectsByDefault}
        onSortOrderChange={setSortOrder}
        onAutoReviewChange={(enabled) => void toggleAuthoredAutoReview(enabled)}
      />
    </section>
  );
}
