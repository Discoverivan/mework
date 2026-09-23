import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { useI18n } from "@/i18n/context";

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

type EditableComment = {
  comment: PullRequestReviewComment;
  index: number;
};

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
  const { t } = useI18n();
  const result = review?.result;
  const [pendingAction, setPendingAction] = useState<string>();
  const [publishedComments, setPublishedComments] = useState<Set<string>>(() => new Set());
  const [editingComment, setEditingComment] = useState<EditableComment>();
  const [commentDraft, setCommentDraft] = useState("");
  const [actionError, setActionError] = useState<string>();

  function commentKey(comment: PullRequestReviewComment, index: number): string {
    return `${comment.file}:${comment.line ?? "na"}:${index}`;
  }

  useEffect(() => {
    if (!open) {
      setEditingComment(undefined);
      setCommentDraft("");
      setActionError(undefined);
    }
  }, [open]);

  function openCommentEditor(comment: PullRequestReviewComment, index: number) {
    setEditingComment({ comment, index });
    setCommentDraft(comment.comment);
    setActionError(undefined);
  }

  async function publishComment(comment: PullRequestReviewComment, index: number, editedText: string) {
    if (!pullRequest || !onPublishComment) return;
    const key = commentKey(comment, index);
    const nextComment = { ...comment, comment: editedText.trim() };
    if (!nextComment.comment) {
      setActionError(t("pr.dialog.commentRequired"));
      return;
    }
    setPendingAction(key);
    setActionError(undefined);
    try {
      await onPublishComment(pullRequest, nextComment);
      setPublishedComments((current) => new Set(current).add(key));
      setEditingComment(undefined);
      setCommentDraft("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : typeof error === "string" ? error : t("pr.dialog.publishError"));
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
      onOpenChange(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : typeof error === "string" ? error : t("pr.dialog.decisionError"));
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="gap-2">
          <DialogTitle aria-label={t("pr.dialog.results")} className="text-base font-semibold">
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
                    {formatRelativeDate(pullRequest.updatedDate, t)}
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
                  aria-label={t("pr.dialog.openWeb")}
                  onClick={() => onOpenPullRequest(pullRequest)}
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  {t("pr.dialog.openWeb")}
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
                    <h3 id="ai-summary-title" className="text-sm font-semibold">{t("pr.dialog.aiSummary")}</h3>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{result.description}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{result.summary}</p>
                  </div>
                  <Badge
                    variant={result.verdict === "ok" ? "default" : "destructive"}
                    className={result.verdict === "ok" ? "shrink-0 bg-emerald-600 hover:bg-emerald-600" : "shrink-0"}
                  >
                    {t(result.verdict === "ok" ? "pr.decision.approved" : "pr.decision.needsWork")}
                  </Badge>
                </div>
              </section>
              <section aria-labelledby="ai-comments-title" className="space-y-3">
                <h3 id="ai-comments-title" className="text-sm font-semibold">{t("pr.dialog.aiComments")}</h3>
                <div className="space-y-2">
                  {reviewSeveritySections.map((section) => {
                    const comments = result.comments.filter((comment) => comment.severity === section.key);
                    return (
                      <details key={section.key} open={comments.length > 0} className="rounded-lg border">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${reviewSeverityBadgeClasses[section.key]}`}>{t(section.labelKey)} ({comments.length})</span>
                        </summary>
                        <div className="border-t px-3 py-2">
                          {comments.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("pr.dialog.noComments")}</p>
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
                                        onClick={() => openCommentEditor(comment, index)}
                                        aria-label={t("pr.dialog.publishFor", { file: comment.file })}
                                      >
                                        {pendingAction === commentKey(comment, index) ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
                                        {publishedComments.has(commentKey(comment, index)) ? t("pr.dialog.published") : pendingAction === commentKey(comment, index) ? t("pr.dialog.publishing") : t("pr.dialog.publish")}
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
            {t("pr.dialog.rerun")}
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
                {pendingAction === "needs_work" ? t("pr.dialog.saving") : t("pr.dialog.needsWork")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!pullRequest || !onSetDecision || pendingAction != null}
                onClick={() => void setDecision("approve")}
                className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                {pendingAction === "approve" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
                {pendingAction === "approve" ? t("pr.dialog.saving") : t("pr.dialog.approve")}
              </Button>
            </div>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
      <Dialog
        open={Boolean(open && editingComment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && pendingAction == null) {
            setEditingComment(undefined);
            setCommentDraft("");
            setActionError(undefined);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("pr.dialog.editComment")}</DialogTitle>
            <DialogDescription>
              {t("pr.dialog.editCommentDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {editingComment?.comment.file}{editingComment?.comment.line != null ? `:${editingComment.comment.line}` : ""}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="review-comment-editor">{t("pr.dialog.comment")}</Label>
              <textarea
                id="review-comment-editor"
                aria-label={t("pr.dialog.reviewComment")}
                className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                disabled={pendingAction != null}
                autoFocus
              />
            </div>
            {actionError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (pendingAction == null) {
                  setEditingComment(undefined);
                  setCommentDraft("");
                  setActionError(undefined);
                }
              }}
              disabled={pendingAction != null}
            >
              {t("settings.common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (editingComment) void publishComment(editingComment.comment, editingComment.index, commentDraft);
              }}
              disabled={!editingComment || !onPublishComment || !commentDraft.trim() || pendingAction != null}
            >
              {pendingAction != null ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
              {pendingAction != null ? t("pr.dialog.sending") : t("pr.dialog.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
