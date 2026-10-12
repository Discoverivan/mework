import { ExternalLink, MessageSquare } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInfoPopoverAnchor } from "@/components/shared/use-info-popover-anchor";
import { useI18n } from "@/i18n/context";
import type { MyPullRequest } from "@/shared/contracts/developer";
import { formatRelativeDate, pullRequestCommentUrl } from "./pull-request-formatting";

export function PullRequestDiscussionUpdates({ pullRequest, pending, onRead }: {
  pullRequest: MyPullRequest;
  pending: boolean;
  onRead: (pullRequest: MyPullRequest, commentId?: number) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { triggerRef, alignOffset, onOpenChange } = useInfoPopoverAnchor();
  const changes = pullRequest.discussion?.changes ?? [];
  if (!changes.length) return null;
  return (
    <Popover open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} type="button" variant="outline" size="sm" className="h-6 gap-1.5 px-2 text-xs text-discussion"
          aria-label={t("pr.discussion.show", { title: pullRequest.title, count: changes.length })}>
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {t("pr.discussion.label")}
          <span className="tabular-nums">{changes.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" alignOffset={alignOffset} sideOffset={8} aria-label={t("pr.discussion.title")}
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4">
        <p className="text-sm font-medium">{t("pr.discussion.title")}</p>
        <ul className="max-h-64 space-y-3 overflow-y-auto text-xs">
          {changes.map((change) => {
            const url = pullRequestCommentUrl(pullRequest.url, change.commentId);
            const description = t(`pr.discussion.${change.kind}`);
            return (
              <li key={change.revision} className="space-y-1">
                <p>{description}</p>
                {change.actor ? <p className="break-words text-muted-foreground">{change.actor}</p> : null}
                {change.updatedAt != null ? <p className="text-muted-foreground">{formatRelativeDate(change.updatedAt, t)}</p> : null}
                {url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"
                  aria-label={t("pr.discussion.openComment", { id: change.commentId })}
                  onClick={() => onRead(pullRequest, change.commentId)}>
                  {t("pr.discussion.open")}<ExternalLink className="size-3" aria-hidden="true" />
                </a> : null}
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => onRead(pullRequest)}>
          {t("pr.discussion.markRead")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
