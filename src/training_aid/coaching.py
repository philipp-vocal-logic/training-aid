# Copyright (c) 2026 Philipp Kaaden
"""Movement archetype taxonomy, tempo cues, and SVG guidance builders."""

import inspect
import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from training_aid import svg_assets
from training_aid.models import Exercise
from training_aid.svg_assets import load_svg_markup

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_ANIMATIONS_JSON = DATA_DIR / "animations.json"
DEFAULT_EXERCISE_COACHING_JSON = DATA_DIR / "exercise_coaching.json"

_ROW_WORD_RE = re.compile(r"\b(?:rows?|rowing)\b")
_CHIN_WORD_RE = re.compile(r"\bchins?\b")

type _ArchetypePredicate = Callable[[str, str, str], bool]

HOLD_KEYWORDS: tuple[str, ...] = (
    "plank",
    "wall sit",
    "side bridge",
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

_DEFAULT_COACHING_META: dict[str, Any] = {
    "rep_seconds": 2.8,
    "is_hold": False,
    "how_to": "Hips back, chest up",
    "cue_work": "↓ Squat",
    "cue_return": "↑ Stand",
    "tempo_mode": "standard",
}


def _load_archetype_coaching(
    animations_path: Path = DEFAULT_ANIMATIONS_JSON,
) -> dict[str, dict[str, Any]]:
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


def _load_exercise_coaching(
    coaching_path: Path = DEFAULT_EXERCISE_COACHING_JSON,
) -> dict[str, dict[str, Any]]:
    if not coaching_path.exists():
        return {}
    try:
        raw = json.loads(coaching_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        str(ex_id): dict(meta) for ex_id, meta in raw.items() if isinstance(meta, dict)
    }


ARCHETYPE_COACHING: dict[str, dict[str, Any]] = _load_archetype_coaching()
EXERCISE_COACHING: dict[str, dict[str, Any]] = _load_exercise_coaching()
_EXERCISE_COACHING_LOWER: dict[str, dict[str, Any]] = {
    ex_id.lower(): meta for ex_id, meta in EXERCISE_COACHING.items()
}


def _lookup_exercise_coaching(exercise_id: str) -> dict[str, Any] | None:
    entry = EXERCISE_COACHING.get(exercise_id)
    if entry is not None:
        return entry
    return _EXERCISE_COACHING_LOWER.get(exercise_id.lower())


def _normalized_text(exercise_id: str, name: str = "") -> str:
    raw = f"{exercise_id} {name}".strip().lower()
    return f"{raw} {raw.replace('_', ' ')}"


def is_hold_exercise(exercise_or_id: Exercise | str) -> bool:
    """Return True if an exercise or exercise ID is an isometric hold or stretch."""
    if isinstance(exercise_or_id, Exercise):
        if (exercise_or_id.category or "").lower() == "stretching":
            return True
        entry = _lookup_exercise_coaching(exercise_or_id.id)
        if entry is not None:
            return bool(entry["is_hold"])
        text = _normalized_text(exercise_or_id.id, exercise_or_id.name)
        return any(k in text for k in HOLD_KEYWORDS) or "stretch" in text

    ex_id = str(exercise_or_id)
    entry = _lookup_exercise_coaching(ex_id)
    if entry is not None:
        return bool(entry["is_hold"])
    text = _normalized_text(ex_id)
    return any(k in text for k in HOLD_KEYWORDS) or "stretch" in text


def _load_svg(archetype: str, equipment: str | None = None) -> str:
    effective_arch = archetype if archetype in svg_assets.ARCHETYPE_SPECS else "squat"
    params = inspect.signature(load_svg_markup).parameters
    if "equipment" in params:
        return load_svg_markup(effective_arch, equipment=equipment)
    return load_svg_markup(effective_arch)


def exercise_svg_url(archetype: str, equipment: str | None = None) -> str:
    """Return static or equipment-parameterized SVG thumbnail URL for an archetype."""
    effective_arch = archetype if archetype in svg_assets.ARCHETYPE_SPECS else "squat"
    spec = svg_assets.ARCHETYPE_SPECS[effective_arch]
    eq_mode = svg_assets.normalize_equipment(equipment, effective_arch)
    if eq_mode == str(spec["default_equipment"]):
        return f"/static/svgs/{effective_arch}.svg"
    return f"/svgs/{effective_arch}.svg?equipment={eq_mode}"


def _matches_chin_pull(n: str, pm: str, _cat: str) -> bool:
    return (
        bool(_CHIN_WORD_RE.search(n))
        and "crunch" not in n
        and "chest" not in n
        and pm != "triceps"
    )


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
    (
        "plank",
        (
            "plank",
            "ab rollout",
            "ab roller",
            "rollout",
            "fallout",
            "exercise ball pull-in",
            "side bridge",
        ),
        None,
    ),
    ("mountain_climber", ("mountain climber", "spider crawl"), None),
    (
        "bicycle_crunch",
        (
            "air bike",
            "bicycle crunch",
            "cross-body crunch",
            "cocoons",
            "elbow to knee",
            "dead bug",
            "flutter kick",
        ),
        None,
    ),
    (
        "glute_bridge",
        ("glute bridge", "hip thrust", "hip bridge", "butt lift (bridge)", "hip lift"),
        None,
    ),
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
    ("hinge", ("hyperextension", "back extension", "reverse hyper"), None),
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
    ("pushup", ("pushup", "push-up", "push up", "body-up", "drop push"), None),
    ("lunge", ("lunge", "split squat"), None),
    (
        "squat",
        ("squat", "box jump", "tuck jump", "depth jump", "box skip", "hurdle hop"),
        None,
    ),
    ("dip", ("dip",), None),
    (
        "hinge",
        (
            "deadlift",
            "good morning",
            "swing",
            "rack pull",
            "pull through",
            "bottoms-up clean",
        ),
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
            "catch and overhead throw",
        ),
        None,
    ),
    (
        "bench_press",
        (
            "bench press",
            "chest press",
            "floor press",
            "board press",
            "pin press",
            "close-grip dumbbell press",
            "close-grip ez-bar press",
            "chest throw",
        ),
        None,
    ),
    (
        "row_pull",
        (
            "pull apart",
            "face pull",
            "incline bench pull",
            "back fly",
            "reverse fly",
            "rear delt fly",
            "shrug",
        ),
        _matches_row_variant,
    ),
    ("curl", (), _matches_bicep_curl),
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
    "traps": "row_pull",
    "lats": "row_pull",
    "middle back": "row_pull",
    "biceps": "curl",
    "forearms": "curl",
}


