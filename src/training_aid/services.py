from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Any
from sqlmodel import Session, func, select

from training_aid.models import (
    Exercise,
    RoutineExercise,
    TrainingPlan,
    User,
    WorkoutLog,
    WorkoutRoutine,
)

DEFAULT_EXERCISES_JSON = Path(__file__).resolve().parents[2] / "data" / "exercises.json"

# Verified exercises from free-exercise-db grouped by user's available workout tools.
# Each entry is (exercise_id, moderate_reps, moderate_weight_kg)
EQUIPMENT_PROGRAMS: dict[str, dict[str, Any]] = {
    "body_only": {
        "label": "Body Only",
        "routines": [
            (
                "Day 1: Full Body Basics",
                [
                    ("Bodyweight_Squat", 15, None),
                    ("Pushups", 10, None),
                    ("Single_Leg_Glute_Bridge", 12, None),
                    ("Plank", 40, None),
                ],
            ),
            (
                "Day 2: Legs & Core",
                [
                    ("Bodyweight_Walking_Lunge", 12, None),
                    ("Bench_Dips", 10, None),
                    ("Mountain_Climbers", 20, None),
                    ("Crunches", 15, None),
                ],
            ),
            (
                "Day 3: Energy & Strength",
                [
                    ("Freehand_Jump_Squat", 10, None),
                    ("Incline_Push-Up", 12, None),
                    ("Air_Bike", 20, None),
                    ("Plank", 40, None),
                ],
            ),
            (
                "Day 4: Total Body Finish",
                [
                    ("Bodyweight_Squat", 15, None),
                    ("Pushups_Close_and_Wide_Hand_Positions", 10, None),
                    ("Single_Leg_Glute_Bridge", 12, None),
                    ("3_4_Sit-Up", 15, None),
                ],
            ),
        ],
    },
    "dumbbells": {
        "label": "Dumbbells",
        "routines": [
            (
                "Day 1: Squat, Press & Row",
                [
                    ("Dumbbell_Squat", 10, 12.0),
                    ("Dumbbell_Bench_Press", 10, 12.0),
                    ("One-Arm_Dumbbell_Row", 10, 12.0),
                    ("Plank", 40, None),
                ],
            ),
            (
                "Day 2: Lunge & Shoulders",
                [
                    ("Dumbbell_Lunges", 10, 10.0),
                    ("Dumbbell_Shoulder_Press", 10, 10.0),
                    ("Alternate_Hammer_Curl", 12, 8.0),
                    ("Crunches", 15, None),
                ],
            ),
            (
                "Day 3: Full Body Dumbbells",
                [
                    ("Dumbbell_Squat_To_A_Bench", 12, 12.0),
                    ("Bent_Over_Two-Dumbbell_Row", 10, 10.0),
                    ("Arnold_Dumbbell_Press", 10, 10.0),
                    ("Air_Bike", 20, None),
                ],
            ),
            (
                "Day 4: Upper & Core Focus",
                [
                    ("Dumbbell_Lunges", 10, 10.0),
                    ("Dumbbell_Bench_Press", 10, 12.0),
                    ("Alternate_Incline_Dumbbell_Curl", 12, 8.0),
                    ("Plank", 45, None),
                ],
            ),
        ],
    },
    "kettlebell_bands": {
        "label": "Kettlebell & Bands",
        "routines": [
            (
                "Day 1: Kettlebell Strength",
                [
                    ("Goblet_Squat", 12, 12.0),
                    ("Alternating_Kettlebell_Press", 10, 10.0),
                    ("Alternating_Kettlebell_Row", 10, 12.0),
                    ("Plank", 40, None),
                ],
            ),
            (
                "Day 2: Band & Core",
                [
                    ("Band_Good_Morning", 12, None),
                    ("Bench_Press_-_With_Bands", 12, None),
                    ("Band_Pull_Apart", 15, None),
                    ("Crunches", 15, None),
                ],
            ),
            (
                "Day 3: Athletic Mix",
                [
                    ("Goblet_Squat", 12, 12.0),
                    ("Pushups", 10, None),
                    ("Band_Skull_Crusher", 12, None),
                    ("Air_Bike", 20, None),
                ],
            ),
            (
                "Day 4: Posture & Legs",
                [
                    ("Bodyweight_Walking_Lunge", 12, None),
                    ("Alternating_Kettlebell_Row", 10, 12.0),
                    ("Back_Flyes_-_With_Bands", 15, None),
                    ("Plank", 45, None),
                ],
            ),
        ],
    },
    "full_gym": {
        "label": "Full Gym",
        "routines": [
            (
                "Day 1: Full Body A",
                [
                    ("Barbell_Full_Squat", 8, 40.0),
                    ("Barbell_Bench_Press_-_Medium_Grip", 8, 35.0),
                    ("Bent_Over_Barbell_Row", 10, 30.0),
                    ("Plank", 45, None),
                ],
            ),
            (
                "Day 2: Full Body B",
                [
                    ("Romanian_Deadlift", 8, 40.0),
                    ("Dumbbell_Shoulder_Press", 10, 10.0),
                    ("Wide-Grip_Lat_Pulldown", 10, 35.0),
                    ("Crunches", 15, None),
                ],
            ),
            (
                "Day 3: Strength & Pull",
                [
                    ("Barbell_Deadlift", 6, 50.0),
                    ("Dumbbell_Bench_Press", 10, 16.0),
                    ("One-Arm_Dumbbell_Row", 10, 14.0),
                    ("Alternate_Hammer_Curl", 12, 10.0),
                ],
            ),
            (
                "Day 4: Legs & Cables",
                [
                    ("Dumbbell_Lunges", 10, 12.0),
                    ("Barbell_Shoulder_Press", 8, 25.0),
                    ("Cable_Chest_Press", 12, 25.0),
                    ("Cable_Crunch", 15, 25.0),
                ],
            ),
        ],
    },
}

