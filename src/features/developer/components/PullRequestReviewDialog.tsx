import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MyPullRequest, PullRequestReviewComment, PullRequestReviewSeverity, PullRequestReviewState } from "@/shared/contracts/developer";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";

import {
  CreatorAvatar,
  AiVerdictBadge,
  formatRelativeDate,
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

const severitySectionStyles: Record<PullRequestReviewSeverity, { border: string; header: string }> = {
  blocker: { border: "border-destructive/60", header: "bg-destructive/20 text-destructive" },
  high: { border: "border-destructive/40", header: "bg-destructive/10 text-destructive" },
  medium: { border: "border-warning/40", header: "bg-warning/10 text-warning" },
  low: { border: "border-primary/40", header: "bg-primary/10 text-primary" },
};

function commentDiffUrl(pullRequestUrl: string | undefined, comment: PullRequestReviewComment): string | undefined {
  if (!pullRequestUrl || !comment.file.trim()) return undefined;
  try {
    const url = new URL(pullRequestUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    if (!/\/pull-requests\/\d+(?:\/.*)?$/.test(url.pathname)) return undefined;
    url.pathname = url.pathname.replace(/(\/pull-requests\/\d+)(?:\/.*)?$/, "$1/diff");
    url.search = "";
    // Bitbucket Server/DC uses ?t= for lines on the destination side of the diff.
    const line = comment.line != null && Number.isSafeInteger(comment.line) && comment.line > 0 ? `?t=${comment.line}` : "";
    url.hash = `${comment.file.split("/").map(encodeURIComponent).join("/")}${line}`;
    return url.href;
  } catch {
    return undefined;
  }
}

function ReviewMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words text-sm text-foreground [&>*+*]:mt-2 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown skipHtml allowedElements={["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "strong", "em", "code", "pre", "a", "blockquote", "br", "hr"]}
        components={{
          hr: () => <Separator />,
          p: ({ children: text }) => <p className="whitespace-pre-wrap text-foreground">{text}</p>,
          a: ({ href, children: text }) => href && /^https?:\/\//i.test(href)
            ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{text}</a>
            : <span>{text}</span>,
        }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CommentLocation({ comment }: { comment: PullRequestReviewComment }) {
  const segments = comment.file.split("/");
  const filename = segments.pop();
  return <>{segments.map((segment, index) => <span key={index}>{segment}/<wbr /></span>)}<span className="inline-block max-w-full break-all">{filename}{comment.line != null ? `:${comment.line}` : ""}</span></>;
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
  const { t, locale } = useI18n();
  const result = review?.result;
  const reviewFailed = review?.status === "failed";
  const finishedAt = review?.finishedAt != null ? new Date(review.finishedAt) : undefined;
  const execution = review?.execution;
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
              <Button asChild type="button" variant="outline" size="icon" actionTone="neutral" className="size-8 shrink-0">
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("pr.dialog.openWeb")}
                  title={t("pr.dialog.openWeb")}
                  onClick={() => onOpenPullRequest(pullRequest)}
                >
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          {reviewFailed ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>{t("pr.aiReviewError")}</AlertTitle>
              <AlertDescription className="break-words">{review.error || t("pr.dialog.unknownReviewError")}</AlertDescription>
            </Alert>
          ) : null}
          {result && !reviewFailed ? (
            <>
              <section aria-labelledby="ai-summary-title" className="space-y-2 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="ai-summary-title" className="text-sm font-semibold">{t("pr.dialog.aiSummary")}</h3>
                  <AiVerdictBadge verdict={result.verdict} />
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {finishedAt ? <p>{t("pr.dialog.completedAt")} <time dateTime={finishedAt.toISOString()}>{finishedAt.toLocaleString(locale)} · {formatRelativeDate(review?.finishedAt ?? undefined, t)}</time></p> : null}
                  {execution ? (
                    <dl aria-label={t("pr.dialog.aiConfiguration")} className="flex flex-wrap gap-x-4 gap-y-1">
                      <div className="flex gap-1"><dt>{t("settings.ai.provider")}:</dt><dd className="break-words text-foreground">{execution.providerName}</dd></div>
                      <div className="flex gap-1"><dt>{t("settings.ai.model")}:</dt><dd className="break-all font-mono text-foreground">{execution.model}</dd></div>
                      {execution.reasoning != null ? <div className="flex gap-1"><dt>{t("settings.ai.reasoning")}:</dt><dd className="text-foreground">{execution.reasoning}</dd></div> : null}
                      {execution.fastMode != null ? <div className="flex gap-1"><dt>{t("settings.ai.fastMode")}:</dt><dd className="text-foreground">{t(execution.fastMode ? "pr.dialog.enabled" : "pr.dialog.disabled")}</dd></div> : null}
                    </dl>
                  ) : <p>{t("pr.dialog.executionUnavailable")}</p>}
                </div>
                <ReviewMarkdown>{result.description}</ReviewMarkdown>
                <ReviewMarkdown>{result.summary}</ReviewMarkdown>
              </section>
              <section aria-labelledby="ai-comments-title" className="space-y-3">
                <h3 id="ai-comments-title" className="text-sm font-semibold">{t("pr.dialog.aiComments")}</h3>
                <div className="space-y-2">
                  {result.comments.length === 0 ? <p className="text-sm text-muted-foreground">{t("pr.dialog.noComments")}</p> : null}
                  {reviewSeveritySections.map((section) => {
                    const comments = result.comments.filter((comment) => comment.severity === section.key);
                    if (comments.length === 0) return null;
                    return (
                      <details key={section.key} open className={cn("overflow-hidden rounded-lg border", severitySectionStyles[section.key].border)}>
                        <summary className={cn("flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold", severitySectionStyles[section.key].header)}>
                          <span>{t(section.labelKey)} ({comments.length})</span>
                        </summary>
                        <div className={cn("border-t bg-background px-3 py-2 text-foreground", severitySectionStyles[section.key].border)}>
                          <ul className="space-y-2">
                            {comments.map((comment, index) => {
                              const diffUrl = commentDiffUrl(pullRequest?.url, comment);
                              const location = `${comment.file}${comment.line != null ? `:${comment.line}` : ""}`;
                              const published = publishedComments.has(commentKey(comment, index));
                              const publishLabel = published ? t("pr.dialog.published") : pendingAction === commentKey(comment, index) ? t("pr.dialog.publishing") : t("pr.dialog.publish");
                              const locationClass = "min-w-0 rounded-md border bg-muted/50 px-2 py-1 font-mono text-sm font-medium text-primary";
                              return (
                                <li key={`${comment.file}:${comment.line ?? "na"}:${index}`} className="space-y-2 rounded-md border bg-background p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    {diffUrl ? (
                                      <a href={diffUrl} target="_blank" rel="noopener noreferrer" className={cn(locationClass, "hover:bg-accent hover:[&_span]:underline focus-visible:[&_span]:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} title={t("pr.dialog.openCommentLocation", { location })} onClick={() => { if (pullRequest) onOpenPullRequest(pullRequest); }}>
                                        <CommentLocation comment={comment} />
                                      </a>
                                    ) : <p className={locationClass}><CommentLocation comment={comment} /></p>}
                                    {reviewerActions ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        actionTone="neutral"
                                        className="size-8 shrink-0"
                                        disabled={!onPublishComment || pendingAction != null || publishedComments.has(commentKey(comment, index))}
                                        onClick={() => openCommentEditor(comment, index)}
                                        aria-label={t("pr.dialog.publishFor", { file: comment.file })}
                                        title={publishLabel}
                                      >
                                        {pendingAction === commentKey(comment, index) ? <Loader2 aria-hidden="true" className="animate-spin" /> : published ? <CheckCircle2 aria-hidden="true" /> : <Send aria-hidden="true" />}
                                      </Button>
                                    ) : null}
                                  </div>
                                  <ReviewMarkdown>{comment.comment}</ReviewMarkdown>
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
        <DialogFooter className={cn("items-center gap-2", !reviewFailed && "justify-between sm:justify-between")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
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
          {reviewerActions && !reviewFailed ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                actionTone="warning"
                className="text-foreground"
                disabled={!pullRequest || !onSetDecision || pendingAction != null}
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
                disabled={!pullRequest || !onSetDecision || pendingAction != null}
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
