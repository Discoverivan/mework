import type { InboxFilter } from "../../shared/contracts/inbox";

import { Button } from "@/components/ui/button";

interface InboxFiltersProps {
  value: InboxFilter;
  onChange: (filter: InboxFilter) => void;
}

const filters: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "needs_my_action", label: "Needs my action" },
];

export function InboxFilters({ value, onChange }: InboxFiltersProps) {
  return (
    <div aria-label="Inbox filters" className="filter-group" role="group">
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
