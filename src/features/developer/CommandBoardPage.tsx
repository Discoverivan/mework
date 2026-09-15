import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { MoreHorizontal, Pencil, Play, Plus, Terminal, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CommandBoardColor, CommandBoardItem, CommandBoardSaveRequest } from "@/shared/contracts/command-board";
import {
  deleteCommandBoardItem,
  listCommandBoardItems,
  runCommandBoardItem,
  saveCommandBoardItem,
} from "./command-board-api";

type CommandForm = {
  id?: string;
  name: string;
  scriptPath: string;
  arguments: string;
  workingDirectory: string;
  color: CommandBoardColor;
};

const COMMAND_BOARD_COLORS: Array<{ value: CommandBoardColor; label: string; swatchClass: string }> = [
  { value: "default", label: "Default", swatchClass: "bg-primary" },
  { value: "blue", label: "Blue", swatchClass: "bg-blue-500" },
  { value: "green", label: "Green", swatchClass: "bg-green-500" },
  { value: "yellow", label: "Yellow", swatchClass: "bg-yellow-400" },
  { value: "orange", label: "Orange", swatchClass: "bg-orange-500" },
  { value: "red", label: "Red", swatchClass: "bg-red-500" },
  { value: "purple", label: "Purple", swatchClass: "bg-purple-500" },
  { value: "pink", label: "Pink", swatchClass: "bg-pink-500" },
];

const COMMAND_BOARD_CARD_CLASSES: Record<CommandBoardColor, string> = {
  default: "border-border bg-card",
  blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  green: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
  yellow: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30",
  orange: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30",
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  purple: "border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30",
  pink: "border-pink-200 bg-pink-50 dark:border-pink-900 dark:bg-pink-950/30",
};

function commandBoardColor(value: CommandBoardColor | undefined): CommandBoardColor {
  return COMMAND_BOARD_COLORS.some((color) => color.value === value) ? value as CommandBoardColor : "default";
}

function colorLabel(value: CommandBoardColor): string {
  return COMMAND_BOARD_COLORS.find((color) => color.value === value)?.label ?? "Default";
}

const emptyForm = (): CommandForm => ({
  name: "",
  scriptPath: "",
  arguments: "",
  workingDirectory: "",
  color: "default",
});

function toForm(item: CommandBoardItem): CommandForm {
  return {
    id: item.id,
    name: item.name,
    scriptPath: item.scriptPath,
    arguments: item.arguments,
    workingDirectory: item.workingDirectory ?? "",
    color: commandBoardColor(item.color),
  };
}

function toRequest(form: CommandForm): CommandBoardSaveRequest {
  return {
    id: form.id,
    name: form.name,
    scriptPath: form.scriptPath,
    arguments: form.arguments,
    workingDirectory: form.workingDirectory || undefined,
    color: form.color,
  };
}

function scriptFileName(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.split("/").pop() || path;
}

function parentDirectory(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  return index > 0 ? path.slice(0, index) : "";
}

