import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CHANGELOG_HEADER = "# Changelog\n\n";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error("Pass the release version as the first argument");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value);
    if (!match) throw new Error(`Invalid release version: ${value}`);
    return { parts: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.parts[index] !== rightVersion.parts[index]) {
      return leftVersion.parts[index] - rightVersion.parts[index];
    }
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

function changelogAt(tag) {
  try {
    return execFileSync("git", ["show", `${tag}:CHANGELOG.md`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r\n/g, "\n");
  } catch {
    // Releases before the changelog was introduced have no notes to bundle.
    return CHANGELOG_HEADER;
  }
}

function entriesSince(previous, current, label) {
  if (!previous.startsWith(CHANGELOG_HEADER) || !current.startsWith(previous)) {
    throw new Error(`${label}: CHANGELOG.md must be append-only`);
  }
  const added = current.slice(previous.length).trim();
  if (!added) return [];
  const lines = added.split("\n").filter((line) => line.trim());
  if (lines.length % 2 !== 0) throw new Error(`${label}: each changelog entry needs EN and RU lines`);
  const entries = [];
  for (let index = 0; index < lines.length; index += 2) {
    const en = /^- \*\*EN:\*\* (.+)$/.exec(lines[index]);
    const ru = /^  \*\*RU:\*\* (.+)$/.exec(lines[index + 1]);
    if (!en?.[1]?.trim() || !ru?.[1]?.trim()) {
      throw new Error(`${label}: use '- **EN:** ...' followed by '  **RU:** ...'`);
    }
    entries.push({ en: en[1].trim(), ru: ru[1].trim() });
  }
  return entries;
}

const tags = git("tag", "--list", "mework-v*")
  .split("\n")
  .filter((tag) => /^mework-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag))
  .sort((left, right) => compareVersions(left.slice(8), right.slice(8)));
const previousTag = tags.at(-1);
if (previousTag && compareVersions(version, previousTag.slice(8)) <= 0) {
  throw new Error(`Release ${version} must be newer than ${previousTag}`);
}

const releases = [];
for (let index = 0; index < tags.length; index += 1) {
  const tag = tags[index];
  const previous = index === 0 ? CHANGELOG_HEADER : changelogAt(tags[index - 1]);
  const entries = entriesSince(previous, changelogAt(tag), tag);
  if (entries.length > 0) releases.push({ version: tag.slice(8), entries });
}

const currentChangelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
if (!currentChangelog.endsWith("\n")) throw new Error("CHANGELOG.md must end with a newline");
const currentEntries = entriesSince(previousTag ? changelogAt(previousTag) : CHANGELOG_HEADER, currentChangelog, version);
if (currentEntries.length === 0) throw new Error(`Release ${version} has no new CHANGELOG.md entries`);
releases.push({ version, entries: currentEntries });

mkdirSync("src/release-notes", { recursive: true });
writeFileSync("src/release-notes/generated.json", `${JSON.stringify({ releases }, null, 2)}\n`);
mkdirSync(".release", { recursive: true });
const format = (language) => currentEntries.map((entry) => `- ${entry[language]}`).join("\n");
writeFileSync(".release/release-body.md", `## What's new\n\n${format("en")}\n\n## Что нового\n\n${format("ru")}\n`);
writeFileSync(".release/update-notes.txt", `${format("en")}\n\n${format("ru")}\n`);
