# Copyright (c) 2026 Philipp Kaaden
"""Tests for deterministic Service Worker CACHE_VERSION content stamping."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import pytest

from training_aid.builder import (
    PWA_SRC_DIR,
    build_pwa,
    stamp_service_worker_cache_version,
)

if TYPE_CHECKING:
    from pathlib import Path

_STAMP_RE = re.compile(r"^v1-[0-9a-f]{12}$")


def test_build_pwa_stamps_deterministic_idempotent_sw_cache_version(
    tmp_path: Path,
) -> None:
    """Verify build_pwa stamps a deterministic SHA-256 digest into dist/sw.js."""
    dist_a = tmp_path / "dist_a"
    dist_b = tmp_path / "dist_b"

    summary_a = build_pwa(dist_a)
    summary_b = build_pwa(dist_b)

    version_a = summary_a["cache_version"]
    assert isinstance(version_a, str)
    assert _STAMP_RE.match(version_a) is not None
    assert summary_b["cache_version"] == version_a

    sw_dist_text = (dist_a / "sw.js").read_text(encoding="utf-8")
    assert f'var CACHE_VERSION = "{version_a}";' in sw_dist_text
    assert 'var CACHE_VERSION = "v1";' not in sw_dist_text

    # Source template in repository must remain unstamped.
    sw_src_text = (PWA_SRC_DIR / "sw.js").read_text(encoding="utf-8")
    assert 'var CACHE_VERSION = "v1";' in sw_src_text

    # Re-stamping an already-stamped bundle must be strictly idempotent.
    restamped = stamp_service_worker_cache_version(dist_a)
    assert restamped == version_a
    assert (dist_a / "sw.js").read_text(encoding="utf-8") == sw_dist_text


def test_stamp_changes_when_any_bundle_asset_changes(tmp_path: Path) -> None:
    """Verify editing JS, CSS, catalog JSON, or SVG thumbs rotates CACHE_VERSION."""
    dist_dir = tmp_path / "dist"
    baseline = build_pwa(dist_dir)["cache_version"]
    assert isinstance(baseline, str)

    seen_versions = {baseline}
    mutations = (
        dist_dir / "app.js",
        dist_dir / "static" / "style.css",
        dist_dir / "data" / "catalog.json",
        dist_dir / "svgs" / "thumbs" / "squat__barbell.svg",
    )
    for target in mutations:
        original = target.read_bytes()
        target.write_bytes(original + b"\n/* mutated */\n")
        rotated = stamp_service_worker_cache_version(dist_dir)
        assert isinstance(rotated, str)
        assert _STAMP_RE.match(rotated) is not None
        assert rotated not in seen_versions
        seen_versions.add(rotated)

        # Restoring exact file bytes restores the baseline stamp.
        target.write_bytes(original)
        assert stamp_service_worker_cache_version(dist_dir) == baseline


def test_stamp_handles_missing_or_malformed_sw_js(tmp_path: Path) -> None:
    """Verify missing sw.js returns None and malformed sw.js raises ValueError."""
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    assert stamp_service_worker_cache_version(empty_dir) is None

    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    (bad_dir / "sw.js").write_text("// missing cache version\n", encoding="utf-8")
    with pytest.raises(ValueError, match="CACHE_VERSION"):
        stamp_service_worker_cache_version(bad_dir)