export function CommandBoardPage() {
  const [commands, setCommands] = useState<CommandBoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CommandForm>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [savingColorId, setSavingColorId] = useState<string | null>(null);

  const sortedCommands = useMemo(
    () => [...commands].sort((left, right) => left.name.localeCompare(right.name)),
    [commands],
  );

  useEffect(() => {
    let active = true;
    void listCommandBoardItems()
      .then((items) => {
        if (active) setCommands(items);
      })
      .catch(() => {
        if (active) setError("Unable to load commands");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const openCreateDialog = () => {
    setError(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEditDialog = (item: CommandBoardItem) => {
    setError(null);
    setOpenMenuId(null);
    setForm(toForm(item));
    setDialogOpen(true);
  };

  const chooseFile = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
      });
      if (typeof selected !== "string") return;
      setForm((current) => ({
        ...current,
        scriptPath: selected,
        workingDirectory: current.workingDirectory || parentDirectory(selected),
      }));
    } catch {
      setError("Unable to open the file picker");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveCommandBoardItem(toRequest(form));
      setCommands((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
      });
      setDialogOpen(false);
    } catch (saveError) {
      setError(typeof saveError === "string" ? saveError : "Unable to save command");
    } finally {
      setSaving(false);
    }
  };

  const handleColorChange = async (item: CommandBoardItem, color: CommandBoardColor) => {
    const selectedColor = commandBoardColor(color);
    setSavingColorId(item.id);
    setError(null);
    try {
      const saved = await saveCommandBoardItem({
        id: item.id,
        name: item.name,
        scriptPath: item.scriptPath,
        arguments: item.arguments,
        workingDirectory: item.workingDirectory ?? undefined,
        color: selectedColor,
      });
      setCommands((current) => current.map((value) => (value.id === saved.id ? saved : value)));
      setOpenMenuId(null);
    } catch (saveError) {
      setError(typeof saveError === "string" ? saveError : "Unable to save card color");
    } finally {
      setSavingColorId(null);
    }
  };

  const handleDelete = async (item: CommandBoardItem) => {
    setOpenMenuId(null);
    if (!window.confirm(`Delete command “${item.name}”?`)) return;
    try {
      await deleteCommandBoardItem(item.id);
      setCommands((current) => current.filter((value) => value.id !== item.id));
    } catch {
      setError("Unable to delete command");
    }
  };

  const handleRun = async (item: CommandBoardItem) => {
    if (runningId) return;
    setRunningId(item.id);
    setError(null);
    try {
      await runCommandBoardItem(item.id);
    } catch {
      setError(`Unable to run “${item.name}”`);
    } finally {
      setRunningId(null);
    }
  };

  const updateForm = (field: keyof CommandForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="page-stack" aria-labelledby="command-board-title">
      <PageHeader
        title="Command Board"
        titleId="command-board-title"
        description="Quickly launch local scripts and commands"
        actions={(
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add command
          </Button>
        )}
      />

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading commands…</p> : null}
      {!loading && sortedCommands.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <Terminal className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-semibold text-foreground">No commands yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add a `.command` or another local script to run it with one click.
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sortedCommands.map((item) => (
          <article
            key={item.id}
            className={`group relative cursor-pointer rounded-xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${COMMAND_BOARD_CARD_CLASSES[commandBoardColor(item.color)]}`}
            role="button"
            tabIndex={0}
            aria-label={`Run ${item.name}`}
            onClick={() => void handleRun(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void handleRun(item);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${COMMAND_BOARD_COLORS.find((color) => color.value === commandBoardColor(item.color))?.swatchClass ?? "bg-muted"} text-white`}>
                <Terminal className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Command options for ${item.name}`}
                  aria-expanded={openMenuId === item.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenuId((current) => (current === item.id ? null : item.id));
                  }}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
                {openMenuId === item.id ? (
                  <div
                    className="absolute right-0 top-9 z-10 min-w-36 rounded-md border border-border bg-popover p-1 shadow-lg"
                    role="menu"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="px-2 pb-1 pt-1">
                      <Label htmlFor={`command-color-${item.id}`} className="text-xs text-muted-foreground">Card color</Label>
                      <Select
                        value={commandBoardColor(item.color)}
                        onValueChange={(value) => void handleColorChange(item, value as CommandBoardColor)}
                        disabled={savingColorId === item.id}
                      >
                        <SelectTrigger id={`command-color-${item.id}`} className="mt-1 h-8 text-xs" aria-label={`Card color for ${item.name}`}>
                          <SelectValue>{colorLabel(commandBoardColor(item.color))}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {COMMAND_BOARD_COLORS.map((color) => (
                            <SelectItem key={color.value} value={color.value}>
                              <span className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${color.swatchClass}`} aria-hidden="true" />
                                {color.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="my-1 border-t border-border" aria-hidden="true" />
                    <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted" role="menuitem" onClick={() => openEditDialog(item)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                    </button>
                    <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10" role="menuitem" onClick={() => void handleDelete(item)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{item.name}</h2>
              {runningId === item.id ? <span className="text-xs text-muted-foreground">Running…</span> : <Play className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
            </div>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground" title={item.scriptPath}>{item.scriptPath}</p>
            <p className="mt-3 text-xs text-muted-foreground">System launcher</p>
          </article>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit command" : "Add command"}</DialogTitle>
            <DialogDescription>Choose a script. mework selects the appropriate system launcher for the operating system and script type.</DialogDescription>
          </DialogHeader>
          <form id="command-board-form" className="grid gap-4 py-2" onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
            <div className="grid gap-2">
              <Label htmlFor="command-name">Name</Label>
              <Input id="command-name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Script file</Label>
              <div className="flex gap-2">
                <div id="command-script" className="flex h-10 min-w-0 flex-1 items-center truncate rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground" aria-label="Selected script" title={form.scriptPath || undefined}>
                  {form.scriptPath ? scriptFileName(form.scriptPath) : "No script selected"}
                </div>
                <Button type="button" variant="outline" onClick={() => void chooseFile()}>Choose script</Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="command-arguments">Additional arguments</Label>
              <textarea id="command-arguments" className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={form.arguments} onChange={(event) => updateForm("arguments", event.target.value)} placeholder="--verbose" rows={2} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="command-working-directory">Working directory (optional)</Label>
              <Input id="command-working-directory" value={form.workingDirectory} onChange={(event) => updateForm("workingDirectory", event.target.value)} placeholder="/path/to/project" />
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="command-board-form" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
