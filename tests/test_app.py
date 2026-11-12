from collections.abc import Generator
from datetime import datetime, timedelta, timezone
import json
import math
import xml.etree.ElementTree as ET

from fastapi.testclient import TestClient
import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from training_aid.coaching import (
    ARCHETYPE_COACHING,
    build_exercise_guidance,
    classify_archetype,
    is_hold_exercise,
)
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
from training_aid.svg_assets import (
    ARCHETYPE_SPECS,
    SVGS_DIR,
    compute_shadow,
    lerp_pose,
    load_svg_markup,
    pregenerate_all_svgs,
    render_archetype_svg,
    solve_fk,
)


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
    assert 'id="setup-prescription-pill"' in res.text
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
    assert len(written) == len(ARCHETYPE_SPECS) == len(ARCHETYPE_COACHING) == 18
    assert set(ARCHETYPE_SPECS.keys()) == set(ARCHETYPE_COACHING.keys())

    for archetype in ARCHETYPE_SPECS:
        svg_path = SVGS_DIR / f"{archetype}.svg"
        assert svg_path.exists()
        root = ET.fromstring(svg_path.read_text(encoding="utf-8"))
        assert root.attrib.get("preserveAspectRatio") == "xMidYMid meet"
        assert root.attrib.get("viewBox") == "0 0 240 200"
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])
        bones = json.loads(root.attrib["data-bones"])
        assert set(pose_a.keys()) == set(pose_b.keys())
        assert {
            "lumbar",
            "thoracic",
            "neck",
            "uarm",
            "farm",
            "thigh",
            "shin",
            "back_dx",
            "back_dy",
        }.issubset(bones.keys())

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
        assert meta["tempo_mode"] in {"standard", "explosive", "alternating", "hold"}

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


def test_fk_zero_bone_distortion_and_viewport_bounds_all_18_archetypes():
    def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1])

    sample_ts = (0.0, 0.25, 0.5, 0.75, 1.0)
    assert len(ARCHETYPE_SPECS) == 18

    for archetype in ARCHETYPE_SPECS:
        svg_text = render_archetype_svg(archetype, thumbnail=False)
        root = ET.fromstring(svg_text)
        bones = json.loads(root.attrib["data-bones"])
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])

        # 2-segment spine path + neck line must be present
        torso_el = root.find(".//*[@class='js-torso']")
        neck_el = root.find(".//*[@class='js-neck']")
        assert torso_el is not None and torso_el.tag.endswith("path")
        assert " Q " in torso_el.attrib.get("d", "")
        assert neck_el is not None and neck_el.tag.endswith("line")

        # Initial t=0 shadow matches compute_shadow
        j0 = solve_fk(bones, lerp_pose(pose_a, pose_b, 0.0))
        expected_cx, expected_rx = compute_shadow(j0)
        shadow_el = root.find(".//*[@class='js-shadow']")
        assert shadow_el is not None
        assert float(shadow_el.attrib["cx"]) == pytest.approx(expected_cx, abs=0.05)
        assert float(shadow_el.attrib["rx"]) == pytest.approx(expected_rx, abs=0.05)

        for swap in (False, True):
            for t in sample_ts:
                pose = lerp_pose(pose_a, pose_b, t)
                pts = solve_fk(bones, pose, swap_sides=swap)

                # 0.0% bone-length distortion across every segment (front and back)
                assert dist(pts["hip"], pts["mid_spine"]) == pytest.approx(
                    bones["lumbar"], abs=1e-9
                )
                assert dist(pts["mid_spine"], pts["shoulder"]) == pytest.approx(
                    bones["thoracic"], abs=1e-9
                )
                assert dist(pts["shoulder"], pts["head"]) == pytest.approx(
                    bones["neck"], abs=1e-9
                )
                assert dist(pts["shoulder"], pts["elbow_f"]) == pytest.approx(
                    bones["uarm"], abs=1e-9
                )
                assert dist(pts["elbow_f"], pts["hand_f"]) == pytest.approx(
                    bones["farm"], abs=1e-9
                )
                assert dist(pts["shoulder_b"], pts["elbow_b"]) == pytest.approx(
                    bones["uarm"], abs=1e-9
                )
                assert dist(pts["elbow_b"], pts["hand_b"]) == pytest.approx(
                    bones["farm"], abs=1e-9
                )
                assert dist(pts["hip"], pts["knee_f"]) == pytest.approx(
                    bones["thigh"], abs=1e-9
                )
                assert dist(pts["knee_f"], pts["foot_f"]) == pytest.approx(
                    bones["shin"], abs=1e-9
                )
                assert dist(pts["hip_b"], pts["knee_b"]) == pytest.approx(
                    bones["thigh"], abs=1e-9
                )
                assert dist(pts["knee_b"], pts["foot_b"]) == pytest.approx(
                    bones["shin"], abs=1e-9
                )

                # Viewport (0..240 x 0..200) & floor (y <= 174) bounds
                for joint_name, (jx, jy) in pts.items():
                    assert 0.0 <= jx <= 240.0, (
                        f"{archetype} t={t} {joint_name} x={jx} outside viewBox"
                    )
                    assert 0.0 <= jy <= 174.0, (
                        f"{archetype} t={t} {joint_name} y={jy} penetrates floor/top"
                    )
                hx, hy = pts["head"]
                assert 11.5 <= hx <= 228.5 and 11.5 <= hy <= 174.0, (
                    f"{archetype} t={t} head circle clips outside bounds: ({hx}, {hy})"
                )

    # Overhead press uses sagittal / 3/4 profile (non-zero back-shoulder offset, arms in front)
    ohp_j0 = solve_fk(
        ARCHETYPE_SPECS["overhead_press"]["bones"],
        ARCHETYPE_SPECS["overhead_press"]["pose_a"],
    )
    assert ohp_j0["shoulder"] != ohp_j0["shoulder_b"]

    # Floor archetypes center aura lower than standing archetypes
    plank_aura = ET.fromstring(render_archetype_svg("plank")).find(
        ".//*[@class='js-aura']"
    )
    squat_aura = ET.fromstring(render_archetype_svg("squat")).find(
        ".//*[@class='js-aura']"
    )
    assert plank_aura is not None and squat_aura is not None
    assert float(plank_aura.attrib["cy"]) > float(squat_aura.attrib["cy"]) + 15.0


