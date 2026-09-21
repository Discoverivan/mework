import { useEffect, useState } from "react";
import type { InboxFilter, InboxItem } from "../../shared/contracts/inbox";

import { PageHeader } from "@/components/shared/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { listInbox, updateInboxState } from "./api";
import { InboxFilters } from "./InboxFilters";
import { InboxItemCard } from "./InboxItemCard";
import { useI18n } from "@/i18n/context";

const PAGE_SIZE = 50;

export function InboxPage({ onReady }: { onReady?: () => void }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);

    const normalizedSearch = search.trim();
    listInbox({
      filter,
      ...(normalizedSearch ? { search: normalizedSearch } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((nextItems) => {
        if (active) setItems(nextItems);
      })
      .catch(() => {
        if (active) {
          setItems([]);
          setError(true);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          onReady?.();
        }
      });

    return () => {
      active = false;
    };
  }, [filter, page, retry, search]);

  async function markDone(item: InboxItem) {
    const updated = await updateInboxState(item.id, { done: true });
    setItems((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
  }

  function changeFilter(nextFilter: InboxFilter) {
    setFilter(nextFilter);
    setPage(0);
  }

  function changeSearch(nextSearch: string) {
    setSearch(nextSearch);
    setPage(0);
  }

  const hasNextPage = !loading && !error && items.length === PAGE_SIZE;
  const hasPreviousPage = page > 0 && !loading;

  return (
    <section aria-labelledby="inbox-title">
      <PageHeader
        title={t("inbox.title")}
        titleId="inbox-title"
        actions={<InboxFilters value={filter} onChange={changeFilter} />}
      />

      <div className="inbox-toolbar">
        <Label htmlFor="inbox-search">{t("inbox.search")}</Label>
        <Input
          id="inbox-search"
          type="search"
          value={search}
          placeholder={t("inbox.searchPlaceholder")}
          onChange={(event) => changeSearch(event.currentTarget.value)}
        />
      </div>

      {loading ? (
        <div role="status" aria-label={t("inbox.loading")} className="inbox-loading">
          <span className="sr-only">{t("inbox.loading")}</span>
          <Skeleton data-testid="inbox-loading-skeleton" className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="inbox-error">
          <AlertTitle>{t("inbox.unavailable")}</AlertTitle>
          <AlertDescription>
            <p>{t("inbox.loadError")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("inbox.retryAria")}
              onClick={() => setRetry((current) => current + 1)}
            >
              {t("inbox.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <Card className="inbox-empty">
          <CardContent>
            <p>{t("inbox.empty")}</p>
          </CardContent>
        </Card>
      ) : null}

      <div aria-live="polite" className="inbox-list">
        {!loading && !error
          ? items.map((item) => (
              <InboxItemCard key={item.id} item={item} onMarkDone={() => markDone(item)} />
            ))
          : null}
      </div>

      <nav aria-label={t("inbox.pagination")} className="inbox-pagination">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasPreviousPage}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          {t("inbox.previous")}
        </Button>
        <span aria-live="polite">{t("inbox.page", { page: page + 1 })}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasNextPage}
          onClick={() => setPage((current) => current + 1)}
        >
          {t("inbox.next")}
        </Button>
      </nav>
    </section>
  );
}
