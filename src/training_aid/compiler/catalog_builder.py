# Copyright (c) 2026 Philipp Kaaden
"""Catalog exercise, program config, and animated SVG payload compiler."""

import json
import re
from pathlib import Path
from typing import Any

from training_aid.compiler.coaching import CatalogExercise, build_exercise_metadata
from training_aid.kinematics import (
    CANONICAL_EQUIPMENT_MODES,
    AnimationRegistry,
    load_animation_registry,
    normalize_equipment,
    render_archetype_svg,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"
DEFAULT_EXERCISES_JSON = DATA_DIR / "exercises.json"
DEFAULT_PROGRAMS_JSON = DATA_DIR / "programs.json"
DEFAULT_ANIMATIONS_JSON = DATA_DIR / "animations.json"

CATALOG_SCHEMA_VERSION = 2

_OTHER_EQ: frozenset[str] = frozenset(
    {"other", "medicine ball", "exercise ball", "foam roll"}
)
_EQUIPMENT_MAP: dict[str, str] = {
    "dumbbell": "dumbbell",
    "kettlebells": "kettlebells",
    "bands": "bands",
    "barbell": "barbell",
    "e-z curl bar": "barbell",
    "cable": "machine",
    "machine": "machine",
}
_PULL_UP_BAR_RE = re.compile(r"pull-?ups?|chin-?ups?|inverted row", re.IGNORECASE)
_BENCH_FREE_EQ: frozenset[str] = frozenset({"machine"})
_EXPLICIT_BENCH_RE = re.compile(r"\b(?:bench|incline|decline)\b", re.IGNORECASE)
_BENCH_RE = re.compile(
    r"\bbench\b|\b(?:dumbbell|incline|decline)\s+flye?s?\b|\baround the worlds\b",
    re.IGNORECASE,
)
_NO_BENCH_RE = re.compile(r"\bfloor\b|no hyperextension bench", re.IGNORECASE)

__all__ = [
    "CATALOG_SCHEMA_VERSION",
    "DATA_DIR",
    "DEFAULT_ANIMATIONS_JSON",
    "DEFAULT_EXERCISES_JSON",
    "DEFAULT_PROGRAMS_JSON",
    "build_catalog_payload",
    "compute_required_equipment",
    "load_catalog_exercises",
    "load_programs_config",
]


def compute_required_equipment(exercise: CatalogExercise) -> list[str]:
    """Derive canonical required equipment IDs (plus fixture props) for an exercise."""
    raw_eq = exercise.equipment.strip().lower()
    arch = exercise.archetype.lower()
    name = exercise.name
    if raw_eq in _OTHER_EQ:
        if raw_eq == "other" and (arch == "pull_up" or _PULL_UP_BAR_RE.search(name)):
            if "rope" in name.lower():
                return ["__other__"]
            req = ["pull_up_bar"]
            if "band" in name.lower():
                req.append("bands")
            return req
        return ["__other__"]

    required: list[str] = []
    if mapped := _EQUIPMENT_MAP.get(raw_eq):
        required.append(mapped)

    if raw_eq == "body only" and (
        arch in {"pull_up", "vertical_pull"} or _PULL_UP_BAR_RE.search(name)
    ):
        required.append("pull_up_bar")
    if raw_eq not in _BENCH_FREE_EQ and not _NO_BENCH_RE.search(name):
        needs_bench = (
            bool(_EXPLICIT_BENCH_RE.search(name))
            if raw_eq in {"cable", "bands"}
            else (arch in {"bench_press", "dip"} or bool(_BENCH_RE.search(name)))
        )
        if needs_bench:
            required.append("bench")

    return list(dict.fromkeys(required))


def load_catalog_exercises(
    exercises_path: Path = DEFAULT_EXERCISES_JSON,
) -> list[CatalogExercise]:
    """Load all catalog exercises from `exercises.json`."""
    raw_items = json.loads(exercises_path.read_text(encoding="utf-8"))
    return [
        CatalogExercise(
            id=str(item["id"]),
            name=str(item["name"]),
            category=str(item.get("category") or "strength"),
            equipment=str(item.get("equipment") or "body only"),
            primary_muscle=str(item.get("primary_muscle") or "other"),
            archetype=str(item.get("archetype") or "squat"),
            is_hold=bool(item.get("is_hold", False)),
            tempo_mode=str(item.get("tempo_mode") or "standard"),
            is_alternating=bool(item.get("is_alternating", False)),
        )
        for item in raw_items
    ]


def load_programs_config(
    programs_path: Path = DEFAULT_PROGRAMS_JSON,
) -> dict[str, Any]:
    """Load declarative workout programs and intensity labels."""
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
    }


def _compile_exercise_record(
    exercise: CatalogExercise,
    *,
    registry: AnimationRegistry,
) -> dict[str, Any]:
    meta = build_exercise_metadata(
        exercise,
        archetype_coaching=registry.coaching,
    )
    raw_arch = str(meta["archetype"])
    archetype = raw_arch if raw_arch in registry.specs else "squat"
    eq_mode = normalize_equipment(exercise.equipment, archetype, registry=registry)
    return {
        "id": exercise.id,
        "name": exercise.name,
        "category": exercise.category,
        "equipment": exercise.equipment,
        "primary_muscle": exercise.primary_muscle,
        "archetype": archetype,
        "eq_mode": eq_mode,
        "svg_key": f"{archetype}:{eq_mode}",
        "thumb_url": f"./svgs/thumbs/{archetype}__{eq_mode}.svg",
        "rep_seconds": float(meta["rep_seconds"]),
        "is_hold": bool(meta["is_hold"]),
        "unit": str(meta["unit"]),
        "how_to": str(meta["how_to"]),
        "cue_work": str(meta["cue_work"]),
        "cue_return": str(meta["cue_return"]),
        "tempo_mode": str(meta["tempo_mode"]),
        "is_alternating": bool(meta["is_alternating"]),
        "unilateral_mode": str(meta["unilateral_mode"]),
        "required_equipment": compute_required_equipment(exercise),
    }


def _build_animated_svgs(registry: AnimationRegistry) -> dict[str, str]:
    svgs: dict[str, str] = {}
    for arch in registry.specs:
        for eq_mode in CANONICAL_EQUIPMENT_MODES:
            svgs[f"{arch}:{eq_mode}"] = render_archetype_svg(
                arch,
                equipment=eq_mode,
                thumbnail=False,
                registry=registry,
            )
    return svgs


def build_catalog_payload(
    data_dir: Path = DATA_DIR,
    *,
    registry: AnimationRegistry | None = None,
) -> dict[str, Any]:
    """Compile exercises, programs, and animated SVGs into the catalog JSON dict."""
    reg = (
        registry
        if registry is not None
        else load_animation_registry(data_dir / "animations.json")
    )
    exercises = load_catalog_exercises(data_dir / "exercises.json")
    programs = load_programs_config(data_dir / "programs.json")

    exercises_payload = [
        _compile_exercise_record(exercise, registry=reg) for exercise in exercises
    ]
    svgs = _build_animated_svgs(reg)
    return {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "exercises": exercises_payload,
        "programs": programs,
        "svgs": svgs,
    }
