import { useState } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";

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
import type { MyPullRequest, PullRequestReviewComment, PullRequestReviewState } from "@/shared/contracts/developer";

import {
  CreatorAvatar,
  formatRelativeDate,
  reviewSeverityBadgeClasses,
  reviewSeveritySections,
} from "./PullRequestListItem";

export interface PullRequestReviewDialogProps {
  open: boolean;
  pullRequest?: MyPullRequest;
  review?: PullRequestReviewState;
  reviewerActions?: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPullRequest: (pullRequest: MyPullRequest) => void;
  onRerunReview: (pullRequest: MyPullRequest) => void;
  onPublishComment?: (pullRequest: MyPullRequest, comment: PullRequestReviewComment) => Promise<void>;
  onSetDecision?: (pullRequest: MyPullRequest, action: "approve" | "needs_work") => Promise<void>;
}

export function PullRequestReviewDialog({
  open,
  pullRequest,
  review,
  reviewerActions = false,
  onOpenChange,
  onOpenPullRequest,
  onRerunReview,
  onPublishComment,
  onSetDecision,
}: PullRequestReviewDialogProps) {
  const result = review?.result;
  const [pendingAction, setPendingAction] = useState<string>();
  const [publishedComments, setPublishedComments] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string>();

  function commentKey(comment: PullRequestReviewComment, index: number): string {
    return `${comment.file}:${comment.line ?? "na"}:${index}`;
  }

  async function publishComment(comment: PullRequestReviewComment, index: number) {
    if (!pullRequest || !onPublishComment) return;
    const key = commentKey(comment, index);
    setPendingAction(key);
    setActionError(undefined);
    try {
      await onPublishComment(pullRequest, comment);
      setPublishedComments((current) => new Set(current).add(key));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : typeof error === "string" ? error : "Unable to publish comment");
    } finally {
      setPendingAction(undefined);
    }
  }

  async function setDecision(action: "approve" | "needs_work") {
    if (!pullRequest || !onSetDecision) return;
    setPendingAction(action);
    setActionError(undefined);
    try {
      await onSetDecision(pullRequest, action);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : typeof error === "string" ? error : "Unable to update pull request decision");
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="gap-2">
          <DialogTitle aria-label="Review results" className="text-base font-semibold">
            {pullRequest?.projectKey}/{pullRequest?.repositorySlug} #{pullRequest?.pullRequestId}
          </DialogTitle>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <DialogDescription className="break-words text-sm font-semibold text-foreground">
                {pullRequest?.title}
              </DialogDescription>
              {pullRequest ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CreatorAvatar pullRequest={pullRequest} />
                  <span className="font-normal text-foreground">{pullRequest.authorDisplayName}</span>
                  <span aria-hidden="true">•</span>
                  <time dateTime={pullRequest.updatedDate != null ? new Date(pullRequest.updatedDate).toISOString() : undefined}>
                    {formatRelativeDate(pullRequest.updatedDate)}
                  </time>
                </div>
              ) : null}
            </div>
            {pullRequest?.url ? (
              <Button asChild type="button" variant="outline" size="sm" className="shrink-0">
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open in web"
                  onClick={() => onOpenPullRequest(pullRequest)}
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  Open in web
                </a>
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          {result ? (
            <>
              <section aria-labelledby="ai-summary-title" className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <h3 id="ai-summary-title" className="text-sm font-semibold">AI Summary</h3>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{result.description}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{result.summary}</p>
                  </div>
                  <Badge
                    variant={result.verdict === "ok" ? "default" : "destructive"}
                    className={result.verdict === "ok" ? "shrink-0 bg-emerald-600 hover:bg-emerald-600" : "shrink-0"}
                  >
                    {result.verdict === "ok" ? "Approved" : "Needs work"}
                  </Badge>
                </div>
              </section>
              <section aria-labelledby="ai-comments-title" className="space-y-3">
                <h3 id="ai-comments-title" className="text-sm font-semibold">AI Comments</h3>
                <div className="space-y-2">
                  {reviewSeveritySections.map((section) => {
                    const comments = result.comments.filter((comment) => comment.severity === section.key);
                    return (
                      <details key={section.key} open={comments.length > 0} className="rounded-lg border">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${reviewSeverityBadgeClasses[section.key]}`}>{section.label} ({comments.length})</span>
                        </summary>
                        <div className="border-t px-3 py-2">
                          {comments.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No comments.</p>
                          ) : (
                            <ul className="space-y-2">
                              {comments.map((comment, index) => (
                                <li key={`${comment.file}:${comment.line ?? "na"}:${index}`} className="space-y-2 rounded-md border bg-background p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="min-w-0 break-words text-xs font-medium text-muted-foreground">
                                      {comment.file}{comment.line != null ? `:${comment.line}` : ""}
                                    </p>
                                    {reviewerActions ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 shrink-0 px-2 text-xs"
                                        disabled={!onPublishComment || pendingAction != null || publishedComments.has(commentKey(comment, index))}
                                        onClick={() => void publishComment(comment, index)}
                                        aria-label={`Publish comment for ${comment.file}`}
                                      >
                                        {pendingAction === commentKey(comment, index) ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
                                        {publishedComments.has(commentKey(comment, index)) ? "Published" : pendingAction === commentKey(comment, index) ? "Publishing…" : "Publish"}
                                      </Button>
                                    ) : null}
                                  </div>
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
              </section>
              {actionError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (pullRequest) {
                onOpenChange(false);
                onRerunReview(pullRequest);
              }
            }}
            disabled={!pullRequest}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Re-run review
          </Button>
          {reviewerActions ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pullRequest || !onSetDecision || pendingAction != null}
                onClick={() => void setDecision("needs_work")}
                className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
              >
                {pendingAction === "needs_work" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CircleAlert aria-hidden="true" className="size-4" />}
                {pendingAction === "needs_work" ? "Saving…" : "Needs Work"}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!pullRequest || !onSetDecision || pendingAction != null}
                onClick={() => void setDecision("approve")}
                className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                {pendingAction === "approve" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
                {pendingAction === "approve" ? "Saving…" : "Approve"}
              </Button>
            </div>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
