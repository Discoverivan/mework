"""Smoke test for collecting both release-note sources from a merged PR."""

import os
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class CollectPrReleaseNotesTest(unittest.TestCase):
    def test_inline_notes_take_priority_and_files_stay_within_language_blocks(self) -> None:
        script = runpy.run_path(str(Path(__file__).with_name("collect-pr-release-notes.py")))
        body = """[release-notes.fr.md](https://example.com/outside)

## Release notes

<!-- release-notes:en -->
### Added

- Inline example.
[release-notes.en.md](https://example.com/en)
<!-- /release-notes:en -->

<!-- release-notes:ru -->
[release-notes.ru.md](https://example.com/ru)
<!-- /release-notes:ru -->
"""
        pull = {
            "merged_at": "2026-01-01T00:00:00Z",
            "base": {"ref": "master"},
            "merge_commit_sha": "synthetic-sha",
            "body": body,
        }
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.dict(os.environ, {
                    "GITHUB_REPOSITORY": "example/example",
                    "GITHUB_SHA": "synthetic-sha",
                    "GH_TOKEN": "example",
                }),
                patch.object(sys, "argv", ["collect", directory]),
                patch.dict(script["main"].__globals__, {
                    "github_json": lambda *_: [pull],
                    "valid_attachment_url": lambda *_: True,
                    "download_note": lambda _: "## Добавлено\n\n- Пример изменения.\n",
                }),
            ):
                script["main"]()
            self.assertEqual(
                (Path(directory) / "release-notes.en.md").read_text(encoding="utf-8"),
                "## Added\n\n- Inline example.\n",
            )
            self.assertIn(
                "## Добавлено\n\n- Пример изменения.",
                (Path(directory) / "release-notes.ru.md").read_text(encoding="utf-8"),
            )
            self.assertFalse((Path(directory) / "release-notes.fr.md").exists())


if __name__ == "__main__":
    unittest.main()
