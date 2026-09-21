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

interface PullRequestDisplayOptionsDialogProps {
  open: boolean;
  groupByProject: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupByProjectChange: (enabled: boolean) => void;
}

export function PullRequestDisplayOptionsDialog({
  open,
  groupByProject,
  onOpenChange,
  onGroupByProjectChange,
}: PullRequestDisplayOptionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Display options</DialogTitle>
          <DialogDescription>Choose how pull requests are arranged on this page.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="group-pull-requests-by-project">Group by project</Label>
              <p className="text-sm text-muted-foreground">Show a separate section for each Bitbucket project.</p>
            </div>
            <Switch
              id="group-pull-requests-by-project"
              checked={groupByProject}
              onCheckedChange={onGroupByProjectChange}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
