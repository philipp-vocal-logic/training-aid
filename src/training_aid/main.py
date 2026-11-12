from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, col, func, select

from training_aid.coaching import build_exercise_guidance, classify_archetype
from training_aid.database import create_db_and_tables, engine, get_session
from training_aid.models import (
    Exercise,
    RoutineExercise,
    TrainingPlan,
    User,
    WorkoutLog,
    WorkoutRoutine,
)
from training_aid.services import (
    apply_intensity_feedback,
    build_motivation_and_stats,
    compute_scaled_target,
    default_prescription_for_exercise,
    format_weight,
    generate_tailored_plan,
    get_next_routine,
    seed_exercises,
)
from training_aid.svg_assets import load_svg_markup, pregenerate_all_svgs

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

EQUIPMENT_ARCHETYPES: dict[str, str] = {
    "body_only": "squat",
    "dumbbells": "curl",
    "kettlebell_bands": "hinge",
    "full_gym": "bench_press",
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    pregenerate_all_svgs()
    create_db_and_tables(engine)
    with Session(engine) as session:
        seed_exercises(session)
    yield


app = FastAPI(
    title="Training Aid",
    description="Full-screen minimal guided workout trainer.",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

SessionDep = Annotated[Session, Depends(get_session)]


def resolve_user(request: Request, session: Session) -> User | None:
    cookie_uid = request.cookies.get("user_id")
    if cookie_uid and cookie_uid.isdigit():
        user = session.get(User, int(cookie_uid))
        if user is not None:
            return user
    return session.exec(select(User).order_by(col(User.id))).first()


def build_routine_cards(
    session: Session, routines: list[WorkoutRoutine]
) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for routine in routines:
        items = list(
            session.exec(
                select(RoutineExercise)
                .where(RoutineExercise.routine_id == routine.id)
                .order_by(col(RoutineExercise.order_index), col(RoutineExercise.id))
            ).all()
        )
        rows: list[dict[str, Any]] = []
        for item in items:
            exercise = session.get(Exercise, item.exercise_id)
            if exercise is None:
                continue
            archetype = classify_archetype(exercise)
            rows.append(
                {
                    "item": item,
                    "exercise": exercise,
                    "archetype": archetype,
                    "svg_url": f"/static/svgs/{archetype}.svg",
                    "scaled": compute_scaled_target(item, routine.intensity_level),
                }
            )
        lead_archetype = rows[0]["archetype"] if rows else "squat"
        cards.append(
            {
                "routine": routine,
                "exercises": rows,
                "lead_archetype": lead_archetype,
            }
        )
    return cards


def search_exercises_for_user(
    session: Session, user: User, q: str = "", limit: int = 16
) -> list[dict[str, Any]]:
    stmt = select(Exercise)
    if q.strip():
        stmt = stmt.where(col(Exercise.name).ilike(f"%{q.strip()}%"))
    elif user.equipment == "body_only":
        stmt = stmt.where(Exercise.equipment == "body only")
    elif user.equipment == "dumbbells":
        stmt = stmt.where(col(Exercise.equipment).in_(["dumbbell", "body only"]))
    elif user.equipment == "kettlebell_bands":
        stmt = stmt.where(
            col(Exercise.equipment).in_(["kettlebells", "bands", "body only"])
        )
    stmt = stmt.order_by(col(Exercise.name)).limit(limit)
    results = list(session.exec(stmt).all())
    return [
        {
            "exercise": ex,
            "archetype": (arch := classify_archetype(ex)),
            "svg_url": f"/static/svgs/{arch}.svg",
        }
        for ex in results
    ]


# ---------------------------------------------------------------------------
# 1. Onboarding Setup (/setup)
# ---------------------------------------------------------------------------


@app.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request, session: SessionDep):
    current_user = resolve_user(request, session)
    all_users = list(session.exec(select(User).order_by(col(User.id))).all())
    equipment_svgs = {
        eq_key: load_svg_markup(arch)
        for eq_key, arch in EQUIPMENT_ARCHETYPES.items()
    }
    return templates.TemplateResponse(
        request=request,
        name="setup.html",
        context={
            "current_user": current_user,
            "all_users": all_users,
            "active_nav": "setup",
            "equipment_svgs": equipment_svgs,
        },
    )


@app.post("/setup")
def submit_setup(
    request: Request,
    session: SessionDep,
    name: Annotated[str, Form()],
    equipment: Annotated[str, Form()] = "body_only",
    starting_intensity: Annotated[str, Form()] = "moderate",
    days_per_week: Annotated[int, Form()] = 3,
):
    clean_name = name.strip() or "Athlete"
    current_user = resolve_user(request, session)

    if current_user is not None and current_user.name.lower() == clean_name.lower():
        user = current_user
        user.name = clean_name
    else:
        user = User(name=clean_name)
        session.add(user)
        session.commit()
        session.refresh(user)

    generate_tailored_plan(
        session=session,
        user=user,
        equipment=equipment,
        starting_intensity=starting_intensity,
        days_per_week=days_per_week,
    )

    resp = RedirectResponse(url="/", status_code=303)
    resp.set_cookie("user_id", str(user.id), max_age=60 * 60 * 24 * 365)
    return resp


@app.post("/users/switch")
def switch_user(session: SessionDep, user_id: Annotated[int, Form()]):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    resp = RedirectResponse(url="/", status_code=303)
    resp.set_cookie("user_id", str(user.id), max_age=60 * 60 * 24 * 365)
    return resp


# ---------------------------------------------------------------------------
# 2. Plan Overview (/)
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
def overview(
    request: Request,
    session: SessionDep,
    completed: Annotated[int | None, Query()] = None,
):
    user = resolve_user(request, session)
    if user is None or user.active_plan_id is None:
        return RedirectResponse(url="/setup", status_code=303)

    active_plan = session.get(TrainingPlan, user.active_plan_id)
    if active_plan is None or active_plan.user_id != user.id:
        return RedirectResponse(url="/setup", status_code=303)

    routines = list(
        session.exec(
            select(WorkoutRoutine)
            .where(WorkoutRoutine.plan_id == active_plan.id)
            .order_by(col(WorkoutRoutine.day_order), col(WorkoutRoutine.id))
        ).all()
    )
    logs = list(
        session.exec(
            select(WorkoutLog)
            .where(WorkoutLog.user_id == user.id)
            .order_by(col(WorkoutLog.completed_at).desc(), col(WorkoutLog.id).desc())
        ).all()
    )

    routine_cards = build_routine_cards(session, routines)
    next_routine = get_next_routine(routines, logs)
    next_card = next(
        (c for c in routine_cards if next_routine and c["routine"].id == next_routine.id),
        routine_cards[0] if routine_cards else None,
    )
    stats = build_motivation_and_stats(user, logs, routines)

    used_archetypes = {"squat"}
    for card in routine_cards:
        for row in card["exercises"]:
            used_archetypes.add(row["archetype"])
    archetype_svgs = {arch: load_svg_markup(arch) for arch in used_archetypes}
    hero_archetype = next_card["lead_archetype"] if next_card else "squat"

    completed_log = None
    if completed is not None:
        candidate = session.get(WorkoutLog, completed)
        if candidate is not None and candidate.user_id == user.id:
            completed_log = candidate

    return templates.TemplateResponse(
        request=request,
        name="overview.html",
        context={
            "current_user": user,
            "active_nav": "overview",
            "active_plan": active_plan,
            "routine_cards": routine_cards,
            "next_card": next_card,
            "stats": stats,
            "completed_log": completed_log,
            "archetype_svgs": archetype_svgs,
            "hero_svg": archetype_svgs[hero_archetype],
        },
    )


# ---------------------------------------------------------------------------
# 3. Full-Screen Active Workout & 1-Tap Intensity Adaptation
# ---------------------------------------------------------------------------


@app.get("/workouts/{routine_id}", response_class=HTMLResponse)
def start_workout(routine_id: int, request: Request, session: SessionDep):
    user = resolve_user(request, session)
    if user is None:
        return RedirectResponse(url="/setup", status_code=303)

    routine = session.get(WorkoutRoutine, routine_id)
    plan = session.get(TrainingPlan, routine.plan_id) if routine else None
    if routine is None or plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workout not found")

    cards = build_routine_cards(session, [routine])
    routine_exercises = cards[0]["exercises"] if cards else []

    playlist: list[dict[str, Any]] = []
    for row in routine_exercises:
        ex: Exercise = row["exercise"]
        scaled = row["scaled"]
        guidance = build_exercise_guidance(ex)
        playlist.append(
            {
                "item_id": row["item"].id,
                "name": ex.name,
                "sets": scaled.sets,
                "reps": scaled.reps,
                "weight_label": (
                    format_weight(scaled.weight_kg) if scaled.weight_kg else None
                ),
                "formatted": scaled.formatted,
                **guidance,
            }
        )

    return templates.TemplateResponse(
        request=request,
        name="workout_session.html",
        context={
            "current_user": user,
            "active_nav": "workout",
            "routine": routine,
            "routine_exercises": routine_exercises,
            "playlist": playlist,
        },
    )


@app.post("/workouts/{routine_id}/complete")
def complete_workout(
    routine_id: int,
    request: Request,
    session: SessionDep,
    next_intensity_choice: Annotated[str, Form()] = "keep",
    duration_minutes: Annotated[int, Form()] = 25,
    completed_ids: Annotated[list[int], Form()] = [],
):
    user = resolve_user(request, session)
    if user is None:
        return RedirectResponse(url="/setup", status_code=303)

    routine = session.get(WorkoutRoutine, routine_id)
    plan = session.get(TrainingPlan, routine.plan_id) if routine else None
    if routine is None or plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workout not found")

    total_exercises = session.exec(
        select(func.count())
        .select_from(RoutineExercise)
        .where(RoutineExercise.routine_id == routine.id)
    ).one()

    choice = (
        next_intensity_choice
        if next_intensity_choice in {"less", "keep", "more"}
        else "keep"
    )
    completed_count = min(total_exercises, len(completed_ids))

    log = WorkoutLog(
        user_id=user.id,  # type: ignore[arg-type]
        plan_id=plan.id,
        routine_id=routine.id,
        routine_name=routine.name,
        duration_minutes=max(1, min(360, duration_minutes)),
        completed_exercises=completed_count,
        total_exercises=total_exercises,
        intensity_at_session=routine.intensity_level,
        next_intensity_choice=choice,
    )
    session.add(log)

    routine.intensity_level = apply_intensity_feedback(routine.intensity_level, choice)
    session.add(routine)
    session.commit()
    session.refresh(log)

    return RedirectResponse(url=f"/?completed={log.id}", status_code=303)


# ---------------------------------------------------------------------------
# 4. Routine Customizer
# ---------------------------------------------------------------------------


@app.post("/plans/{plan_id}/add-day")
def add_workout_day(plan_id: int, request: Request, session: SessionDep):
    user = resolve_user(request, session)
    plan = session.get(TrainingPlan, plan_id)
    if user is None or plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Plan not found")

    existing_count = session.exec(
        select(func.count())
        .select_from(WorkoutRoutine)
        .where(WorkoutRoutine.plan_id == plan.id)
    ).one()
    new_routine = WorkoutRoutine(
        plan_id=plan.id,  # type: ignore[arg-type]
        name=f"Day {existing_count + 1}",
        day_order=existing_count + 1,
        intensity_level=0,
    )
    session.add(new_routine)
    session.commit()
    session.refresh(new_routine)
    return RedirectResponse(url=f"/routines/{new_routine.id}/edit", status_code=303)


@app.get("/routines/{routine_id}/edit", response_class=HTMLResponse)
def edit_routine(routine_id: int, request: Request, session: SessionDep):
    user = resolve_user(request, session)
    if user is None:
        return RedirectResponse(url="/setup", status_code=303)

    routine = session.get(WorkoutRoutine, routine_id)
    plan = session.get(TrainingPlan, routine.plan_id) if routine else None
    if routine is None or plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Routine not found")

    cards = build_routine_cards(session, [routine])
    routine_exercises = cards[0]["exercises"] if cards else []
    exercises = search_exercises_for_user(session, user, q="")

    return templates.TemplateResponse(
        request=request,
        name="routine_edit.html",
        context={
            "current_user": user,
            "active_nav": "overview",
            "routine": routine,
            "routine_exercises": routine_exercises,
            "exercises": exercises,
        },
    )


@app.get("/routines/{routine_id}/search", response_class=HTMLResponse)
def search_routine_exercises(
    routine_id: int,
    request: Request,
    session: SessionDep,
    q: str = "",
):
    user = resolve_user(request, session)
    routine = session.get(WorkoutRoutine, routine_id)
    plan = session.get(TrainingPlan, routine.plan_id) if routine else None
    if user is None or routine is None or plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Routine not found")

    exercises = search_exercises_for_user(session, user, q=q)
    return templates.TemplateResponse(
        request=request,
        name="partials/routine_search.html",
        context={"routine": routine, "exercises": exercises},
    )


@app.post("/routines/{routine_id}/add-exercise")
def add_exercise_simple(
    routine_id: int,
    request: Request,
    session: SessionDep,
    exercise_id: Annotated[str, Form()],
):
    user = resolve_user(request, session)
    routine = session.get(WorkoutRoutine, routine_id)
    plan = session.get(TrainingPlan, routine.plan_id) if routine else None
    exercise = session.get(Exercise, exercise_id)
    if (
        user is None
        or routine is None
        or plan is None
        or plan.user_id != user.id
        or exercise is None
    ):
        raise HTTPException(status_code=404, detail="Not found")

    sets, reps, weight = default_prescription_for_exercise(user, exercise)
    count = session.exec(
        select(func.count())
        .select_from(RoutineExercise)
        .where(RoutineExercise.routine_id == routine.id)
    ).one()

    session.add(
        RoutineExercise(
            routine_id=routine.id,  # type: ignore[arg-type]
            exercise_id=exercise.id,
            order_index=count + 1,
            sets=sets,
            base_reps=reps,
            base_weight_kg=weight,
        )
    )
    session.commit()
    return RedirectResponse(url=f"/routines/{routine.id}/edit", status_code=303)


@app.post("/routine-exercises/{item_id}/delete")
def remove_routine_exercise(item_id: int, request: Request, session: SessionDep):
    user = resolve_user(request, session)
    item = session.get(RoutineExercise, item_id)
    routine = session.get(WorkoutRoutine, item.routine_id) if item else None
    plan = session.get(TrainingPlan, routine.plan_id) if routine else None
    if user is None or item is None or routine is None or plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")

    session.delete(item)
    session.commit()
    return RedirectResponse(url=f"/routines/{routine.id}/edit", status_code=303)


# ---------------------------------------------------------------------------
# 5. Progress (/progress)
# ---------------------------------------------------------------------------


@app.get("/progress", response_class=HTMLResponse)
def progress_view(request: Request, session: SessionDep):
    user = resolve_user(request, session)
    if user is None:
        return RedirectResponse(url="/setup", status_code=303)

    logs_desc = list(
        session.exec(
            select(WorkoutLog)
            .where(WorkoutLog.user_id == user.id)
            .order_by(col(WorkoutLog.completed_at).desc(), col(WorkoutLog.id).desc())
        ).all()
    )
    routines: list[WorkoutRoutine] = []
    if user.active_plan_id is not None:
        routines = list(
            session.exec(
                select(WorkoutRoutine)
                .where(WorkoutRoutine.plan_id == user.active_plan_id)
                .order_by(col(WorkoutRoutine.day_order), col(WorkoutRoutine.id))
            ).all()
        )

    stats = build_motivation_and_stats(user, logs_desc, routines)
    logs_chrono = list(reversed(logs_desc))
    if logs_chrono:
        chart_labels = ["0", *[f"#{i}" for i in range(1, len(logs_chrono) + 1)]]
        chart_values = [100, *[lg.intensity_percent for lg in logs_chrono]]
    else:
        chart_labels = []
        chart_values = []

    return templates.TemplateResponse(
        request=request,
        name="progress.html",
        context={
            "current_user": user,
            "active_nav": "progress",
            "stats": stats,
            "logs": logs_desc,
            "chart_labels": chart_labels,
            "chart_values": chart_values,
            "empty_svg": load_svg_markup("squat"),
        },
    )
