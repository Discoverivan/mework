import { CheckCircle2, CircleAlert, Clock3, Eye, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  MyPullRequest,
  MyPullRequestDecision,
  PullRequestReviewSeverity,
} from "@/shared/contracts/developer";
import { useI18n } from "@/i18n/context";
import type { TranslationKey } from "@/i18n/locales/en";
import type { TranslationParams } from "@/i18n/types";

export type PullRequestListMode = "reviewer" | "author";

export const reviewSeverityBadgeClasses: Record<PullRequestReviewSeverity, string> = {
  blocker: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export const reviewSeveritySections: Array<{
  key: PullRequestReviewSeverity;
  labelKey: TranslationKey;
}> = [
  { key: "blocker", labelKey: "pr.severity.blocker" },
  { key: "high", labelKey: "pr.severity.high" },
  { key: "medium", labelKey: "pr.severity.medium" },
  { key: "low", labelKey: "pr.severity.low" },
];

type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export function formatRelativeDate(timestamp?: number, t?: Translator): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return t ? t("pr.relative.unknown") : "Unknown update";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t ? t("pr.relative.justNow") : "just now";
  if (seconds < 3600) return t ? t("pr.relative.minutes", { count: Math.floor(seconds / 60) }) : `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return t ? t("pr.relative.hours", { count: Math.floor(seconds / 3600) }) : `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return t ? t("pr.relative.days", { count: Math.floor(seconds / 86_400) }) : `${Math.floor(seconds / 86_400)}d ago`;
  if (seconds < 31_536_000) return t ? t("pr.relative.months", { count: Math.floor(seconds / 2_592_000) }) : `${Math.floor(seconds / 2_592_000)}mo ago`;
  return t ? t("pr.relative.years", { count: Math.floor(seconds / 31_536_000) }) : `${Math.floor(seconds / 31_536_000)}y ago`;
}

function creatorInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

export function CreatorAvatar({ pullRequest }: { pullRequest: MyPullRequest }) {
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

export function ReviewerDecisionIcon({ decision }: { decision: MyPullRequestDecision }) {
  const { t } = useI18n();
  if (decision === "approved") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600" role="img" aria-label={t("pr.decision.approved")} title={t("pr.decision.approved")}>
        <CheckCircle2 className="size-5" aria-hidden="true" />
      </span>
    );
  }
  if (decision === "needs_work") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600" role="img" aria-label={t("pr.decision.needsWork")} title={t("pr.decision.needsWork")}>
        <CircleAlert className="size-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" role="img" aria-label={t("pr.decision.pending")} title={t("pr.decision.pending")}>
      <Clock3 className="size-5" aria-hidden="true" />
    </span>
  );
}

function ActivityBadge({ activity }: { activity: MyPullRequest["activity"] }) {
  const { t } = useI18n();
  if (activity === "read") return null;
  const description = t(activity === "new" ? "pr.activity.newDescription" : "pr.activity.updatedDescription");
  return (
    <Badge
      variant={activity === "new" ? "default" : "secondary"}
      aria-label={description}
      title={description}
    >
      {activity === "new" ? "NEW" : "UPDATED"}
    </Badge>
  );
}

