"""Smoke test for skipping a duplicate push while allowing a manual rebuild."""

import json
import os
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class CheckReleaseNeededTest(unittest.TestCase):
    def test_published_commit_skips_push_but_allows_manual_rebuild(self) -> None:
        script = runpy.run_path(str(Path(__file__).with_name("check-release-needed.py")))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            sha = "a" * 40
            commands = []

            def run(command, **kwargs):
                commands.append(command)
                if command[:2] == ["git", "tag"]:
                    return subprocess.CompletedProcess(command, 0, "mework-v1.2.3\n")
                if command[0] == "gh":
                    return subprocess.CompletedProcess(command, 0, json.dumps([[{
                        "tag_name": "mework-v1.2.3",
                        "draft": False,
                        "published_at": "2026-01-01T00:00:00Z",
                    }]]))
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.dict(os.environ, {
                    "GITHUB_EVENT_NAME": "push",
                    "GITHUB_REPOSITORY": "example/example",
                    "GITHUB_SHA": sha,
                    "GITHUB_OUTPUT": str(output),
                }),
                patch.object(subprocess, "run", side_effect=run),
            ):
                self.assertEqual(script["main"](), 0)
                self.assertEqual(output.read_text(encoding="utf-8"), "should_release=false\n")
                self.assertIn(["git", "tag", "--points-at", sha, "--list", "mework-v*"], commands)
                commands.clear()
                os.environ["GITHUB_EVENT_NAME"] = "workflow_dispatch"
                self.assertEqual(script["main"](), 0)
                self.assertEqual(output.read_text(encoding="utf-8"), "should_release=false\nshould_release=true\n")
                self.assertEqual(commands, [])


if __name__ == "__main__":
    unittest.main()