INTENSITY_LABELS = {
    "light": "Easy Start",
    "moderate": "Moderate",
    "intense": "Intense",
}


@dataclass
class ScaledTarget:
    sets: int
    reps: int
    weight_kg: float | None
    intensity_percent: int
    formatted: str


def format_weight(weight: float) -> str:
    return f"{int(weight)} kg" if weight.is_integer() else f"{weight:.1f} kg"


def round_half_kg(val: float) -> float:
    return max(0.5, round(val * 2) / 2)


def compute_scaled_target(item: RoutineExercise, intensity_level: int) -> ScaledTarget:
    """Scale target weight (if weighted) or target reps (if bodyweight) by 10% per step."""
    clamped = max(-5, intensity_level)
    intensity_pct = 100 + clamped * 10
    multiplier = intensity_pct / 100.0

    if item.base_weight_kg is not None and item.base_weight_kg > 0:
        rounded_weight = round_half_kg(item.base_weight_kg * multiplier)
        if clamped > 0:
            target_weight = max(rounded_weight, item.base_weight_kg + 0.5 * clamped)
        elif clamped < 0:
            target_weight = max(0.5, min(rounded_weight, item.base_weight_kg + 0.5 * clamped))
        else:
            target_weight = item.base_weight_kg

        formatted = f"{item.sets} × {item.base_reps} @ {format_weight(target_weight)}"
        return ScaledTarget(
            sets=item.sets,
            reps=item.base_reps,
            weight_kg=target_weight,
            intensity_percent=intensity_pct,
            formatted=formatted,
        )

    rounded_reps = round(item.base_reps * multiplier)
    if clamped > 0:
        target_reps = max(rounded_reps, item.base_reps + clamped)
    elif clamped < 0:
        target_reps = max(1, min(rounded_reps, item.base_reps + clamped))
    else:
        target_reps = item.base_reps

    unit = "sec" if "plank" in item.exercise_id.lower() else "reps"
    formatted = f"{item.sets} × {target_reps} {unit}"
    return ScaledTarget(
        sets=item.sets,
        reps=target_reps,
        weight_kg=None,
        intensity_percent=intensity_pct,
        formatted=formatted,
    )


def apply_intensity_feedback(current_level: int, choice: str) -> int:
    normalized = choice.strip().lower()
    if normalized == "more":
        return current_level + 1
    if normalized == "less":
        return max(-5, current_level - 1)
    return current_level


def seed_exercises(session: Session, exercises_path: Path = DEFAULT_EXERCISES_JSON) -> int:
    existing_count = session.exec(select(func.count()).select_from(Exercise)).one()
    if existing_count > 0:
        return existing_count

    if not exercises_path.exists():
        return 0

    raw_items = json.loads(exercises_path.read_text(encoding="utf-8"))
    exercises: list[Exercise] = []
    for item in raw_items:
        primary_list = item.get("primaryMuscles") or []
        secondary_list = item.get("secondaryMuscles") or []
        images = item.get("images") or []
        image_url = (
            f"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{images[0]}"
            if images
            else None
        )
        exercises.append(
            Exercise(
                id=item["id"],
                name=item["name"],
                category=item.get("category") or "strength",
                level=item.get("level") or "beginner",
                equipment=item.get("equipment") or "body only",
                primary_muscle=primary_list[0] if primary_list else "other",
                secondary_muscles=", ".join(secondary_list),
                instructions_json=json.dumps(item.get("instructions") or []),
                image_url=image_url,
            )
        )
    session.add_all(exercises)
    session.commit()
    return len(exercises)


def _scale_initial_prescription(
    base_reps: int, base_weight: float | None, starting_intensity: str
) -> tuple[int, int, float | None]:
    if starting_intensity == "light":
        sets = 2
        reps = max(6, round(base_reps * 0.8))
        weight = round_half_kg(base_weight * 0.75) if base_weight else None
    elif starting_intensity == "intense":
        sets = 4
        reps = round(base_reps * 1.2)
        weight = round_half_kg(base_weight * 1.2) if base_weight else None
    else:
        sets = 3
        reps = base_reps
        weight = base_weight
    return sets, reps, weight