def _fallback_muscle_archetype(pm: str, equipment: str | None) -> str:
    if pm == "chest":
        return "pushup" if equipment == "body only" else "bench_press"
    return _MUSCLE_ARCHETYPE_MAP.get(pm, "squat")


def classify_archetype_fallback(exercise: Exercise) -> str:
    """Classify an exercise into one of the 18 archetypes via rule-based heuristics."""
    n = _normalized_text(exercise.id, exercise.name)
    pm = (exercise.primary_muscle or "").lower()
    cat = (exercise.category or "").lower()

    for archetype, keywords, predicate in _ARCHETYPE_RULES:
        if any(k in n for k in keywords) or (
            predicate is not None and predicate(n, pm, cat)
        ):
            return archetype

    return _fallback_muscle_archetype(pm, exercise.equipment)


def classify_archetype(exercise: Exercise) -> str:
    """Classify an exercise into one of the 18 movement archetypes."""
    entry = _lookup_exercise_coaching(exercise.id)
    if entry is not None:
        return str(entry["archetype"])
    return classify_archetype_fallback(exercise)


def _resolve_non_hold_tempo(raw_tempo: str) -> str:
    return "standard" if raw_tempo == "hold" else raw_tempo


def build_exercise_guidance(exercise: Exercise) -> dict[str, Any]:
    """Build SVG markup, tempo pacing, and movement cues for an exercise."""
    entry = _lookup_exercise_coaching(exercise.id)
    is_stretch = (exercise.category or "").lower() == "stretching"

    if entry is not None:
        archetype = str(entry["archetype"])
        meta = ARCHETYPE_COACHING.get(archetype, _DEFAULT_COACHING_META)
        is_hold = True if is_stretch else bool(entry["is_hold"])
        tempo_mode = (
            "hold" if is_hold else _resolve_non_hold_tempo(str(entry["tempo_mode"]))
        )
        is_alternating = bool(entry["is_alternating"])
    else:
        archetype = classify_archetype(exercise)
        meta = ARCHETYPE_COACHING.get(archetype, _DEFAULT_COACHING_META)
        n = _normalized_text(exercise.id, exercise.name)
        is_hold = is_hold_exercise(exercise)
        if is_hold:
            tempo_mode = "hold"
        elif any(k in n for k in EXPLOSIVE_KEYWORDS):
            tempo_mode = "explosive"
        else:
            tempo_mode = _resolve_non_hold_tempo(str(meta["tempo_mode"]))
        is_alternating = archetype in {"mountain_climber", "bicycle_crunch"} or any(
            k in n for k in ALTERNATING_KEYWORDS
        )

    raw_instructions = [
        step.strip() for step in exercise.instructions if step and step.strip()
    ]
    instructions = raw_instructions or [str(meta["how_to"])]

    return {
        "archetype": archetype,
        "svg_url": exercise_svg_url(archetype, exercise.equipment),
        "svg_markup": _load_svg(archetype, equipment=exercise.equipment),
        "rep_seconds": 1.0 if is_hold else meta["rep_seconds"],
        "is_hold": is_hold,
        "unit": "sec" if is_hold else "reps",
        "how_to": meta["how_to"],
        "instructions": instructions,
        "cue_work": "Hold" if is_hold else meta["cue_work"],
        "cue_return": "Breathe" if is_hold else meta["cue_return"],
        "tempo_mode": tempo_mode,
        "is_alternating": is_alternating,
    }
