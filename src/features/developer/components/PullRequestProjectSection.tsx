import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/context";

interface PullRequestProjectSectionProps {
  label: string;
  grouping: "project" | "person";
  pullRequestCount: number;
  expandedByDefault: boolean;
  children: ReactNode;
}

export function PullRequestProjectSection({
  label,
  grouping,
  pullRequestCount,
  expandedByDefault,
  children,
}: PullRequestProjectSectionProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(!expandedByDefault);
  const previousExpandedByDefault = useRef(expandedByDefault);
  const contentId = useId();
  useEffect(() => {
    if (previousExpandedByDefault.current === expandedByDefault) return;
    previousExpandedByDefault.current = expandedByDefault;
    setCollapsed(!expandedByDefault);
  }, [expandedByDefault]);
  const pullRequestLabel = t(
    pullRequestCount === 1 ? "prGroup.countOne" : "prGroup.countMany",
    { count: pullRequestCount },
  );

  return (
    <section aria-label={grouping === "project" ? t("prGroup.project", { project: label }) : t("prGroup.person", { person: label })} className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center gap-3 border-b pb-2 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        aria-label={grouping === "project" ? t(collapsed ? "prGroup.expand" : "prGroup.collapse", { project: label }) : t(collapsed ? "prGroup.expandPerson" : "prGroup.collapsePerson", { person: label })}
        onClick={() => setCollapsed((current) => !current)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", collapsed && "-rotate-90")}
        />
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          {pullRequestLabel}
        </span>
      </button>
      <div id={contentId} className="inbox-list" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
