# Copyright (c) 2026 Philipp Kaaden
"""Catalog exercise model and archetype coaching cue resolver."""

import re
from dataclasses import dataclass
from typing import Any

__all__ = [
    "VALID_UNILATERAL_MODES",
    "CatalogExercise",
    "build_exercise_metadata",
    "resolve_unilateral_mode",
]

VALID_UNILATERAL_MODES: frozenset[str] = frozenset(
    {"none", "arm_single", "arm_pair", "leg", "side"}
)

_NATIVE_ALTERNATING_ARCHETYPES: frozenset[str] = frozenset(
    {"mountain_climber", "bicycle_crunch"}
)
_SINGLE_LEG_ARCHETYPES: frozenset[str] = frozenset(
    {"single_leg_bridge", "single_leg_hinge", "single_leg_squat", "lunge"}
)
_ONE_ARM_RE = re.compile(
    r"(?:^|[_-])(?:one|single)[_-](?:arm|hand(?:ed)?)(?:$|[_-])",
    re.IGNORECASE,
)

_SIDE_EXERCISE_IDS: frozenset[str] = frozenset(
    {
        "Alternate_Heel_Touchers",
        "Barbell_Side_Bend",
        "Bosu_Ball_Cable_Crunch_With_Side_Bends",
        "Decline_Oblique_Crunch",
        "Dumbbell_Side_Bend",
        "Isometric_Neck_Exercise_-_Sides",
        "Kneeling_Cable_Crunch_With_Alternating_Oblique_Twists",
        "Landmine_180s",
        "Lying_Prone_Quadriceps",
        "Oblique_Crunches",
        "Oblique_Crunches_-_On_The_Floor",
        "On_Your_Side_Quad_Stretch",
        "One-Arm_High-Pulley_Cable_Side_Bends",
        "One_Half_Locust",
        "One_Knee_To_Chest",
        "Pallof_Press",
        "Pallof_Press_With_Rotation",
        "Push_Up_to_Side_Plank",
        "Side-Lying_Floor_Stretch",
        "Side_Bridge",
        "Side_Jackknife",
        "Side_Neck_Stretch",
        "Side_To_Side_Chins",
        "Side_Wrist_Pull",
        "Standing_Cable_Wood_Chop",
        "Tricep_Side_Stretch",
        "Weighted_Ball_Side_Bend",
    }
)

_ARM_PAIR_IDS: frozenset[str] = frozenset(
    {
        "Alternate_Hammer_Curl",
        "Alternate_Incline_Dumbbell_Curl",
        "Alternating_Cable_Shoulder_Press",
        "Alternating_Deltoid_Raise",
        "Alternating_Floor_Press",
        "Alternating_Hang_Clean",
        "Alternating_Kettlebell_Press",
        "Alternating_Kettlebell_Row",
        "Alternating_Renegade_Row",
        "Double_Kettlebell_Alternating_Hang_Clean",
        "Dumbbell_Alternate_Bicep_Curl",
        "Kettlebell_Seesaw_Press",
        "See-Saw_Press_Alternating_Side_Press",
        "Standing_Alternating_Dumbbell_Press",
    }
)

_ARM_SINGLE_IDS: frozenset[str] = frozenset(
    {
        "Advanced_Kettlebell_Windmill",
        "Bent_Over_Low-Pulley_Side_Lateral",
        "Bent_Press",
        "Cable_Seated_Lateral_Raise",
        "Concentration_Curls",
        "Cross_Body_Hammer_Curl",
        "Kettlebell_Windmill",
        "Landmine_Linear_Jammer",
        "One_Arm_Against_Wall",
        "Shotgun_Row",
        "Standing_Concentration_Curl",
        "Standing_Low-Pulley_Deltoid_Raise",
        "Tricep_Dumbbell_Kickback",
    }
)

_UNILATERAL_LEG_IDS: frozenset[str] = frozenset(
    {
        "Alternate_Leg_Diagonal_Bound",
        "Band_Hip_Adductions",
        "Barbell_Side_Split_Squat",
        "Cable_Hip_Adduction",
        "Carioca_Quick_Step",
        "Dumbbell_Seated_One-Leg_Calf_Raise",
        "Lateral_Bound",
        "Lateral_Box_Jump",
        "Lateral_Cone_Hops",
        "Scissors_Jump",
        "Side_Leg_Raises",
        "Side_Lying_Groin_Stretch",
        "Single-Leg_Leg_Extension",
        "Split_Jump",
        "Stride_Jump_Crossover",
    }
)


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


def resolve_unilateral_mode(exercise: CatalogExercise) -> str:
    """Derive deterministic `unilateral_mode` from exercise identity and archetype."""
    ex_id = exercise.id
    if (
        exercise.tempo_mode == "alternating"
        or exercise.archetype in _NATIVE_ALTERNATING_ARCHETYPES
        or ex_id == "Double_Kettlebell_Windmill"
    ):
        return "none"
    if ex_id in _SIDE_EXERCISE_IDS:
        return "side"
    if exercise.archetype in _SINGLE_LEG_ARCHETYPES or ex_id in _UNILATERAL_LEG_IDS:
        return "leg"
    if ex_id in _ARM_PAIR_IDS:
        return "arm_pair"
    if ex_id in _ARM_SINGLE_IDS or _ONE_ARM_RE.search(ex_id):
        return "arm_single"
    return "none"


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
        "unilateral_mode": resolve_unilateral_mode(exercise),
    }
