import { Check, CheckCircle2, CircleAlert, Clock3, ExternalLink, Loader2, MessageSquare, MoreHorizontal, RefreshCw, Sparkles, Ban, SmilePlus } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type {
  MyPullRequest,
  MyPullRequestDecision,
  PullRequestReviewSeverity,
  PullRequestReviewState,
} from "@/shared/contracts/developer";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n/locales/en";
import { formatRelativeDate } from "./pull-request-formatting";
import { PullRequestReviewDetails } from "./PullRequestReviewDetails";

export type PullRequestListMode = "reviewer" | "author";

const reviewDecisionAppearance = {
  approved: { icon: CheckCircle2, tone: "success" },
  needs_work: { icon: CircleAlert, tone: "warning" },
  not_reviewed: { icon: SmilePlus, tone: "neutral" },
} as const;

export const reviewSeveritySections: Array<{
  key: PullRequestReviewSeverity;
  labelKey: TranslationKey;
}> = [
  { key: "blocker", labelKey: "pr.severity.blocker" },
  { key: "high", labelKey: "pr.severity.high" },
  { key: "medium", labelKey: "pr.severity.medium" },
  { key: "low", labelKey: "pr.severity.low" },
];

function safePullRequestUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
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

export function AiVerdictBadge({ verdict, review }: { verdict: "ok" | "needs_changes"; review?: PullRequestReviewState }) {
  const { t } = useI18n();
  const approved = verdict === "ok";
  const label = t(approved ? "pr.decision.approved" : "pr.decision.needsWork");
  return (
    <Badge
      variant="outline"
      className={cn("h-7 gap-1.5 rounded-md px-2.5 py-0", approved ? "text-success" : "text-warning")}
      aria-label={t("pr.aiVerdict", { verdict: label })}
    >
      {review ? <><PullRequestReviewDetails review={review} /><Separator orientation="vertical" className="h-4" /></> : null}
      <Sparkles className="size-3" aria-hidden="true" />
      {t("pr.aiVerdictLabel")}
      <Separator orientation="vertical" className="h-4" />
      {approved ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
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
  onReviewDecision?: (pullRequest: MyPullRequest, action: "approve" | "needs_work") => void;
  decisionPending?: boolean;
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
  onReviewDecision,
  decisionPending = false,
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
  const { icon: DecisionIcon, tone: decisionTone } = reviewDecisionAppearance[pullRequest.myDecision];

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
          {reviewRunning ? (
            <Badge variant="outline" className="h-7 gap-1.5 rounded-md px-2.5 py-0 text-primary" role="status" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t("pr.aiReviewInProgress")}
            </Badge>
          ) : null}
          {!reviewRunning && reviewCompleted && review?.result ? <AiVerdictBadge verdict={review.result.verdict} review={review} /> : null}
          {!reviewRunning && reviewFailed ? (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="h-7 gap-1.5 rounded-md px-2.5 py-0 text-destructive">
                {review ? <><PullRequestReviewDetails review={review} /><Separator orientation="vertical" className="h-4" /></> : null}
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
            {mode === "reviewer" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="icon" actionTone={decisionTone} className="size-8" disabled={!onReviewDecision || decisionPending} aria-label={t("pr.actions.reviewDecision")} title={t("pr.actions.reviewDecision")}>
                    {decisionPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <DecisionIcon aria-hidden="true" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem disabled={pullRequest.myDecision === "approved"} onSelect={() => onReviewDecision?.(pullRequest, "approve")}><CheckCircle2 aria-hidden="true" className="text-success" />{t("pr.dialog.approve")}</DropdownMenuItem>
                    <DropdownMenuItem disabled={pullRequest.myDecision === "needs_work"} onSelect={() => onReviewDecision?.(pullRequest, "needs_work")}><CircleAlert aria-hidden="true" className="text-warning" />{t("pr.dialog.needsWork")}</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("pr.actions.more")} title={t("pr.actions.more")}><MoreHorizontal aria-hidden="true" className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {pullRequest.activity !== "read" ? <DropdownMenuItem onSelect={() => onMarkViewed(pullRequest)}><Check aria-hidden="true" />{t("pr.markViewed")}</DropdownMenuItem> : null}
                <DropdownMenuItem disabled={!externalUrl} onSelect={() => { if (externalUrl) { window.open(externalUrl, "_blank", "noopener,noreferrer"); onOpenPullRequest(pullRequest); } }}><ExternalLink aria-hidden="true" />{t("pr.dialog.openWeb")}</DropdownMenuItem>
                {mode === "reviewer" ? <>
                  <DropdownMenuItem onSelect={() => onBlacklistProject?.(pullRequest)}><Ban aria-hidden="true" />{t("pr.actions.blacklistProject")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onBlacklistRepository?.(pullRequest)}><Ban aria-hidden="true" />{t("pr.actions.blacklistRepository")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!onRemoveReviewer} onSelect={() => onRemoveReviewer?.(pullRequest)}><CircleAlert aria-hidden="true" />{t("pr.actions.removeReviewer")}</DropdownMenuItem>
                </> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
