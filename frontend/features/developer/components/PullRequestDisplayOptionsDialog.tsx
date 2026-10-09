import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
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

  const hasChanges = draftGrouping !== grouping
    || draftExpand !== expandProjectsByDefault
    || draftSort !== sortOrder
    || draftAutoReview !== autoReviewEnabled;

  function apply() {
    if (!hasChanges) return;
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
      {/* Pixel-aligned centering keeps 1 px separators crisp in the native WebView. */}
      <DialogContent className="max-w-2xl top-[round(nearest,50%,1px)] -translate-y-[round(nearest,50%,1px)]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("pr.displayOptions")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="m-0 space-y-3 p-1 pb-0">
          <Card role="region" className="overflow-hidden shadow-none" aria-labelledby="pull-request-automation-options">
            <CardHeader variant="section" className="py-3">
              <CardTitle id="pull-request-automation-options" className="text-base font-semibold leading-tight">{t("pr.options.automation")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex min-h-9 items-center justify-between gap-3 pt-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="pull-request-auto-review" alignment="inline" className="text-sm font-medium leading-tight">{t("pr.aiAutoReview")}</Label>
                  <p className="text-xs leading-snug text-muted-foreground">{t("pr.options.autoReviewDescription")}</p>
                </div>
                <Switch
                  id="pull-request-auto-review"
                  size="sm"
                  checked={draftAutoReview}
                  onCheckedChange={setDraftAutoReview}
                  disabled={autoReviewDisabled}
                />
              </div>
            </CardContent>
          </Card>
          <Card role="region" className="overflow-hidden shadow-none" aria-labelledby="pull-request-display-options">
            <CardHeader variant="section" className="py-3">
              <CardTitle id="pull-request-display-options" className="text-base font-semibold leading-tight">{t("pr.options.display")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 py-3">
                <Label htmlFor="pull-request-sort-order" alignment="inline" className="min-w-0 flex-1 text-sm font-medium leading-tight">{t("pr.options.sortOrder")}</Label>
                <Select value={draftSort} onValueChange={(value) => setDraftSort(value as PullRequestSortOrder)}>
                  <SelectTrigger id="pull-request-sort-order" aria-label={t("pr.options.sortOrder")} className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t("pr.options.newestFirst")}</SelectItem>
                    <SelectItem value="oldest">{t("pr.options.oldestFirst")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div role="group" aria-labelledby="pull-request-grouping-label">
                <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 py-3 last:pb-0">
                  <Label id="pull-request-grouping-label" htmlFor="pull-request-grouping" alignment="inline" className="min-w-0 flex-1 text-sm font-medium leading-tight">{t("pr.options.grouping")}</Label>
                  <Select value={draftGrouping} onValueChange={(value) => setDraftGrouping(value as PullRequestGrouping)}>
                    <SelectTrigger id="pull-request-grouping" aria-label={t("pr.options.grouping")} className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("pr.options.groupNone")}</SelectItem>
                      <SelectItem value="project">{t("pr.options.groupProject")}</SelectItem>
                      <SelectItem value="person">{t("pr.options.groupPerson")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draftGrouping !== "none" ? (
                  <>
                    <Separator />
                    <div className="flex min-h-9 items-center justify-between gap-3 pl-4 pt-3">
                      <Label htmlFor="expand-pull-request-projects-by-default" alignment="inline" className="min-w-0 flex-1 text-sm font-medium leading-tight">{t("pr.options.expandGroups")}</Label>
                      <Switch id="expand-pull-request-projects-by-default" size="sm" checked={draftExpand} onCheckedChange={setDraftExpand} />
                    </div>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </DialogBody>
        <DialogFooter className="px-1">
          <Button data-dialog-cancel type="button" variant="outline" actionTone="neutral" onClick={() => onOpenChange(false)}>{t("settings.common.cancel")}</Button>
          <Button type="button" variant="outline" actionTone="edit" onClick={apply} disabled={!hasChanges}>{t("settings.common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
