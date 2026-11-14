# Copyright (c) 2026 Philipp Kaaden
"""Tests for Service Worker precache, bundle cleanup, and CSP/icon audit."""

from __future__ import annotations

import hashlib
import json
import re
from typing import TYPE_CHECKING

import pytest

from training_aid.audit import DATA_DIR, REPO_ROOT
from training_aid.audit.bundle_security import check_shell_and_privacy
from training_aid.compiler import (
    PWA_SRC_DIR,
    build_pwa,
    stamp_service_worker,
)

if TYPE_CHECKING:
    from pathlib import Path

_STAMP_RE = re.compile(r"^v1-[0-9a-f]{12}$")
_ASSETS_RE = re.compile(r"APP_SHELL_ASSETS\s*=\s*(\[[^\]]*\])", flags=re.DOTALL)
_REVISIONS_RE = re.compile(
    r"APP_SHELL_REVISIONS\s*=\s*(\{[^}]*\})",
    flags=re.DOTALL,
)


def test_build_pwa_stamps_deterministic_idempotent_sw(tmp_path: Path) -> None:
    """Verify build_pwa stamps APP_SHELL_ASSETS and CACHE_VERSION idempotently."""
    dist_a = tmp_path / "dist_a"
    dist_b = tmp_path / "dist_b"

    summary_a = build_pwa(dist_a)
    summary_b = build_pwa(dist_b)

    version_a = summary_a["cache_version"]
    assert isinstance(version_a, str)
    assert _STAMP_RE.match(version_a) is not None
    assert summary_b["cache_version"] == version_a

    sw_dist_text = (dist_a / "sw.js").read_text(encoding="utf-8")
    assert f'CACHE_VERSION = "{version_a}";' in sw_dist_text
    assert 'CACHE_VERSION = "v1";' not in sw_dist_text
    assert 'new Request(url, { cache: "reload" })' in sw_dist_text
    assert 'pathname.endsWith(".png")' in sw_dist_text

    match = _ASSETS_RE.search(sw_dist_text)
    assert match is not None
    assets = set(json.loads(match.group(1)))
    assert "./" in assets
    assert "./index.html" in assets
    assert "./app.js" in assets
    assert "./apple-touch-icon.png" in assets
    assert "./icon-192.png" in assets
    assert "./icon-512.png" in assets
    assert "./icon-maskable-512.png" in assets
    assert "./data/catalog.json" in assets
    assert "./ui/sw-update.js" in assets
    assert "./sw.js" not in assets
    assert not any(a.startswith("./svgs/thumbs/") for a in assets)

    rev_match = _REVISIONS_RE.search(sw_dist_text)
    assert rev_match is not None
    revisions = json.loads(rev_match.group(1))
    assert set(revisions.keys()) == assets
    index_hex = hashlib.sha256((dist_a / "index.html").read_bytes()).hexdigest()[:12]
    catalog_hex = hashlib.sha256(
        (dist_a / "data" / "catalog.json").read_bytes()
    ).hexdigest()[:12]
    assert revisions["./"] == index_hex
    assert revisions["./index.html"] == index_hex
    assert revisions["./data/catalog.json"] == catalog_hex

    # Source template in repository must remain unstamped.
    sw_src_text = (PWA_SRC_DIR / "sw.js").read_text(encoding="utf-8")
    assert 'CACHE_VERSION = "v1";' in sw_src_text
    assert "APP_SHELL_REVISIONS = {};" in sw_src_text

    # Re-stamping an already-stamped bundle must be strictly idempotent.
    restamped = stamp_service_worker(dist_a)
    assert restamped == version_a
    assert (dist_a / "sw.js").read_text(encoding="utf-8") == sw_dist_text


def test_build_pwa_cleans_orphaned_files_and_guards_unsafe_paths(
    tmp_path: Path,
) -> None:
    """Verify build_pwa purges stale files/dirs and rejects unsafe output_dir paths."""
    dist_dir = tmp_path / "dist"
    stale_dir = dist_dir / "old_nested"
    stale_dir.mkdir(parents=True)
    stale_file = dist_dir / "orphan.js"
    stale_nested = stale_dir / "stale.txt"
    stale_file.write_text("// orphan\n", encoding="utf-8")
    stale_nested.write_text("stale\n", encoding="utf-8")

    summary = build_pwa(dist_dir)
    assert not stale_file.exists()
    assert not stale_dir.exists()
    assert (dist_dir / "index.html").is_file()

    clean_bundle = tmp_path / "clean_dist"
    assert summary["cache_version"] == build_pwa(clean_bundle)["cache_version"]

    for unsafe_target in (
        REPO_ROOT,
        REPO_ROOT.parent,
        PWA_SRC_DIR,
        PWA_SRC_DIR / "core",
        DATA_DIR,
    ):
        with pytest.raises(ValueError, match="Refusing to clean unsafe output_dir"):
            build_pwa(unsafe_target)


