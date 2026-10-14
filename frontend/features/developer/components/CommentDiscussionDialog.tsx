import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleHelp, FileText, Loader2, Send, XCircle } from "lucide-react";
import { InfoPopover } from "@/components/shared/InfoPopover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { PullRequestReviewComment, ReviewCommentDecision, ReviewCommentDiscussion } from "@/shared/contracts/developer";
import { ReviewCommentLocation } from "./ReviewCommentLocation";

interface Props {
  comment: PullRequestReviewComment;
  pullRequestUrl?: string;
  onOpenLocation?: () => void;
  discussion?: ReviewCommentDiscussion;
  commit?: string | null;
  pending: boolean;
  error?: string;
  published: boolean;
  onClose: () => void;
  onAction: (action: "send" | ReviewCommentDecision, text: string) => Promise<boolean | undefined>;
}

function DiscussionBlock({ title, status, children }: { title: string; status?: string; children: ReactNode }) {
  return <Card role="group" aria-label={title} className="border bg-background">
    <CardHeader variant="section" className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-2">
      <CardTitle className="text-sm font-semibold leading-tight tracking-normal">{title}</CardTitle>
      {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
    </CardHeader>
    <CardContent className="space-y-2 px-4 py-3">{children}</CardContent>
  </Card>;
}

export function CommentDiscussionDialog({ comment, pullRequestUrl, onOpenLocation, discussion, commit, pending, error, published, onClose, onAction }: Props) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [dismissalOpen, setDismissalOpen] = useState(false);
  const [dismissalAttempted, setDismissalAttempted] = useState(false);
  const last = discussion?.turns[discussion.turns.length - 1]?.assessment;
  const decision = discussion?.decision ?? "undecided";
  async function send() {
    const submitted = message;
    if (await onAction("send", submitted)) setMessage(current => current === submitted ? "" : current);
  }
  function openDismissal() {
    setReason("");
    setDismissalAttempted(false);
    setDismissalOpen(true);
  }
  async function dismiss() {
    if (pending || !reason.trim()) return;
    setDismissalAttempted(true);
    if (await onAction("dismissed", reason.trim())) setDismissalOpen(false);
  }
  return <><Dialog open onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
          <DialogTitle>{t("pr.discuss.title")}</DialogTitle>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" aria-label={t("pr.discuss.severity", { severity: t(`pr.severity.${comment.severity}`) })} className={cn("h-7 gap-1.5 px-2.5 py-0", comment.severity === "blocker" || comment.severity === "high" ? "text-destructive" : comment.severity === "medium" ? "text-warning" : "text-primary")}>
            <CircleAlert className="size-3.5" aria-hidden="true" />{t(`pr.severity.${comment.severity}`)}
          </Badge>
          {!published ? <Badge role="status" variant="outline" className={cn("h-7 gap-1.5 px-2.5 py-0", decision === "revised" ? "text-success" : decision === "dismissed" ? "text-destructive" : "text-muted-foreground")}>
            {decision === "revised" ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : decision === "dismissed" ? <XCircle className="size-3.5" aria-hidden="true" /> : decision === "original" ? <FileText className="size-3.5" aria-hidden="true" /> : <CircleHelp className="size-3.5" aria-hidden="true" />}
            {t(`pr.discuss.decision.${decision}`)}
          </Badge> : null}
          </div>
        </div>
        <DialogDescription>{t("pr.discuss.description")}</DialogDescription>
      </DialogHeader>
      <DialogBody layout="sections">
        <Card className="border bg-card">
          <CardHeader variant="section" className="flex-row items-center gap-2 space-y-0 px-4 py-2">
            <CardTitle className="text-sm font-semibold leading-tight">{t("pr.discuss.finding")}</CardTitle>
            {commit ? <InfoPopover label={t("pr.discuss.showFindingDetails")} title={t("pr.discuss.findingDetails")}>
              <p className="break-all">{t("pr.discuss.commit", { commit })}</p>
            </InfoPopover> : null}
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <Card className="border bg-background">
              <ReviewCommentLocation comment={comment} pullRequestUrl={pullRequestUrl} onOpen={onOpenLocation} />
              <CardContent className="space-y-2 px-4 py-3">
                <MarkdownContent>{comment.comment}</MarkdownContent>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
        <div className={cn("space-y-4", !discussion?.turns.length && "hidden")} aria-live="polite">
          {discussion?.turns.map((turn, index) => <Card key={index} role="group" aria-label={t("pr.discuss.round", { number: index + 1 })} className="border bg-card">
            <CardHeader variant="section" className="py-2">
              <CardTitle className="text-sm font-semibold leading-tight">{t("pr.discuss.round", { number: index + 1 })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
            <DiscussionBlock title={t("pr.discuss.yourMessage")}>
              <p className="whitespace-pre-wrap break-words text-sm">{turn.message}</p>
            </DiscussionBlock>
            <DiscussionBlock title={t("pr.discuss.aiResponse")} status={turn.assessment ? t(`pr.discuss.verdict.${turn.assessment.verdict}`) : undefined}>
              {turn.assessment ? <MarkdownContent>{turn.assessment.explanation}</MarkdownContent>
                : <p className="text-sm text-muted-foreground">{t(pending ? "pr.discuss.thinking" : "pr.discuss.unanswered")}</p>}
            </DiscussionBlock>
            {turn.assessment?.comment ? <DiscussionBlock title={t("pr.discuss.proposed")}>
              <MarkdownContent>{turn.assessment.comment}</MarkdownContent>
            </DiscussionBlock> : null}
            </CardContent>
          </Card>)}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="comment-discussion-message">{t("pr.discuss.message")}</Label>
          <div className="flex items-end gap-2">
            <Textarea id="comment-discussion-message" rows={1} className="block min-h-9 min-w-0 flex-1 resize-y text-sm" maxLength={8000} value={message} onChange={event => setMessage(event.target.value)} placeholder={t("pr.discuss.placeholder")} />
            <Button size="sm" className="shrink-0" actionTone="neutral" disabled={pending || !message.trim() || (discussion?.turns.length ?? 0) >= 30} onClick={() => void send()}>{pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}{t(pending ? "pr.discuss.thinking" : "pr.discuss.send")}</Button>
          </div>
        </div>
        {!published && discussion?.decision === "dismissed" ? <div className="space-y-2 rounded-md border px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium">{t("pr.discuss.reason")}</p>
          <p className="whitespace-pre-wrap break-words">{discussion.reason}</p>
        </div> : null}
        {error !== undefined ? <p role="alert" className="rounded-md border px-4 py-3 text-sm text-destructive">{error || t("pr.discuss.error")}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button data-dialog-cancel size="sm" actionTone="neutral" onClick={onClose}>{t("pr.discuss.close")}</Button>
        {!published ? <>
          <Button size="sm" actionTone="delete" disabled={pending} onClick={openDismissal}>{t("pr.discuss.dismiss")}</Button>
          <Button size="sm" actionTone="neutral" disabled={pending} onClick={() => void onAction("original", "")}>{t("pr.discuss.keep")}</Button>
          <Button size="sm" actionTone="success" disabled={pending || !last?.comment} onClick={() => void onAction("revised", "")}>{t("pr.discuss.apply")}</Button>
        </> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog open={dismissalOpen} onOpenChange={value => { if (!pending) setDismissalOpen(value); }}>
    <DialogContent className="max-w-xl" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onInteractOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{t("pr.discuss.dismiss")}</DialogTitle>
        <DialogDescription>{t("pr.discuss.dismissDescription")}</DialogDescription>
      </DialogHeader>
      <DialogBody layout="sections">
        <div className="space-y-2">
          <Label htmlFor="comment-discussion-reason">{t("pr.discuss.reason")}</Label>
          <Textarea id="comment-discussion-reason" className="min-h-32 px-3!" maxLength={8000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} placeholder={t("pr.discuss.reasonPlaceholder")} />
        </div>
        {dismissalAttempted && error !== undefined ? <p role="alert" className="rounded-md border px-4 py-3 text-sm text-destructive">{error || t("pr.discuss.error")}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button data-dialog-cancel size="sm" actionTone="neutral" disabled={pending} onClick={() => setDismissalOpen(false)}>{t("settings.common.cancel")}</Button>
        <Button size="sm" actionTone="delete" disabled={pending || !reason.trim()} onClick={() => void dismiss()}>{pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}{t("pr.discuss.dismiss")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog></>;
}
