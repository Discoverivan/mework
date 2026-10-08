import { CircleAlert } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { useEffect, useState, type ReactElement } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export function FieldValidationHint({ error, children }: { error?: string; children: ReactElement }) {
  const [open, setOpen] = useState(Boolean(error));
  useEffect(() => setOpen(Boolean(error)), [error]);

  return <Popover open={Boolean(error) && open} onOpenChange={setOpen}>
    <PopoverAnchor asChild>
      <Slot aria-invalid={Boolean(error)} aria-description={error}
        className={error ? "border-destructive ring-1 ring-destructive focus-visible:ring-destructive aria-invalid:data-[pointer-hover=true]:data-[state=closed]:enabled:border-destructive" : undefined}
        onFocus={() => setOpen(Boolean(error))}
        onMouseEnter={() => setOpen(Boolean(error))}
        onPointerDown={() => setOpen(false)}
      >{children}</Slot>
    </PopoverAnchor>
    <PopoverContent role="alert" side="bottom" align="start" sideOffset={6} collisionPadding={8}
      className="flex gap-2 border-destructive/50 px-4 py-3 text-sm text-destructive"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{error}</span>
    </PopoverContent>
  </Popover>;
}