def default_prescription_for_exercise(
    user: User, exercise: Exercise
) -> tuple[int, int, float | None]:
    weighted_equip = {"barbell", "dumbbell", "kettlebells", "cable", "machine", "e-z curl bar"}
    base_weight: float | None = None
    if exercise.equipment in weighted_equip and user.equipment != "body_only":
        base_weight = 20.0 if exercise.equipment == "barbell" else 10.0
    return _scale_initial_prescription(10, base_weight, user.starting_intensity)


def generate_tailored_plan(
    session: Session,
    user: User,
    equipment: str,
    starting_intensity: str,
    days_per_week: int,
) -> TrainingPlan:
    eq_key = equipment if equipment in EQUIPMENT_PROGRAMS else "body_only"
    int_key = starting_intensity if starting_intensity in INTENSITY_LABELS else "moderate"
    days = max(2, min(4, days_per_week))

    program = EQUIPMENT_PROGRAMS[eq_key]
    plan_name = f"{program['label']} Plan ({days}x/Week)"
    plan_desc = f"{INTENSITY_LABELS[int_key]} start • {program['label']}"

    plan = TrainingPlan(
        user_id=user.id,  # type: ignore[arg-type]
        name=plan_name,
        description=plan_desc,
        days_per_week=days,
    )
    session.add(plan)
    session.flush()

    selected_routines = program["routines"][:days]
    for day_idx, (routine_name, ex_specs) in enumerate(selected_routines, start=1):
        routine = WorkoutRoutine(
            plan_id=plan.id,  # type: ignore[arg-type]
            name=routine_name,
            day_order=day_idx,
            intensity_level=0,
        )
        session.add(routine)
        session.flush()

        for order_idx, (ex_id, mod_reps, mod_weight) in enumerate(ex_specs, start=1):
            if session.get(Exercise, ex_id) is None:
                continue
            sets, reps, weight = _scale_initial_prescription(
                mod_reps, mod_weight, int_key
            )
            session.add(
                RoutineExercise(
                    routine_id=routine.id,  # type: ignore[arg-type]
                    exercise_id=ex_id,
                    order_index=order_idx,
                    sets=sets,
                    base_reps=reps,
                    base_weight_kg=weight,
                )
            )

    user.equipment = eq_key
    user.starting_intensity = int_key
    user.weekly_goal = days
    user.active_plan_id = plan.id
    session.add(user)
    session.commit()
    session.refresh(plan)
    return plan


def get_next_routine(
    routines: list[WorkoutRoutine], logs: list[WorkoutLog]
) -> WorkoutRoutine | None:
    if not routines:
        return None
    routine_ids = [r.id for r in routines if r.id is not None]
    for log in logs:
        if log.routine_id in routine_ids:
            idx = routine_ids.index(log.routine_id)
            return routines[(idx + 1) % len(routines)]
    return routines[0]


def _normalize_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def compute_week_streak(logs: list[WorkoutLog], now: datetime | None = None) -> int:
    if not logs:
        return 0
    ref = _normalize_utc(now or datetime.now(timezone.utc))
    active_weeks = {
        (
            _normalize_utc(log.completed_at).isocalendar().year,
            _normalize_utc(log.completed_at).isocalendar().week,
        )
        for log in logs
    }

    cursor_date = ref.date()
    curr_iso = cursor_date.isocalendar()
    if (curr_iso.year, curr_iso.week) not in active_weeks:
        prev_date = cursor_date - timedelta(days=7)
        prev_iso = prev_date.isocalendar()
        if (prev_iso.year, prev_iso.week) not in active_weeks:
            return 0
        cursor_date = prev_date

    streak = 0
    while True:
        iso = cursor_date.isocalendar()
        if (iso.year, iso.week) in active_weeks:
            streak += 1
            cursor_date -= timedelta(days=7)
        else:
            break
    return streak


def build_motivation_and_stats(
    user: User, logs: list[WorkoutLog], routines: list[WorkoutRoutine]
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start_of_week = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    workouts_this_week = sum(
        1 for log in logs if _normalize_utc(log.completed_at) >= start_of_week
    )
    total_workouts = len(logs)
    week_streak = compute_week_streak(logs, now=now)

    if routines:
        avg_plan_intensity = round(
            sum(r.intensity_percent for r in routines) / len(routines)
        )
    elif logs:
        avg_plan_intensity = logs[0].intensity_percent
    else:
        avg_plan_intensity = 100

    weekly_goal = max(1, user.weekly_goal)

    if total_workouts == 0:
        message = f"{user.name} · 0/{weekly_goal}"
    elif workouts_this_week >= weekly_goal:
        message = f"{user.name} · {workouts_this_week}/{weekly_goal} ✓"
    else:
        message = f"{user.name} · {workouts_this_week}/{weekly_goal}"

    return {
        "workouts_this_week": workouts_this_week,
        "weekly_goal": weekly_goal,
        "total_workouts": total_workouts,
        "week_streak": week_streak,
        "avg_plan_intensity": avg_plan_intensity,
        "message": message,
    }
