"""Validate pull request structure and required application release notes."""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


# Keep in sync with the application paths that trigger release.yml.
APP_RELEASE_PATHS = (
    "src/**",
    "src-tauri/**",
    "public/**",
    "index.html",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "vitest.config.ts",
    "tsconfig*.json",
    "components.json",
    "scripts/collect-pr-release-notes.py",
    "rust-toolchain.toml",
)
LANGUAGE = r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"
NOTE_BLOCK = re.compile(
    rf"^<!-- release-notes:({LANGUAGE}) -->[ \t]*\r?\n"
    rf"(.*?)"
    rf"^<!-- /release-notes:\1 -->[ \t]*(?:\r?\n|$)",
    re.MULTILINE | re.DOTALL,
)
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
FILE_LINK = re.compile(rf"^\[release-notes\.({LANGUAGE})\.md\]\(([^\s)]+)\)$")
MAX_NOTE_BYTES = 128 * 1024


def section(body: str, title: str) -> str | None:
    heading = re.search(rf"(?m)^## {re.escape(title)}[ \t]*\r?$", body)
    if heading is None:
        return None
    remainder = body[heading.end():]
    next_heading = re.search(r"(?m)^##? [^\r\n]+", remainder)
    return remainder[:next_heading.start()] if next_heading else remainder


def meaningful(markdown: str) -> str:
    return COMMENT.sub("", markdown).strip()


def valid_attachment_url(url: str, language: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https" or parsed.hostname != "github.com":
        return False
    if parsed.path.startswith("/user-attachments/files/"):
        return urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1]) == f"release-notes.{language}.md"
    return parsed.path.startswith("/user-attachments/assets/")


def download_attachment(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "mework-pr-template-check"})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read(MAX_NOTE_BYTES + 1)
    if len(data) > MAX_NOTE_BYTES:
        raise ValueError("attachment is too large")
    text = data.decode("utf-8-sig")
    if not text.strip() or text.lstrip().lower().startswith(("<!doctype html", "<html")):
        raise ValueError("attachment is empty or not Markdown")
    return text


def release_notes(body: str) -> tuple[dict[str, str], list[str]]:
    notes_section = section(body, "Release notes")
    if notes_section is None:
        return {}, ["Add a ## Release notes section."]

    blocks: dict[str, str] = {}
    errors: list[str] = []
    for language, text in NOTE_BLOCK.findall(notes_section):
        if language in blocks:
            errors.append(f"Use only one release-notes block for {language}.")
        blocks[language] = text

    marker_lines = re.findall(r"(?m)^<!-- /?release-notes:[^>]+-->[ \t]*$", notes_section)
    if len(marker_lines) != sum(2 for _ in NOTE_BLOCK.finditer(notes_section)):
        errors.append("Every release-notes language marker must have a matching block.")
    for language in ("en", "ru"):
        if language not in blocks:
            errors.append(f"Keep the release-notes:{language} block from the pull request template.")
    return blocks, errors


def note_content(text: str, language: str) -> tuple[str, list[str]]:
    lines: list[str] = []
    links: list[str] = []
    errors: list[str] = []
    for line in text.splitlines():
        match = FILE_LINK.fullmatch(line.strip())
        if match is None:
            lines.append(line)
            continue
        link_language, url = match.groups()
        if link_language != language or not valid_attachment_url(url, language):
            errors.append(f"The {language} notes link must point to a GitHub release-notes.{language}.md attachment.")
        else:
            links.append(url)

    markdown = meaningful("\n".join(lines))
    if markdown:
        return markdown, errors
    if len(links) != 1:
        if len(links) > 1:
            errors.append(f"Use only one release notes attachment for {language}.")
        return "", errors
    try:
        return download_attachment(links[0]), errors
    except (urllib.error.URLError, TimeoutError, UnicodeError, ValueError) as error:
        errors.append(f"Could not read the {language} release notes attachment: {error}.")
        return "", errors


def has_categorized_note(text: str, language: str) -> bool:
    content = meaningful(text)
    if language == "en":
        headings = {"Added", "Changed", "Fixed", "Removed"}
    elif language == "ru":
        headings = {"Добавлено", "Изменено", "Исправлено", "Удалено"}
    else:
        headings = set()

    matches = list(re.finditer(r"(?m)^ {0,3}#{2,3} ([^\r\n]+)[ \t]*$", content))
    for index, match in enumerate(matches):
        if headings and match.group(1).strip() not in headings:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        if meaningful(content[match.end():end]):
            return True
    return False


def is_application_change(filenames: list[str]) -> bool:
    from fnmatch import fnmatchcase

    return any(
        fnmatchcase(filename, pattern)
        for filename in filenames
        for pattern in APP_RELEASE_PATHS
    )


def validate_pr(body: str, filenames: list[str]) -> list[str]:
    errors: list[str] = []
    for title in ("Summary", "Checks"):
        content = section(body, title)
        if content is None:
            errors.append(f"Add the ## {title} section from the pull request template.")
        elif not meaningful(content):
            errors.append(f"Fill in the ## {title} section.")

    raw_notes, note_errors = release_notes(body)
    errors.extend(note_errors)
    notes: dict[str, str] = {}
    for language, raw_text in raw_notes.items():
        notes[language], content_errors = note_content(raw_text, language)
        errors.extend(content_errors)
    if is_application_change(filenames):
        if not has_categorized_note(notes.get("en", ""), "en"):
            errors.append(
                "Application changes require non-empty English release notes "
                "in a categorized release-notes:en block."
            )
    for language, text in notes.items():
        if language != "en" and text and not has_categorized_note(text, language):
            errors.append(f"The {language} release notes need a category heading and non-empty text.")
    return errors


def changed_files(repository: str, number: int) -> list[str]:
    result = subprocess.run(
        ["gh", "api", "--paginate", f"repos/{repository}/pulls/{number}/files", "--jq", ".[] | .filename"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def main() -> int:
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    pull_request = event.get("pull_request")
    if not isinstance(pull_request, dict):
        print("This validator must run for a pull_request event.", file=sys.stderr)
        return 2

    errors = validate_pr(
        pull_request.get("body") or "",
        changed_files(os.environ["GITHUB_REPOSITORY"], pull_request["number"]),
    )
    if errors:
        print("Pull request does not meet the template requirements:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Pull request template and release notes are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
