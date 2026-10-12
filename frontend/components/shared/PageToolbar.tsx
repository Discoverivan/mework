import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/** Primary page filters and actions share a size, independent of subform controls. */
export function PageToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-slot="page-toolbar" data-action-size="normal" data-control-size="normal" className={cn("flex flex-wrap items-center gap-2", className)} />;
}
