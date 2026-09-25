import { invoke } from "@tauri-apps/api/core";
import catalog from "./generated.json";

export interface ReleaseNote {
  version: string;
  entries: { en: string; ru: string }[];
}

const bundledReleases: ReleaseNote[] = catalog.releases;

export async function getReleaseNotesState(): Promise<{ currentVersion: string; lastSeenVersion: string }> {
  return invoke("release_notes_state");
}

export async function markReleaseNotesSeen(): Promise<void> {
  return invoke("mark_release_notes_seen");
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value);
    if (!match) return { parts: [0, 0, 0], prerelease: undefined };
    return { parts: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.parts[index] - rightVersion.parts[index];
    if (difference !== 0) return difference;
  }
  if (!leftVersion.prerelease) return rightVersion.prerelease ? 1 : 0;
  if (!rightVersion.prerelease) return -1;
  for (let index = 0; index < Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length); index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function releaseNotesSince(lastSeenVersion: string, currentVersion: string): ReleaseNote[] {
  return bundledReleases
    .filter((release) => compareVersions(release.version, lastSeenVersion) > 0
      && compareVersions(release.version, currentVersion) <= 0)
    .reverse();
}

export function allReleaseNotes(): ReleaseNote[] {
  return [...bundledReleases].reverse();
}
