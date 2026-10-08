import type { InboxFilter } from "../../shared/contracts/inbox";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";

interface InboxFiltersProps {
  value: InboxFilter;
  onChange: (filter: InboxFilter) => void;
}

export function InboxFilters({ value, onChange }: InboxFiltersProps) {
  const { t } = useI18n();
  const filters = [
    { value: "all", label: t("inbox.filterAll") },
    { value: "unread", label: t("inbox.filterUnread") },
    { value: "needs_my_action", label: t("inbox.filterAction") },
  ] satisfies Array<{ value: InboxFilter; label: string }>;
  return (
    <div aria-label={t("inbox.filters")} className="filter-group" role="group">
      {filters.map((filter) => (
        <Button
          key={filter.value}
          type="button"
          variant={value === filter.value ? "default" : "outline"}
          aria-pressed={value === filter.value}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
        </Button>
      ))}
    </div>
  );
}
