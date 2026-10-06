import { useRef, useState } from "react";

/** Keep the popup below its trigger, inset from the containing panel's right edge. */
export function useInfoPopoverAnchor() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [alignOffset, setAlignOffset] = useState(0);
  function onOpenChange(open: boolean) {
    const trigger = triggerRef.current;
    if (!open || !trigger) return;
    const boundary = trigger.closest("[data-info-popover-boundary]");
    setAlignOffset(boundary ? trigger.getBoundingClientRect().right - boundary.getBoundingClientRect().right + 5 : 0);
  }
  return { triggerRef, alignOffset, onOpenChange };
}
