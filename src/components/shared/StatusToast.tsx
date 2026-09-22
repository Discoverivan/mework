import { Check, CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface StatusToastProps {
  message?: string | null;
  duration?: number;
  onDismiss?: () => void;
  variant?: "success" | "error";
}

export function StatusToast({ message, duration = 2_400, onDismiss, variant = "success" }: StatusToastProps) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => onDismissRef.current?.(), duration);
    return () => window.clearTimeout(timeoutId);
  }, [duration, message]);

  if (!message) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg",
        variant === "error" && "border-destructive/50",
      )}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      {variant === "error"
        ? <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
        : <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
      <span>{message}</span>
    </div>
  );
}