function AiVerdictBadge({ verdict }: { verdict: "ok" | "needs_changes" }) {
  const { t } = useI18n();
  const approved = verdict === "ok";
  const label = t(approved ? "pr.decision.approved" : "pr.decision.needsWork");
  return (
    <Badge
      variant="outline"
      className={approved
        ? "gap-1.5 border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        : "gap-1.5 border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}
      aria-label={t("pr.aiVerdict", { verdict: label })}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      {t("pr.aiVerdictLabel")} · {approved ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
      {label}
    </Badge>
  );
}

export interface PullRequestListItemProps {
  pullRequest: MyPullRequest;
  mode: PullRequestListMode;
  aiReviewReady: boolean;
  reviewStarting: boolean;
  onOpenPullRequest: (pullRequest: MyPullRequest) => void;
  onMarkViewed: (pullRequest: MyPullRequest) => void;
  onStartReview: (pullRequest: MyPullRequest) => void;
  onOpenResults: (pullRequest: MyPullRequest) => void;
  completedLabel?: string;
  showProjectKey?: boolean;
}

export function PullRequestListItem({
  pullRequest,
  mode,
  aiReviewReady,
  reviewStarting,
  onOpenPullRequest,
  onMarkViewed,
  onStartReview,
  onOpenResults,
  completedLabel,
  showProjectKey = true,
}: PullRequestListItemProps) {
  const { t } = useI18n();
  const review = pullRequest.review;
  const reviewRunning = reviewStarting || review?.status === "running";
  const reviewCompleted = review?.status === "completed" && review.result != null;
  const needsAction = mode === "author" && (pullRequest.needsAction || (pullRequest.reviewSummary?.needsWork ?? 0) > 0);
  const reviewSummary = pullRequest.reviewSummary ?? { approved: 0, needsWork: 0, comments: 0 };

  return (
    <Card
      className={needsAction ? "border-l-4 border-l-rose-500" : pullRequest.activity === "read" ? "border-l-4 border-l-transparent" : "border-l-4 border-l-blue-500"}
    >
      <CardContent className="flex items-center gap-3 p-4">
        {mode === "reviewer" ? <ReviewerDecisionIcon decision={pullRequest.myDecision} /> : (
          <span className={needsAction ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-600" : "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"} role="img" aria-label={t(needsAction ? "pr.activity.needsAction" : "pr.activity.review")}>
            {needsAction ? <CircleAlert className="size-5" aria-hidden="true" /> : <Clock3 className="size-5" aria-hidden="true" />}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2 pr-review-card-meta">
            <p className="min-w-0 truncate text-sm text-foreground">
              {showProjectKey ? `${pullRequest.projectKey}/` : ""}{pullRequest.repositorySlug} <span className="ml-2 text-muted-foreground">#{pullRequest.pullRequestId}</span>
            </p>
            <ActivityBadge activity={pullRequest.activity} />
          </div>
          <div className="flex min-w-0 items-center gap-2 pr-review-card-title">
            <h2 className="min-w-0 flex-1 break-words text-sm font-semibold leading-5">
              {pullRequest.url ? (
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onOpenPullRequest(pullRequest)}
                  className="hover:underline"
                >
                  {pullRequest.title}
                </a>
              ) : pullRequest.title}
            </h2>
          </div>
          {mode === "reviewer" ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <CreatorAvatar pullRequest={pullRequest} />
              <span className="truncate font-normal text-foreground">{pullRequest.authorDisplayName}</span>
              <span aria-hidden="true">•</span>
              <time className="shrink-0" dateTime={pullRequest.updatedDate != null ? new Date(pullRequest.updatedDate).toISOString() : undefined}>
                {formatRelativeDate(pullRequest.updatedDate, t)}
              </time>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <time className="shrink-0" dateTime={pullRequest.updatedDate != null ? new Date(pullRequest.updatedDate).toISOString() : undefined}>
                {t("pr.updated", { date: formatRelativeDate(pullRequest.updatedDate, t) })}
              </time>
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300" aria-label={t("pr.approvedCount", { count: reviewSummary.approved })}>
                <CheckCircle2 className="size-3.5" aria-hidden="true" /> {reviewSummary.approved}
              </span>
              <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300" aria-label={t("pr.needsWorkCount", { count: reviewSummary.needsWork })}>
                <CircleAlert className="size-3.5" aria-hidden="true" /> {reviewSummary.needsWork}
              </span>
              <span className="flex items-center gap-1 text-sky-700 dark:text-sky-300" aria-label={t("pr.commentsCount", { count: reviewSummary.comments })}>
                <MessageSquare className="size-3.5" aria-hidden="true" /> {reviewSummary.comments}
              </span>
              {needsAction ? <Badge variant="destructive">{t("pr.activity.needsAction")}</Badge> : null}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {reviewCompleted && review?.result ? <AiVerdictBadge verdict={review.result.verdict} /> : null}
          <div className="flex items-center gap-2">
            {pullRequest.activity !== "read" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                actionTone="success"
                className="size-8"
                onClick={() => onMarkViewed(pullRequest)}
                aria-label={t("pr.markViewed")}
                title={t("pr.markViewed")}
              >
                <Eye aria-hidden="true" className="size-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant={reviewCompleted ? "default" : "outline"}
              size="sm"
              onClick={() => reviewCompleted ? onOpenResults(pullRequest) : onStartReview(pullRequest)}
              disabled={reviewRunning || (!reviewCompleted && !aiReviewReady)}
              title={reviewCompleted ? undefined : !aiReviewReady ? t("pr.aiProviderRequired") : review?.status === "failed" ? review.error ?? undefined : undefined}
            >
              {reviewRunning ? <><Loader2 aria-hidden="true" className="animate-spin" /> {t("pr.aiReviewRunning")}</> : reviewCompleted ? completedLabel ?? t("pr.reviewResults") : <><Sparkles aria-hidden="true" /> {t("pr.aiReview")}</>}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
