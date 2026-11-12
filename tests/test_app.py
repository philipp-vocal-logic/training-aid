import json
import xml.etree.ElementTree as ET
from collections.abc import Generator
from fastapi.testclient import TestClient
import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from training_aid.coaching import ARCHETYPE_COACHING, build_exercise_guidance, classify_archetype
from training_aid.database import get_session
from training_aid.main import app
from training_aid.models import (
    Exercise,
    RoutineExercise,
    TrainingPlan,
    User,
    WorkoutLog,
    WorkoutRoutine,
)
from training_aid.services import (
    EQUIPMENT_PROGRAMS,
    apply_intensity_feedback,
    compute_scaled_target,
    compute_week_streak,
    seed_exercises,
)
from training_aid.svg_assets import ARCHETYPE_SPECS, SVGS_DIR, pregenerate_all_svgs


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    with Session(test_engine) as db:
        seed_exercises(db)
        yield db


@pytest.fixture()
def client(session: Session) -> Generator[TestClient, None, None]:
    def override_get_session() -> Generator[Session, None, None]:
        yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as tc:
        yield tc
    app.dependency_overrides.clear()


def test_first_visit_opens_fullscreen_minimal_setup(client: TestClient):
    res = client.get("/", follow_redirects=True)
    assert res.status_code == 200
    assert 'class="split-screen"' in res.text
    assert 'class="graphic-stage"' in res.text
    assert "data-pose-a=" in res.text
    assert "Equipment" in res.text
    assert "Body Only" in res.text
    assert "Intensity" in res.text
    assert "Weekly" in res.text
    # Verbose sentences removed
    assert "Answer 4 quick questions" not in res.text


def test_exercise_seeding_and_all_equipment_programs(session: Session):
    exercises = session.exec(select(Exercise)).all()
    assert len(exercises) > 800

    for eq_key, prog in EQUIPMENT_PROGRAMS.items():
        for _routine_name, specs in prog["routines"]:
            for ex_id, *_ in specs:
                assert session.get(Exercise, ex_id) is not None, (
                    f"Missing exercise {ex_id} in {eq_key}"
                )


