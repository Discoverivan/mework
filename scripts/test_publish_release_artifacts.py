"""Smoke test for merging parallel platform artifacts into one updater manifest."""

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
    def test_normalizes_parallel_macos_assets_and_builds_complete_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mac_arm = root / "bundles-arm" / "aarch64-apple-darwin" / "release/bundle"
            mac_intel = root / "bundles-intel" / "x86_64-apple-darwin" / "release/bundle"
            windows = root / "bundles-windows" / "release/bundle"

            artifacts = {
                mac_arm / "macos/demo.app.tar.gz": "archive-arm",
                mac_arm / "macos/demo.app.tar.gz.sig": "signature-arm",
                mac_arm / "dmg/demo-1.2.3-aarch64.dmg": "dmg-arm",
                mac_intel / "macos/demo.app.tar.gz": "archive-intel",
                mac_intel / "macos/demo.app.tar.gz.sig": "signature-intel",
                mac_intel / "dmg/demo-1.2.3-x64.dmg": "dmg-intel",
                windows / "msi/demo-1.2.3-x64_en-US.msi": "msi",
                windows / "msi/demo-1.2.3-x64_en-US.msi.sig": "signature-msi",
                windows / "nsis/demo-1.2.3-x64-setup.exe": "nsis",
                windows / "nsis/demo-1.2.3-x64-setup.exe.sig": "signature-nsis",
            }
            for path, content in artifacts.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            normalized_count = PUBLISHER.normalize_macos_asset_names(root, "1.2.3")
            asset_paths = PUBLISHER.release_asset_paths(root)
            asset_names = {path.name for path in asset_paths}
            self.assertEqual(normalized_count, 4)
            self.assertIn("demo_1.2.3_aarch64.app.tar.gz", asset_names)
            self.assertIn("demo_1.2.3_x64.app.tar.gz", asset_names)
            self.assertIn("demo_1.2.3_aarch64.app.tar.gz.sig", asset_names)
            self.assertIn("demo_1.2.3_x64.app.tar.gz.sig", asset_names)
            self.assertEqual(
                (mac_arm / "macos/demo_1.2.3_aarch64.app.tar.gz.sig").read_text(encoding="utf-8"),
                "signature-arm",
            )

            assets = PUBLISHER.release_download_urls(
                [path.name for path in asset_paths],
                "example/example",
                "demo-v1.2.3",
            )
            self.assertEqual(
                assets["demo_1.2.3_aarch64.app.tar.gz"],
                "https://github.com/example/example/releases/download/demo-v1.2.3/demo_1.2.3_aarch64.app.tar.gz",
            )
            manifest = PUBLISHER.build_manifest(root, "1.2.3", "Release notes", assets, "2026-01-01T00:00:00Z")

        self.assertEqual(manifest["version"], "1.2.3")
        platforms = manifest["platforms"]
        self.assertEqual(platforms["darwin-aarch64"]["signature"], "signature-arm")
        self.assertEqual(platforms["darwin-aarch64"]["url"], assets["demo_1.2.3_aarch64.app.tar.gz"])
        self.assertEqual(platforms["darwin-aarch64-app"], platforms["darwin-aarch64"])
        self.assertEqual(platforms["darwin-x86_64"]["signature"], "signature-intel")
        self.assertEqual(platforms["windows-x86_64"]["signature"], "signature-msi")
        self.assertEqual(platforms["windows-x86_64-nsis"]["signature"], "signature-nsis")
        self.assertEqual(manifest["notes"], "Release notes")


if __name__ == "__main__":
    unittest.main()