def test_decoupled_equipment_props_and_baked_thumbnails():
    # Barbell squat renders back-rack barbell shaft + plates
    bb_squat = ET.fromstring(render_archetype_svg("squat", equipment="barbell"))
    assert bb_squat.attrib.get("data-equipment") == "barbell"
    assert bb_squat.attrib.get("data-bar-mode") == "shoulder"
    assert bb_squat.find(".//*[@class='js-bar-shaft']") is not None
    assert bb_squat.find(".//*[@class='js-weight']") is not None

    # Bodyweight row and hinge render zero handheld weights
    bw_row = ET.fromstring(render_archetype_svg("row_pull", equipment="body only"))
    bw_hinge = ET.fromstring(render_archetype_svg("hinge", equipment="body only"))
    assert bw_row.find(".//*[@class='js-weight']") is None
    assert bw_hinge.find(".//*[@class='js-weight']") is None

    # Band exercises render taut band lines from anchor without green dumbbell circles
    band_hinge = ET.fromstring(render_archetype_svg("hinge", equipment="bands"))
    assert band_hinge.attrib.get("data-equipment") == "bands"
    assert "data-anchor-x" in band_hinge.attrib and "data-anchor-y" in band_hinge.attrib
    assert band_hinge.find(".//*[@class='js-band-f']") is not None
    assert band_hinge.find(".//*[@class='js-band-b']") is not None
    assert band_hinge.find(".//*[@class='js-weight']") is None

    # Cable exercises render taut cable line + grip
    cable_pull = ET.fromstring(
        render_archetype_svg("vertical_pull", equipment="cable")
    )
    assert cable_pull.find(".//*[@class='js-cable']") is not None
    assert cable_pull.find(".//*[@class='js-cable-grip']") is not None

    # Kettlebell squat renders kettlebell handle + bell
    kb_squat = ET.fromstring(render_archetype_svg("squat", equipment="kettlebells"))
    assert kb_squat.find(".//*[@class='js-kb-handle-f']") is not None
    assert kb_squat.find(".//*[@class='js-weight']") is not None

    # Pregenerated static thumbnails are baked near pose_b (t=0.9), distinct from t=0
    pregenerate_all_svgs()
    for archetype in ARCHETYPE_SPECS:
        static_svg = (SVGS_DIR / f"{archetype}.svg").read_text(encoding="utf-8")
        live_t0_svg = load_svg_markup(archetype)
        baked_thumb_svg = render_archetype_svg(archetype, thumbnail=True)
        assert static_svg == baked_thumb_svg
        assert static_svg != live_t0_svg


