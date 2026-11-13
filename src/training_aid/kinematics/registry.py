# Copyright (c) 2026 Philipp Kaaden
"""Animation registry loader and equipment mode normalizer."""

import functools
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from training_aid.kinematics.ik_compiler import compile_animation_spec

ANIMATIONS_JSON = Path(__file__).resolve().parents[3] / "data" / "animations.json"

CANONICAL_EQUIPMENT_MODES: tuple[str, ...] = (
    "body_only",
    "barbell",
    "dumbbell",
    "kettlebells",
    "bands",
    "cable",
    "machine",
)

__all__ = [
    "ANIMATIONS_JSON",
    "CANONICAL_EQUIPMENT_MODES",
    "AnimationRegistry",
    "get_default_registry",
    "load_animation_registry",
    "normalize_equipment",
]


@dataclass(frozen=True, slots=True)
class AnimationRegistry:
    """Immutable compiled animation registry loaded from `data/animations.json`."""

    std_bones: dict[str, float]
    prop_geometry: dict[str, dict[str, float]]
    equipment_aliases: dict[str, str]
    specs: dict[str, dict[str, Any]]
    coaching: dict[str, dict[str, Any]]


def load_animation_registry(
    path: Path = ANIMATIONS_JSON,
) -> AnimationRegistry:
    """Load standard bones, prop geometry, equipment aliases, specs, and coaching."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    std_bones = {str(k): float(v) for k, v in raw["std_bones"].items()}
    prop_geometry = {
        str(k): {str(pk): float(pv) for pk, pv in props.items()}
        for k, props in raw["prop_geometry"].items()
    }
    aliases = {str(k): str(v) for k, v in raw["equipment_aliases"].items()}
    specs = {
        str(arch): compile_animation_spec(cfg, std_bones)
        for arch, cfg in raw["animations"].items()
    }
    coaching = {arch: dict(spec["coaching"]) for arch, spec in specs.items()}
    return AnimationRegistry(
        std_bones=std_bones,
        prop_geometry=prop_geometry,
        equipment_aliases=aliases,
        specs=specs,
        coaching=coaching,
    )


@functools.lru_cache(maxsize=1)
def get_default_registry() -> AnimationRegistry:
    """Return the cached default `AnimationRegistry` loaded from `ANIMATIONS_JSON`."""
    return load_animation_registry()


def normalize_equipment(
    equipment: str | None,
    archetype: str = "squat",
    *,
    registry: AnimationRegistry | None = None,
) -> str:
    """Normalize raw equipment text into a supported SVG prop mode."""
    reg = registry if registry is not None else get_default_registry()
    spec = reg.specs.get(archetype, reg.specs["squat"])
    default_eq = str(spec["default_equipment"])
    if equipment is None:
        return default_eq

    raw = equipment.strip().lower().replace("-", "_").replace(" ", "_")
    if not raw:
        return "body_only"
    return reg.equipment_aliases.get(raw, default_eq)
