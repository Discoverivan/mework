import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";
import type { PullRequestReviewState } from "@/shared/contracts/developer";

import { formatRelativeDate } from "./pull-request-formatting";

export function PullRequestReviewDetails({ review }: { review: PullRequestReviewState }) {
  const { t } = useI18n();
  const finishedAt = review.finishedAt != null ? new Date(review.finishedAt) : undefined;
  const execution = review.execution;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("pr.dialog.showReviewDetails")} title={t("pr.dialog.showReviewDetails")}>
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t("pr.dialog.reviewDetails")} className="w-80 space-y-3">
        <p className="font-medium text-foreground">{t("pr.dialog.reviewDetails")}</p>
        <div className="space-y-2 text-sm text-muted-foreground">
          {finishedAt ? <p>{t(review.status === "failed" ? "pr.dialog.endedAt" : "pr.dialog.completedAt")} <time dateTime={finishedAt.toISOString()}>{finishedAt.toLocaleString("ru-RU", { hour12: false })} · {formatRelativeDate(review.finishedAt ?? undefined, t)}</time></p> : null}
          {execution ? (
            <dl aria-label={t("pr.dialog.aiConfiguration")} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
              <dt>{t("settings.ai.provider")}</dt><dd className="break-words text-foreground">{execution.providerName}</dd>
              <dt>{t("settings.ai.model")}</dt><dd className="break-all font-mono text-foreground">{execution.model}</dd>
              {execution.reasoning != null ? <><dt>{t("settings.ai.reasoning")}</dt><dd className="text-foreground">{execution.reasoning}</dd></> : null}
              {execution.fastMode != null ? <><dt>{t("settings.ai.fastMode")}</dt><dd className="text-foreground">{t(execution.fastMode ? "pr.dialog.enabled" : "pr.dialog.disabled")}</dd></> : null}
            </dl>
          ) : <p>{t("pr.dialog.executionUnavailable")}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