def test_expanded_taxonomy_accuracy_holds_and_tempo_metadata(session: Session):
    expected_mappings = {
        "Wide-Grip_Lat_Pulldown": "vertical_pull",
        "Pullups": "vertical_pull",
        "Band_Skull_Crusher": "triceps_extension",
        "Leg_Extensions": "leg_extension_curl",
        "Lying_Leg_Curls": "leg_extension_curl",
        "Hyperextensions_Back_Extensions": "hinge",
        "Air_Bike": "bicycle_crunch",
        "Standing_Calf_Raises": "calf_raise",
    }
    for ex_id, expected_arch in expected_mappings.items():
        ex = session.get(Exercise, ex_id)
        assert ex is not None, f"Missing seeded exercise {ex_id}"
        assert classify_archetype(ex) == expected_arch, (
            f"{ex_id} classified as {classify_archetype(ex)}, expected {expected_arch}"
        )

    # Stretching and isometric hold exercises map to is_hold=True & "sec" units
    stretches = list(
        session.exec(
            select(Exercise).where(Exercise.category == "stretching").limit(10)
        ).all()
    )
    assert len(stretches) > 0
    for stretch_ex in stretches:
        assert is_hold_exercise(stretch_ex) is True
        assert is_hold_exercise(stretch_ex.id) is True
        guide = build_exercise_guidance(stretch_ex)
        assert guide["is_hold"] is True
        assert guide["unit"] == "sec"
        assert guide["tempo_mode"] == "hold"

        hold_item = RoutineExercise(
            routine_id=1,
            exercise_id=stretch_ex.id,
            sets=2,
            base_reps=30,
            base_weight_kg=None,
        )
        assert (
            compute_scaled_target(hold_item, 0, exercise=stretch_ex).formatted
            == "2 × 30 sec"
        )

    # Explosive & alternating metadata plus equipment-aware guidance SVG
    jump_squat = session.get(Exercise, "Freehand_Jump_Squat")
    air_bike = session.get(Exercise, "Air_Bike")
    band_skull = session.get(Exercise, "Band_Skull_Crusher")
    barbell_squat = session.get(Exercise, "Barbell_Full_Squat")
    assert jump_squat and air_bike and band_skull and barbell_squat

    assert build_exercise_guidance(jump_squat)["tempo_mode"] == "explosive"
    air_guide = build_exercise_guidance(air_bike)
    assert air_guide["tempo_mode"] == "alternating"
    assert air_guide["is_alternating"] is True

    band_guide = build_exercise_guidance(band_skull)
    assert "js-band-f" in band_guide["svg_markup"]
    assert "js-weight" not in band_guide["svg_markup"]

    bb_guide = build_exercise_guidance(barbell_squat)
    assert "js-bar-shaft" in bb_guide["svg_markup"]


def test_accessibility_motion_js_selector_caching_and_ui_routes(
    client: TestClient, session: Session
):
    # Human-readable aria-labels with zero raw underscores on all 18 archetypes
    for archetype in ARCHETYPE_SPECS:
        root = ET.fromstring(render_archetype_svg(archetype))
        aria_label = root.attrib.get("aria-label", "")
        assert aria_label and "_" not in aria_label and aria_label[0].isupper()

    # motion.js exposes required API and performs zero querySelector calls inside applyPose
    motion_js = client.get("/static/motion.js").text
    for symbol in (
        "tempoCurve",
        "applyRestBreath",
        "swapSides",
        "prefersReducedMotion",
    ):
        assert symbol in motion_js
    render_state_idx = motion_js.index("function renderPoseState")
    assert "querySelector" in motion_js[:render_state_idx]
    assert "querySelector" not in motion_js[render_state_idx:]

    # style.css includes reduced-motion media query
    style_css = client.get("/static/style.css").text
    assert "@media (prefers-reduced-motion: reduce)" in style_css

    # Verify HTTP routes (/setup, /, /workouts/{id}, /progress, /routines/{id}/edit)
    setup_res = client.get("/setup")
    assert setup_res.status_code == 200
    assert 'id="setup-prescription-pill"' in setup_res.text

    client.post(
        "/setup",
        data={
            "name": "Alex",
            "equipment": "kettlebell_bands",
            "starting_intensity": "moderate",
            "days_per_week": "3",
        },
        follow_redirects=True,
    )

    overview_res = client.get("/")
    assert overview_res.status_code == 200
    assert "data-svg-key=" in overview_res.text
    assert "kettlebells" in overview_res.text or "js-kb-handle-f" in overview_res.text

    routines = list(
        session.exec(select(WorkoutRoutine).order_by(WorkoutRoutine.day_order)).all()
    )
    assert len(routines) == 3

    # Day 2 (Band & Core) workout renders band props and biomechanical motion hooks
    workout_res = client.get(f"/workouts/{routines[1].id}")
    assert workout_res.status_code == 200
    assert "tempoCurve" in workout_res.text
    assert "applyRestBreath" in workout_res.text
    assert "swapSides" in workout_res.text
    assert "js-band-f" in workout_res.text

    progress_res = client.get("/progress")
    assert progress_res.status_code == 200
    assert "prefersReducedMotion" in progress_res.text

    edit_res = client.get(f"/routines/{routines[0].id}/edit")
    assert edit_res.status_code == 200
    assert 'class="editor-screen"' in edit_res.text
