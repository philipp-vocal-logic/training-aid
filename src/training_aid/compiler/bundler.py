# Copyright (c) 2026 Philipp Kaaden
"""Static PWA bundle emitter and idempotent Service Worker stamper."""

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

from training_aid.compiler.catalog_builder import (
    DATA_DIR,
    REPO_ROOT,
    build_catalog_payload,
)
from training_aid.kinematics import (
    CANONICAL_EQUIPMENT_MODES,
    AnimationRegistry,
    load_animation_registry,
    render_archetype_svg,
)

PACKAGE_DIR = Path(__file__).resolve().parents[1]
PWA_SRC_DIR = PACKAGE_DIR / "pwa"
DEFAULT_DIST_DIR = REPO_ROOT / "dist"

_SW_CACHE_VERSION_RE = re.compile(r'(CACHE_VERSION\s*=\s*")v1(?:-[0-9a-f]{12})?(")')
_SW_ASSETS_RE = re.compile(r"(APP_SHELL_ASSETS\s*=\s*)\[[^\]]*\]", flags=re.DOTALL)
_IGNORED_BUNDLE_SUFFIXES = frozenset({".pyc", ".pyo"})

__all__ = [
    "DEFAULT_DIST_DIR",
    "PWA_SRC_DIR",
    "build_pwa",
    "stamp_service_worker",
]


def _copy_asset_tree(src_dir: Path, dst_dir: Path) -> None:
    if not src_dir.is_dir():
        return
    shutil.copytree(
        src_dir,
        dst_dir,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )


def _write_equipment_thumbnails(
    thumbs_dir: Path,
    registry: AnimationRegistry,
) -> list[Path]:
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for arch in registry.specs:
        for eq_mode in CANONICAL_EQUIPMENT_MODES:
            target = thumbs_dir / f"{arch}__{eq_mode}.svg"
            target.write_text(
                render_archetype_svg(
                    arch,
                    equipment=eq_mode,
                    thumbnail=True,
                    registry=registry,
                ),
                encoding="utf-8",
            )
            written.append(target)
    return written


def stamp_service_worker(output_dir: Path) -> str | None:
    """Stamp deterministic `APP_SHELL_ASSETS` and `CACHE_VERSION` into `sw.js`.

    Normalizes `sw.js` back to its canonical template (`CACHE_VERSION = "v1"` and
    `APP_SHELL_ASSETS = ["./", "./index.html"]`) before hashing the normalized
    Service Worker and every file in `output_dir`, making repeated calls
    idempotent.

    Args:
        output_dir: Compiled PWA bundle directory containing `sw.js`.

    Returns:
        Stamped `CACHE_VERSION` string (e.g. `"v1-a1b2c3d4e5f6"`), or `None` if
        `sw.js` is not present in `output_dir`.

    Raises:
        ValueError: If `sw.js` lacks `CACHE_VERSION` or `APP_SHELL_ASSETS`.
    """
    out_dir = Path(output_dir)
    sw_path = out_dir / "sw.js"
    if not sw_path.is_file():
        return None

    raw_sw = sw_path.read_text(encoding="utf-8")
    sw_template, ver_count = _SW_CACHE_VERSION_RE.subn(r"\g<1>v1\g<2>", raw_sw, count=1)
    if ver_count != 1:
        msg = f"Expected CACHE_VERSION = 'v1' declaration in {sw_path}"
        raise ValueError(msg)

    sw_template, assets_count = _SW_ASSETS_RE.subn(
        r'\g<1>["./", "./index.html"]',
        sw_template,
        count=1,
    )
    if assets_count != 1:
        msg = f"Expected APP_SHELL_ASSETS = [...] declaration in {sw_path}"
        raise ValueError(msg)

    hasher = hashlib.sha256()
    sw_bytes = sw_template.encode("utf-8")
    hasher.update(f"sw.js:{len(sw_bytes)}\0".encode())
    hasher.update(sw_bytes)

    bundle_files = sorted(
        (
            (path.relative_to(out_dir).as_posix(), path)
            for path in out_dir.rglob("*")
            if path.is_file()
            and path != sw_path
            and "__pycache__" not in path.parts
            and path.suffix not in _IGNORED_BUNDLE_SUFFIXES
        ),
        key=lambda item: item[0],
    )
    for rel_posix, file_path in bundle_files:
        content = file_path.read_bytes()
        hasher.update(f"{rel_posix}:{len(content)}\0".encode())
        hasher.update(content)

    cache_version = f"v1-{hasher.hexdigest()[:12]}"
    shell_assets = [
        "./",
        *(
            f"./{rel_posix}"
            for rel_posix, _ in bundle_files
            if not rel_posix.startswith("svgs/thumbs/")
        ),
    ]
    assets_json = json.dumps(shell_assets, indent=2)

    stamped_sw = _SW_CACHE_VERSION_RE.sub(
        rf"\g<1>{cache_version}\g<2>",
        sw_template,
        count=1,
    )
    stamped_sw = _SW_ASSETS_RE.sub(
        lambda match: f"{match.group(1)}{assets_json}",
        stamped_sw,
        count=1,
    )
    sw_path.write_text(stamped_sw, encoding="utf-8", newline="\n")
    return cache_version


def build_pwa(
    output_dir: Path = DEFAULT_DIST_DIR,
    *,
    data_dir: Path = DATA_DIR,
    pwa_dir: Path = PWA_SRC_DIR,
) -> dict[str, Any]:
    """Compile the complete zero-backend static PWA bundle into `output_dir`."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if pwa_dir.is_dir() and any(pwa_dir.iterdir()):
        _copy_asset_tree(pwa_dir, out_dir)

    registry = load_animation_registry(data_dir / "animations.json")
    thumb_paths = _write_equipment_thumbnails(
        out_dir / "svgs" / "thumbs",
        registry,
    )

    catalog = build_catalog_payload(data_dir=data_dir, registry=registry)
    catalog_dir = out_dir / "data"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = catalog_dir / "catalog.json"
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    cache_version = stamp_service_worker(out_dir)

    return {
        "output_dir": out_dir,
        "catalog_path": catalog_path,
        "cache_version": cache_version,
        "exercise_count": len(catalog["exercises"]),
        "thumbnail_count": len(thumb_paths),
        "svg_count": len(catalog["svgs"]),
        "catalog": catalog,
    }
