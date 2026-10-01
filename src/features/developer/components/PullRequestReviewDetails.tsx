import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { PullRequestReviewState } from "@/shared/contracts/developer";

import { formatRelativeDate } from "./pull-request-formatting";

export function PullRequestReviewDetails({ review, inBadge = false }: { review: PullRequestReviewState; inBadge?: boolean }) {
  const { t } = useI18n();
  const finishedAt = review.finishedAt != null ? new Date(review.finishedAt) : undefined;
  const execution = review.execution;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex h-5 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", inBadge ? "w-3.5" : "w-5")} aria-label={t("pr.dialog.showReviewDetails")} title={t("pr.dialog.showReviewDetails")}>
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t("pr.dialog.reviewDetails")} className="w-80 space-y-2">
        <p className="text-xs font-medium text-foreground">{t("pr.dialog.reviewDetails")}</p>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          {finishedAt ? <p>{t(review.status === "failed" ? "pr.dialog.endedAt" : "pr.dialog.completedAt")} <time className="text-foreground" dateTime={finishedAt.toISOString()}>{finishedAt.toLocaleString("ru-RU", { hour12: false })} · {formatRelativeDate(review.finishedAt ?? undefined, t)}</time></p> : null}
          {execution ? (
            <dl aria-label={t("pr.dialog.aiConfiguration")} className="grid gap-1">
              <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="inline whitespace-nowrap">{t("settings.ai.provider")}:</dt>{" "}<dd className="inline text-foreground">{execution.providerName}</dd></div>
              <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="inline whitespace-nowrap">{t("settings.ai.model")}:</dt>{" "}<dd className="inline text-foreground">{execution.model}</dd></div>
              {execution.reasoning != null ? <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="inline whitespace-nowrap">{t("settings.ai.reasoning")}:</dt>{" "}<dd className="inline text-foreground">{execution.reasoning}</dd></div> : null}
              {execution.fastMode != null ? <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="inline whitespace-nowrap">{t("settings.ai.fastMode")}:</dt>{" "}<dd className="inline text-foreground">{t(execution.fastMode ? "pr.dialog.enabled" : "pr.dialog.disabled")}</dd></div> : null}
            </dl>
          ) : <p>{t("pr.dialog.executionUnavailable")}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
