import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import { useInfoPopoverAnchor } from "./use-info-popover-anchor";

export function InfoPopover({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const { triggerRef, alignOffset, onOpenChange } = useInfoPopoverAnchor();
  return <Popover onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Hint content={label}><button ref={triggerRef} type="button" aria-label={label}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Info className="size-3.5" aria-hidden="true" />
      </button></Hint>
    </PopoverTrigger>
    <PopoverContent align="end" alignOffset={alignOffset} sideOffset={8} aria-label={title} className="w-max max-w-[min(24rem,calc(100vw-2rem))] space-y-2">
      <p className="text-xs font-medium">{title}</p>
      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </PopoverContent>
  </Popover>;
}
