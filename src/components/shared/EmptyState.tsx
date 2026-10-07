import type { ReactNode } from "react";

interface EmptyStateProps {
  titleId: string;
  title: string;
  description: string;
  hint?: string;
  icon: ReactNode;
}

export function EmptyState({ titleId, title, description, hint, icon }: EmptyStateProps) {
  return (
    <div role="status" aria-labelledby={titleId} className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 id={titleId} className="text-sm font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
        {icon}
      </div>
    </div>
  );
}
