# Copyright (c) 2026 Philipp Kaaden
"""Movement archetype taxonomy, tempo cues, and SVG guidance builders."""

import inspect
import json
import re
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from training_aid import svg_assets
from training_aid.models import Exercise
from training_aid.svg_assets import load_svg_markup

DEFAULT_EXERCISES_JSON = Path(__file__).resolve().parents[2] / "data" / "exercises.json"

_ROW_WORD_RE = re.compile(r"\b(?:rows?|rowing)\b")
_CHIN_WORD_RE = re.compile(r"\bchins?\b")

type _ArchetypePredicate = Callable[[str, str, str], bool]

HOLD_KEYWORDS: tuple[str, ...] = (
    "plank",
    "wall sit",
    "isometric",
    "l-sit",
    "l sit",
    "dead hang",
)

EXPLOSIVE_KEYWORDS: tuple[str, ...] = (
    "jump",
    "plyo",
    "swing",
    "snatch",
    "clean",
    "jerk",
    "push press",
)

ALTERNATING_KEYWORDS: tuple[str, ...] = (
    "alternat",
    "one-arm",
    "one arm",
    "single-arm",
    "single arm",
    "single-leg",
    "single leg",
    "one-leg",
    "one leg",
    "walking lunge",
)

ARCHETYPE_COACHING: dict[str, dict[str, Any]] = {
    "squat": {
        "rep_seconds": 2.8,
        "is_hold": False,
        "how_to": "Hips back, chest up",
        "cue_work": "↓ Squat",
        "cue_return": "↑ Stand",
        "tempo_mode": "standard",
    },
    "lunge": {
        "rep_seconds": 2.8,
        "is_hold": False,
        "how_to": "Drop back knee, drive up",
        "cue_work": "↓ Lunge",
        "cue_return": "↑ Rise",
        "tempo_mode": "standard",
    },
    "pushup": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Body straight, chest down",
        "cue_work": "↓ Lower",
        "cue_return": "↑ Press",
        "tempo_mode": "standard",
    },
    "plank": {
        "rep_seconds": 1.0,
        "is_hold": True,
        "how_to": "Straight line, core braced",
        "cue_work": "Hold",
        "cue_return": "Breathe",
        "tempo_mode": "hold",
    },
    "hinge": {
        "rep_seconds": 3.0,
        "is_hold": False,
        "how_to": "Flat spine, hinge hips",
        "cue_work": "↓ Hinge",
        "cue_return": "↑ Stand",
        "tempo_mode": "standard",
    },
    "glute_bridge": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Drive heels, lift hips",
        "cue_work": "↑ Lift",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "crunch_core": {
        "rep_seconds": 2.2,
        "is_hold": False,
        "how_to": "Curl ribs to pelvis",
        "cue_work": "↑ Crunch",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "mountain_climber": {
        "rep_seconds": 1.4,
        "is_hold": False,
        "how_to": "Plank hold, drive knees",
        "cue_work": "Drive",
        "cue_return": "Switch",
        "tempo_mode": "alternating",
    },
    "dip": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Bend elbows, press tall",
        "cue_work": "↓ Dip",
        "cue_return": "↑ Press",
        "tempo_mode": "standard",
    },
    "overhead_press": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Brace core, press overhead",
        "cue_work": "↑ Press",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "bench_press": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Shoulders set, press up",
        "cue_work": "↑ Press",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "row_pull": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Flat back, pull elbows",
        "cue_work": "↑ Row",
        "cue_return": "↓ Extend",
        "tempo_mode": "standard",
    },
    "curl": {
        "rep_seconds": 2.4,
        "is_hold": False,
        "how_to": "Elbows pinned, curl up",
        "cue_work": "↑ Curl",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "vertical_pull": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Chest tall, pull elbows down",
        "cue_work": "↓ Pull",
        "cue_return": "↑ Reach",
        "tempo_mode": "standard",
    },
    "triceps_extension": {
        "rep_seconds": 2.4,
        "is_hold": False,
        "how_to": "Lock elbows, extend forearms",
        "cue_work": "↑ Extend",
        "cue_return": "↓ Bend",
        "tempo_mode": "standard",
    },
    "leg_extension_curl": {
        "rep_seconds": 2.5,
        "is_hold": False,
        "how_to": "Control knee arc, squeeze peak",
        "cue_work": "↑ Squeeze",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "calf_raise": {
        "rep_seconds": 2.0,
        "is_hold": False,
        "how_to": "Press balls of feet, pause high",
        "cue_work": "↑ Rise",
        "cue_return": "↓ Lower",
        "tempo_mode": "standard",
    },
    "bicycle_crunch": {
        "rep_seconds": 1.6,
        "is_hold": False,
        "how_to": "Pedal legs, rotate shoulder to knee",
        "cue_work": "Twist",
        "cue_return": "Switch",
        "tempo_mode": "alternating",
    },
}


