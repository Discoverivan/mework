"""Upload parallel Tauri build artifacts and assemble the updater manifest."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlparse


BUNDLE_SUFFIXES = (
    ".app.tar.gz",
    ".dmg",
    ".msi.zip",
    ".msi",
    ".nsis.zip",
    ".exe",
)
SIGNATURE_SUFFIXES = (
    ".app.tar.gz.sig",
    ".msi.zip.sig",
    ".nsis.zip.sig",
    ".msi.sig",
    ".exe.sig",
)


MACOS_ARCHES = {
    "aarch64-apple-darwin": "aarch64",
    "x86_64-apple-darwin": "x64",
}


def normalize_macos_asset_names(root: Path, version: str) -> int:
    renamed = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        is_signature = path.name.endswith(".app.tar.gz.sig")
        if not is_signature and not path.name.endswith(".app.tar.gz"):
            continue

        arch = next((value for target, value in MACOS_ARCHES.items() if target in path.parts), None)
        if arch is None:
            raise ValueError(f"Could not determine macOS target for {path.name}")
        archive_name = path.name[:-4] if is_signature else path.name
        stem = archive_name.removesuffix(".app.tar.gz")
        if stem.endswith(("_aarch64", "_x64")):
            if not stem.endswith(f"_{arch}"):
                raise ValueError(f"Updater archive architecture does not match its runner: {path.name}")
            continue

        suffix = ".app.tar.gz.sig" if is_signature else ".app.tar.gz"
        target = path.with_name(f"{stem}_{version}_{arch}{suffix}")
        if target.exists():
            raise ValueError(f"Cannot rename macOS updater asset; target already exists: {target.name}")
        path.rename(target)
        renamed += 1
    return renamed


def release_asset_paths(root: Path) -> list[Path]:
    paths = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.name.endswith((*BUNDLE_SUFFIXES, *SIGNATURE_SUFFIXES))
    )
    names = [path.name for path in paths]
    if len(names) != len(set(names)):
        raise ValueError("Tauri build artifacts contain duplicate release asset filenames")
    if not paths:
        raise ValueError("No Tauri release bundles were downloaded")
    return paths


def architecture(filename: str) -> str:
    name = filename.lower()
    if "aarch64" in name or "arm64" in name:
        return "aarch64"
    if "x86_64" in name or "_x64" in name or "-x64" in name:
        return "x86_64"
    raise ValueError(f"Could not determine updater architecture from {filename}")


def signature_bundle(filename: str) -> tuple[str, str] | None:
    if filename.endswith(".app.tar.gz.sig"):
        return "darwin", "app"
    if filename.endswith((".msi.zip.sig", ".msi.sig")):
        return "windows", "msi"
    if filename.endswith((".nsis.zip.sig", ".exe.sig")):
        return "windows", "nsis"
    return None


def release_download_urls(assets: list[object]) -> dict[str, str]:
    urls: dict[str, str] = {}
    for asset in assets:
        if not isinstance(asset, dict):
            raise ValueError("GitHub returned an invalid release asset")
        name = asset.get("name")
        url = asset.get("browser_download_url")
        if not isinstance(name, str) or not isinstance(url, str):
            raise ValueError("GitHub returned a release asset without a downloadable URL")
        parsed = urlparse(url)
        filename = unquote(parsed.path.rsplit("/", 1)[-1])
        if parsed.scheme != "https" or parsed.hostname != "github.com" or filename != name:
            raise ValueError(f"GitHub returned an unexpected download URL for {name}")
        urls[name] = url
    return urls


def build_platforms(root: Path, asset_urls: dict[str, str]) -> dict[str, dict[str, str]]:
    platforms: dict[str, dict[str, str]] = {}
    windows_bundles: dict[str, tuple[int, dict[str, str]]] = {}
    windows_preferences = {
        ".msi.sig": 0,
        ".msi.zip.sig": 1,
        ".exe.sig": 2,
        ".nsis.zip.sig": 3,
    }
    for signature_path in sorted(root.rglob("*.sig")):
        bundle_info = signature_bundle(signature_path.name)
        if bundle_info is None:
            continue
        platform_name, bundle = bundle_info
        bundle_filename = signature_path.name[:-4]
        url = asset_urls.get(bundle_filename)
        if url is None:
            raise ValueError(f"No uploaded release asset found for {bundle_filename}")
        signature = signature_path.read_text(encoding="utf-8")
        if not signature.strip():
            raise ValueError(f"Updater signature is empty: {signature_path.name}")
        entry = {"signature": signature, "url": url}
        arch = architecture(signature_path.name)
        if platform_name == "darwin":
            for key in (f"darwin-{arch}", f"darwin-{arch}-app"):
                platforms[key] = entry
            continue

        platform_key = f"windows-{arch}-{bundle}"
        platforms[platform_key] = entry
        priority = next(
            (value for suffix, value in windows_preferences.items() if signature_path.name.endswith(suffix)),
            2,
        )
        current = windows_bundles.get(arch)
        if current is None or priority < current[0]:
            windows_bundles[arch] = (priority, entry)

    for arch, (_, entry) in windows_bundles.items():
        platforms[f"windows-{arch}"] = entry

    required = {"darwin-aarch64", "darwin-x86_64", "windows-x86_64"}
    missing = sorted(required - platforms.keys())
    if missing:
        raise ValueError(f"Updater signatures are missing required platforms: {', '.join(missing)}")
    return platforms


def build_manifest(
    root: Path,
    version: str,
    notes: str,
    asset_urls: dict[str, str],
    pub_date: str | None = None,
) -> dict[str, object]:
    return {
        "version": version,
        "notes": notes,
        "pub_date": pub_date or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "platforms": build_platforms(root, asset_urls),
    }


def gh_json(*args: str) -> object:
    result = subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: publish-release-artifacts.py <artifact-directory> <manifest-output>", file=sys.stderr)
        return 2

    artifact_root = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    repository = os.environ["GITHUB_REPOSITORY"]
    release_tag = os.environ["RELEASE_TAG"]
    version = os.environ["RELEASE_VERSION"]
    notes_path = Path(os.environ["RELEASE_NOTES_FILE"])
    fallback_notes = os.environ.get("RELEASE_BODY_FALLBACK", "Release build for macOS and Windows.")
    notes = notes_path.read_text(encoding="utf-8") if notes_path.is_file() else fallback_notes

    normalized_count = normalize_macos_asset_names(artifact_root, version)
    files = release_asset_paths(artifact_root)
    subprocess.run(
        ["gh", "release", "upload", release_tag, *(str(path) for path in files), "--repo", repository, "--clobber"],
        check=True,
    )
    release = gh_json(f"repos/{repository}/releases/tags/{release_tag}")
    assets = release.get("assets") if isinstance(release, dict) else None
    if not isinstance(assets, list):
        raise ValueError("GitHub returned an invalid release asset list")
    asset_urls = release_download_urls(assets)
    manifest = build_manifest(artifact_root, version, notes, asset_urls)
    output_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"Uploaded {len(files)} release assets ({normalized_count} macOS updater filenames normalized) "
        f"and created updater manifest for {version}."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"::error::{error}", file=sys.stderr)
        raise SystemExit(1)
