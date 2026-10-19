import type { ManagedProject } from "@/shared/contracts/planning";

// Display preferences only; Rust remains responsible for resolving the active sprint.
const STORAGE_KEY = "mework.sprint-selection.v1";

export interface SprintSelection {
  projectId?: string;
  pinnedSprints: Record<string, string>;
}

export function sprintSelectionScope(project: ManagedProject): string {
  return JSON.stringify([project.integrationId, project.id]);
}

export function readSprintSelection(): SprintSelection {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof value === "object" && value !== null) {
      const saved = value as Partial<SprintSelection>;
      return {
        projectId: typeof saved.projectId === "string" ? saved.projectId : undefined,
        pinnedSprints: Object.fromEntries(Object.entries(saved.pinnedSprints ?? {})
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)),
      };
    }
  } catch {
    // Display preferences may be unavailable; default to the current sprint.
  }
  return { pinnedSprints: {} };
}

export function writeSprintSelection(selection: SprintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Keep the selection usable for this visit when storage is unavailable.
  }
}
