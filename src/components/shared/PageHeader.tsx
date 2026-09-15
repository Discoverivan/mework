import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: ReactNode;
  titleId: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared compact header for every top-level application section.
 * Keep section identity in the page title; do not add an eyebrow/kicker here.
 */
export function PageHeader({
  title,
  titleId,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("page-header", className)}>
      <div className="page-header-copy">
        <h1 id={titleId}>{title}</h1>
        {description ? <p className="page-header-description">{description}</p> : null}
        {meta}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
