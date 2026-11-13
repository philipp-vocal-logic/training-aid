# Copyright (c) 2026 Philipp Kaaden
"""Build-time static compiler for the zero-backend Training Aid PWA."""

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

from training_aid.coaching import (
    CatalogExercise,
    build_exercise_metadata,
    load_archetype_coaching,
    load_exercise_coaching,
)
from training_aid.svg_assets import (
    CANONICAL_EQUIPMENT_MODES,
    SVGS_DIR,
    load_animation_registry,
    normalize_equipment,
    pregenerate_all_svgs,
    render_archetype_svg,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_SRC_DIR = PACKAGE_DIR / "static"
PWA_SRC_DIR = PACKAGE_DIR / "pwa"
DEFAULT_DIST_DIR = REPO_ROOT / "dist"

DEFAULT_EXERCISES_JSON = DATA_DIR / "exercises.json"
DEFAULT_PROGRAMS_JSON = DATA_DIR / "programs.json"
DEFAULT_ANIMATIONS_JSON = DATA_DIR / "animations.json"
DEFAULT_EXERCISE_COACHING_JSON = DATA_DIR / "exercise_coaching.json"

CATALOG_SCHEMA_VERSION = 1
_SW_CACHE_VERSION_RE = re.compile(r'(CACHE_VERSION\s*=\s*")v1(?:-[0-9a-f]{12})?(")')
_IGNORED_BUNDLE_SUFFIXES = frozenset({".pyc", ".pyo"})

__all__ = [
    "CANONICAL_EQUIPMENT_MODES",
    "CATALOG_SCHEMA_VERSION",
    "DATA_DIR",
    "DEFAULT_DIST_DIR",
    "PWA_SRC_DIR",
    "STATIC_SRC_DIR",
    "CatalogExercise",
    "build_catalog_payload",
    "build_pwa",
    "load_catalog_exercises",
    "load_programs_config",
    "stamp_service_worker_cache_version",
]


def load_catalog_exercises(
    exercises_path: Path = DEFAULT_EXERCISES_JSON,
) -> list[CatalogExercise]:
    """Load and normalize all catalog exercises from exercises.json."""
    raw_items = json.loads(exercises_path.read_text(encoding="utf-8"))
    exercises: list[CatalogExercise] = []
    for item in raw_items:
        primary_list = item.get("primaryMuscles") or []
        secondary_list = item.get("secondaryMuscles") or []
        exercises.append(
            CatalogExercise(
                id=str(item["id"]),
                name=str(item["name"]),
                category=str(item.get("category") or "strength"),
                level=str(item.get("level") or "beginner"),
                equipment=str(item.get("equipment") or "body only"),
                primary_muscle=str(primary_list[0]) if primary_list else "other",
                secondary_muscles=", ".join(str(m) for m in secondary_list),
                instructions=tuple(
                    str(step) for step in (item.get("instructions") or [])
                ),
            )
        )
    return exercises


def load_programs_config(
    programs_path: Path = DEFAULT_PROGRAMS_JSON,
) -> dict[str, Any]:
    """Load declarative workout programs, intensity labels, and setup presets."""
    raw = json.loads(programs_path.read_text(encoding="utf-8"))
    equipment_programs: dict[str, dict[str, Any]] = {}
    for eq_key, prog in raw["equipment_programs"].items():
        routines = [
            [
                str(routine_name),
                [
                    [
                        str(ex_id),
                        int(reps),
                        float(weight) if weight is not None else None,
                    ]
                    for ex_id, reps, weight in specs
                ],
            ]
            for routine_name, specs in prog["routines"]
        ]
        equipment_programs[str(eq_key)] = {
            "label": str(prog["label"]),
            "routines": routines,
        }
    return {
        "equipment_programs": equipment_programs,
        "intensity_labels": {
            str(k): str(v) for k, v in raw["intensity_labels"].items()
        },
        "equipment_archetypes": {
            str(k): str(v) for k, v in raw["equipment_archetypes"].items()
        },
        "setup_equipment_props": {
            str(k): str(v) for k, v in raw["setup_equipment_props"].items()
        },
    }


def _compile_exercise_record(
    exercise: CatalogExercise,
    *,
    archetype_specs: dict[str, dict[str, Any]],
    coaching_map: dict[str, dict[str, Any]],
    archetype_coaching: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    meta = build_exercise_metadata(
        exercise,
        coaching_map=coaching_map,
        archetype_coaching=archetype_coaching,
    )
    raw_arch = str(meta["archetype"])
    archetype = raw_arch if raw_arch in archetype_specs else "squat"
    eq_mode = normalize_equipment(exercise.equipment, archetype)
    return {
        "id": exercise.id,
        "name": exercise.name,
        "category": exercise.category,
        "level": exercise.level,
        "equipment": exercise.equipment,
        "primary_muscle": exercise.primary_muscle,
        "secondary_muscles": exercise.secondary_muscles,
        "archetype": archetype,
        "eq_mode": eq_mode,
        "svg_key": f"{archetype}:{eq_mode}",
        "thumb_url": f"./svgs/thumbs/{archetype}__{eq_mode}.svg",
        "rep_seconds": float(meta["rep_seconds"]),
        "is_hold": bool(meta["is_hold"]),
        "unit": str(meta["unit"]),
        "how_to": str(meta["how_to"]),
        "instructions": list(meta["instructions"]),
        "cue_work": str(meta["cue_work"]),
        "cue_return": str(meta["cue_return"]),
        "tempo_mode": str(meta["tempo_mode"]),
        "is_alternating": bool(meta["is_alternating"]),
    }


def _build_animated_svgs(
    archetype_specs: dict[str, dict[str, Any]],
) -> dict[str, str]:
    svgs: dict[str, str] = {}
    for arch, spec in archetype_specs.items():
        for eq_mode in CANONICAL_EQUIPMENT_MODES:
            svgs[f"{arch}:{eq_mode}"] = render_archetype_svg(
                arch,
                equipment=eq_mode,
                thumbnail=False,
            )
        default_eq = normalize_equipment(str(spec["default_equipment"]), arch)
        svgs[arch] = svgs[f"{arch}:{default_eq}"]
    return svgs


def _write_equipment_thumbnails(
    thumbs_dir: Path,
    archetype_specs: dict[str, dict[str, Any]],
) -> list[Path]:
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for arch in archetype_specs:
        for eq_mode in CANONICAL_EQUIPMENT_MODES:
            target = thumbs_dir / f"{arch}__{eq_mode}.svg"
            target.write_text(
                render_archetype_svg(arch, equipment=eq_mode, thumbnail=True),
                encoding="utf-8",
            )
            written.append(target)
    return written


def build_catalog_payload(data_dir: Path = DATA_DIR) -> dict[str, Any]:
    """Compile exercises, programs, and animated SVGs into the catalog JSON dict."""
    animations_path = data_dir / "animations.json"
    coaching_path = data_dir / "exercise_coaching.json"
    exercises_path = data_dir / "exercises.json"
    programs_path = data_dir / "programs.json"

    _std_bones, _aliases, archetype_specs = load_animation_registry(animations_path)
    archetype_coaching = load_archetype_coaching(animations_path)
    coaching_map = load_exercise_coaching(coaching_path)
    exercises = load_catalog_exercises(exercises_path)
    programs = load_programs_config(programs_path)

    exercises_payload = [
        _compile_exercise_record(
            exercise,
            archetype_specs=archetype_specs,
            coaching_map=coaching_map,
            archetype_coaching=archetype_coaching,
        )
        for exercise in exercises
    ]
    svgs = _build_animated_svgs(archetype_specs)
    return {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "exercises": exercises_payload,
        "programs": programs,
        "svgs": svgs,
    }


def _copy_asset_tree(src_dir: Path, dst_dir: Path) -> None:
    if not src_dir.is_dir():
        return
    shutil.copytree(
        src_dir,
        dst_dir,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )


def stamp_service_worker_cache_version(output_dir: Path) -> str | None:
    """Stamp a deterministic SHA-256 asset digest into `output_dir / 'sw.js'`.

    Computes a SHA-256 digest across the normalized Service Worker template and
    every compiled file in `output_dir` (sorted by POSIX relative path) and
    rewrites `CACHE_VERSION` to `"v1-<12hex>"`.

    Args:
        output_dir: Compiled PWA bundle directory containing `sw.js`.

    Returns:
        Stamped `CACHE_VERSION` string (e.g. `"v1-a1b2c3d4e5f6"`), or `None` if
        `sw.js` is not present in `output_dir`.

    Raises:
        ValueError: If `sw.js` exists but lacks a `CACHE_VERSION = "v1"` token.
    """
    out_dir = Path(output_dir)
    sw_path = out_dir / "sw.js"
    if not sw_path.is_file():
        return None

    raw_sw = sw_path.read_text(encoding="utf-8")
    sw_template, count = _SW_CACHE_VERSION_RE.subn(r"\g<1>v1\g<2>", raw_sw, count=1)
    if count != 1:
        msg = f"Expected CACHE_VERSION = 'v1' declaration in {sw_path}"
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
    stamped_sw = _SW_CACHE_VERSION_RE.sub(
        rf"\g<1>{cache_version}\g<2>",
        sw_template,
        count=1,
    )
    sw_path.write_text(stamped_sw, encoding="utf-8", newline="\n")
    return cache_version


def build_pwa(
    output_dir: Path = DEFAULT_DIST_DIR,
    *,
    data_dir: Path = DATA_DIR,
    static_dir: Path = STATIC_SRC_DIR,
    pwa_dir: Path = PWA_SRC_DIR,
) -> dict[str, Any]:
    """Compile the complete zero-backend static PWA bundle into `output_dir`."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if static_dir == STATIC_SRC_DIR and not all(
        (SVGS_DIR / f"{arch}.svg").exists()
        for arch in load_animation_registry(data_dir / "animations.json")[2]
    ):
        pregenerate_all_svgs(SVGS_DIR)

    _copy_asset_tree(static_dir, out_dir / "static")
    pregenerate_all_svgs(out_dir / "static" / "svgs")

    if pwa_dir.is_dir() and any(pwa_dir.iterdir()):
        _copy_asset_tree(pwa_dir, out_dir)

    _std_bones, _aliases, archetype_specs = load_animation_registry(
        data_dir / "animations.json"
    )
    thumb_paths = _write_equipment_thumbnails(
        out_dir / "svgs" / "thumbs",
        archetype_specs,
    )

    catalog = build_catalog_payload(data_dir=data_dir)
    catalog_dir = out_dir / "data"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = catalog_dir / "catalog.json"
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    cache_version = stamp_service_worker_cache_version(out_dir)

    return {
        "output_dir": out_dir,
        "catalog_path": catalog_path,
        "cache_version": cache_version,
        "exercise_count": len(catalog["exercises"]),
        "thumbnail_count": len(thumb_paths),
        "svg_count": len(catalog["svgs"]),
        "catalog": catalog,
    }