def test_bundle_security_enforces_png_signature_manifest_and_csp(
    tmp_path: Path,
) -> None:
    """Verify check_shell_and_privacy checks PNG magic bytes, manifest, and CSP."""
    dist_dir = tmp_path / "dist"
    build_pwa(dist_dir)
    assert check_shell_and_privacy(dist_dir) == []

    # Corrupt a PNG file and verify magic-byte failure.
    png_path = dist_dir / "icon-192.png"
    original_png = png_path.read_bytes()
    png_path.write_bytes(b"NOT_A_PNG_HEADER")
    stamp_service_worker(dist_dir)
    errs = check_shell_and_privacy(dist_dir)
    assert any("invalid PNG magic signature" in err for err in errs)
    png_path.write_bytes(original_png)

    # Combine 'any maskable' in manifest and verify rejection.
    manifest_path = dist_dir / "manifest.webmanifest"
    original_manifest = manifest_path.read_text(encoding="utf-8")
    bad_manifest = json.loads(original_manifest)
    bad_manifest["icons"] = [
        {
            "src": "./icon.svg",
            "sizes": "any",
            "type": "image/svg+xml",
            "purpose": "any maskable",
        }
    ]
    manifest_path.write_text(json.dumps(bad_manifest), encoding="utf-8")
    stamp_service_worker(dist_dir)
    errs = check_shell_and_privacy(dist_dir)
    assert any("must not combine purposes" in err for err in errs)
    assert any("must include both 'any' and 'maskable'" in err for err in errs)
    manifest_path.write_text(original_manifest, encoding="utf-8")
    stamp_service_worker(dist_dir)
    assert check_shell_and_privacy(dist_dir) == []

    # Mutate an asset without re-stamping sw.js and verify revision mismatch detection.
    app_js_path = dist_dir / "app.js"
    original_app_js = app_js_path.read_bytes()
    app_js_path.write_bytes(original_app_js + b"\n// unstamped edit\n")
    errs = check_shell_and_privacy(dist_dir)
    assert any("APP_SHELL_REVISIONS['./app.js'] digest mismatch" in err for err in errs)
    app_js_path.write_bytes(original_app_js)
    assert check_shell_and_privacy(dist_dir) == []


def test_stamp_changes_when_any_bundle_asset_changes(tmp_path: Path) -> None:
    """Verify editing JS, CSS, catalog JSON, or SVG thumbs rotates CACHE_VERSION."""
    dist_dir = tmp_path / "dist"
    baseline = build_pwa(dist_dir)["cache_version"]
    assert isinstance(baseline, str)

    seen_versions = {baseline}
    mutations = (
        dist_dir / "app.js",
        dist_dir / "styles" / "tokens.css",
        dist_dir / "data" / "catalog.json",
        dist_dir / "svgs" / "thumbs" / "squat__barbell.svg",
    )
    for target in mutations:
        original = target.read_bytes()
        target.write_bytes(original + b"\n/* mutated */\n")
        rotated = stamp_service_worker(dist_dir)
        assert isinstance(rotated, str)
        assert _STAMP_RE.match(rotated) is not None
        assert rotated not in seen_versions
        seen_versions.add(rotated)

        # Restoring exact file bytes restores the baseline stamp.
        target.write_bytes(original)
        assert stamp_service_worker(dist_dir) == baseline


def test_stamp_handles_missing_or_malformed_sw_js(tmp_path: Path) -> None:
    """Verify missing sw.js returns None and malformed sw.js raises ValueError."""
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    assert stamp_service_worker(empty_dir) is None

    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    (bad_dir / "sw.js").write_text("// missing tokens\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"CACHE_VERSION|APP_SHELL_ASSETS"):
        stamp_service_worker(bad_dir)

    missing_revs_dir = tmp_path / "missing_revs"
    missing_revs_dir.mkdir()
    (missing_revs_dir / "sw.js").write_text(
        'const CACHE_VERSION = "v1";\n'
        'const APP_SHELL_ASSETS = ["./", "./index.html"];\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="APP_SHELL_REVISIONS"):
        stamp_service_worker(missing_revs_dir)
