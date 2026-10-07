import { invoke } from "@tauri-apps/api/core";
import releaseNotesConfig from "../../src-tauri/release-notes-config.json";

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

const availableUpdateNotes = new Map<string, { promise: Promise<ReleaseNote[]>; expiresAt: number }>();

export function loadAvailableUpdateReleaseNotes(targetVersion: string, language: "en" | "ru"): Promise<ReleaseNote[]> {
  const now = Date.now();
  for (const [key, entry] of availableUpdateNotes) {
    if (entry.expiresAt <= now) availableUpdateNotes.delete(key);
  }
  const key = `${targetVersion}:${language}`;
  const cached = availableUpdateNotes.get(key);
  if (cached) return cached.promise;

  // Share both the background request and its result between the banner and About.
  // Persisted content and all network access remain owned by the Rust core.
  const entry: { promise: Promise<ReleaseNote[]>; expiresAt: number } = {
    promise: invoke<ReleaseNote[]>("load_available_update_release_notes", { targetVersion, language })
      .then((notes) => {
        if (notes.length === 0) throw new Error("No release notes");
        entry.expiresAt = Date.now() + releaseNotesConfig.cacheTtlSeconds * 1000;
        return notes;
      })
      .catch((error: unknown) => {
        availableUpdateNotes.delete(key);
        throw error;
      }),
    expiresAt: Infinity,
  };
  availableUpdateNotes.set(key, entry);
  return entry.promise;
}

export function prefetchOlderReleaseNotes(versions: string[], selectedVersion: string, language: "en" | "ru"): void {
  const index = versions.indexOf(selectedVersion);
  if (index < 0) return;
  void Promise.allSettled(versions.slice(index + 1, index + 3)
    .map((version) => loadReleaseNoteVersion(version, language)));
}
