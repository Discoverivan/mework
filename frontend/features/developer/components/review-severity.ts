import type { PullRequestReviewSeverity } from "@/shared/contracts/developer";

export const reviewSeverityStyles: Record<PullRequestReviewSeverity, { border: string; header: string }> = {
  blocker: { border: "border-destructive/60", header: "bg-destructive/20 text-destructive" },
  high: { border: "border-destructive/40", header: "bg-destructive/10 text-destructive" },
  medium: { border: "border-warning/40", header: "bg-warning/10 text-warning" },
  low: { border: "border-primary/40", header: "bg-primary/10 text-primary" },
};
export const reviewSeverityTitleClass = "text-sm font-semibold leading-tight tracking-tight";

