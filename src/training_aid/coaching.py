# Copyright (c) 2026 Philipp Kaaden
"""Movement archetype taxonomy, tempo cues, and sparse override resolvers."""

import functools
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_ANIMATIONS_JSON = DATA_DIR / "animations.json"
DEFAULT_EXERCISE_COACHING_JSON = DATA_DIR / "exercise_coaching.json"
DEFAULT_EXERCISES_JSON = DATA_DIR / "exercises.json"

__all__ = [
    "ALTERNATING_KEYWORDS",
    "DATA_DIR",
    "DEFAULT_ANIMATIONS_JSON",
    "DEFAULT_EXERCISE_COACHING_JSON",
    "EXPLOSIVE_KEYWORDS",
    "HOLD_KEYWORDS",
    "CatalogExercise",
    "build_exercise_metadata",
    "classify_archetype",
    "classify_archetype_fallback",
    "is_hold_exercise",
    "load_archetype_coaching",
    "load_exercise_coaching",
]


@dataclass(frozen=True, slots=True)
class CatalogExercise:
    """Immutable catalog exercise record loaded from free-exercise-db JSON."""

    id: str
    name: str
    category: str = "strength"
    equipment: str = "body only"
    primary_muscle: str = "other"


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


def load_exercise_coaching(
    coaching_path: Path = DEFAULT_EXERCISE_COACHING_JSON,
) -> dict[str, dict[str, Any]]:
    """Load sparse per-exercise archetype, hold, tempo, and alternating overrides."""
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


@functools.lru_cache(maxsize=1)
def _default_archetype_coaching() -> dict[str, dict[str, Any]]:
    return load_archetype_coaching()


@functools.lru_cache(maxsize=1)
def _default_exercise_coaching() -> tuple[
    dict[str, dict[str, Any]], dict[str, dict[str, Any]]
]:
    exact = load_exercise_coaching()
    lower = {ex_id.lower(): meta for ex_id, meta in exact.items()}
    return (exact, lower)


@functools.lru_cache(maxsize=1)
def _default_exercises_by_id() -> dict[str, CatalogExercise]:
    if not DEFAULT_EXERCISES_JSON.exists():
        return {}
    try:
        raw_items = json.loads(DEFAULT_EXERCISES_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw_items, list):
        return {}
    by_lower: dict[str, CatalogExercise] = {}
    for item in raw_items:
        if not isinstance(item, dict) or "id" not in item:
            continue
        primary_list = item.get("primaryMuscles") or []
        ex = CatalogExercise(
            id=str(item["id"]),
            name=str(item.get("name") or item["id"]),
            category=str(item.get("category") or "strength"),
            equipment=str(item.get("equipment") or "body only"),
            primary_muscle=str(primary_list[0]) if primary_list else "other",
        )
        by_lower[ex.id.lower()] = ex
    return by_lower


def _lookup_exercise_coaching(
    exercise_id: str,
    coaching_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    if coaching_map is not None:
        entry = coaching_map.get(exercise_id)
        if entry is not None:
            return entry
        target = exercise_id.lower()
        for ex_id, meta in coaching_map.items():
            if ex_id.lower() == target:
                return meta
        return None
    exact, lower = _default_exercise_coaching()
    entry = exact.get(exercise_id)
    if entry is not None:
        return entry
    return lower.get(exercise_id.lower())


def _normalized_text(exercise_id: str, name: str = "") -> str:
    raw = f"{exercise_id} {name}".strip().lower()
    return f"{raw} {raw.replace('_', ' ')}"


def is_hold_exercise(exercise_or_id: CatalogExercise | str) -> bool:
    """Return True if an exercise or exercise ID is an isometric hold or stretch."""
    target: CatalogExercise | str = exercise_or_id
    if isinstance(target, str):
        known = _default_exercises_by_id().get(target.lower())
        if known is not None:
            target = known

    if isinstance(target, CatalogExercise):
        if (target.category or "").lower() == "stretching":
            return True
        entry = _lookup_exercise_coaching(target.id)
        if entry is not None and "is_hold" in entry:
            return bool(entry["is_hold"])
        text = _normalized_text(target.id, target.name)
        return any(k in text for k in HOLD_KEYWORDS) or "stretch" in text

    ex_id = str(target)
    entry = _lookup_exercise_coaching(ex_id)
    if entry is not None and "is_hold" in entry:
        return bool(entry["is_hold"])
    text = _normalized_text(ex_id)
    return any(k in text for k in HOLD_KEYWORDS) or "stretch" in text


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
        ("bicycling", "running", "jogging", "rope jumping", "jump rope", "skating"),
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


def classify_archetype_fallback(exercise: CatalogExercise) -> str:
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


def classify_archetype(exercise: CatalogExercise) -> str:
    """Classify an exercise into one of the 18 movement archetypes."""
    entry = _lookup_exercise_coaching(exercise.id)
    if entry is not None and "archetype" in entry:
        return str(entry["archetype"])
    return classify_archetype_fallback(exercise)


def _resolve_non_hold_tempo(raw_tempo: str) -> str:
    return "standard" if raw_tempo == "hold" else raw_tempo


def build_exercise_metadata(
    exercise: CatalogExercise,
    *,
    coaching_map: dict[str, dict[str, Any]] | None = None,
    archetype_coaching: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compute archetype, tempo pacing, and movement cues for an exercise."""
    arch_meta_map = (
        archetype_coaching
        if archetype_coaching is not None
        else _default_archetype_coaching()
    )
    entry = _lookup_exercise_coaching(exercise.id, coaching_map) or {}
    is_stretch = (exercise.category or "").lower() == "stretching"

    heuristic_arch = classify_archetype_fallback(exercise)
    archetype = str(entry.get("archetype") or heuristic_arch)
    meta = arch_meta_map.get(archetype, _DEFAULT_COACHING_META)

    n = _normalized_text(exercise.id, exercise.name)
    heuristic_hold = is_stretch or any(k in n for k in HOLD_KEYWORDS) or "stretch" in n
    raw_hold = bool(entry["is_hold"]) if "is_hold" in entry else heuristic_hold
    is_hold = True if is_stretch else raw_hold

    if any(k in n for k in EXPLOSIVE_KEYWORDS):
        heuristic_tempo = "explosive"
    else:
        heuristic_tempo = str(meta["tempo_mode"])
    raw_tempo = str(entry.get("tempo_mode") or heuristic_tempo)
    tempo_mode = "hold" if is_hold else _resolve_non_hold_tempo(raw_tempo)

    heuristic_alt = archetype in {"mountain_climber", "bicycle_crunch"} or any(
        k in n for k in ALTERNATING_KEYWORDS
    )
    is_alternating = (
        bool(entry["is_alternating"]) if "is_alternating" in entry else heuristic_alt
    )

    return {
        "archetype": archetype,
        "rep_seconds": 1.0 if is_hold else meta["rep_seconds"],
        "is_hold": is_hold,
        "unit": "sec" if is_hold else "reps",
        "how_to": meta["how_to"],
        "cue_work": "Hold" if is_hold else meta["cue_work"],
        "cue_return": "Breathe" if is_hold else meta["cue_return"],
        "tempo_mode": tempo_mode,
        "is_alternating": is_alternating,
    }
