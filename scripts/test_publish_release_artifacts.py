"""Smoke test for merging platform signatures into one updater manifest."""

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "publish_release_artifacts",
    Path(__file__).with_name("publish-release-artifacts.py"),
)
PUBLISHER = importlib.util.module_from_spec(SPEC)
sys.dont_write_bytecode = True
assert SPEC.loader is not None
SPEC.loader.exec_module(PUBLISHER)


class PublishReleaseArtifactsTests(unittest.TestCase):
    def test_builds_complete_manifest_from_parallel_platform_bundles(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = PUBLISHER.release_download_urls(
                [
                    {
                        "name": filename,
                        "browser_download_url": f"https://github.com/example/example/releases/download/demo-v1.2.3/{filename}",
                    }
                    for filename in (
                        "demo-1.2.3-aarch64.app.tar.gz",
                        "demo-1.2.3-x64.app.tar.gz",
                        "demo-1.2.3-x64_en-US.msi",
                        "demo-1.2.3-x64-setup.exe",
                    )
                ]
            )
            signatures = {
                "demo-1.2.3-aarch64.app.tar.gz.sig": "signature-arm",
                "demo-1.2.3-x64.app.tar.gz.sig": "signature-intel",
                "demo-1.2.3-x64_en-US.msi.sig": "signature-msi",
                "demo-1.2.3-x64-setup.exe.sig": "signature-nsis",
            }
            for filename, signature in signatures.items():
                (root / filename).write_text(signature, encoding="utf-8")

            manifest = PUBLISHER.build_manifest(root, "1.2.3", "Release notes", assets, "2026-01-01T00:00:00Z")

        self.assertEqual(manifest["version"], "1.2.3")
        platforms = manifest["platforms"]
        self.assertEqual(platforms["darwin-aarch64"]["signature"], "signature-arm")
        self.assertEqual(platforms["darwin-aarch64"]["url"], assets["demo-1.2.3-aarch64.app.tar.gz"])
        self.assertEqual(platforms["darwin-aarch64-app"], platforms["darwin-aarch64"])
        self.assertEqual(platforms["darwin-x86_64"]["signature"], "signature-intel")
        self.assertEqual(platforms["windows-x86_64"]["signature"], "signature-msi")
        self.assertEqual(platforms["windows-x86_64-nsis"]["signature"], "signature-nsis")
        self.assertEqual(manifest["notes"], "Release notes")


if __name__ == "__main__":
    unittest.main()
