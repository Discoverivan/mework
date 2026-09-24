import { FlaskConical, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/context";
import {
  addDevMockPullRequest,
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
  const [summary, setSummary] = useState("");
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
  useEffect(() => {
    if (!tasks.some((task) => task.key === selectedTaskKey)) {
      setSelectedTaskKey(tasks[0]?.key ?? "");
      setSelectedStatus((tasks[0]?.status as (typeof TASK_STATUSES)[number]) ?? "In Progress");
    }
  }, [selectedTaskKey, tasks]);

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

  return (
    <aside aria-label={t("devOverlay.title")} className="fixed bottom-3 right-3 z-50">
      {open ? (
        <Card className="w-[min(24rem,calc(100vw-1.5rem))] border-primary/50 bg-card shadow-2xl opacity-100">
          <CardHeader className="flex-row items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FlaskConical aria-hidden="true" className="size-4 text-primary" />
                <CardTitle className="text-sm">{t("devOverlay.title")}</CardTitle>
                <Badge variant="destructive">{t("devOverlay.badge")}</Badge>
              </div>
              <CardDescription className="mt-1">{t("devOverlay.description")}</CardDescription>
            </div>
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
          </CardHeader>
          <CardContent id="dev-mock-controls" className="flex flex-col gap-3 px-4 pb-4">
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <form onSubmit={submitTask} className="flex flex-col gap-2">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="dev-mock-task">{t("devOverlay.selectTask")}</Label>
              <select
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
                <select
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void run(() => addDevMockPullRequest(false))} disabled={busy}>
                {t("devOverlay.addReviewerPr")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void run(() => addDevMockPullRequest(true))} disabled={busy}>
                {t("devOverlay.addAuthoredPr")}
              </Button>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => void run(resetDevMockScenario)} disabled={busy}>
              <RotateCcw data-icon="inline-start" />
              {t("devOverlay.reset")}
            </Button>
          </CardContent>
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
