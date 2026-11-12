from typing import Any

from training_aid.models import Exercise
from training_aid.svg_assets import load_svg_markup

ARCHETYPE_COACHING: dict[str, dict[str, Any]] = {
    "squat": {
        "rep_seconds": 2.8,
        "is_hold": False,
        "how_to": "Hips back, chest up",
        "cue_work": "↓ Squat",
        "cue_return": "↑ Stand",
    },
    "lunge": {
        "rep_seconds": 2.8,
        "is_hold": False,
        "how_to": "Drop back knee, drive up",
        "cue_work": "↓ Lunge",
        "cue_return": "↑ Rise",
    },
    "pushup": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Body straight, chest down",
        "cue_work": "↓ Lower",
        "cue_return": "↑ Press",
    },
    "plank": {
        "rep_seconds": 1.0,
        "is_hold": True,
        "how_to": "Straight line, core braced",
        "cue_work": "Hold",
        "cue_return": "Breathe",
    },
    "hinge": {
        "rep_seconds": 3.0,
        "is_hold": False,
        "how_to": "Flat spine, hinge hips",
        "cue_work": "↓ Hinge",
        "cue_return": "↑ Stand",
    },
    "glute_bridge": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Drive heels, lift hips",
        "cue_work": "↑ Lift",
        "cue_return": "↓ Lower",
    },
    "crunch_core": {
        "rep_seconds": 2.2,
        "is_hold": False,
        "how_to": "Curl ribs to pelvis",
        "cue_work": "↑ Crunch",
        "cue_return": "↓ Lower",
    },
    "mountain_climber": {
        "rep_seconds": 1.4,
        "is_hold": False,
        "how_to": "Plank hold, drive knees",
        "cue_work": "Drive",
        "cue_return": "Switch",
    },
    "dip": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Bend elbows, press tall",
        "cue_work": "↓ Dip",
        "cue_return": "↑ Press",
    },
    "overhead_press": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Brace core, press overhead",
        "cue_work": "↑ Press",
        "cue_return": "↓ Lower",
    },
    "bench_press": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Shoulders set, press up",
        "cue_work": "↑ Press",
        "cue_return": "↓ Lower",
    },
    "row_pull": {
        "rep_seconds": 2.6,
        "is_hold": False,
        "how_to": "Flat back, pull elbows",
        "cue_work": "↑ Row",
        "cue_return": "↓ Extend",
    },
    "curl": {
        "rep_seconds": 2.4,
        "is_hold": False,
        "how_to": "Elbows pinned, curl up",
        "cue_work": "↑ Curl",
        "cue_return": "↓ Lower",
    },
}


def classify_archetype(exercise: Exercise) -> str:
    n = f"{exercise.id} {exercise.name}".lower()
    if "plank" in n:
        return "plank"
    if "mountain climber" in n:
        return "mountain_climber"
    if "glute bridge" in n or "hip thrust" in n:
        return "glute_bridge"
    if "pushup" in n or "push-up" in n or "push up" in n:
        return "pushup"
    if "dip" in n:
        return "dip"
    if "lunge" in n or "split squat" in n:
        return "lunge"
    if "squat" in n:
        return "squat"
    if "deadlift" in n or "good morning" in n or "swing" in n:
        return "hinge"
    if "crunch" in n or "sit-up" in n or "sit up" in n or "air bike" in n:
        return "crunch_core"
    if any(
        k in n
        for k in (
            "shoulder press",
            "overhead press",
            "arnold",
            "kettlebell press",
            "push press",
            "jerk",
        )
    ):
        return "overhead_press"
    if "bench press" in n or "chest press" in n or "floor press" in n:
        return "bench_press"
    if any(
        k in n
        for k in ("row", "pulldown", "pull-up", "pullup", "pull apart", "flye")
    ):
        return "row_pull"
    if "curl" in n or "skull crusher" in n or "extension" in n:
        return "curl"

    pm = exercise.primary_muscle.lower()
    if pm in {"quadriceps", "glutes", "calves", "adductors", "abductors"}:
        return "squat"
    if pm in {"hamstrings", "lower back"}:
        return "hinge"
    if pm == "abdominals":
        return "crunch_core"
    if pm == "chest":
        return "pushup" if exercise.equipment == "body only" else "bench_press"
    if pm in {"shoulders", "neck", "traps"}:
        return "overhead_press"
    if pm in {"lats", "middle back"}:
        return "row_pull"
    if pm in {"biceps", "triceps", "forearms"}:
        return "curl"
    return "squat"


def build_exercise_guidance(exercise: Exercise) -> dict[str, Any]:
    archetype = classify_archetype(exercise)
    meta = ARCHETYPE_COACHING[archetype]
    return {
        "archetype": archetype,
        "svg_url": f"/static/svgs/{archetype}.svg",
        "svg_markup": load_svg_markup(archetype),
        "rep_seconds": meta["rep_seconds"],
        "is_hold": meta["is_hold"],
        "unit": "sec" if meta["is_hold"] else "reps",
        "how_to": meta["how_to"],
        "cue_work": meta["cue_work"],
        "cue_return": meta["cue_return"],
    }
