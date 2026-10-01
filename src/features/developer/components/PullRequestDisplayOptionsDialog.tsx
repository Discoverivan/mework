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
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import { useEffect, useState } from "react";
import type { PullRequestGrouping } from "../display-options";

import type { PullRequestSortOrder } from "./pull-request-projects";

interface PullRequestDisplayOptionsDialogProps {
  open: boolean;
  grouping: PullRequestGrouping;
  expandProjectsByDefault: boolean;
  sortOrder: PullRequestSortOrder;
  autoReviewEnabled: boolean;
  autoReviewDisabled: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (values: {
    grouping: PullRequestGrouping;
    expandProjectsByDefault: boolean;
    sortOrder: PullRequestSortOrder;
    autoReviewEnabled: boolean;
  }) => void;
}

export function PullRequestDisplayOptionsDialog({
  open,
  grouping,
  expandProjectsByDefault,
  sortOrder,
  autoReviewEnabled,
  autoReviewDisabled,
  onOpenChange,
  onApply,
}: PullRequestDisplayOptionsDialogProps) {
  const { t } = useI18n();
  const [draftGrouping, setDraftGrouping] = useState(grouping);
  const [draftExpand, setDraftExpand] = useState(expandProjectsByDefault);
  const [draftSort, setDraftSort] = useState(sortOrder);
  const [draftAutoReview, setDraftAutoReview] = useState(autoReviewEnabled);

  useEffect(() => {
    if (!open) return;
    setDraftGrouping(grouping);
    setDraftExpand(expandProjectsByDefault);
    setDraftSort(sortOrder);
    setDraftAutoReview(autoReviewEnabled);
    // Capture persisted values when the dialog opens; edits remain local until Apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function apply() {
    onApply({
      grouping: draftGrouping,
      expandProjectsByDefault: draftExpand,
      sortOrder: draftSort,
      autoReviewEnabled: draftAutoReview,
    });
    onOpenChange(false);
  }
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
                checked={draftAutoReview}
                onCheckedChange={setDraftAutoReview}
                disabled={autoReviewDisabled}
              />
            </div>
          </section>
          <section className="space-y-3" aria-labelledby="pull-request-display-options">
            <h3 id="pull-request-display-options" className="text-sm font-semibold">{t("pr.options.display")}</h3>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
              <div className="min-w-0 flex-1">
                <Label htmlFor="pull-request-sort-order" alignment="inline">{t("pr.options.sortOrder")}</Label>
              </div>
              <div className="w-full sm:w-auto">
                <Select value={draftSort} onValueChange={(value) => setDraftSort(value as PullRequestSortOrder)}>
                  <SelectTrigger id="pull-request-sort-order" aria-label={t("pr.options.sortOrder")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t("pr.options.newestFirst")}</SelectItem>
                    <SelectItem value="oldest">{t("pr.options.oldestFirst")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <Label htmlFor="pull-request-grouping" alignment="inline" className="min-w-0">{t("pr.options.grouping")}</Label>
                <div className="w-full sm:w-auto">
                  <Select value={draftGrouping} onValueChange={(value) => setDraftGrouping(value as PullRequestGrouping)}>
                    <SelectTrigger id="pull-request-grouping" aria-label={t("pr.options.grouping")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("pr.options.groupNone")}</SelectItem>
                      <SelectItem value="project">{t("pr.options.groupProject")}</SelectItem>
                      <SelectItem value="person">{t("pr.options.groupPerson")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {draftGrouping !== "none" ? <><Separator /><div className="flex items-center justify-between gap-6 pl-4">
                <div>
                  <Label htmlFor="expand-pull-request-projects-by-default" alignment="inline">{t("pr.options.expandGroups")}</Label>
                </div>
                <Switch id="expand-pull-request-projects-by-default" checked={draftExpand} onCheckedChange={setDraftExpand} />
              </div></> : null}
            </div>
          </section>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("settings.common.cancel")}</Button>
          <Button type="button" onClick={apply}>{t("pr.options.apply")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
