import { Hint } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";
import { formatDisplayDateTime } from "@/lib/display-date";

import { formatRelativeDate } from "./pull-request-formatting";
import type { PullRequestSortOrder } from "./pull-request-projects";

const POLL_INTERVAL_MS = 300_000;

type PullRequestListKind = "review" | "authored";

export function PullRequestStatus({
  kind,
  count,
  activeFilterCount = 0,
  filterMode,
  sortOrder,
  lastSyncAt,
  now = Date.now(),
  polling = false,
}: {
  kind: PullRequestListKind;
  count: number;
  activeFilterCount?: number;
  filterMode?: "allow" | "deny";
  sortOrder: PullRequestSortOrder;
  lastSyncAt?: number;
  now?: number;
  polling?: boolean;
}) {
  const { locale, t } = useI18n();
  const relativeLastSync = lastSyncAt == null ? undefined : formatRelativeDate(lastSyncAt, t);
  const formattedLastSync = lastSyncAt == null ? undefined : formatDisplayDateTime(lastSyncAt, locale);
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
          <Hint content={formattedLastSync}><time dateTime={new Date(lastSyncAt!).toISOString()}>
            {t("pr.status.updated", { last: relativeLastSync })}
          </time></Hint>
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
          <Hint content={t("pr.status.openDetails")}><button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("pr.status.openDetails")}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button></Hint>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={t("pr.status.details")} className="w-max max-w-[calc(100vw-2rem)] space-y-2">
          <p className="text-xs font-medium text-foreground">{t("pr.status.details")}</p>
          <dl className="space-y-1 text-xs [&>div]:[overflow-wrap:anywhere] [&_dt]:inline [&_dt]:text-muted-foreground [&_dd]:inline [&_dd]:text-foreground">
            <div><dt>{t(kind === "review" ? "pr.status.reviewLabel" : "pr.status.authoredLabel")}:</dt>{" "}<dd>{count}</dd></div>
            <div><dt>{t("pr.status.filters")}:</dt>{" "}<dd>
              {filterMode && (filterMode === "allow" || activeFilterCount > 0)
                ? `${t(filterMode === "allow" ? "pr.filters.whitelist" : "pr.filters.blacklist")} · ${activeFilterCount}`
                : activeFilterCount === 0 ? t("pr.status.noFilters") : activeFilterCount}
            </dd></div>
            <div><dt>{t("pr.status.sort")}:</dt>{" "}<dd>
              {t(sortOrder === "newest" ? "pr.options.newestFirst" : "pr.options.oldestFirst")}
            </dd></div>
            <div><dt>{t("pr.status.lastUpdate")}:</dt>{" "}<dd>{formattedLastSync ?? t("pr.status.notYet")}</dd></div>
            <div><dt>{t("pr.status.autoRefresh")}:</dt>{" "}<dd>{t("pr.status.everyFiveMinutes")}</dd></div>
            <div><dt>{t("pr.status.nextUpdate")}:</dt>{" "}<dd>{nextUpdate}</dd></div>
          </dl>
        </PopoverContent>
      </Popover>
    </span>
  );
}
