import { FlaskConical, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import {
  addDevMockPullRequest,
  addDevMockSubtask,
  addDevMockTask,
  getDevOverlayState,
  resetDevMockScenario,
  setDevMockTaskStatus,
  type DevOverlaySnapshot,
} from "./api";

const TASK_STATUSES = ["To Do", "In Progress", "Done"] as const;

export function DevOverlay() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<DevOverlaySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [subtaskDialogOpen, setSubtaskDialogOpen] = useState(false);
  const [section, setSection] = useState<"tasks" | "pullRequests">("tasks");
  const [summary, setSummary] = useState("");
  const [subtaskSummary, setSubtaskSummary] = useState("");
  const [parentIssueKey, setParentIssueKey] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [selectedTaskKey, setSelectedTaskKey] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<(typeof TASK_STATUSES)[number]>("In Progress");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setSnapshot(await getDevOverlayState());
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  const tasks = snapshot?.monitors[0]?.issues ?? [];
  const parentIssues = snapshot?.parentIssues ?? [];
  const assignees = snapshot?.assignees ?? [];
  const sprints = snapshot?.sprints ?? [];
  useEffect(() => {
    if (!tasks.some((task) => task.key === selectedTaskKey)) {
      setSelectedTaskKey(tasks[0]?.key ?? "");
      setSelectedStatus((tasks[0]?.status as (typeof TASK_STATUSES)[number]) ?? "In Progress");
    }
  }, [selectedTaskKey, tasks]);

  useEffect(() => {
    if (!parentIssues.some((issue) => issue.key === parentIssueKey)) {
      setParentIssueKey(parentIssues[0]?.key ?? "");
    }
    if (!assignees.some((assignee) => assignee.id === assigneeId)) {
      setAssigneeId(assignees[0]?.id ?? "");
    }
    if (!sprints.some((sprint) => sprint.id === sprintId)) {
      setSprintId(sprints.find((sprint) => sprint.state === "active")?.id ?? sprints[0]?.id ?? "");
    }
  }, [assignees, assigneeId, parentIssueKey, parentIssues, sprintId, sprints]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = summary.trim();
    if (!value) return;
    void run(async () => {
      await addDevMockTask(value);
      setSummary("");
    });
  }

  function submitSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = subtaskSummary.trim();
    if (!value || !parentIssueKey || !assigneeId || !sprintId) return;
    void run(async () => {
      await addDevMockSubtask({
        parentIssueKey,
        summary: value,
        assigneeId,
        sprintId,
      });
      setSubtaskSummary("");
      setSubtaskDialogOpen(false);
    });
  }

  return (
    <aside aria-label={t("devOverlay.title")} className="fixed bottom-3 right-3 z-50">
      {open ? (
        <Card className="flex max-h-[calc(100dvh-1.5rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden border-primary/50 bg-card shadow-2xl opacity-100">
          <CardHeader className="flex-row items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <CardTitle className="text-sm">{t("devOverlay.title")}</CardTitle>
                <Badge variant="destructive">{t("devOverlay.badge")}</Badge>
              </div>
              <CardDescription className="mt-1 line-clamp-2 text-xs">{t("devOverlay.description")}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("devOverlay.reset")}
                title={t("devOverlay.reset")}
                onClick={() => void run(resetDevMockScenario)}
                disabled={busy}
              >
                <RotateCcw aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={open}
                aria-controls="dev-mock-controls"
                onClick={() => setOpen(false)}
              >
                {t("devOverlay.hide")}
              </Button>
            </div>
          </CardHeader>
          <CardContent id="dev-mock-controls" className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4">
            <ToggleGroup
              type="single"
              value={section}
              onValueChange={(value) => {
                if (value === "tasks" || value === "pullRequests") setSection(value);
              }}
              aria-label={t("devOverlay.sections")}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="tasks" className="flex-1">{t("devOverlay.tasksTab")}</ToggleGroupItem>
              <ToggleGroupItem value="pullRequests" className="flex-1">{t("devOverlay.pullRequestsTab")}</ToggleGroupItem>
            </ToggleGroup>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {section === "tasks" ? (
              <div className="flex flex-col gap-3">
                <form autoComplete="off" onSubmit={submitTask} className="flex flex-col gap-2">
                  <Label htmlFor="dev-mock-task-summary">{t("devOverlay.taskSummary")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="dev-mock-task-summary"
                      value={summary}
                      maxLength={160}
                      onChange={(event) => setSummary(event.target.value)}
                      placeholder={t("devOverlay.taskPlaceholder")}
                      disabled={busy}
                    />
                    <Button type="submit" disabled={busy || !summary.trim()}>{t("devOverlay.addTask")}</Button>
                  </div>
                </form>
                <Button type="button" variant="outline" onClick={() => setSubtaskDialogOpen(true)} disabled={busy}>
                  {t("devOverlay.createSubtask")}
                </Button>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dev-mock-task">{t("devOverlay.selectTask")}</Label>
                  <select autoComplete="off"
                    id="dev-mock-task"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={selectedTaskKey}
                    onChange={(event) => {
                      const key = event.target.value;
                      setSelectedTaskKey(key);
                      const task = tasks.find((item) => item.key === key);
                      if (task && TASK_STATUSES.includes(task.status as (typeof TASK_STATUSES)[number])) {
                        setSelectedStatus(task.status as (typeof TASK_STATUSES)[number]);
                      }
                    }}
                    disabled={busy || tasks.length === 0}
                  >
                    {tasks.map((task) => <option key={task.key} value={task.key}>{task.key} · {task.summary}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <select autoComplete="off"
                      aria-label={t("devOverlay.taskStatus")}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                      value={selectedStatus}
                      onChange={(event) => setSelectedStatus(event.target.value as (typeof TASK_STATUSES)[number])}
                      disabled={busy || !selectedTaskKey}
                    >
                      {TASK_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void run(() => setDevMockTaskStatus(selectedTaskKey, selectedStatus))}
                      disabled={busy || !selectedTaskKey}
                    >
                      {t("devOverlay.setStatus")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => void run(() => addDevMockPullRequest(false))} disabled={busy}>
                  {t("devOverlay.addReviewerPr")}
                </Button>
                <Button type="button" variant="outline" onClick={() => void run(() => addDevMockPullRequest(true))} disabled={busy}>
                  {t("devOverlay.addAuthoredPr")}
                </Button>
              </div>
            )}
          </CardContent>
          <Dialog open={subtaskDialogOpen} onOpenChange={setSubtaskDialogOpen}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("devOverlay.subtaskTitle")}</DialogTitle>
                <DialogDescription>{t("devOverlay.subtaskDialogDescription")}</DialogDescription>
              </DialogHeader>
              <form autoComplete="off" onSubmit={submitSubtask} className="space-y-4">
                <DialogBody className="max-h-[55vh] space-y-3 pr-2">
                  <FieldGroup className="gap-3">
                    <Field>
                      <FieldLabel htmlFor="dev-mock-subtask-parent">{t("devOverlay.parentIssue")}</FieldLabel>
                      <Select value={parentIssueKey} onValueChange={setParentIssueKey} disabled={busy || parentIssues.length === 0}>
                        <SelectTrigger id="dev-mock-subtask-parent" className="w-full" aria-label={t("devOverlay.parentIssue")}>
                          <SelectValue placeholder={t("devOverlay.selectParentIssue")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {parentIssues.map((issue) => (
                              <SelectItem key={issue.key} value={issue.key}>{issue.key} · {issue.summary}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="dev-mock-subtask-summary">{t("devOverlay.subtaskSummary")}</FieldLabel>
                      <Input
                        id="dev-mock-subtask-summary"
                        value={subtaskSummary}
                        maxLength={255}
                        onChange={(event) => setSubtaskSummary(event.target.value)}
                        placeholder={t("devOverlay.subtaskPlaceholder")}
                        disabled={busy}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="dev-mock-subtask-assignee">{t("devOverlay.subtaskAssignee")}</FieldLabel>
                      <Select value={assigneeId} onValueChange={setAssigneeId} disabled={busy || assignees.length === 0}>
                        <SelectTrigger id="dev-mock-subtask-assignee" className="w-full" aria-label={t("devOverlay.subtaskAssignee")}>
                          <SelectValue placeholder={t("devOverlay.selectSubtaskAssignee")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {assignees.map((assignee) => (
                              <SelectItem key={assignee.id} value={assignee.id}>{assignee.displayName}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="dev-mock-subtask-sprint">{t("devOverlay.subtaskSprint")}</FieldLabel>
                      <Select value={sprintId} onValueChange={setSprintId} disabled={busy || sprints.length === 0}>
                        <SelectTrigger id="dev-mock-subtask-sprint" className="w-full" aria-label={t("devOverlay.subtaskSprint")}>
                          <SelectValue placeholder={t("devOverlay.selectSubtaskSprint")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {sprints.map((sprint) => (
                              <SelectItem key={sprint.id} value={sprint.id}>
                                {t(sprint.state === "active" ? "daily.sprintState.active" : "daily.sprintState.future")}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                </DialogBody>
                <DialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
                  <DialogClose asChild>
                    <Button data-dialog-cancel type="button" variant="outline" disabled={busy}>{t("devOverlay.cancel")}</Button>
                  </DialogClose>
                  <Button type="submit" disabled={busy || !subtaskSummary.trim() || !parentIssueKey || !assigneeId || !sprintId}>
                    {t("devOverlay.addSubtask")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </Card>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("devOverlay.launch")}
          aria-expanded={open}
          title={t("devOverlay.title")}
          onClick={() => setOpen(true)}
          className="h-9 rounded-full border-border/70 bg-card/50 px-3 text-foreground/80 opacity-70 shadow-lg backdrop-blur-sm transition-opacity hover:bg-card hover:opacity-100 focus-visible:opacity-100"
        >
          <FlaskConical aria-hidden="true" className="size-4" />
          <span>{t("devOverlay.badge")}</span>
        </Button>
      )}
    </aside>
  );
}
