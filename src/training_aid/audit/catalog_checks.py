# Copyright (c) 2026 Philipp Kaaden
"""Catalog, coaching metadata, and declarative workout program audit checks."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from training_aid.audit.bundle_security import check_shell_and_privacy
from training_aid.audit.models import (
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_SVG_COMBO_COUNT,
    AuditConfig,
    AuditSectionResult,
)

try:
    from training_aid.compiler import (
        CATALOG_SCHEMA_VERSION,
        CatalogExercise,
        build_exercise_metadata,
        build_pwa,
        compute_required_equipment,
        load_catalog_exercises,
        load_programs_config,
    )
except ModuleNotFoundError:  # pragma: no cover
    CATALOG_SCHEMA_VERSION = 2

if TYPE_CHECKING:
    from pathlib import Path

    from training_aid.kinematics import AnimationRegistry

__all__ = [
    "EXPECTED_COMPILED_EXERCISE_KEYS",
    "EXPECTED_METADATA_KEYS",
    "EXPECTED_RAW_EXERCISE_KEYS",
    "audit_catalog_and_pwa_bundle",
    "audit_coaching_integration",
    "audit_programs_config",
]

EXPECTED_RAW_STRING_KEYS: tuple[str, ...] = (
    "id",
    "name",
    "category",
    "equipment",
    "primary_muscle",
    "archetype",
    "tempo_mode",
)
EXPECTED_RAW_BOOL_KEYS: tuple[str, ...] = ("is_hold", "is_alternating")
EXPECTED_RAW_EXERCISE_KEYS: frozenset[str] = frozenset(
    EXPECTED_RAW_STRING_KEYS + EXPECTED_RAW_BOOL_KEYS
)
EXPECTED_METADATA_KEYS: frozenset[str] = frozenset(
    {
        "archetype",
        "rep_seconds",
        "is_hold",
        "unit",
        "how_to",
        "cue_work",
        "cue_return",
        "tempo_mode",
        "is_alternating",
    }
)
EXPECTED_COMPILED_EXERCISE_KEYS: frozenset[str] = EXPECTED_METADATA_KEYS | frozenset(
    {
        "id",
        "name",
        "category",
        "equipment",
        "primary_muscle",
        "eq_mode",
        "svg_key",
        "thumb_url",
        "required_equipment",
    }
)
VALID_TEMPO_MODES: frozenset[str] = frozenset(
    {"standard", "explosive", "alternating", "hold"}
)
MIN_HOLD_REPS, MIN_WEIGHT_KG, MAX_WEIGHT_KG = 20, 2.0, 250.0
WEIGHTED_EQUIPMENT: frozenset[str] = frozenset(
    {"barbell", "dumbbell", "kettlebells", "cable", "machine", "e-z curl bar"}
)
_BASE_BODY_EQ: frozenset[str] = frozenset(
    {"body only", "foam roll", "exercise ball", "other"}
)
TIER_ALLOWED_EQUIPMENT: dict[str, frozenset[str] | None] = {
    "body_only": _BASE_BODY_EQ,
    "dumbbells": _BASE_BODY_EQ | {"dumbbell", "medicine ball"},
    "kettlebell_bands": _BASE_BODY_EQ | {"kettlebells", "bands"},
    "full_gym": None,
}


def _validate_raw_exercise_record(index: int, item: object) -> list[str]:
    """Validate schema and field types for a single raw exercises.json entry."""
    if not isinstance(item, dict):
        return [f"exercises.json[{index}] is not a JSON object"]
    if set(item.keys()) != EXPECTED_RAW_EXERCISE_KEYS:
        return [f"exercises.json[{index}] has unexpected keys: {sorted(item.keys())}"]
    errs = [
        f"exercises.json[{index}].{key} must be a non-empty string"
        for key in EXPECTED_RAW_STRING_KEYS
        if not isinstance(item.get(key), str) or not str(item.get(key)).strip()
    ]
    errs.extend(
        f"exercises.json[{index}].{key} must be a boolean"
        for key in EXPECTED_RAW_BOOL_KEYS
        if not isinstance(item.get(key), bool)
    )
    return errs


def _check_compiled_exercise_entry(
    item: object, svgs: dict[str, Any], dist_dir: Path
) -> list[str]:
    """Validate a single exercise object in compiled catalog.json."""
    if not isinstance(item, dict):
        return ["catalog.json contains a non-dict exercise entry"]
    errs: list[str] = []
    ex_id = item.get("id", "<unknown>")
    if set(item.keys()) != EXPECTED_COMPILED_EXERCISE_KEYS:
        errs.append(f"{ex_id}: compiled exercise keys mismatch")
    req_eq = item.get("required_equipment")
    if not isinstance(req_eq, list) or not all(isinstance(x, str) for x in req_eq):
        errs.append(f"{ex_id}: required_equipment must be a list[str]")
    if str(item.get("svg_key") or "") not in svgs:
        errs.append(f"{ex_id}: svg_key missing from catalog.svgs")
    thumb_rel = str(item.get("thumb_url") or "").removeprefix("./")
    if not thumb_rel or not (dist_dir / thumb_rel).is_file():
        errs.append(f"{ex_id}: missing thumbnail file '{thumb_rel}'")
    return errs


def _check_compiled_catalog_payload(
    dist_dir: Path,
    catalog: dict[str, Any],
    expected_ids: set[str],
    errors: list[str],
) -> None:
    """Validate compiled dist/data/catalog.json schema v2, SVGs, and thumbnails."""
    if catalog.get("schema_version") != CATALOG_SCHEMA_VERSION:
        errors.append(f"catalog.json schema_version={catalog.get('schema_version')}")

    programs = catalog.get("programs")
    if not isinstance(programs, dict) or set(programs.keys()) != {
        "equipment_programs",
        "intensity_labels",
    }:
        errors.append("catalog.json 'programs' keys mismatch")

    compiled = catalog.get("exercises")
    if not isinstance(compiled, list):
        errors.append("catalog.json 'exercises' is not a list")
        return

    svgs = catalog.get("svgs") if isinstance(catalog.get("svgs"), dict) else {}
    thumbs = list((dist_dir / "svgs" / "thumbs").glob("*.svg"))
    if len(compiled) != len(expected_ids):
        errors.append(f"catalog.json exercises count {len(compiled)} != expected")
    if len(svgs) != EXPECTED_SVG_COMBO_COUNT or not all(":" in str(k) for k in svgs):
        errors.append("catalog.json svgs count or 'arch:eq_mode' keys invalid")
    if len(thumbs) != EXPECTED_SVG_COMBO_COUNT:
        errors.append(f"dist/svgs/thumbs count {len(thumbs)} != 126")

    compiled_ids = {str(it.get("id") or "") for it in compiled if isinstance(it, dict)}
    if compiled_ids != expected_ids:
        errors.append("Compiled catalog.json IDs diverge from raw exercises.json IDs")

    for item in compiled:
        errors.extend(_check_compiled_exercise_entry(item, svgs, dist_dir))


def audit_catalog_and_pwa_bundle(
    cfg: AuditConfig, dist_dir: Path, *, reuse: bool
) -> tuple[AuditSectionResult, list[CatalogExercise], dict[str, Any]]:
    """Audit raw exercises.json, compiled catalog.json, and static PWA shell/privacy."""
    if not cfg.exercises_path.is_file():
        msg = f"Missing exercises catalog: {cfg.exercises_path}"
        return (AuditSectionResult("catalog_and_pwa_bundle", 0, (msg,)), [], {})

    raw_items = json.loads(cfg.exercises_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    if len(raw_items) != cfg.expected_count:
        errors.append(f"exercises.json count {len(raw_items)} != {cfg.expected_count}")
    for idx, item in enumerate(raw_items):
        errors.extend(_validate_raw_exercise_record(idx, item))

    raw_ids = {
        str(it.get("id") or "").strip() for it in raw_items if isinstance(it, dict)
    }
    if len(raw_ids) != len(raw_items):
        errors.append("Duplicate exercise IDs detected in exercises.json")

    exercises = load_catalog_exercises(cfg.exercises_path)
    fields_ok = all(
        getattr(ex, field, "").strip()
        for ex in exercises
        for field in EXPECTED_RAW_STRING_KEYS
    )
    if {ex.id for ex in exercises} != raw_ids or not fields_ok:
        errors.append("load_catalog_exercises ID mismatch or empty required string")

    if reuse:
        catalog = json.loads((dist_dir / "data" / "catalog.json").read_text("utf-8"))
    else:
        summary = build_pwa(
            dist_dir, data_dir=cfg.exercises_path.parent, pwa_dir=cfg.pwa_dir
        )
        catalog = summary["catalog"]

    _check_compiled_catalog_payload(dist_dir, catalog, raw_ids, errors)
    errors.extend(check_shell_and_privacy(dist_dir))
    section = AuditSectionResult(
        "catalog_and_pwa_bundle", len(exercises), tuple(errors)
    )
    return (section, exercises, catalog)


def _check_single_exercise_coaching(
    ex: CatalogExercise,
    meta: dict[str, Any],
    specs: dict[str, Any],
    compiled: dict[str, Any] | None,
) -> list[str]:
    """Validate coaching metadata and compiled parity for one catalog exercise."""
    errs: list[str] = []
    arch = str(meta.get("archetype") or "")
    tempo = str(meta.get("tempo_mode") or "")
    is_hold = bool(meta.get("is_hold"))

    if set(meta.keys()) != EXPECTED_METADATA_KEYS or arch not in specs:
        errs.append(f"{ex.id}: invalid metadata keys or archetype '{arch}'")
    if tempo not in VALID_TEMPO_MODES or is_hold != (tempo == "hold"):
        errs.append(f"{ex.id}: invalid tempo_mode='{tempo}' for is_hold={is_hold}")
    is_stretch = ex.category.lower() == "stretching"
    if (is_stretch and not is_hold) or (
        not is_stretch and (ex.is_hold != is_hold or ex.tempo_mode != tempo)
    ):
        errs.append(f"{ex.id}: hold/tempo metadata diverges from exercise record")
    errs.extend(
        f"{ex.id}: empty coaching field '{cue_key}'"
        for cue_key in ("how_to", "cue_work", "cue_return")
        if not str(meta.get(cue_key) or "").strip()
    )
    if compiled is not None:
        errs.extend(
            f"{ex.id}: compiled.{key} != metadata.{key}"
            for key in EXPECTED_METADATA_KEYS
            if compiled.get(key) != meta.get(key)
        )
        if compiled.get("required_equipment") != compute_required_equipment(ex):
            errs.append(f"{ex.id}: compiled required_equipment mismatch")
    return errs


def audit_coaching_integration(
    exercises: list[CatalogExercise],
    catalog: dict[str, Any],
    registry: AnimationRegistry,
) -> AuditSectionResult:
    """Verify archetype coaching cues, hold/tempo invariants, and compiled parity."""
    errors: list[str] = []
    specs, coaching = registry.specs, registry.coaching
    if len(specs) != EXPECTED_ARCHETYPE_COUNT or set(coaching) != set(specs):
        errors.append("AnimationRegistry coaching keys diverge from specs")

    compiled_map = {
        str(item["id"]): item
        for item in catalog.get("exercises", [])
        if isinstance(item, dict) and "id" in item
    }
    for ex in exercises:
        meta = build_exercise_metadata(ex, archetype_coaching=coaching)
        errors.extend(
            _check_single_exercise_coaching(ex, meta, specs, compiled_map.get(ex.id))
        )
    return AuditSectionResult("coaching_integration", len(exercises), tuple(errors))


def _check_program_slot(
    tier: str,
    allowed_eq: frozenset[str] | None,
    ex: CatalogExercise,
    reps: int,
    weight: float | None,
) -> list[str]:
    """Validate equipment, hold duration, and weight bounds for one routine slot."""
    errs: list[str] = []
    if allowed_eq is not None and ex.equipment not in allowed_eq:
        errs.append(f"programs.json[{tier}][{ex.id}]: disallowed equipment")
    if ex.is_hold and int(reps) < MIN_HOLD_REPS:
        errs.append(f"programs.json[{tier}][{ex.id}]: hold duration < {MIN_HOLD_REPS}s")
    if tier == "body_only" and weight is not None:
        errs.append(f"programs.json[{tier}][{ex.id}]: body_only slot has weight")
    if weight is not None and not (MIN_WEIGHT_KG <= float(weight) <= MAX_WEIGHT_KG):
        errs.append(f"programs.json[{tier}][{ex.id}]: weight {weight}kg out of bounds")
    if (
        tier != "body_only"
        and ex.equipment in WEIGHTED_EQUIPMENT
        and not ex.is_hold
        and weight is None
    ):
        errs.append(f"programs.json[{tier}][{ex.id}]: weighted slot missing weight")
    return errs


def audit_programs_config(
    cfg: AuditConfig, by_id: dict[str, CatalogExercise], specs: dict[str, Any]
) -> list[str]:
    """Validate declarative workout programs, tier equipment, and archetype coverage."""
    if not cfg.programs_path.is_file():
        return [f"Missing programs.json: {cfg.programs_path}"]

    raw_programs = json.loads(cfg.programs_path.read_text(encoding="utf-8"))
    errors = [
        f"programs.json must not contain legacy key '{dead_key}'"
        for dead_key in ("setup_equipment_props", "equipment_archetypes")
        if dead_key in raw_programs
    ]

    prog_cfg = load_programs_config(cfg.programs_path)
    if set(prog_cfg.keys()) != {"equipment_programs", "intensity_labels"}:
        errors.append("load_programs_config() keys mismatch")

    covered_archetypes: set[str] = set()
    for tier, prog in prog_cfg.get("equipment_programs", {}).items():
        allowed_eq = TIER_ALLOWED_EQUIPMENT.get(tier)
        for _routine_name, slot_specs in prog.get("routines", []):
            for ex_id, reps, weight in slot_specs:
                ex = by_id.get(str(ex_id))
                if ex is None:
                    errors.append(f"programs.json[{tier}]: unknown exercise '{ex_id}'")
                    continue
                covered_archetypes.add(ex.archetype)
                errors.extend(
                    _check_program_slot(tier, allowed_eq, ex, int(reps), weight)
                )

    if missing_archetypes := sorted(set(specs.keys()) - covered_archetypes):
        errors.append(f"programs.json missing archetypes: {missing_archetypes}")
    return errors
