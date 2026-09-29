"""Collect optional inline notes or linked Markdown files from the merged PR."""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


MAX_NOTE_BYTES = 128 * 1024
LANGUAGE = r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"
FILE_LINK = re.compile(rf"\[release-notes\.({LANGUAGE})\.md\]\(([^\s)]+)\)")
INLINE_NOTE = re.compile(
    rf"^<!-- release-notes:({LANGUAGE}) -->[ \t]*\r?\n"
    r"(.*?)"
    r"^<!-- /release-notes:\1 -->[ \t]*(?:\r?\n|$)",
    re.MULTILINE | re.DOTALL,
)


def github_json(url: str, token: str) -> object:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "mework-release-notes",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def valid_attachment_url(url: str, filename: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https" or parsed.hostname != "github.com":
        return False
    if parsed.path.startswith("/user-attachments/files/"):
        return urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1]) == filename
    return parsed.path.startswith("/user-attachments/assets/")


def note_sources(body: str) -> tuple[dict[str, str], dict[str, str]]:
    notes: dict[str, str] = {}
    links: dict[str, str] = {}
    seen: set[str] = set()
    duplicates: set[str] = set()
    heading = re.search(r"(?m)^## Release notes[ \t]*\r?$", body)
    if heading is None:
        return notes, links
    section = body[heading.end():]
    next_heading = re.search(r"(?m)^#{1,2} [^\r\n]+", section)
    if next_heading:
        section = section[:next_heading.start()]
    for language, block in INLINE_NOTE.findall(section):
        if language in seen:
            duplicates.add(language)
            continue
        seen.add(language)
        markdown_lines: list[str] = []
        file_urls: list[str] = []
        for line in block.splitlines():
            match = FILE_LINK.fullmatch(line.strip())
            if match:
                filename = f"release-notes.{match.group(1)}.md"
                if match.group(1) == language and valid_attachment_url(match.group(2), filename):
                    file_urls.append(match.group(2))
                else:
                    print(f"Warning: invalid {language} release notes link; skipping", file=sys.stderr)
            else:
                markdown_lines.append(line)
        markdown = "\n".join(markdown_lines).strip()
        if markdown:
            if len(markdown.encode("utf-8")) <= MAX_NOTE_BYTES:
                notes[language] = standalone_markdown(markdown) + "\n"
            else:
                print(f"Warning: inline {language} release notes are too large", file=sys.stderr)
        if len(file_urls) == 1:
            links[language] = file_urls[0]
        elif len(file_urls) > 1:
            print(f"Warning: duplicate {language} release notes links; skipping", file=sys.stderr)
    for language in duplicates:
        print(f"Warning: duplicate {language} release notes blocks; skipping", file=sys.stderr)
        notes.pop(language, None)
        links.pop(language, None)
    return notes, links


def standalone_markdown(markdown: str) -> str:
    """Lift PR subsection headings by one level for standalone release assets."""
    lines = []
    fence: tuple[str, int] | None = None
    for line in markdown.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            if (marker and marker.group(1)[0] == fence[0]
                    and len(marker.group(1)) >= fence[1]
                    and not line[marker.end():].strip()):
                fence = None
        elif marker:
            fence = (marker.group(1)[0], len(marker.group(1)))
        else:
            heading = re.match(r"^( {0,3})#{3,6}[ \t]+", line)
            if heading:
                line = line[:len(heading.group(1))] + line[len(heading.group(1)) + 1:]
        lines.append(line)
    return "".join(lines)


def download_note(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "mework-release-notes"})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read(MAX_NOTE_BYTES + 1)
    if len(data) > MAX_NOTE_BYTES:
        raise ValueError("attachment is too large")
    text = data.decode("utf-8-sig")
    if not text.strip() or text.lstrip().lower().startswith(("<!doctype html", "<html")):
        raise ValueError("attachment is empty or not Markdown")
    return text


def main() -> None:
    repository = os.environ["GITHUB_REPOSITORY"]
    commit_sha = os.environ["GITHUB_SHA"]
    token = os.environ["GH_TOKEN"]
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)

    try:
        pulls = github_json(
            f"https://api.github.com/repos/{repository}/commits/{commit_sha}/pulls?per_page=100",
            token,
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        print(f"Warning: could not find the merged PR: {error}", file=sys.stderr)
        return
    if not isinstance(pulls, list):
        print("Warning: unexpected PR lookup response; continuing without release notes", file=sys.stderr)
        return
    merged = [
        pull for pull in pulls
        if isinstance(pull, dict)
        and pull.get("merged_at")
        and isinstance(pull.get("base"), dict)
        and pull["base"].get("ref") == "master"
    ]
    pull = next((item for item in merged if item.get("merge_commit_sha") == commit_sha), None)
    if pull is None and len(merged) == 1:
        pull = merged[0]
    if pull is None:
        print("No unique merged PR for this release; continuing without release notes")
        return

    body = pull.get("body") or ""
    embedded, links = note_sources(body)
    if not embedded and not links:
        print("No PR release notes; continuing without release notes")
        return
    for language in links.keys() | embedded.keys():
        note = embedded.get(language)
        if note is None and language in links:
            try:
                note = download_note(links[language])
            except (urllib.error.URLError, TimeoutError, UnicodeError, ValueError) as error:
                print(f"Warning: could not load {language} attachment: {error}", file=sys.stderr)
        if note is None:
            continue
        (output / f"release-notes.{language}.md").write_text(note, encoding="utf-8")
        print(f"Prepared release-notes.{language}.md")


if __name__ == "__main__":
    main()
