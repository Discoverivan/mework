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
    <div role="status" aria-labelledby={titleId} className="grid place-items-center rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
          {icon}
        </div>
        <h2 id={titleId} className="text-[17px] font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
