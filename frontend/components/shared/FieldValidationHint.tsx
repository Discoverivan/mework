import { CircleAlert } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { useEffect, useState, type ReactElement } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function FieldValidationHint({ error, warning, children }: { error?: string; warning?: string; children: ReactElement }) {
  const message = error || warning;
  const [open, setOpen] = useState(Boolean(message));
  useEffect(() => setOpen(Boolean(message)), [message]);
  useEffect(() => {
    if (!open || !message) return;
    const timer = window.setTimeout(() => setOpen(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [message, open]);

  return <Popover open={Boolean(message) && open} onOpenChange={setOpen}>
    <PopoverAnchor asChild>
      <Slot aria-invalid={Boolean(error)} aria-description={message}
        data-field-warning={!error && warning ? "true" : undefined}
        onFocus={() => setOpen(Boolean(message))}
        onPointerEnter={() => setOpen(Boolean(message))}
        onPointerDown={() => setOpen(false)}
      >{children}</Slot>
    </PopoverAnchor>
    <PopoverContent role={error ? "alert" : "status"} side="bottom" align="start" sideOffset={6} collisionPadding={8}
      className={cn("flex gap-2 px-4 py-3 text-sm", error ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning")}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </PopoverContent>
  </Popover>;
}
