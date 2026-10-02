"""Fill missing Dependabot PR notes after CI, using only trusted base code."""

import importlib.util
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path


sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "validate_pr_template", Path(__file__).with_name("validate-pr-template.py")
)
VALIDATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(VALIDATOR)


def fill_notes(body: str, filenames: list[str]) -> str:
    # Use the contributor policy's generic note, including for dev dependency
    # updates: these must not claim new user-facing features or fixes.
    note = "### Fixed\n- Performance improvements and bug fixes.\n" if (
        VALIDATOR.is_application_change(filenames)
    ) else ""
    block = f"<!-- release-notes:en -->\n{note}<!-- /release-notes:en -->\n"
    heading = re.search(r"(?m)^## Release notes[ \t]*\r?$", body)
    if heading is None:
        return body.rstrip() + "\n\n## Release notes\n\n" + block

    contents = VALIDATOR.section(body, "Release notes")
    start, end = heading.end(), heading.end() + len(contents)
    matches = [match for match in VALIDATOR.NOTE_BLOCK.finditer(contents) if match[1] == "en"]
    if len(matches) == 1:
        match = matches[0]
        # Preserve manually written notes, links, and malformed blocks for review.
        if not VALIDATOR.meaningful(match[2]) and note:
            return body[:start + match.start()] + block + body[start + match.end():]
        return body
    if matches or "release-notes:en" in contents:
        return body
    return body[:end].rstrip() + "\n\n" + block + "\n" + body[end:]


def process_run(run: dict, repository: str) -> None:
    if (run.get("event") != "pull_request" or run.get("name") != "CI"
            or run.get("path") != ".github/workflows/ci.yml"
            or run.get("status") != "completed"
            or run.get("head_repository", {}).get("full_name") != repository):
        return

    # workflow_run may have an empty pull_requests array. Resolve the branch
    # through the API and then verify the current PR's author, repository, SHA.
    head = urllib.parse.quote(f"{repository.split('/')[0]}:{run['head_branch']}", safe="")
    pulls = VALIDATOR.github_api(f"repos/{repository}/pulls?state=open&base=master&head={head}")
    for pull in pulls:
        if (pull.get("user", {}).get("login") != "dependabot[bot]"
                or pull.get("state") != "open"
                or pull.get("base", {}).get("ref") != "master"
                or pull.get("base", {}).get("repo", {}).get("full_name") != repository
                or pull.get("head", {}).get("repo", {}).get("full_name") != repository
                or pull.get("head", {}).get("sha") != run["head_sha"]):
            continue
        number = pull["number"]
        filenames = VALIDATOR.changed_files(repository, number)
        body = pull.get("body") or ""
        updated = fill_notes(body, filenames)
        if updated == body:
            continue
        VALIDATOR.github_api(f"repos/{repository}/pulls/{number}", "PATCH", {"body": updated})
        print(f"Added release notes to Dependabot PR #{number}.")
        # Body edits with GITHUB_TOKEN do not trigger CI. Re-run explicitly,
        # only after an actual edit; unchanged notes cannot cause a retry loop.
        if run.get("conclusion") == "failure":
            VALIDATOR.github_api(f"repos/{repository}/actions/runs/{run['id']}/rerun-failed-jobs", "POST")
            print("Requested a re-run of failed CI jobs.")


def main() -> None:
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    process_run(event["workflow_run"], os.environ["GITHUB_REPOSITORY"])


if __name__ == "__main__":
    main()
