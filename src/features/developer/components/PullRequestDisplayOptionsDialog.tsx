import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/context";
import { ChevronDown } from "lucide-react";

import type { PullRequestSortOrder } from "./pull-request-projects";

interface PullRequestDisplayOptionsDialogProps {
  open: boolean;
  groupByProject: boolean;
  expandProjectsByDefault: boolean;
  sortOrder: PullRequestSortOrder;
  autoReviewEnabled: boolean;
  autoReviewDisabled: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupByProjectChange: (enabled: boolean) => void;
  onExpandProjectsByDefaultChange: (enabled: boolean) => void;
  onSortOrderChange: (order: PullRequestSortOrder) => void;
  onAutoReviewChange: (enabled: boolean) => void;
}

export function PullRequestDisplayOptionsDialog({
  open,
  groupByProject,
  expandProjectsByDefault,
  sortOrder,
  autoReviewEnabled,
  autoReviewDisabled,
  onOpenChange,
  onGroupByProjectChange,
  onExpandProjectsByDefaultChange,
  onSortOrderChange,
  onAutoReviewChange,
}: PullRequestDisplayOptionsDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pr.displayOptions")}</DialogTitle>
          <DialogDescription>{t("pr.options.description")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <section className="space-y-3" aria-labelledby="pull-request-automation-options">
            <h3 id="pull-request-automation-options" className="text-sm font-semibold">{t("pr.options.automation")}</h3>
            <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="pull-request-auto-review" alignment="inline">{t("pr.aiAutoReview")}</Label>
                <p className="text-sm text-muted-foreground">{t("pr.options.autoReviewDescription")}</p>
              </div>
              <Switch
                id="pull-request-auto-review"
                checked={autoReviewEnabled}
                onCheckedChange={onAutoReviewChange}
                disabled={autoReviewDisabled}
              />
            </div>
          </section>
          <section className="space-y-3" aria-labelledby="pull-request-display-options">
            <h3 id="pull-request-display-options" className="text-sm font-semibold">{t("pr.options.display")}</h3>
            <div className="space-y-2 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="pull-request-sort-order">{t("pr.options.sortOrder")}</Label>
                <p className="text-sm text-muted-foreground">{t("pr.options.sortOrderDescription")}</p>
              </div>
              <div className="relative">
                <select
                  id="pull-request-sort-order"
                  value={sortOrder}
                  onChange={(event) => onSortOrderChange(event.target.value as PullRequestSortOrder)}
                  className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm"
                >
                  <option value="newest">{t("pr.options.newestFirst")}</option>
                  <option value="oldest">{t("pr.options.oldestFirst")}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="group-pull-requests-by-project" alignment="inline">{t("pr.options.groupByProject")}</Label>
                <p className="text-sm text-muted-foreground">{t("pr.options.groupByProjectDescription")}</p>
              </div>
              <Switch
                id="group-pull-requests-by-project"
                checked={groupByProject}
                onCheckedChange={onGroupByProjectChange}
              />
            </div>
            <div className="ml-6 flex items-center justify-between gap-6 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="expand-pull-request-projects-by-default" alignment="inline">{t("pr.options.expandProjects")}</Label>
                <p className="text-sm text-muted-foreground">{t("pr.options.expandProjectsDescription")}</p>
              </div>
              <Switch
                id="expand-pull-request-projects-by-default"
                checked={expandProjectsByDefault}
                onCheckedChange={onExpandProjectsByDefaultChange}
                disabled={!groupByProject}
              />
            </div>
          </section>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>{t("pr.options.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
