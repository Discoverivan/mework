import { Check, CheckCircle2, CircleAlert, Clock3, ExternalLink, Loader2, MessageSquare, MoreHorizontal, RefreshCw, Sparkles, Ban } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type {
  MyPullRequest,
  MyPullRequestDecision,
  PullRequestReviewSeverity,
} from "@/shared/contracts/developer";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n/locales/en";
import type { TranslationParams } from "@/i18n/types";

export type PullRequestListMode = "reviewer" | "author";

export const reviewSeverityBadgeClasses: Record<PullRequestReviewSeverity, string> = {
  blocker: "border-destructive/30 bg-destructive/10 text-destructive",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-border bg-muted text-foreground",
  low: "border-border bg-muted text-muted-foreground",
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

function safePullRequestUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

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
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success" role="img" aria-label={t("pr.decision.approved")} title={t("pr.decision.approved")}>
        <CheckCircle2 className="size-5" aria-hidden="true" />
      </span>
    );
  }
  if (decision === "needs_work") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning" role="img" aria-label={t("pr.decision.needsWork")} title={t("pr.decision.needsWork")}>
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

export function AiVerdictBadge({ verdict }: { verdict: "ok" | "needs_changes" }) {
  const { t } = useI18n();
  const approved = verdict === "ok";
  const label = t(approved ? "pr.decision.approved" : "pr.decision.needsWork");
  return (
    <Badge
      variant="outline"
      className={cn("h-7 gap-1.5 rounded-md px-2.5 py-0", approved ? "text-success" : "text-warning")}
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
  onBlacklistProject?: (pullRequest: MyPullRequest) => void;
  onBlacklistRepository?: (pullRequest: MyPullRequest) => void;
  onRemoveReviewer?: (pullRequest: MyPullRequest) => void;
  onApprove?: (pullRequest: MyPullRequest) => void;
  approving?: boolean;
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
  onBlacklistProject,
  onBlacklistRepository,
  onRemoveReviewer,
  onApprove,
  approving = false,
  completedLabel,
  showProjectKey = true,
}: PullRequestListItemProps) {
  const { t } = useI18n();
  const review = pullRequest.review;
  const reviewRunning = reviewStarting || review?.status === "running";
  const reviewCompleted = review?.status === "completed" && review.result != null;
  const reviewFailed = review?.status === "failed";
  let reviewLabel = t("pr.aiReview");
  let reviewIconClassName: string | undefined;
  if (reviewRunning) {
    reviewLabel = t("pr.aiReviewRunning");
    reviewIconClassName = "text-primary";
  } else if (reviewFailed) {
    reviewLabel = t("pr.aiReviewError");
    reviewIconClassName = "text-destructive";
  } else if (reviewCompleted) {
    reviewLabel = completedLabel ?? t("pr.reviewResults");
    reviewIconClassName = review?.result?.verdict === "ok" ? "text-success" : "text-warning";
  }
  const reviewTitle = !reviewRunning && !reviewFailed && !reviewCompleted && !aiReviewReady
    ? t("pr.aiProviderRequired")
    : reviewLabel;
  const needsAction = mode === "author" && (pullRequest.needsAction || (pullRequest.reviewSummary?.needsWork ?? 0) > 0);
  const reviewSummary = pullRequest.reviewSummary ?? { approved: 0, needsWork: 0, comments: 0 };
  const externalUrl = safePullRequestUrl(pullRequest.url);

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
              {externalUrl ? (
                <a
                  href={externalUrl}
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
              <span className="flex items-center gap-1 text-success" aria-label={t("pr.approvedCount", { count: reviewSummary.approved })}>
                <CheckCircle2 className="size-3.5" aria-hidden="true" /> {reviewSummary.approved}
              </span>
              <span className="flex items-center gap-1 text-warning" aria-label={t("pr.needsWorkCount", { count: reviewSummary.needsWork })}>
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
          {reviewFailed ? (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="h-7 gap-1.5 rounded-md px-2.5 py-0 text-destructive">
                <Sparkles className="size-3" aria-hidden="true" />
                {t("pr.aiReviewError")}
              </Badge>
              <Button type="button" variant="ghost" size="icon" className="size-7 [&_svg]:!size-3.5" onClick={() => onStartReview(pullRequest)} disabled={!aiReviewReady || reviewStarting} aria-label={t("pr.dialog.rerun")} title={t("pr.dialog.rerun")}>
                <RefreshCw aria-hidden="true" />
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => reviewCompleted || reviewFailed ? onOpenResults(pullRequest) : onStartReview(pullRequest)}
              disabled={reviewRunning || (!reviewCompleted && !reviewFailed && !aiReviewReady)}
              aria-label={reviewLabel}
              title={reviewTitle}
            >
              <Sparkles
                aria-hidden="true"
                className={reviewIconClassName}
              />
            </Button>
            {mode === "reviewer" && pullRequest.myDecision !== "approved" ? (
              <Button type="button" variant="outline" size="icon" actionTone="success" className="size-8 text-success" onClick={() => onApprove?.(pullRequest)} disabled={!onApprove || approving} aria-label={t("pr.actions.quickApprove")} title={t("pr.actions.quickApprove")}>
                {approving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
              </Button>
            ) : null}
            {pullRequest.activity !== "read" ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                actionTone="neutral"
                className="size-8"
                onClick={() => onMarkViewed(pullRequest)}
                aria-label={t("pr.markViewed")}
                title={t("pr.markViewed")}
              >
                <Check aria-hidden="true" />
              </Button>
            ) : null}
            {mode === "reviewer" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("pr.actions.more")} title={t("pr.actions.more")}><MoreHorizontal aria-hidden="true" className="size-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!externalUrl} onSelect={() => { if (externalUrl) { window.open(externalUrl, "_blank", "noopener,noreferrer"); onOpenPullRequest(pullRequest); } }}><ExternalLink aria-hidden="true" />{t("pr.dialog.openWeb")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onBlacklistProject?.(pullRequest)}><Ban aria-hidden="true" />{t("pr.actions.blacklistProject")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onBlacklistRepository?.(pullRequest)}><Ban aria-hidden="true" />{t("pr.actions.blacklistRepository")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!onRemoveReviewer} onSelect={() => onRemoveReviewer?.(pullRequest)}><CircleAlert aria-hidden="true" />{t("pr.actions.removeReviewer")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
