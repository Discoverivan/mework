"""Focused checks for the pull request template gate."""

import importlib.util
import io
import sys
import unittest
from unittest.mock import patch
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "validate_pr_template",
    Path(__file__).with_name("validate-pr-template.py"),
)
VALIDATOR = importlib.util.module_from_spec(SPEC)
sys.dont_write_bytecode = True
assert SPEC.loader is not None
SPEC.loader.exec_module(VALIDATOR)


class ValidatePrTemplateTests(unittest.TestCase):
    def test_accepts_application_pr_with_english_release_notes(self) -> None:
        body = """## Summary
Add sprint summaries.

## Checks
- Tests passed.

## Release notes
<!-- release-notes:en -->
### Added
- Generate AI summaries for sprint tasks.
<!-- /release-notes:en -->
<!-- release-notes:ru -->
<!-- /release-notes:ru -->
"""
        self.assertEqual(VALIDATOR.validate_pr(body, ["src/features/daily/DailyPage.tsx"]), [])

    def test_does_not_require_a_russian_template_block(self) -> None:
        body = """## Summary
Update contributor documentation.

## Checks
- Spelling reviewed.

## Release notes
<!-- release-notes:en -->
<!-- /release-notes:en -->
"""
        self.assertEqual(VALIDATOR.validate_pr(body, ["docs/example.md"]), [])

    def test_allows_empty_notes_for_documentation_only_changes(self) -> None:
        body = """## Summary
Update contributor documentation.

## Checks
- Spelling reviewed.

## Release notes
<!-- release-notes:en -->
<!-- /release-notes:en -->
<!-- release-notes:ru -->
<!-- /release-notes:ru -->
"""
        self.assertEqual(VALIDATOR.validate_pr(body, ["docs/example.md"]), [])

    def test_rejects_pr_without_required_template_sections(self) -> None:
        errors = VALIDATOR.validate_pr("Free-form PR description.", ["docs/example.md"])
        self.assertTrue(any("## Summary" in error for error in errors))
        self.assertTrue(any("## Checks" in error for error in errors))
        self.assertTrue(any("## Release notes" in error for error in errors))

    def test_rejects_application_pr_without_nonempty_categorized_notes(self) -> None:
        body = """## Summary
Improve the application.

## Checks
- Tests passed.

## Release notes
<!-- release-notes:en -->
<!-- /release-notes:en -->
<!-- release-notes:ru -->
<!-- /release-notes:ru -->
"""
        errors = VALIDATOR.validate_pr(body, ["src/App.tsx"])
        self.assertTrue(any("require non-empty English release notes" in error for error in errors))

    @patch.object(VALIDATOR.urllib.request, "urlopen")
    def test_accepts_github_markdown_attachment(self, urlopen: object) -> None:
        urlopen.return_value = io.BytesIO(b"## Added\n\n- Generate a sprint summary.\n")
        body = """## Summary
Add sprint summaries.

## Checks
- Tests passed.

## Release notes
<!-- release-notes:en -->
[release-notes.en.md](https://github.com/user-attachments/files/example/release-notes.en.md)
<!-- /release-notes:en -->
<!-- release-notes:ru -->
<!-- /release-notes:ru -->
"""
        self.assertEqual(VALIDATOR.validate_pr(body, ["src/App.tsx"]), [])
        urlopen.assert_called_once()

    def test_accepts_additional_languages_with_localized_categories(self) -> None:
        body = """## Summary
Add sprint summaries.

## Checks
- Tests passed.

## Release notes
<!-- release-notes:en -->
### Added
- Generate a summary.
<!-- /release-notes:en -->
<!-- release-notes:ru -->
<!-- /release-notes:ru -->
<!-- release-notes:fr -->
  ### Ajouté
- Générer un résumé.
<!-- /release-notes:fr -->
"""
        self.assertEqual(VALIDATOR.validate_pr(body, ["src/App.tsx"]), [])


if __name__ == "__main__":
    unittest.main()
