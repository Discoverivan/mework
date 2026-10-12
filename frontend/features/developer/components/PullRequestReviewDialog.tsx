import { Hint } from "@/components/ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, MessageCircle, Pencil, RefreshCw, Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MyPullRequest, PullRequestCommentMatch, PullRequestPublishableComment, PullRequestCommentMatchesRequest, PullRequestReviewComment, PullRequestReviewState } from "@/shared/contracts/developer";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";

import {
  CreatorAvatar,
  AiVerdictBadge,
  reviewSeveritySections,
} from "./PullRequestListItem";
import { formatRelativeDate, pullRequestCommentUrl } from "./pull-request-formatting";
import { PullRequestReviewDetails } from "./PullRequestReviewDetails";
import { reviewCommentPath } from "./review-comment-path";
import { normalizeReviewMarkdown } from "./review-markdown";
import { getPullRequestCommentMatches } from "../api";
import { useCommentDiscussions } from "./use-comment-discussions";
import { CommentDiscussionDialog } from "./CommentDiscussionDialog";
import { CommentLocation, ReviewCommentLocation } from "./ReviewCommentLocation";
import { reviewSeverityStyles, reviewSeverityTitleClass } from "./review-severity";

export interface PullRequestReviewDialogProps {
  open: boolean;
  pullRequest?: MyPullRequest;
  review?: PullRequestReviewState;
  reviewerActions?: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPullRequest: (pullRequest: MyPullRequest) => void;
  onRerunReview: (pullRequest: MyPullRequest) => void;
  onPublishComment?: (pullRequest: MyPullRequest, comment: PullRequestPublishableComment) => Promise<{ commentId: number }>;
  onSetDecision?: (pullRequest: MyPullRequest, action: "approve" | "needs_work") => Promise<void>;
}

type EditableComment = {
  scope: string;
  comment: PullRequestReviewComment;
  index: number;
  parentCommentId?: number;
};

type CommentStatus = "checking" | "checkFailed" | "ready" | "duplicate" | "partial" | "publishing" | "published";

function commentKey(comment: PullRequestReviewComment, index: number): string {
  return JSON.stringify([comment.file, comment.line, comment.comment, index]);
}