def test_onboarding_builds_tailored_body_only_light_plan(
    client: TestClient, session: Session
):
    res = client.post(
        "/setup",
        data={
            "name": "Philipp",
            "equipment": "body_only",
            "starting_intensity": "light",
            "days_per_week": "2",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert "Philipp · 0/2" in res.text
    assert "Body Only Plan (2x/Week)" in res.text
    assert 'id="overview-svg-wrap"' in res.text

    user = session.exec(select(User)).one()
    assert user.equipment == "body_only"
    assert user.starting_intensity == "light"
    assert user.weekly_goal == 2

    routines = list(session.exec(select(WorkoutRoutine)).all())
    assert len(routines) == 2

    items = list(
        session.exec(
            select(RoutineExercise).where(RoutineExercise.routine_id == routines[0].id)
        ).all()
    )
    assert all(it.sets == 2 for it in items)
    assert all(it.base_weight_kg is None for it in items)


def test_fullscreen_workout_coach_and_minimal_intensity_adaptation(
    client: TestClient, session: Session
):
    client.post(
        "/setup",
        data={
            "name": "Sam",
            "equipment": "full_gym",
            "starting_intensity": "moderate",
            "days_per_week": "3",
        },
        follow_redirects=True,
    )

    routines = list(
        session.exec(select(WorkoutRoutine).order_by(WorkoutRoutine.day_order)).all()
    )
    day1, day2 = routines[0], routines[1]

    # Open Day 1 full-screen guided workout
    ws = client.get(f"/workouts/{day1.id}")
    assert ws.status_code == 200
    assert 'class="topbar"' not in ws.text  # No global nav clutter in workout view
    assert 'class="workout-viewport"' in ws.text
    assert 'class="workout-svg-canvas"' in ws.text
    assert "1/4 · S1/3" in ws.text
    assert "data-pose-a=" in ws.text
    assert "data-pose-b=" in ws.text
    assert "startSignal()" in ws.text
    assert "What to do:" not in ws.text
    assert "+10%" in ws.text
    assert "−10%" in ws.text

    # 1-tap finish choosing "more"
    done_more = client.post(
        f"/workouts/{day1.id}/complete",
        data={"next_intensity_choice": "more"},
        follow_redirects=True,
    )
    assert done_more.status_code == 200
    assert "+10%" in done_more.text
    assert day2.name in done_more.text
    assert "3 × 8 @ 44 kg" in done_more.text

    # Finish Day 2 choosing "less"
    done_less = client.post(
        f"/workouts/{day2.id}/complete",
        data={"next_intensity_choice": "less"},
        follow_redirects=True,
    )
    assert done_less.status_code == 200
    assert "−10%" in done_less.text
    assert "3 × 8 @ 36 kg" in done_less.text

    # Full-screen Stats / Progress view
    prog = client.get("/progress")
    assert prog.status_code == 200
    assert 'class="progress-screen"' in prog.text
    assert "Done" in prog.text
    assert "Streak" in prog.text
    assert "Load" in prog.text
    assert "+10%" in prog.text
    assert "−10%" in prog.text


def test_simple_routine_customization_with_svg_thumbnails(
    client: TestClient, session: Session
):
    client.post(
        "/setup",
        data={
            "name": "Jordan",
            "equipment": "dumbbells",
            "starting_intensity": "intense",
            "days_per_week": "3",
        },
        follow_redirects=True,
    )
    plan = session.exec(select(TrainingPlan)).one()

    add_day_res = client.post(f"/plans/{plan.id}/add-day", follow_redirects=False)
    assert add_day_res.status_code == 303
    edit_url = add_day_res.headers["location"]

    edit_page = client.get(edit_url)
    assert edit_page.status_code == 200
    assert 'class="editor-screen"' in edit_page.text

    new_routine = session.exec(
        select(WorkoutRoutine).order_by(WorkoutRoutine.day_order.desc())
    ).first()
    assert new_routine is not None

    search_res = client.get(f"/routines/{new_routine.id}/search?q=Pushups")
    assert search_res.status_code == 200
    assert "Pushups" in search_res.text
    assert "/static/svgs/pushup.svg" in search_res.text

    add_ex = client.post(
        f"/routines/{new_routine.id}/add-exercise",
        data={"exercise_id": "Pushups"},
        follow_redirects=True,
    )
    assert add_ex.status_code == 200
    assert "Pushups" in add_ex.text
    assert "4 × 12 reps" in add_ex.text


def test_intensity_math_and_streak():
    item = RoutineExercise(
        routine_id=1, exercise_id="Pushups", sets=3, base_reps=10, base_weight_kg=None
    )
    assert compute_scaled_target(item, 0).formatted == "3 × 10 reps"
    assert compute_scaled_target(item, 1).formatted == "3 × 11 reps"
    assert compute_scaled_target(item, -1).formatted == "3 × 9 reps"
    assert apply_intensity_feedback(-5, "less") == -5

    from datetime import datetime, timedelta, timezone

    now = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
    logs = [
        WorkoutLog(user_id=1, routine_name="A", completed_at=now - timedelta(days=1)),
        WorkoutLog(user_id=1, routine_name="B", completed_at=now - timedelta(days=8)),
    ]
    assert compute_week_streak(logs, now=now) == 2


def test_pregenerated_svgs_motion_js_and_minimal_coaching(
    client: TestClient, session: Session
):
    written = pregenerate_all_svgs()
    assert len(written) == len(ARCHETYPE_SPECS) == 13

    for archetype in ARCHETYPE_SPECS:
        svg_path = SVGS_DIR / f"{archetype}.svg"
        assert svg_path.exists()
        root = ET.fromstring(svg_path.read_text(encoding="utf-8"))
        assert root.attrib.get("preserveAspectRatio") == "xMidYMid meet"
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])
        assert set(pose_a.keys()) == set(pose_b.keys())

        res = client.get(f"/static/svgs/{archetype}.svg")
        assert res.status_code == 200
        assert "image/svg+xml" in res.headers["content-type"]

    motion_res = client.get("/static/motion.js")
    assert motion_res.status_code == 200
    assert "TrainingMotion" in motion_res.text

    css_res = client.get("/static/style.css")
    assert css_res.status_code == 200
    assert "100dvh" in css_res.text
    assert "narrow-shell" not in css_res.text

    for meta in ARCHETYPE_COACHING.values():
        assert len(meta["cue_work"].split()) <= 2
        assert len(meta["cue_return"].split()) <= 2

    squat = session.get(Exercise, "Bodyweight_Squat")
    plank = session.get(Exercise, "Plank")
    pushup = session.get(Exercise, "Pushups")
    assert squat and plank and pushup
    assert classify_archetype(squat) == "squat"
    assert classify_archetype(pushup) == "pushup"

    plank_guide = build_exercise_guidance(plank)
    assert plank_guide["archetype"] == "plank"
    assert plank_guide["is_hold"] is True
    assert plank_guide["unit"] == "sec"
