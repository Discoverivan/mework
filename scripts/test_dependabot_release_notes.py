"""Smoke coverage for Dependabot notes and privileged-write isolation."""

import copy
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "dependabot_release_notes", Path(__file__).with_name("dependabot-release-notes.py")
)
NOTES = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(NOTES)


class DependabotReleaseNotesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = "example/example-app"
        self.run = {
            "id": 42, "name": "CI", "path": ".github/workflows/ci.yml",
            "event": "pull_request", "status": "completed", "conclusion": "failure",
            "head_branch": "dependabot/npm_and_yarn/example-group",
            "head_sha": "example-sha", "head_repository": {"full_name": self.repository},
        }
        self.pull = {
            "number": 7, "state": "open", "user": {"login": "dependabot[bot]"},
            "body": "Update example dependencies.\n",
            "base": {"ref": "master", "repo": {"full_name": self.repository}},
            "head": {"sha": "example-sha", "repo": {"full_name": self.repository}},
        }

    def test_adds_valid_notes_and_reruns_ci_using_the_current_body(self) -> None:
        calls = []
        self.pull["body"] += (
            "\n#### Why this change\n\nKeep example dependencies current.\n"
            "\n#### How it works\n\n<!-- Describe the update. -->\n"
        )

        def api(endpoint: str, method: str = "GET", data: dict | None = None) -> object:
            calls.append((endpoint, method, data))
            if endpoint.endswith("/pulls/7"):
                if method == "PATCH":
                    self.pull["body"] = data["body"]
                return self.pull
            if "/pulls?" in endpoint:
                return [self.pull]
            return None

        with patch.object(NOTES.VALIDATOR, "github_api", side_effect=api), patch.object(
            NOTES.VALIDATOR, "changed_files", return_value=["package-lock.json"]
        ):
            NOTES.process_run(self.run, self.repository)
            self.assertTrue(self.pull["body"].startswith("Update example dependencies."))
            self.assertIn("### Changed\n- Updated application libraries.", self.pull["body"])
            self.assertIn("Keep example dependencies current.", self.pull["body"])
            self.assertEqual(NOTES.VALIDATOR.validate_pr(self.pull["body"], ["package-lock.json"]), [])
            self.assertIn((f"repos/{self.repository}/actions/runs/42/rerun-failed-jobs", "POST", None), calls)
            # Repeat completion is a no-op, preserving notes and avoiding a loop.
            calls.clear()
            NOTES.process_run(self.run, self.repository)
            self.assertTrue(all(method == "GET" for _, method, _ in calls))

            with tempfile.TemporaryDirectory() as directory:
                event_path = Path(directory) / "event.json"
                event_path.write_text(json.dumps({"pull_request": {"number": 7, "body": "Stale description."}}))
                with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(event_path), "GITHUB_REPOSITORY": self.repository}):
                    self.assertEqual(NOTES.VALIDATOR.main(), 0)

    def test_never_writes_for_other_authors_forks_or_stale_commits(self) -> None:
        # These checks protect a workflow with write privileges from PR input.
        for field, value in (("user", {"login": "example-user"}),
                             ("head", {"sha": "example-sha", "repo": {"full_name": "example/example-fork"}}),
                             ("head", {"sha": "old-example-sha", "repo": {"full_name": self.repository}})):
            with self.subTest(field=field, value=value):
                pull = copy.deepcopy(self.pull)
                pull[field] = value
                with patch.object(NOTES.VALIDATOR, "github_api", return_value=[pull]) as api:
                    NOTES.process_run(self.run, self.repository)
                    self.assertEqual(api.call_count, 1)
                    self.assertEqual(len(api.call_args.args), 1)


if __name__ == "__main__":
    unittest.main()