function ReviewMarkdown({ children }: { children: string }) {
  const markdown = useMemo(() => normalizeReviewMarkdown(children), [children]);
  return <MarkdownContent>{markdown}</MarkdownContent>;
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
  const { t } = useI18n();
  const result = review?.result;
  const reviewFailed = review?.status === "failed";
  const [pendingAction, setPendingAction] = useState<string>();
  const pendingCommentKeysRef = useRef(new Set<string>());
  const [pendingCommentKeys, setPendingCommentKeys] = useState(new Set<string>());
  const [publicationStatus, setPublicationStatus] = useState<{ scope: string; resourceScope: string; published: Map<string, number>; checked: boolean; matches: PullRequestCommentMatch[]; failed?: boolean; failureCode?: string }>();
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [editingComment, setEditingComment] = useState<EditableComment>();
  const [commentDraft, setCommentDraft] = useState("");
  const [actionError, setActionError] = useState<string>();
  const [discussing, setDiscussing] = useState<{ scope: string; index: number }>();
  const discussionScope = pullRequest && review?.status === "completed" ? {
    integrationId: pullRequest.integrationId,
    projectKey: pullRequest.projectKey,
    repositorySlug: pullRequest.repositorySlug,
    pullRequestId: pullRequest.pullRequestId,
    latestCommit: review.reviewedCommit ?? undefined,
    runId: review.runId,
  } : undefined;
  const discussionScopeKey = JSON.stringify(discussionScope);
  const discussions = useCommentDiscussions(open, discussionScope);
  const comments = useMemo(() => result?.comments.map((comment, index) => {
    const discussion = discussions.items.get(index);
    return discussion?.decision === "revised" && discussion.appliedComment
      ? { ...comment, comment: discussion.appliedComment } : comment;
  }) ?? [], [result, discussions.items]);

  const publicationRequest = pullRequest && result?.comments.length
    ? JSON.stringify({
      integrationId: pullRequest.integrationId,
      projectKey: pullRequest.projectKey,
      repositorySlug: pullRequest.repositorySlug,
      pullRequestId: pullRequest.pullRequestId,
      latestCommit: pullRequest.latestCommit,
      comments,
    } satisfies PullRequestCommentMatchesRequest)
    : "";
  const publicationScope = `${review?.runId ?? ""}:${publicationRequest}`;
  const publicationResourceScope = JSON.stringify([pullRequest?.integrationId, pullRequest?.projectKey, pullRequest?.repositorySlug, pullRequest?.pullRequestId, pullRequest?.latestCommit, review?.runId]);
  const editingPending = Boolean(editingComment && pendingCommentKeys.has(
    JSON.stringify([publicationResourceScope, commentKey(editingComment.comment, editingComment.index)]),
  ));
  const hasPendingComments = [...pendingCommentKeys].some((key) => JSON.parse(key)[0] === publicationResourceScope);
  const checkingPublication = !discussions.ready || Boolean(publicationRequest)
    && (publicationStatus?.scope !== publicationScope || !publicationStatus.checked);
  const publishedComments = publicationStatus?.resourceScope === publicationResourceScope ? publicationStatus.published : new Map<string, number>();
  const commentMatches = publicationStatus?.scope === publicationScope ? publicationStatus.matches : [];
  const comparisonFailed = publicationStatus?.scope === publicationScope && publicationStatus.failed;
  const comparisonError = t(publicationStatus?.scope === publicationScope && publicationStatus.failureCode === "authentication_required" ? "pr.dialog.publicationAuthenticationError" : "pr.dialog.publicationCheckError");
  const editingMatch = editingComment ? commentMatches.find((match) => match.index === editingComment.index) : undefined;
  const editingParent = editingMatch?.coverage === "partial" ? editingMatch.parentCommentId ?? editingMatch.commentId : undefined;
  const editingDestinationChanged = Boolean(editingComment && !checkingPublication && editingComment.parentCommentId !== editingParent);
  const editingDuplicate = editingMatch?.coverage === "full";

  function retryComparison() {
    setActionError(undefined);
    setCheckAttempt((attempt) => attempt + 1);
  }

  useEffect(() => {
    if (!open || !publicationRequest) return;
    let active = true;
    const request: PullRequestCommentMatchesRequest = JSON.parse(publicationRequest);
    setPublicationStatus((current) => ({ scope: publicationScope, resourceScope: publicationResourceScope, published: current?.resourceScope === publicationResourceScope ? current.published : new Map(), checked: false, matches: [] }));
    void getPullRequestCommentMatches(request).then(({ matches }) => {
      if (!active) return;
      setPublicationStatus((current) => ({
        scope: publicationScope,
        resourceScope: publicationResourceScope,
        published: current?.resourceScope === publicationResourceScope ? current.published : new Map(),
        matches,
        checked: true,
      }));
    }).catch((error: unknown) => {
      if (!active) return;
      const failureCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
      setPublicationStatus((current) => ({ scope: publicationScope, resourceScope: publicationResourceScope, published: current?.resourceScope === publicationResourceScope ? current.published : new Map(), checked: false, matches: [], failed: true, failureCode }));
    });
    return () => { active = false; };
  }, [open, publicationRequest, publicationScope, publicationResourceScope, t, checkAttempt]);

  useEffect(() => {
    if (!open) {
      setDiscussing(undefined);
      setEditingComment(undefined);
      setCommentDraft("");
      setActionError(undefined);
    }
  }, [open]);

  function openCommentEditor(comment: PullRequestReviewComment, index: number) {
    const match = commentMatches.find((match) => match.index === index && match.coverage === "partial");
    setEditingComment({ scope: publicationScope, comment, index, parentCommentId: match ? match.parentCommentId ?? match.commentId : undefined });
    setCommentDraft(match?.addition ?? comment.comment);
    setActionError(undefined);
  }

  async function publishComment(comment: PullRequestReviewComment, index: number, editedText: string, parentCommentId?: number) {
    if (!pullRequest || !onPublishComment) return;
    if (discussions.pending(index) || discussions.items.get(index)?.decision === "dismissed") return;
    if (comments[index]?.comment !== comment.comment) {
      setActionError(t("pr.discuss.changed"));
      return;
    }
    const key = commentKey(comment, index);
    const pendingKey = JSON.stringify([publicationResourceScope, key]);
    if (pendingCommentKeysRef.current.has(pendingKey) || publishedComments.has(key)) return;
    const match = commentMatches.find((match) => match.index === index);
    if (checkingPublication || match?.coverage === "full") return;
    const currentParent = match?.coverage === "partial" ? match.parentCommentId ?? match.commentId : undefined;
    if (parentCommentId !== currentParent) {
      setActionError(t("pr.dialog.discussionChanged"));
      return;
    }
    const nextComment: PullRequestPublishableComment = { ...comment, comment: editedText.trim(), ...(parentCommentId != null ? { parentCommentId } : {}) };
    if (!nextComment.comment) {
      setActionError(t("pr.dialog.commentRequired"));
      return;
    }
    pendingCommentKeysRef.current.add(pendingKey);
    setPendingCommentKeys(new Set(pendingCommentKeysRef.current));
    setActionError(undefined);
    try {
      const { commentId } = await onPublishComment(pullRequest, nextComment);
      setPublicationStatus((current) => current?.resourceScope === publicationResourceScope ? {
        ...current,
        published: new Map(current.published).set(key, commentId),
      } : current);
      setEditingComment((current) => current?.scope === publicationScope && commentKey(current.comment, current.index) === key ? undefined : current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : typeof error === "string" ? error : t("pr.dialog.publishError"));
      setCheckAttempt((attempt) => attempt + 1);
    } finally {
      pendingCommentKeysRef.current.delete(pendingKey);
      setPendingCommentKeys(new Set(pendingCommentKeysRef.current));
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

  const openInBrowser = pullRequest?.url ? (
    <Button asChild type="button" variant="outline" size="icon" actionTone="neutral" className="size-7 shrink-0 text-foreground">
      <Hint content={t("pr.dialog.openWeb")}><a href={pullRequest.url} target="_blank" rel="noreferrer" aria-label={t("pr.dialog.openWeb")} onClick={() => onOpenPullRequest(pullRequest)}>
        <ExternalLink aria-hidden="true" />
      </a></Hint>
    </Button>
  ) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="gap-2">
          <div data-subform className="flex items-center gap-2 pr-6">
            <DialogTitle aria-label={t("pr.dialog.results")} className="min-w-0 break-words">
              {pullRequest?.projectKey}/{pullRequest?.repositorySlug} #{pullRequest?.pullRequestId}
            </DialogTitle>
            {openInBrowser}
          </div>
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
          </div>
        </DialogHeader>
        <DialogBody layout="sections">
          {reviewFailed ? (
            <Alert variant="destructive" data-info-popover-boundary>
              <CircleAlert aria-hidden="true" className="size-4 translate-y-0.5" />
              <AlertTitle className="flex items-center gap-2">
                {t("pr.aiReviewError")}
                {review ? <PullRequestReviewDetails review={review} /> : null}
              </AlertTitle>
              <AlertDescription className="break-words">{review.error || t("pr.dialog.unknownReviewError")}</AlertDescription>
            </Alert>
          ) : null}
          {result && !reviewFailed ? (
            <>
              <section data-info-popover-boundary aria-labelledby="ai-summary-title" className="overflow-hidden rounded-lg border bg-card">
                  <CardHeader variant="section" className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-2">
                    <h3 id="ai-summary-title" className="text-base font-semibold leading-tight">{t("pr.dialog.aiSummary")}</h3>
                    <AiVerdictBadge verdict={result.verdict} review={review} className="border-muted-foreground/40 [&_[data-orientation=vertical]]:bg-muted-foreground/40" />
                  </CardHeader>
                <div className="space-y-2 px-4 py-3">
                  <ReviewMarkdown>{result.description}</ReviewMarkdown>
                  <ReviewMarkdown>{result.summary}</ReviewMarkdown>
                </div>
              </section>
              <section aria-labelledby="ai-comments-title" className="space-y-4">
                <h3 id="ai-comments-title" className="text-sm font-semibold">{t("pr.dialog.aiComments")}</h3>
                {!discussions.ready ? <div className="flex items-center justify-between gap-2 rounded-md border px-4 py-3 text-sm text-muted-foreground">
                  <span>{t(discussions.failed ? "pr.discuss.loadError" : "pr.discuss.loading")}</span>
                  {discussions.failed ? <Button size="sm" actionTone="neutral" onClick={discussions.retry}>{t("pr.discuss.retry")}</Button> : null}
                </div> : null}
                <div className="space-y-4">
                  {result.comments.length === 0 ? <p className="text-sm text-muted-foreground">{t("pr.dialog.noComments")}</p> : null}
                  {reviewSeveritySections.map((section) => {
                    const sectionComments = comments.filter((comment) => comment.severity === section.key);
                    if (sectionComments.length === 0) return null;
                    return (
                      <details key={section.key} open className={cn("overflow-hidden rounded-lg border", reviewSeverityStyles[section.key].border)}>
                        <summary className={cn("flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2", reviewSeverityTitleClass, reviewSeverityStyles[section.key].header)}>
                          <span>{t(section.labelKey)} ({sectionComments.length})</span>
                        </summary>
                        <div className="bg-background p-4 text-foreground">
                          <ul className="space-y-4">
                            {sectionComments.map((comment) => {
                              const index = comments.indexOf(comment);
                              const key = commentKey(comment, index);
                              const published = publishedComments.has(key);
                              const discussion = discussions.items.get(index);
                              const dismissed = discussion?.decision === "dismissed";
                              const matched = commentMatches.find((match) => match.index === index);
                              const existingId = publishedComments.get(key) ?? matched?.commentId;
                              const matchedUrl = existingId != null ? pullRequestCommentUrl(pullRequest?.url, existingId) : undefined;
                              const commentPending = pendingCommentKeys.has(JSON.stringify([publicationResourceScope, key]));
                              const status: CommentStatus = commentPending ? "publishing"
                                : published ? "published"
                                : comparisonFailed ? "checkFailed"
                                : checkingPublication ? "checking"
                                : matched?.coverage === "full" ? "duplicate"
                                : matched?.coverage === "partial" ? "partial" : "ready";
                              const publishLabel = status === "publishing" ? t("pr.dialog.publishing") : t("pr.dialog.publish");
                              return (
                                <li key={`${comment.file}:${comment.line ?? "na"}:${index}`} className="overflow-hidden rounded-md border bg-card">
                                  <ReviewCommentLocation comment={comment} pullRequestUrl={pullRequest?.url} onOpen={() => { if (pullRequest) onOpenPullRequest(pullRequest); }} />
                                  <div className="space-y-2 px-4 py-3">
                                  <ReviewMarkdown>{comment.comment}</ReviewMarkdown>
                                  {discussion && (discussion.decision === "revised" || dismissed) ? <div className="space-y-1 rounded-md border px-4 py-3 text-sm text-muted-foreground"><p>{t(`pr.discuss.decision.${discussion.decision}`)}</p>{dismissed ? <p className="whitespace-pre-wrap break-words">{discussion.reason}</p> : null}</div> : null}
                                  {!published && matched?.coverage === "partial" ? <p className="text-sm text-muted-foreground">{t("pr.dialog.partiallyCovered")}</p> : null}
                                  <Separator />
                                  <div className="flex flex-wrap items-center gap-2">
                                    {matchedUrl || (status !== "ready" && status !== "publishing") ? <div className="mr-auto flex flex-wrap items-center gap-2">
                                      {matchedUrl ? <Button asChild variant="outline" size="sm"><a href={matchedUrl} target="_blank" rel="noopener noreferrer" aria-label={t("pr.dialog.existingCommentFor", { file: reviewCommentPath(comment.file) })}><ExternalLink aria-hidden="true" />{t("pr.dialog.existingComment")}</a></Button> : null}
                                      {status === "checkFailed" ? <Button type="button" variant="outline" size="sm" actionTone="neutral" aria-label={t("pr.dialog.retryComparisonFor", { file: reviewCommentPath(comment.file) })} title={t("pr.dialog.retryComparison")} onClick={retryComparison}><RefreshCw aria-hidden="true" />{t("pr.discuss.retry")}</Button> : null}
                                      {status !== "ready" && status !== "publishing" ? <Hint content={status === "checkFailed" ? comparisonError : status === "duplicate" ? t("pr.dialog.duplicateCovered") : status === "partial" ? t("pr.dialog.partiallyCovered") : undefined}><span role="status" aria-label={t("pr.dialog.statusFor", { file: reviewCommentPath(comment.file) })} className={cn("flex items-center gap-1.5 text-xs", status === "checkFailed" ? "text-destructive" : "text-muted-foreground")}>
                                        {status === "checking" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : status === "checkFailed" ? <CircleAlert aria-hidden="true" className="size-4" /> : status === "published" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : null}
                                        {t(`pr.dialog.commentStatus.${status}`)}
                                      </span></Hint> : null}
                                    </div> : null}
                                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                                      {status === "checkFailed" || status === "checking" || published || dismissed || discussions.pending(index) || matched?.coverage === "full" ? null
                                      : reviewerActions && matched?.coverage === "partial" ? (
                                        <Button type="button" variant="outline" size="sm" actionTone="neutral" className="shrink-0" aria-label={t("pr.dialog.publishFor", { file: reviewCommentPath(comment.file) })} title={status === "publishing" ? t("pr.dialog.publishing") : t("pr.dialog.publishAddition")} disabled={!onPublishComment || commentPending || pendingAction != null || checkingPublication} onClick={() => openCommentEditor(comment, index)}>
                                          {status === "publishing" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
                                          {status === "publishing" ? t("pr.dialog.publishing") : t("pr.dialog.publishAddition")}
                                        </Button>
                                      ) : reviewerActions ? (
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              actionTone="neutral"
                                              className="shrink-0"
                                              disabled={!onPublishComment || commentPending || pendingAction != null || checkingPublication}
                                              aria-label={t("pr.dialog.publishFor", { file: reviewCommentPath(comment.file) })}
                                              title={publishLabel}
                                            >
                                              {status === "publishing" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
                                              {publishLabel}
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (editingComment) event.preventDefault(); }}>
                                            <DropdownMenuItem disabled={commentPending || pendingAction != null || checkingPublication} onSelect={() => void publishComment(comment, index, comment.comment)}>
                                              <Send aria-hidden="true" />
                                              {t("pr.dialog.sendAsIs")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem disabled={commentPending || pendingAction != null || checkingPublication} onSelect={() => openCommentEditor(comment, index)}>
                                              <Pencil aria-hidden="true" />
                                              {t("pr.dialog.editAndSend")}
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      ) : null}
                                      <Button type="button" variant="outline" size="sm" actionTone="neutral" disabled={!discussions.ready || commentPending} aria-label={t("pr.discuss.for", { file: reviewCommentPath(comment.file) })} onClick={() => setDiscussing({ scope: discussionScopeKey, index })}>
                                        {discussions.pending(index) ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <MessageCircle aria-hidden="true" className="size-4" />}{t("pr.discuss.title")}
                                      </Button>
                                    </div>
                                  </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
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
        <DialogFooter className="items-center gap-2">
          <Button
            data-dialog-cancel
            type="button"
            variant="outline"
            size="sm"
            actionTone="neutral"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              actionTone="neutral"
              className="text-foreground"
              onClick={() => {
                if (pullRequest) {
                  onOpenChange(false);
                  onRerunReview(pullRequest);
                }
              }}
              disabled={!pullRequest}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {t(reviewFailed ? "pr.dialog.retryReview" : "pr.dialog.rerun")}
            </Button>
          </div>
          {reviewerActions && !reviewFailed ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                actionTone="warning"
                className="text-foreground"
                disabled={!pullRequest || !onSetDecision || pendingAction != null || hasPendingComments}
                onClick={() => void setDecision("needs_work")}
              >
                {pendingAction === "needs_work" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CircleAlert aria-hidden="true" className="size-4" />}
                {pendingAction === "needs_work" ? t("pr.dialog.saving") : t("pr.dialog.needsWork")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                actionTone="success"
                className="text-foreground"
                disabled={!pullRequest || !onSetDecision || pendingAction != null || hasPendingComments}
                onClick={() => void setDecision("approve")}
              >
                {pendingAction === "approve" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
                {pendingAction === "approve" ? t("pr.dialog.saving") : t("pr.dialog.approve")}
              </Button>
            </div>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
      {open && discussing && discussing.scope === discussionScopeKey && result?.comments[discussing.index] ? <CommentDiscussionDialog
        key={`${discussionScopeKey}:${discussing.index}`}
        comment={result.comments[discussing.index]}
        pullRequestUrl={pullRequest?.url}
        onOpenLocation={() => { if (pullRequest) onOpenPullRequest(pullRequest); }}
        commit={review?.reviewedCommit}
        discussion={discussions.items.get(discussing.index)}
        pending={discussions.pending(discussing.index)}
        error={discussions.error(discussing.index)}
        published={publishedComments.has(commentKey(comments[discussing.index], discussing.index))}
        onClose={() => setDiscussing(undefined)}
        onAction={(action, text) => discussions.perform(discussing.index, action, text)}
      /> : null}
      <Dialog
        open={Boolean(open && editingComment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !editingPending) {
            setEditingComment(undefined);
            setCommentDraft("");
            setActionError(undefined);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t(editingComment?.parentCommentId ? "pr.dialog.publishAddition" : "pr.dialog.editComment")}</DialogTitle>
            <DialogDescription>
              {t(editingComment?.parentCommentId ? "pr.dialog.additionDescription" : "pr.dialog.editCommentDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody layout="sections">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {editingComment ? <CommentLocation comment={editingComment.comment} /> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="review-comment-editor">{t("pr.dialog.comment")}</Label>
              <textarea autoComplete="off"
                id="review-comment-editor"
                aria-label={t("pr.dialog.reviewComment")}
                className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                disabled={editingPending}
                autoFocus
              />
            </div>
            {comparisonFailed ? <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="space-y-2">
                <p>{comparisonError}</p>
                <Button type="button" variant="outline" size="sm" onClick={retryComparison}><RefreshCw aria-hidden="true" />{t("pr.dialog.retryComparison")}</Button>
              </AlertDescription>
            </Alert> : checkingPublication ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />{t("pr.dialog.commentStatus.checking")}</p>
              : editingDuplicate || editingDestinationChanged ? <Alert>
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{t(editingDuplicate ? "pr.dialog.duplicateCovered" : "pr.dialog.editorDestinationChanged")}</AlertDescription>
              </Alert> : null}
            {actionError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button data-dialog-cancel
              type="button"
              variant="outline"
              onClick={() => {
                if (!editingPending) {
                  setEditingComment(undefined);
                  setCommentDraft("");
                  setActionError(undefined);
                }
              }}
              disabled={editingPending}
            >
              {t("settings.common.cancel")}
            </Button>
            <Button
              type="button"
              actionTone="add"
              onClick={() => {
                if (editingComment) void publishComment(editingComment.comment, editingComment.index, commentDraft, editingComment.parentCommentId);
              }}
              disabled={!editingComment || !onPublishComment || !commentDraft.trim() || editingPending || checkingPublication || editingDuplicate || editingDestinationChanged}
            >
              {editingPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
              {editingPending ? t("pr.dialog.sending") : t("pr.dialog.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
