export type AssigneesLayout = "left" | "top";

export const ASSIGNEES_LAYOUT_STORAGE_KEY = "mework.sprint-tasks.assignees-layout.v1";

export function readAssigneesLayout(): AssigneesLayout {
  try {
    return window.localStorage.getItem(ASSIGNEES_LAYOUT_STORAGE_KEY) === "top" ? "top" : "left";
  } catch {
    return "left";
  }
}

export function writeAssigneesLayout(layout: AssigneesLayout): void {
  try {
    window.localStorage.setItem(ASSIGNEES_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Display preferences remain usable when local storage is unavailable.
  }
}
