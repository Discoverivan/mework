import { Check } from "lucide-react";
import { useEffect, useRef } from "react";

interface StatusToastProps {
  message?: string | null;
  duration?: number;
  onDismiss?: () => void;
}

export function StatusToast({ message, duration = 2_400, onDismiss }: StatusToastProps) {
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
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
      role="status"
      aria-live="polite"
    >
      <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <span>{message}</span>
    </div>
  );
}
