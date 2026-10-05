"""Skip automatic builds of commits that already have a published release."""

import json
import os
import re
import subprocess
from pathlib import Path


def published_release_for_commit(repository: str, sha: str) -> str | None:
    tags = subprocess.run(
        ["git", "tag", "--points-at", sha, "--list", "mework-v*"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    release_tags = {tag for tag in tags if re.fullmatch(r"mework-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag)}
    if not release_tags:
        return None

    result = subprocess.run(
        ["gh", "api", "--paginate", "--slurp", f"repos/{repository}/releases"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    for page in json.loads(result.stdout):
        for release in page:
            if (
                release["tag_name"] in release_tags
                and not release["draft"]
                and release["published_at"]
            ):
                return release["tag_name"]
    return None


def main() -> int:
    published = None
    if os.environ["GITHUB_EVENT_NAME"] == "push":
        # Fetch inside the serial workflow, after any earlier publication finishes.
        subprocess.run(["git", "fetch", "--tags", "--force"], check=True)
        published = published_release_for_commit(
            os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"]
        )

    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"should_release={'false' if published else 'true'}\n")
    if published:
        print(f"Skipping automatic release: this commit is already published as {published}.")
    else:
        print("Release build is required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
