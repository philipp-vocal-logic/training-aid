# Copyright (c) 2026 Philipp Kaaden
"""Catalog exercise model and archetype coaching cue resolver."""

import functools
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_ANIMATIONS_JSON = DATA_DIR / "animations.json"
DEFAULT_EXERCISES_JSON = DATA_DIR / "exercises.json"

__all__ = [
    "DATA_DIR",
    "DEFAULT_ANIMATIONS_JSON",
    "DEFAULT_EXERCISES_JSON",
    "CatalogExercise",
    "build_exercise_metadata",
    "load_archetype_coaching",
]


@dataclass(frozen=True, slots=True)
class CatalogExercise:
    """Immutable catalog exercise record loaded from `data/exercises.json`."""

    id: str
    name: str
    category: str = "strength"
    equipment: str = "body only"
    primary_muscle: str = "other"
    archetype: str = "squat"
    is_hold: bool = False
    tempo_mode: str = "standard"
    is_alternating: bool = False


_DEFAULT_COACHING_META: dict[str, Any] = {
    "rep_seconds": 2.8,
    "is_hold": False,
    "how_to": "Hips back, chest up",
    "cue_work": "↓ Squat",
    "cue_return": "↑ Stand",
    "tempo_mode": "standard",
}


def load_archetype_coaching(
    animations_path: Path = DEFAULT_ANIMATIONS_JSON,
) -> dict[str, dict[str, Any]]:
    """Load archetype tempo, hold, and movement cue metadata from animations.json."""
    if not animations_path.exists():
        return {"squat": dict(_DEFAULT_COACHING_META)}
    try:
        raw = json.loads(animations_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"squat": dict(_DEFAULT_COACHING_META)}
    animations = raw.get("animations")
    if not isinstance(animations, dict):
        return {"squat": dict(_DEFAULT_COACHING_META)}
    loaded = {
        str(arch): dict(spec["coaching"])
        for arch, spec in animations.items()
        if isinstance(spec, dict) and isinstance(spec.get("coaching"), dict)
    }
    return loaded or {"squat": dict(_DEFAULT_COACHING_META)}


@functools.lru_cache(maxsize=1)
def _default_archetype_coaching() -> dict[str, dict[str, Any]]:
    return load_archetype_coaching()


def _resolve_non_hold_tempo(raw_tempo: str) -> str:
    return "standard" if raw_tempo == "hold" else raw_tempo


def build_exercise_metadata(
    exercise: CatalogExercise,
    *,
    archetype_coaching: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Resolve tempo pacing, units, and movement cues for a catalog exercise."""
    arch_meta_map = (
        archetype_coaching
        if archetype_coaching is not None
        else _default_archetype_coaching()
    )
    meta = arch_meta_map.get(exercise.archetype, _DEFAULT_COACHING_META)
    is_stretch = exercise.category.lower() == "stretching"
    is_hold = True if is_stretch else bool(exercise.is_hold)
    raw_tempo = str(exercise.tempo_mode or meta["tempo_mode"])
    tempo_mode = "hold" if is_hold else _resolve_non_hold_tempo(raw_tempo)

    return {
        "archetype": exercise.archetype,
        "rep_seconds": 1.0 if is_hold else meta["rep_seconds"],
        "is_hold": is_hold,
        "unit": "sec" if is_hold else "reps",
        "how_to": meta["how_to"],
        "cue_work": "Hold" if is_hold else meta["cue_work"],
        "cue_return": "Breathe" if is_hold else meta["cue_return"],
        "tempo_mode": tempo_mode,
        "is_alternating": bool(exercise.is_alternating),
    }
