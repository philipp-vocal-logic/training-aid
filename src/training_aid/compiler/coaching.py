# Copyright (c) 2026 Philipp Kaaden
"""Catalog exercise model and archetype coaching cue resolver."""

from dataclasses import dataclass
from typing import Any

__all__ = [
    "CatalogExercise",
    "build_exercise_metadata",
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


def _resolve_non_hold_tempo(raw_tempo: str) -> str:
    return "standard" if raw_tempo == "hold" else raw_tempo


def build_exercise_metadata(
    exercise: CatalogExercise,
    *,
    archetype_coaching: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Resolve tempo pacing, units, and movement cues for a catalog exercise."""
    meta = archetype_coaching.get(exercise.archetype, _DEFAULT_COACHING_META)
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
