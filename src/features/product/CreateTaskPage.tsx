import { Plus, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";

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

import "./create-task.css";

export function CreateTaskPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [lastPrompt, setLastPrompt] = useState<string>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = description.trim();
    if (!prompt) return;
    setLastPrompt(prompt);
    setDescription("");
    setDialogOpen(false);
  }

  return (
    <section aria-labelledby="create-task-title" className="create-task-page">
      <header className="create-task-hero">
        <div className="min-w-0">
          <p className="eyebrow">Product</p>
          <h1 id="create-task-title" className="create-task-title">Create task</h1>
        </div>
        <Button type="button" size="lg" className="create-task-new-button" onClick={() => setDialogOpen(true)}>
          <Plus aria-hidden="true" />
          Create task
        </Button>
      </header>

      {lastPrompt ? (
        <article className="create-task-empty" aria-live="polite">
          <h2>Task sent to AI</h2>
          <p>{lastPrompt}</p>
        </article>
      ) : (
        <div className="create-task-empty" aria-hidden="true" />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="create-task-dialog">
          <DialogHeader>
            <div className="create-task-dialog-icon"><Sparkles aria-hidden="true" /></div>
            <DialogTitle>Describe your task</DialogTitle>
            <DialogDescription>Turn a rough idea into a well-structured Jira task with AI.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form id="create-task-form" className="create-task-form" onSubmit={submit}>
              <label className="sr-only" htmlFor="task-description">Describe your task</label>
              <textarea
                id="task-description"
                className="create-task-textarea create-task-textarea--dialog"
                value={description}
                placeholder="Describe your task"
                autoFocus
                required
                onChange={(event) => setDescription(event.target.value)}
              />
            </form>
          </DialogBody>
          <DialogFooter className="create-task-dialog-footer">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="create-task-form" disabled={!description.trim()}>
              <Sparkles aria-hidden="true" />
              Create with AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