def _normalized_text(exercise_id: str, name: str = "") -> str:
    raw = f"{exercise_id} {name}".strip().lower()
    return f"{raw} {raw.replace('_', ' ')}"


@lru_cache(maxsize=1)
def _stretching_exercise_ids() -> frozenset[str]:
    if not DEFAULT_EXERCISES_JSON.exists():
        return frozenset()
    try:
        items = json.loads(DEFAULT_EXERCISES_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return frozenset()
    return frozenset(
        str(item["id"]).lower()
        for item in items
        if (item.get("category") or "").lower() == "stretching" and "id" in item
    )


def is_hold_exercise(exercise_or_id: Exercise | str) -> bool:
    """Return True if an exercise or exercise ID is an isometric hold or stretch."""
    if isinstance(exercise_or_id, Exercise):
        if (exercise_or_id.category or "").lower() == "stretching":
            return True
        text = _normalized_text(exercise_or_id.id, exercise_or_id.name)
        return any(k in text for k in HOLD_KEYWORDS)

    ex_id = str(exercise_or_id)
    if ex_id.lower() in _stretching_exercise_ids():
        return True
    text = _normalized_text(ex_id)
    return any(k in text for k in HOLD_KEYWORDS) or "stretch" in text


def _load_svg(archetype: str, equipment: str | None = None) -> str:
    effective_arch = archetype if archetype in svg_assets.ARCHETYPE_SPECS else "squat"
    params = inspect.signature(load_svg_markup).parameters
    if "equipment" in params:
        return load_svg_markup(effective_arch, equipment=equipment)
    return load_svg_markup(effective_arch)


def _matches_chin_pull(n: str, _pm: str, _cat: str) -> bool:
    return bool(_CHIN_WORD_RE.search(n)) and "crunch" not in n and "chest" not in n


def _matches_triceps_kickback(n: str, pm: str, _cat: str) -> bool:
    return "kickback" in n and "glute" not in n and pm != "glutes"


def _matches_row_variant(n: str, pm: str, _cat: str) -> bool:
    return bool(_ROW_WORD_RE.search(n)) or ("flye" in n and pm != "chest")


def _matches_bicep_curl(n: str, pm: str, _cat: str) -> bool:
    return "curl" in n and pm != "abdominals"


def _matches_cardio(_n: str, _pm: str, cat: str) -> bool:
    return cat == "cardio"


_ARCHETYPE_RULES: tuple[
    tuple[str, tuple[str, ...], _ArchetypePredicate | None], ...
] = (
    ("plank", ("plank",), None),
    ("mountain_climber", ("mountain climber",), None),
    (
        "bicycle_crunch",
        (
            "air bike",
            "bicycle crunch",
            "cross-body crunch",
            "cocoons",
            "elbow to knee",
        ),
        None,
    ),
    (
        "glute_bridge",
        ("glute bridge", "hip thrust", "hip bridge", "butt lift (bridge)"),
        None,
    ),
    # Vertical pull BEFORE generic row / pull / crunch
    (
        "vertical_pull",
        (
            "pulldown",
            "pull-up",
            "pullup",
            "pull up",
            "chin-up",
            "chinup",
            "chin up",
            "muscle-up",
            "muscle up",
            "lat pull",
            "rope climb",
            "dead hang",
            "one handed hang",
        ),
        _matches_chin_pull,
    ),
    # Knee isolation BEFORE generic curl / extension
    (
        "leg_extension_curl",
        (
            "leg extension",
            "leg curl",
            "hamstring curl",
            "ball leg curl",
            "glute ham raise",
            "glute-ham raise",
        ),
        None,
    ),
    # Spinal / hip extensions -> hinge (NEVER curl!)
    ("hinge", ("hyperextension", "back extension", "reverse hyper"), None),
    # Calf isolation BEFORE press / squat
    (
        "calf_raise",
        (
            "calf raise",
            "calf press",
            "standing calf",
            "seated calf",
            "donkey calf",
            "ankle",
        ),
        None,
    ),
    # Triceps isolation BEFORE bench / overhead press / generic extension
    (
        "triceps_extension",
        (
            "skull crusher",
            "skullcrusher",
            "triceps extension",
            "tricep extension",
            "triceps pushdown",
            "tricep pushdown",
            "pushdown",
            "tricep press",
            "triceps press",
            "jm press",
            "overhead triceps",
        ),
        _matches_triceps_kickback,
    ),
    ("pushup", ("pushup", "push-up", "push up"), None),
    ("lunge", ("lunge", "split squat"), None),
    ("squat", ("squat",), None),
    ("dip", ("dip",), None),
    (
        "hinge",
        ("deadlift", "good morning", "swing", "rack pull", "pull through"),
        None,
    ),
    ("crunch_core", ("crunch", "sit-up", "sit up"), None),
    (
        "overhead_press",
        (
            "shoulder press",
            "overhead press",
            "military press",
            "arnold",
            "kettlebell press",
            "push press",
            "jerk",
        ),
        None,
    ),
    ("bench_press", ("bench press", "chest press", "floor press"), None),
    (
        "row_pull",
        (
            "pull apart",
            "face pull",
            "incline bench pull",
            "back fly",
            "reverse fly",
            "rear delt fly",
        ),
        _matches_row_variant,
    ),
    ("curl", (), _matches_bicep_curl),
    # Cardio locomotion -> mountain_climber rather than squat
    (
        "mountain_climber",
        (
            "bicycling",
            "running",
            "jogging",
            "rope jumping",
            "jump rope",
            "skating",
        ),
        _matches_cardio,
    ),
)

_MUSCLE_ARCHETYPE_MAP: dict[str, str] = {
    "calves": "calf_raise",
    "triceps": "triceps_extension",
    "quadriceps": "squat",
    "glutes": "squat",
    "adductors": "squat",
    "abductors": "squat",
    "hamstrings": "hinge",
    "lower back": "hinge",
    "abdominals": "crunch_core",
    "shoulders": "overhead_press",
    "neck": "overhead_press",
    "traps": "overhead_press",
    "lats": "row_pull",
    "middle back": "row_pull",
    "biceps": "curl",
    "forearms": "curl",
}


def _fallback_muscle_archetype(pm: str, equipment: str | None) -> str:
    if pm == "chest":
        return "pushup" if equipment == "body only" else "bench_press"
    return _MUSCLE_ARCHETYPE_MAP.get(pm, "squat")


def classify_archetype(exercise: Exercise) -> str:
    """Classify an exercise into one of the 18 movement archetypes."""
    n = _normalized_text(exercise.id, exercise.name)
    pm = (exercise.primary_muscle or "").lower()
    cat = (exercise.category or "").lower()

    for archetype, keywords, predicate in _ARCHETYPE_RULES:
        if any(k in n for k in keywords) or (
            predicate is not None and predicate(n, pm, cat)
        ):
            return archetype

    return _fallback_muscle_archetype(pm, exercise.equipment)


def build_exercise_guidance(exercise: Exercise) -> dict[str, Any]:
    """Build SVG markup, tempo pacing, and movement cues for an exercise."""
    archetype = classify_archetype(exercise)
    meta = ARCHETYPE_COACHING[archetype]
    n = _normalized_text(exercise.id, exercise.name)
    is_hold = is_hold_exercise(exercise)

    if is_hold:
        tempo_mode = "hold"
    elif any(k in n for k in EXPLOSIVE_KEYWORDS):
        tempo_mode = "explosive"
    else:
        tempo_mode = meta["tempo_mode"]

    is_alternating = archetype in {"mountain_climber", "bicycle_crunch"} or any(
        k in n for k in ALTERNATING_KEYWORDS
    )

    return {
        "archetype": archetype,
        "svg_url": f"/static/svgs/{archetype}.svg",
        "svg_markup": _load_svg(archetype, equipment=exercise.equipment),
        "rep_seconds": 1.0 if is_hold else meta["rep_seconds"],
        "is_hold": is_hold,
        "unit": "sec" if is_hold else "reps",
        "how_to": meta["how_to"],
        "cue_work": "Hold" if is_hold else meta["cue_work"],
        "cue_return": "Breathe" if is_hold else meta["cue_return"],
        "tempo_mode": tempo_mode,
        "is_alternating": is_alternating,
    }
