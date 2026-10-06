import { invoke } from "@tauri-apps/api/core";

export interface ReleaseNote {
  version: string;
  markdown: string;
  language: "en" | "ru";
}

export interface ReleaseNotesState {
  currentVersion: string;
  pendingFromVersion: string | null;
}

export function getReleaseNotesState(): Promise<ReleaseNotesState> {
  return invoke("release_notes_state");
}

export function markReleaseNotesSeen(): Promise<void> {
  return invoke("mark_release_notes_seen");
}

export function listUpdateReleaseNotesVersions(): Promise<string[]> {
  return invoke("list_update_release_notes_versions");
}

export function listReleaseNotesVersions(): Promise<string[]> {
  return invoke("list_release_notes_versions");
}

export function loadReleaseNoteVersion(version: string, language: "en" | "ru"): Promise<ReleaseNote> {
  return invoke("load_release_note_version", { version, language });
}

export function loadAvailableUpdateReleaseNotes(targetVersion: string, language: "en" | "ru"): Promise<ReleaseNote[]> {
  return invoke("load_available_update_release_notes", { targetVersion, language });
}

export function prefetchOlderReleaseNotes(versions: string[], selectedVersion: string, language: "en" | "ru"): void {
  const index = versions.indexOf(selectedVersion);
  if (index < 0) return;
  void Promise.allSettled(versions.slice(index + 1, index + 3)
    .map((version) => loadReleaseNoteVersion(version, language)));
}
