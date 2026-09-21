import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";

import { formatRelativeDate } from "./PullRequestListItem";
import type { PullRequestSortOrder } from "./pull-request-projects";

const POLL_INTERVAL_MS = 300_000;

type PullRequestListKind = "review" | "authored";

function formatSyncTimestamp(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function PullRequestStatus({
  kind,
  count,
  activeFilterCount = 0,
  sortOrder,
  lastSyncAt,
  now = Date.now(),
  polling = false,
}: {
  kind: PullRequestListKind;
  count: number;
  activeFilterCount?: number;
  sortOrder: PullRequestSortOrder;
  lastSyncAt?: number;
  now?: number;
  polling?: boolean;
}) {
  const { locale, t } = useI18n();
  const relativeLastSync = lastSyncAt == null ? undefined : formatRelativeDate(lastSyncAt, t);
  const formattedLastSync = lastSyncAt == null ? undefined : formatSyncTimestamp(lastSyncAt, locale);
  const remaining = lastSyncAt == null ? undefined : Math.max(0, lastSyncAt + POLL_INTERVAL_MS - now);
  const nextUpdate = remaining == null
    ? t("pr.sync.first")
    : remaining === 0
      ? t("pr.sync.now")
      : t("pr.sync.inMinutes", { count: Math.ceil(remaining / 60_000) });
  const pluralCategory = new Intl.PluralRules(locale).select(count);
  const pluralForm = pluralCategory === "one" ? "one" : pluralCategory === "few" ? "few" : "many";
  const countLabel = kind === "review"
    ? pluralForm === "one"
      ? t("pr.status.reviewCountOne", { count })
      : pluralForm === "few"
        ? t("pr.status.reviewCountFew", { count })
        : t("pr.status.reviewCountMany", { count })
    : pluralForm === "one"
      ? t("pr.status.authoredCountOne", { count })
      : pluralForm === "few"
        ? t("pr.status.authoredCountFew", { count })
        : t("pr.status.authoredCountMany", { count });

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span>{countLabel}</span>
      {relativeLastSync ? (
        <>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(lastSyncAt!).toISOString()} title={formattedLastSync}>
            {t("pr.status.updated", { last: relativeLastSync })}
          </time>
        </>
      ) : null}
      {polling ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{t("pr.checkingUpdates")}</span>
        </>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("pr.status.openDetails")}
            title={t("pr.status.openDetails")}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <p className="font-medium text-foreground">{t("pr.status.details")}</p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 text-sm">
            <dt className="text-muted-foreground">
              {t(kind === "review" ? "pr.status.reviewLabel" : "pr.status.authoredLabel")}
            </dt>
            <dd className="text-right font-medium">{count}</dd>
            <dt className="text-muted-foreground">{t("pr.status.filters")}</dt>
            <dd className="text-right font-medium">
              {activeFilterCount === 0 ? t("pr.status.noFilters") : activeFilterCount}
            </dd>
            <dt className="text-muted-foreground">{t("pr.status.sort")}</dt>
            <dd className="text-right font-medium">
              {t(sortOrder === "newest" ? "pr.options.newestFirst" : "pr.options.oldestFirst")}
            </dd>
            <dt className="text-muted-foreground">{t("pr.status.lastUpdate")}</dt>
            <dd className="text-right font-medium">{formattedLastSync ?? t("pr.status.notYet")}</dd>
            <dt className="text-muted-foreground">{t("pr.status.autoRefresh")}</dt>
            <dd className="text-right font-medium">{t("pr.status.everyFiveMinutes")}</dd>
            <dt className="text-muted-foreground">{t("pr.status.nextUpdate")}</dt>
            <dd className="text-right font-medium">{nextUpdate}</dd>
          </dl>
        </PopoverContent>
      </Popover>
    </span>
  );
}
