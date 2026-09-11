import { useEffect, useState } from "react";
import type { InboxFilter, InboxItem } from "../../shared/contracts/inbox";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { listInbox, updateInboxState } from "./api";
import { InboxFilters } from "./InboxFilters";
import { InboxItemCard } from "./InboxItemCard";

const PAGE_SIZE = 50;

export function InboxPage({ onReady }: { onReady?: () => void }) {
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Work queue</p>
          <h1 id="inbox-title">Inbox</h1>
        </div>
        <InboxFilters value={filter} onChange={changeFilter} />
      </header>

      <div className="inbox-toolbar">
        <Label htmlFor="inbox-search">Search inbox</Label>
        <Input
          id="inbox-search"
          type="search"
          value={search}
          placeholder="Search title, reason, or issue"
          onChange={(event) => changeSearch(event.currentTarget.value)}
        />
      </div>

      {loading ? (
        <div role="status" aria-label="Loading inbox" className="inbox-loading">
          <span className="sr-only">Loading inbox</span>
          <Skeleton data-testid="inbox-loading-skeleton" className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="inbox-error">
          <AlertTitle>Inbox unavailable</AlertTitle>
          <AlertDescription>
            <p>Unable to load inbox. Try again.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Retry loading inbox"
              onClick={() => setRetry((current) => current + 1)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <Card className="inbox-empty">
          <CardContent>
            <p>No inbox items.</p>
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

      <nav aria-label="Inbox pagination" className="inbox-pagination">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasPreviousPage}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          Previous page
        </Button>
        <span aria-live="polite">Page {page + 1}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasNextPage}
          onClick={() => setPage((current) => current + 1)}
        >
          Next page
        </Button>
      </nav>
    </section>
  );
}
