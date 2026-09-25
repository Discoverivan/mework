import { useCallback, useEffect, useState } from "react";
import { CheckCheck, RefreshCw, Settings2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/shared/PageHeader";
import { useI18n } from "@/i18n/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PullRequestDisplayOptionsDialog } from "./components/PullRequestDisplayOptionsDialog";
import { PullRequestListItem } from "./components/PullRequestListItem";
import { PullRequestProjectSection } from "./components/PullRequestProjectSection";
import { PullRequestReviewDialog } from "./components/PullRequestReviewDialog";
import { PullRequestStatus } from "./components/PullRequestStatus";
import { usePullRequestDisplayPreferences } from "./display-options";
import {
  groupPullRequestsByProject,
  sortPullRequestsByUpdatedDate,
} from "./components/pull-request-projects";
import type { AiSettingsPageData } from "@/shared/contracts/settings";
import { matchesSelectedAiProvider } from "@/shared/contracts/settings";
import type { PullRequestReviewSettings } from "@/shared/contracts/developer";
import type {
  MyPullRequest,
  MyPullRequestPage,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

import { getAiSettings } from "../settings/api";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";
import { shouldRefreshPullRequestCache } from "./pull-request-cache";
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
  const [displayPreferences, updateDisplayPreferences] = usePullRequestDisplayPreferences("authored");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  useEffect(() => {
    return subscribeAppEvent(APP_EVENT.aiSettingsChanged, setAiSettings);
  }, []);

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
    matchesSelectedAiProvider(aiSettings.settings, provider)
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
    const pagePromise = listAuthoredPullRequests(0, 100).then((page) =>
      shouldRefreshPullRequestCache(page.lastUpdatedAt)
        ? refreshAuthoredPullRequests(0, 100)
        : page,
    );
    void Promise.all([pagePromise, getAiSettings()])
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
    return subscribeAppEvent(APP_EVENT.authoredPullRequestsUpdated, applyPage);
  }, [applyPage]);

  useEffect(() => {
    return subscribeAppEvent(APP_EVENT.pullRequestReviewChanged, ({ key, review }) => {
      setReviewStartingKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setPullRequests((current) => sortPullRequests(current.map((item) =>
        pullRequestKey(item) === key ? { ...item, review } : item,
      )));
    });
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
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
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
      emitAppEvent(APP_EVENT.pullRequestActivityChanged);
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
    displayPreferences.sortOrder,
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
            sortOrder={displayPreferences.sortOrder}
            lastSyncAt={lastSyncAt}
            now={now}
            polling={polling}
          />
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={quickFilter} onValueChange={(value) => setQuickFilter(value as QuickFilter)}>
          <SelectTrigger aria-label={t("pr.quickFilters.authored")} className="h-9 text-[13.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pr.filter.all")}</SelectItem>
            <SelectItem value="needs_action">{t("pr.filter.needsAction")}</SelectItem>
          </SelectContent>
        </Select>
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
            aria-label={polling ? t("pr.refreshing") : t("pr.refresh")}
            title={polling ? t("pr.refreshing") : t("pr.refresh")}
            onClick={() => void syncPullRequests()}
            disabled={loading || polling}
          >
            <RefreshCw className={polling ? "animate-spin" : undefined} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            actionTone="success"
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

      <div className={`${displayPreferences.groupByProject ? "space-y-5" : "inbox-list"} pt-1`} aria-live="polite">
        {displayPreferences.groupByProject
          ? projectGroups.map((group) => (
              <PullRequestProjectSection
                key={group.key}
                projectKey={group.projectKey}
                pullRequestCount={group.pullRequests.length}
                expandedByDefault={displayPreferences.expandProjectsByDefault}
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
        groupByProject={displayPreferences.groupByProject}
        expandProjectsByDefault={displayPreferences.expandProjectsByDefault}
        sortOrder={displayPreferences.sortOrder}
        autoReviewEnabled={reviewSettings?.authoredAutoReviewEnabled ?? false}
        autoReviewDisabled={loading || reviewSettings == null || autoReviewSaving}
        onOpenChange={setDisplayOptionsOpen}
        onGroupByProjectChange={(enabled) => updateDisplayPreferences({ groupByProject: enabled })}
        onExpandProjectsByDefaultChange={(enabled) => updateDisplayPreferences({ expandProjectsByDefault: enabled })}
        onSortOrderChange={(order) => updateDisplayPreferences({ sortOrder: order })}
        onAutoReviewChange={(enabled) => void toggleAuthoredAutoReview(enabled)}
      />
    </section>
  );
}
