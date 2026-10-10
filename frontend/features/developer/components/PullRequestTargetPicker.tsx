import { CreateButton } from "@/components/shared/CreateButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/context";
import { controlBorderClasses } from "@/lib/control-border";
import { directPointerHover } from "@/lib/direct-pointer-hover";
import { cn } from "@/lib/utils";

export interface PullRequestTargetOption {
  key: string;
  primary: string;
  secondary?: string;
  accessibleName: string;
}

// Shared by Filters and review instructions: keep the search form identical.
export function PullRequestTargetPicker({ open, onOpenChange, disabled, actionLabel, inputId, fieldLabel, query, onQueryChange, placeholder, searching, searchingLabel, error, resultsLabel, options, onSelect, onEnter }: {
  open: boolean; onOpenChange: (open: boolean) => void; disabled?: boolean;
  actionLabel: string; inputId: string; fieldLabel: string; query: string; onQueryChange: (query: string) => void;
  placeholder: string; searching: boolean; searchingLabel: string; error?: string; resultsLabel: string;
  options: PullRequestTargetOption[]; onSelect: (key: string) => void; onEnter?: () => void;
}) {
  const { t } = useI18n();
  return <Popover modal open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <CreateButton label={t("pr.filters.add")} type="button" variant="outline" className="h-7" aria-label={actionLabel} disabled={disabled} />
    </PopoverTrigger>
    <PopoverContent align="end" aria-label={actionLabel} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
      <Label htmlFor={inputId}>{fieldLabel}</Label>
      <Input id={inputId} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); }
        }} />
      {searching ? <p role="status" className="text-sm text-muted-foreground">{searchingLabel}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {options.length > 0 ? <ul aria-label={resultsLabel} className="flex max-h-[min(18rem,40vh)] flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
        {options.map((option) => <li key={option.key}>
          <button type="button" aria-label={option.accessibleName} className={cn("app-search-result w-full cursor-pointer rounded-md border px-3 py-2 text-left text-sm hover:text-primary focus-visible:text-primary", controlBorderClasses)} {...directPointerHover<HTMLButtonElement>({})} onClick={() => onSelect(option.key)}>
            <span className="block font-medium">{option.primary}</span>
            {option.secondary ? <span className="mt-0.5 block opacity-70">{option.secondary}</span> : null}
          </button>
        </li>)}
      </ul> : null}
    </PopoverContent>
  </Popover>;
}
