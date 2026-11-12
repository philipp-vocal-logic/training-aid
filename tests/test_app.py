# Copyright (c) 2026 Philipp Kaaden
"""End-to-end, kinematic, coaching, and asset test suite for Training Aid."""

import json
import math
import os
import re
import shutil
import subprocess
import tomllib
import xml.etree.ElementTree as ET
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from training_aid.coaching import (
    ARCHETYPE_COACHING,
    EXERCISE_COACHING,
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
    load_programs_config,
    seed_exercises,
)
from training_aid.svg_assets import (
    ANIMATIONS_JSON,
    ARCHETYPE_SPECS,
    BONE_KEYS,
    POSE_KEYS,
    STD_BONES,
    SVGS_DIR,
    compile_animation_spec,
    compute_shadow,
    evaluate_archetype_pose,
    lerp_pose,
    load_svg_markup,
    normalize_equipment,
    pregenerate_all_svgs,
    render_archetype_svg,
    solve_fk,
)


def _parse_svg(svg_markup: str) -> ET.Element:
    """Parse trusted in-process SVG markup into an ElementTree element."""
    return ET.fromstring(svg_markup)  # noqa: S314


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


@pytest.fixture
def session() -> Generator[Session]:
    """Provide an isolated in-memory SQLite session seeded with exercises."""
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    with Session(test_engine) as db:
        seed_exercises(db)
        yield db


@pytest.fixture
def client(session: Session) -> Generator[TestClient]:
    """Provide a FastAPI TestClient wired to the isolated test database session."""

    def override_get_session() -> Generator[Session]:
        yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as tc:
        yield tc
    app.dependency_overrides.clear()


def test_first_visit_opens_fullscreen_minimal_setup(client: TestClient) -> None:
    """Verify initial visit redirects to the minimal split-screen setup view."""
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
    assert "Answer 4 quick questions" not in res.text


def test_exercise_seeding_and_all_equipment_programs(session: Session) -> None:
    """Verify exercise catalog seeding covers all curated equipment program entries."""
    exercises = session.exec(select(Exercise)).all()
    assert len(exercises) > 800

    for eq_key, prog in EQUIPMENT_PROGRAMS.items():
        for _routine_name, specs in prog["routines"]:
            for ex_id, *_ in specs:
                assert session.get(Exercise, ex_id) is not None, (
                    f"Missing exercise {ex_id} in {eq_key}"
                )


def test_onboarding_builds_tailored_body_only_light_plan(
    client: TestClient,
    session: Session,
) -> None:
    """Verify setup form creates a tailored bodyweight light plan."""
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
    assert "Philipp \u00b7 0/2" in res.text
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
    client: TestClient,
    session: Session,
) -> None:
    """Verify guided workout flow, intensity feedback scaling, and progress view."""
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

    ws = client.get(f"/workouts/{day1.id}")
    assert ws.status_code == 200
    assert 'class="topbar"' not in ws.text
    assert 'class="workout-viewport"' in ws.text
    assert 'class="workout-svg-canvas"' in ws.text
    assert "1/4 \u00b7 S1/3" in ws.text
    assert "data-pose-a=" in ws.text
    assert "data-pose-b=" in ws.text
    assert "startSignal()" in ws.text
    assert "What to do:" not in ws.text
    assert "+10%" in ws.text
    assert "\u221210%" in ws.text

    done_more = client.post(
        f"/workouts/{day1.id}/complete",
        data={"next_intensity_choice": "more"},
        follow_redirects=True,
    )
    assert done_more.status_code == 200
    assert "+10%" in done_more.text
    assert day2.name in done_more.text
    assert "3 \u00d7 8 @ 44 kg" in done_more.text

    done_less = client.post(
        f"/workouts/{day2.id}/complete",
        data={"next_intensity_choice": "less"},
        follow_redirects=True,
    )
    assert done_less.status_code == 200
    assert "\u221210%" in done_less.text
    assert "3 \u00d7 8 @ 36 kg" in done_less.text

    prog = client.get("/progress")
    assert prog.status_code == 200
    assert 'class="progress-screen"' in prog.text
    assert "Done" in prog.text
    assert "Streak" in prog.text
    assert "Load" in prog.text
    assert "+10%" in prog.text
    assert "\u221210%" in prog.text


def test_simple_routine_customization_with_svg_thumbnails(
    client: TestClient,
    session: Session,
) -> None:
    """Verify routine day creation, SVG search thumbnails, and adding exercises."""
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
    assert "4 \u00d7 12 reps" in add_ex.text


def test_intensity_math_and_streak() -> None:
    """Verify rep scaling math, intensity floor clamping, and weekly streaks."""
    item = RoutineExercise(
        routine_id=1, exercise_id="Pushups", sets=3, base_reps=10, base_weight_kg=None
    )
    assert compute_scaled_target(item, 0).formatted == "3 \u00d7 10 reps"
    assert compute_scaled_target(item, 1).formatted == "3 \u00d7 11 reps"
    assert compute_scaled_target(item, -1).formatted == "3 \u00d7 9 reps"
    assert apply_intensity_feedback(-5, "less") == -5

    now = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)
    logs = [
        WorkoutLog(user_id=1, routine_name="A", completed_at=now - timedelta(days=1)),
        WorkoutLog(user_id=1, routine_name="B", completed_at=now - timedelta(days=8)),
    ]
    assert compute_week_streak(logs, now=now) == 2


def test_pregenerated_svgs_motion_js_and_minimal_coaching(
    client: TestClient,
    session: Session,
) -> None:
    """Verify pregenerated SVGs, static assets, and minimal coaching metadata."""
    written = pregenerate_all_svgs()
    assert len(written) == len(ARCHETYPE_SPECS) == len(ARCHETYPE_COACHING) == 18
    assert set(ARCHETYPE_SPECS.keys()) == set(ARCHETYPE_COACHING.keys())

    for archetype in ARCHETYPE_SPECS:
        svg_path = SVGS_DIR / f"{archetype}.svg"
        assert svg_path.exists()
        root = _parse_svg(svg_path.read_text(encoding="utf-8"))
        assert root.attrib.get("preserveAspectRatio") == "xMidYMid meet"
        assert root.attrib.get("viewBox") == "0 0 240 200"
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])
        bones = json.loads(root.attrib["data-bones"])
        assert set(pose_a.keys()) == set(pose_b.keys())
        assert set(BONE_KEYS).issubset(bones.keys())

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
    assert squat is not None
    assert plank is not None
    assert pushup is not None
    assert classify_archetype(squat) == "squat"
    assert classify_archetype(pushup) == "pushup"

    plank_guide = build_exercise_guidance(plank)
    assert plank_guide["archetype"] == "plank"
    assert plank_guide["is_hold"] is True
    assert plank_guide["unit"] == "sec"


def _assert_rig_kinematics_and_bounds(
    archetype: str,
    bones: dict[str, float],
    pose_a: dict[str, float],
    pose_b: dict[str, float],
) -> None:
    segment_pairs = (
        ("hip", "mid_spine", "lumbar"),
        ("mid_spine", "shoulder", "thoracic"),
        ("shoulder", "head", "neck"),
        ("shoulder", "elbow_f", "uarm"),
        ("elbow_f", "hand_f", "farm"),
        ("shoulder_b", "elbow_b", "uarm"),
        ("elbow_b", "hand_b", "farm"),
        ("hip", "knee_f", "thigh"),
        ("knee_f", "foot_f", "shin"),
        ("hip_b", "knee_b", "thigh"),
        ("knee_b", "foot_b", "shin"),
    )
    for swap in (False, True):
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            pose = lerp_pose(pose_a, pose_b, t)
            pts = solve_fk(bones, pose, swap_sides=swap)

            for p1_key, p2_key, bone_key in segment_pairs:
                assert _dist(pts[p1_key], pts[p2_key]) == pytest.approx(
                    bones[bone_key], abs=1e-9
                )

            for joint_name, (jx, jy) in pts.items():
                assert 0.0 <= jx <= 240.0, (
                    f"{archetype} t={t} {joint_name} x={jx} outside viewBox"
                )
                assert 0.0 <= jy <= 174.0, (
                    f"{archetype} t={t} {joint_name} y={jy} penetrates floor/top"
                )
            hx, hy = pts["head"]
            assert 11.5 <= hx <= 228.5, (
                f"{archetype} t={t} head x clips outside bounds: ({hx}, {hy})"
            )
            assert 11.5 <= hy <= 174.0, (
                f"{archetype} t={t} head y clips outside bounds: ({hx}, {hy})"
            )


def test_fk_zero_bone_distortion_and_viewport_bounds_all_18_archetypes() -> None:
    """Verify zero bone-length distortion and viewport bounds for all archetypes."""
    assert len(ARCHETYPE_SPECS) == 18

    for archetype in ARCHETYPE_SPECS:
        svg_text = render_archetype_svg(archetype, thumbnail=False)
        root = _parse_svg(svg_text)
        bones = json.loads(root.attrib["data-bones"])
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])

        torso_el = root.find(".//*[@class='js-torso']")
        neck_el = root.find(".//*[@class='js-neck']")
        assert torso_el is not None
        assert torso_el.tag.endswith("path")
        assert " Q " in torso_el.attrib.get("d", "")
        assert neck_el is not None
        assert neck_el.tag.endswith("line")

        j0 = solve_fk(bones, lerp_pose(pose_a, pose_b, 0.0))
        expected_cx, expected_rx = compute_shadow(j0)
        shadow_el = root.find(".//*[@class='js-shadow']")
        assert shadow_el is not None
        assert float(shadow_el.attrib["cx"]) == pytest.approx(expected_cx, abs=0.05)
        assert float(shadow_el.attrib["rx"]) == pytest.approx(expected_rx, abs=0.05)

        _assert_rig_kinematics_and_bounds(archetype, bones, pose_a, pose_b)

    # Overhead press uses sagittal / 3/4 profile (non-zero back-shoulder offset)
    ohp_j0 = solve_fk(
        ARCHETYPE_SPECS["overhead_press"]["bones"],
        ARCHETYPE_SPECS["overhead_press"]["pose_a"],
    )
    assert ohp_j0["shoulder"] != ohp_j0["shoulder_b"]

    # Floor archetypes center aura lower than standing archetypes
    plank_aura = _parse_svg(render_archetype_svg("plank")).find(
        ".//*[@class='js-aura']"
    )
    squat_aura = _parse_svg(render_archetype_svg("squat")).find(
        ".//*[@class='js-aura']"
    )
    assert plank_aura is not None
    assert squat_aura is not None
    assert float(plank_aura.attrib["cy"]) > float(squat_aura.attrib["cy"]) + 15.0


def test_decoupled_equipment_props_and_baked_thumbnails() -> None:
    """Verify equipment-specific SVG props and peak-pose static thumbnails."""
    bb_squat = _parse_svg(render_archetype_svg("squat", equipment="barbell"))
    assert bb_squat.attrib.get("data-equipment") == "barbell"
    assert bb_squat.attrib.get("data-bar-mode") == "shoulder"
    assert bb_squat.find(".//*[@class='js-bar-shaft']") is not None
    assert bb_squat.find(".//*[@class='js-weight']") is not None

    bw_row = _parse_svg(render_archetype_svg("row_pull", equipment="body only"))
    bw_hinge = _parse_svg(render_archetype_svg("hinge", equipment="body only"))
    assert bw_row.find(".//*[@class='js-weight']") is None
    assert bw_hinge.find(".//*[@class='js-weight']") is None

    band_hinge = _parse_svg(render_archetype_svg("hinge", equipment="bands"))
    assert band_hinge.attrib.get("data-equipment") == "bands"
    assert "data-anchor-x" in band_hinge.attrib
    assert "data-anchor-y" in band_hinge.attrib
    assert band_hinge.find(".//*[@class='js-band-f']") is not None
    assert band_hinge.find(".//*[@class='js-band-b']") is not None
    assert band_hinge.find(".//*[@class='js-weight']") is None

    cable_pull = _parse_svg(render_archetype_svg("vertical_pull", equipment="cable"))
    assert cable_pull.find(".//*[@class='js-cable']") is not None
    assert cable_pull.find(".//*[@class='js-cable-grip']") is not None

    kb_squat = _parse_svg(render_archetype_svg("squat", equipment="kettlebells"))
    assert kb_squat.find(".//*[@class='js-kb-handle-f']") is not None
    assert kb_squat.find(".//*[@class='js-weight']") is not None

    pregenerate_all_svgs()
    for archetype in ARCHETYPE_SPECS:
        static_svg = (SVGS_DIR / f"{archetype}.svg").read_text(encoding="utf-8")
        live_t0_svg = load_svg_markup(archetype)
        baked_thumb_svg = render_archetype_svg(archetype, thumbnail=True)
        assert static_svg == baked_thumb_svg
        assert static_svg != live_t0_svg


def test_expanded_taxonomy_accuracy_holds_and_tempo_metadata(session: Session) -> None:
    """Verify exercise archetype classification, hold units, and tempo modes."""
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
            == "2 \u00d7 30 sec"
        )

    jump_squat = session.get(Exercise, "Freehand_Jump_Squat")
    air_bike = session.get(Exercise, "Air_Bike")
    band_skull = session.get(Exercise, "Band_Skull_Crusher")
    barbell_squat = session.get(Exercise, "Barbell_Full_Squat")
    assert jump_squat is not None
    assert air_bike is not None
    assert band_skull is not None
    assert barbell_squat is not None

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
    client: TestClient,
    session: Session,
) -> None:
    """Verify SVG aria-labels, motion.js DOM selector caching, and HTTP UI routes."""
    for archetype in ARCHETYPE_SPECS:
        root = _parse_svg(render_archetype_svg(archetype))
        aria_label = root.attrib.get("aria-label", "")
        assert aria_label
        assert "_" not in aria_label
        assert aria_label[0].isupper()

    # motion.js exposes required API with zero querySelector calls inside render loop
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

    style_css = client.get("/static/style.css").text
    assert "@media (prefers-reduced-motion: reduce)" in style_css

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


def test_svg_public_api_and_ruff_config_contract() -> None:
    """Verify svg_assets public helpers and pyproject.toml Ruff configuration."""
    assert len(POSE_KEYS) == 13
    assert set(STD_BONES.keys()) == set(BONE_KEYS)
    assert normalize_equipment("e-z curl bar", "curl") == "barbell"
    assert normalize_equipment(None, "vertical_pull") == "cable"

    mid_joints = evaluate_archetype_pose("mountain_climber", 0.5, swap_sides=True)
    assert "hip" in mid_joints
    assert "hand_f" in mid_joints

    pyproject_path = Path(__file__).resolve().parents[1] / "pyproject.toml"
    pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    assert pyproject["project"]["name"] == "training-aid"

    tool_cfg = pyproject.get("tool", {})
    if "ruff" in tool_cfg:
        ruff_cfg = tool_cfg["ruff"]
        assert "format" in ruff_cfg
        assert "lint" in ruff_cfg
        lint_cfg = ruff_cfg["lint"]
        assert "ALL" in lint_cfg.get("select", [])
        assert "N" in lint_cfg.get("extend-select", []) or "N" in lint_cfg.get(
            "select", []
        )
        assert "pep8-naming" in lint_cfg


def test_declarative_animations_json_and_ik_compiler() -> None:
    """Verify animations.json unifies rig + coaching config with declarative IK."""
    raw = json.loads(ANIMATIONS_JSON.read_text(encoding="utf-8"))
    assert {"std_bones", "equipment_aliases", "animations"} <= set(raw.keys())
    animations = raw["animations"]
    assert set(animations.keys()) == set(ARCHETYPE_SPECS.keys())

    grounded = (
        "squat",
        "lunge",
        "pushup",
        "plank",
        "hinge",
        "glute_bridge",
        "dip",
        "calf_raise",
    )
    for arch in grounded:
        pose_a_cfg = animations[arch]["pose_a"]
        has_ik = any(
            isinstance(pose_a_cfg[limb], dict) and "target" in pose_a_cfg[limb]
            for limb in ("arm_f", "arm_b", "leg_f", "leg_b")
        )
        assert has_ik, f"{arch} should preserve declarative IK targets in animations"

    for arch, cfg in animations.items():
        compiled = compile_animation_spec(cfg, STD_BONES)
        assert compiled["pose_a"] == ARCHETYPE_SPECS[arch]["pose_a"]
        assert compiled["pose_b"] == ARCHETYPE_SPECS[arch]["pose_b"]
        assert compiled["coaching"] == ARCHETYPE_COACHING[arch]

    plank_svg = _parse_svg(render_archetype_svg("plank"))
    squat_svg = _parse_svg(render_archetype_svg("squat"))
    bike_svg = _parse_svg(render_archetype_svg("bicycle_crunch"))
    assert plank_svg.attrib.get("data-hold-style") == "pulse"
    assert plank_svg.attrib.get("data-tempo-mode") == "hold"
    assert squat_svg.attrib.get("data-hold-style") == "settle"
    assert squat_svg.attrib.get("data-tempo-mode") == "standard"
    assert bike_svg.attrib.get("data-tempo-mode") == "alternating"


def test_declarative_exercise_coaching_and_programs_configs(session: Session) -> None:
    """Verify 2-tier exercise coaching and program configs without catalog pollution."""
    data_dir = Path(__file__).resolve().parents[1] / "data"
    catalog = json.loads((data_dir / "exercises.json").read_text(encoding="utf-8"))
    coaching_map = json.loads(
        (data_dir / "exercise_coaching.json").read_text(encoding="utf-8")
    )
    programs_cfg = load_programs_config(data_dir / "programs.json")

    expected_catalog_keys = {
        "id",
        "name",
        "force",
        "level",
        "mechanic",
        "equipment",
        "primaryMuscles",
        "secondaryMuscles",
        "instructions",
        "category",
        "images",
    }
    assert set(catalog[0].keys()) == expected_catalog_keys
    assert "pose_a" not in Exercise.model_fields
    assert "bones" not in Exercise.model_fields

    catalog_ids = {item["id"] for item in catalog}
    assert set(coaching_map.keys()) == catalog_ids
    assert set(EXERCISE_COACHING.keys()) == catalog_ids

    valid_tempos = {"standard", "explosive", "alternating", "hold"}
    for item in catalog:
        entry = coaching_map[item["id"]]
        assert entry["archetype"] in ARCHETYPE_SPECS
        assert entry["tempo_mode"] in valid_tempos
        if item.get("category") == "stretching":
            assert entry["is_hold"] is True
            assert entry["tempo_mode"] == "hold"

    box_jump = session.get(Exercise, "Box_Jump_Multiple_Response")
    ab_roller = session.get(Exercise, "Ab_Roller")
    shrug = session.get(Exercise, "Barbell_Shrug")
    side_bridge = session.get(Exercise, "Side_Bridge")
    assert box_jump is not None
    assert ab_roller is not None
    assert shrug is not None
    assert side_bridge is not None
    assert build_exercise_guidance(box_jump)["archetype"] == "squat"
    assert build_exercise_guidance(box_jump)["tempo_mode"] == "explosive"
    assert build_exercise_guidance(ab_roller)["archetype"] == "plank"
    assert build_exercise_guidance(ab_roller)["is_hold"] is False
    assert classify_archetype(shrug) == "row_pull"
    assert is_hold_exercise(side_bridge) is True

    synthetic = Exercise(
        id="Custom_Unlisted_Goblet_Jump_Squat",
        name="Custom Unlisted Goblet Jump Squat",
        category="strength",
        equipment="kettlebells",
        primary_muscle="quadriceps",
    )
    syn_guide = build_exercise_guidance(synthetic)
    assert syn_guide["archetype"] == "squat"
    assert syn_guide["tempo_mode"] == "explosive"

    assert programs_cfg["equipment_programs"] == EQUIPMENT_PROGRAMS
    assert set(programs_cfg["equipment_archetypes"].values()) <= set(ARCHETYPE_SPECS)


def test_templates_and_motion_js_have_zero_hardcoded_archetype_branches(
    client: TestClient,
) -> None:
    """Verify templates and motion.js delegate tempo/hold behavior to data attrs."""
    templates_dir = (
        Path(__file__).resolve().parents[1] / "src" / "training_aid" / "templates"
    )
    workout_tpl = (templates_dir / "workout_session.html").read_text(encoding="utf-8")
    overview_tpl = (templates_dir / "overview.html").read_text(encoding="utf-8")

    assert 'archetype === "plank"' not in workout_tpl
    assert "const TURNAROUND_BY_MODE" not in workout_tpl
    assert "applyHold(" in workout_tpl
    assert "turnaroundForMode(" in workout_tpl

    assert "mountain_climber" not in overview_tpl
    assert "bicycle_crunch" not in overview_tpl
    assert "rig.tempoMode" in overview_tpl

    motion_js = client.get("/static/motion.js").text
    for symbol in ("turnaroundForMode", "applyHold", "tempoMode", "holdStyle"):
        assert symbol in motion_js
    render_state_idx = motion_js.index("function renderPoseState")
    assert "querySelector" not in motion_js[render_state_idx:]


_EXPECTED_SOUND_THEMES: tuple[tuple[str, str], ...] = (
    ("off", "Off"),
    ("minimal", "Minimal Cues"),
    ("techno", "Techno Pulse"),
    ("trance", "Trance Arp"),
    ("studio", "Studio Kit"),
)

_EXPECTED_SOUND_SCALE: dict[str, float] = {
    "A2": 110.0,
    "C3": 130.81,
    "D3": 146.83,
    "E3": 164.81,
    "G3": 196.0,
    "A3": 220.0,
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "G4": 392.0,
    "A4": 440.0,
    "C5": 523.25,
    "E5": 659.25,
}

_TURNAROUND_BY_MODE: dict[str, float] = {
    "standard": 0.43,
    "explosive": 0.31,
    "alternating": 0.5,
    "hold": 1.0,
}

_SOUND_JS_HARNESS = """\
const fs = require("node:fs");
const motionPath = process.env.TA_MOTION_JS;
const soundPath = process.env.TA_SOUND_JS;
const coaching = JSON.parse(process.env.TA_COACHING_JSON);
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

globalThis.window = globalThis;

function makeParam(init) {
  return {
    value: init,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
  };
}

class MockAudioContext {
  constructor() {
    this.currentTime = 10.0;
    this.state = "running";
    this.sampleRate = 44100;
    this.destination = { kind: "dest" };
    this.sources = [];
    this.nodes = [];
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  _node(n) {
    this.nodes.push(n);
    return n;
  }
  _source(s) {
    this.sources.push(s);
    this.nodes.push(s);
    return s;
  }
  createOscillator() {
    return this._source({
      type: "sine",
      frequency: makeParam(440),
      started: false,
      immediateStopped: false,
      disconnected: false,
      onended: null,
      connect() {},
      disconnect() { this.disconnected = true; },
      start() { this.started = true; },
      stop(...args) { if (args.length === 0) this.immediateStopped = true; },
    });
  }
  createGain() {
    return this._node({
      gain: makeParam(1),
      disconnected: false,
      connect() {},
      disconnect() { this.disconnected = true; },
    });
  }
  createBiquadFilter() {
    return this._node({
      type: "lowpass",
      frequency: makeParam(1000),
      Q: makeParam(1),
      disconnected: false,
      connect() {},
      disconnect() { this.disconnected = true; },
    });
  }
  createBuffer(_ch, len, sr) {
    const arr = new Float32Array(len);
    return { sampleRate: sr, length: len, getChannelData: () => arr };
  }
  createBufferSource() {
    return this._source({
      buffer: null,
      started: false,
      immediateStopped: false,
      disconnected: false,
      onended: null,
      connect() {},
      disconnect() { this.disconnected = true; },
      start() { this.started = true; },
      stop(...args) { if (args.length === 0) this.immediateStopped = true; },
    });
  }
}
globalThis.AudioContext = MockAudioContext;

new Function(fs.readFileSync(motionPath, "utf8"))();
new Function(fs.readFileSync(soundPath, "utf8"))();

const TM = globalThis.TrainingMotion;
const TS = globalThis.TrainingSound;
assert(TM && TS, "TrainingMotion and TrainingSound must load");
assert(TS.STORAGE_KEY === "training_aid_sound_theme", "STORAGE_KEY mismatch");
assert(
  JSON.stringify(TS.THEMES.map((t) => [t.id, t.label])) ===
    JSON.stringify([
      ["off", "Off"],
      ["minimal", "Minimal Cues"],
      ["techno", "Techno Pulse"],
      ["trance", "Trance Arp"],
      ["studio", "Studio Kit"],
    ]),
  "THEMES mismatch"
);

for (const [arch, meta] of Object.entries(coaching)) {
  const expectedSub = meta.is_hold ? 2 : meta.rep_seconds >= 2.4 ? 8 : 4;
  assert(
    TS.subdivisionsForRep(meta.rep_seconds, meta.is_hold) === expectedSub,
    `subdivisions mismatch for ${arch}`
  );
  for (const silent of ["off", "minimal"]) {
    const emptyPat = TS.buildRepPattern({
      theme: silent,
      repSeconds: meta.rep_seconds,
    });
    assert(emptyPat.length === 0, `${silent} must return []`);
  }
  for (const theme of ["techno", "trance", "studio"]) {
    const pat = TS.buildRepPattern({
      theme,
      repSeconds: meta.rep_seconds,
      tempoMode: meta.tempo_mode,
      isHold: meta.is_hold,
      repIndex: 8,
      totalReps: 10,
    });
    assert(
      pat.length >= 1 && pat[0].role === "downbeat" && pat[0].offsetSec === 0,
      "downbeat"
    );
    assert(pat.every((e) => e.isFinalStretch === true), "final stretch");
    const early = TS.buildRepPattern({
      theme,
      repSeconds: meta.rep_seconds,
      tempoMode: meta.tempo_mode,
      isHold: meta.is_hold,
      repIndex: 0,
      totalReps: 10,
    });
    assert(early.every((e) => e.isFinalStretch === false), "early rep");
    const turns = pat.filter((e) => e.role === "turnaround");
    if (meta.is_hold) {
      assert(turns.length === 0, "hold omits turnaround");
    } else {
      const turnFrac = TM.turnaroundForMode(meta.tempo_mode);
      const expectedOff = Number((turnFrac * meta.rep_seconds).toFixed(4));
      assert(
        turns.length === 1 && turns[0].offsetSec === expectedOff,
        `turnaround ${arch}`
      );
      for (const sub of pat.filter((e) => e.role === "subdivision")) {
        assert(Math.abs(sub.offsetSec - expectedOff) >= 0.045, `flam ${arch}`);
      }
    }
  }
}

const tempoPairs = [
  ["explosive", 0.31],
  ["standard", 0.43],
  ["alternating", 0.5],
];
for (const [mode, frac] of tempoPairs) {
  for (const theme of ["techno", "trance", "studio"]) {
    const pat = TS.buildRepPattern({
      theme,
      repSeconds: 2.6,
      tempoMode: mode,
      isHold: false,
    });
    const turn = pat.find((e) => e.role === "turnaround");
    assert(
      turn && turn.offsetSec === Number((frac * 2.6).toFixed(4)),
      `mode ${mode}`
    );
  }
}

const store = {};
const mockStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const ctrl = TS.createController({
  turnaroundForMode: TM.turnaroundForMode,
  storage: mockStorage,
});
assert(ctrl.getTheme() === "minimal" && !ctrl.isMuted(), "default minimal");
ctrl.setTheme("trance");
assert(store[TS.STORAGE_KEY] === "trance", "persisted trance");
ctrl.toggleMute();
assert(
  ctrl.getTheme() === "off" &&
    ctrl.isMuted() &&
    store[TS.STORAGE_KEY] === "off",
  "muted"
);
ctrl.toggleMute();
assert(ctrl.getTheme() === "trance" && !ctrl.isMuted(), "restored trance");

const ctx = ctrl.ensureAudio();
assert(ctx instanceof MockAudioContext, "AudioContext created");
ctrl.beginPhase("ACTIVE", {
  repSeconds: 2.8,
  reps: 4,
  tempoMode: "standard",
  isHold: false,
});
assert(ctx.sources.length > 0, "lookahead primed");
ctx.currentTime = 10.65;
assert(Math.abs(ctrl.advancePhase(0.016) - 0.65) < 1e-6, "clock tracks currentTime");

const prePauseSources = ctx.sources.slice();
ctrl.pause();
assert(
  prePauseSources.every((s) => s.immediateStopped && s.disconnected),
  "pause cleanup"
);
assert(ctx.nodes.every((n) => n.disconnected), "pause disconnects nodes");
assert(Math.abs(ctrl.advancePhase(0.5) - 0.65) < 1e-6, "paused freezes elapsed");

ctrl.resume();
ctrl.toggleMute();
assert(Math.abs(ctrl.advancePhase(0.25) - 0.9) < 1e-6, "off falls back to dt");

ctrl.toggleMute();
const preStopCount = ctx.sources.length;
ctrl.startSignal();
assert(ctx.sources.length > preStopCount, "cue scheduled");
ctrl.stopAll();
assert(
  ctx.sources.every((s) => s.immediateStopped && s.disconnected),
  "stopAll cleanup"
);

process.stdout.write(JSON.stringify({ ok: true }));
"""


def _expected_subdivisions(rep_seconds: float, *, is_hold: bool) -> int:
    if is_hold:
        return 2
    return 8 if rep_seconds >= 2.4 else 4


def _verify_rep_grid(
    rep_seconds: float,
    tempo_mode: str,
    *,
    is_hold: bool,
    flam_guard: float,
) -> None:
    subdivs = _expected_subdivisions(rep_seconds, is_hold=is_hold)
    sub_offsets = [round((i * rep_seconds) / subdivs, 4) for i in range(1, subdivs)]
    assert all(0.0 < off < rep_seconds for off in sub_offsets)
    if is_hold:
        assert subdivs == 2
        assert sub_offsets == [round(rep_seconds / 2, 4)]
        return

    turnaround = _TURNAROUND_BY_MODE[tempo_mode]
    turn_offset = round(turnaround * rep_seconds, 4)
    assert 0.0 < turn_offset < rep_seconds
    kept_subs = [off for off in sub_offsets if abs(off - turn_offset) >= flam_guard]
    for off in kept_subs:
        assert abs(off - turn_offset) >= 0.045


def test_sound_js_asset_and_workout_hud_integration(
    client: TestClient,
    session: Session,
) -> None:
    """Verify /static/sound.js contract, 5-theme HUD selector, and zero audio assets."""
    repo_root = Path(__file__).resolve().parents[1]
    for folder in ("src", "data"):
        audio_files = [
            p
            for p in (repo_root / folder).rglob("*")
            if p.suffix.lower() in {".wav", ".mp3", ".ogg", ".flac", ".m4a"}
        ]
        assert audio_files == []

    sound_res = client.get("/static/sound.js")
    assert sound_res.status_code == 200
    assert "javascript" in sound_res.headers["content-type"]
    sound_js = sound_res.text

    for required in (
        "TrainingSound",
        "STORAGE_KEY",
        '"training_aid_sound_theme"',
        "THEMES",
        "subdivisionsForRep",
        "buildRepPattern",
        "createController",
    ):
        assert required in sound_js
    assert "rock" not in sound_js.lower()

    parsed_themes = re.findall(
        r'\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}',
        sound_js,
    )
    assert tuple(parsed_themes) == _EXPECTED_SOUND_THEMES

    client.post(
        "/setup",
        data={
            "name": "Morgan",
            "equipment": "body_only",
            "starting_intensity": "moderate",
            "days_per_week": "3",
        },
        follow_redirects=True,
    )
    routine = session.exec(
        select(WorkoutRoutine).order_by(WorkoutRoutine.day_order)
    ).first()
    assert routine is not None

    ws = client.get(f"/workouts/{routine.id}")
    assert ws.status_code == 200
    assert '<script src="/static/motion.js"></script>' in ws.text
    assert '<script src="/static/sound.js"></script>' in ws.text
    assert ws.text.index("/static/motion.js") < ws.text.index("/static/sound.js")

    select_match = re.search(
        r'<select[^>]*id="sound-theme-select"[^>]*>.*?</select>',
        ws.text,
        flags=re.DOTALL,
    )
    assert select_match is not None
    select_el = _parse_svg(select_match.group(0))
    options = [(opt.attrib.get("value", ""), (opt.text or "")) for opt in select_el]
    assert tuple(options) == _EXPECTED_SOUND_THEMES
    assert "rock" not in select_match.group(0).lower()

    for hud_contract in (
        'id="sound-toggle"',
        'id="icon-vol-on"',
        'id="icon-vol-off"',
        "window.TrainingSound.createController",
        "Sound.beginPhase(",
        "Sound.advancePhase(",
        "Sound.pause()",
        "Sound.resume()",
        "Sound.stopAll()",
        "Sound.startSignal()",
        "Sound.stopSet()",
        "Sound.workoutComplete()",
        "visibilitychange",
    ):
        assert hud_contract in ws.text

    style_css = client.get("/static/style.css").text
    assert ".hud-select" in style_css
    reduced_idx = style_css.index("@media (prefers-reduced-motion: reduce)")
    assert ".hud-select" in style_css[reduced_idx:]


def test_sound_kinematic_rhythm_and_controller_contract() -> None:
    """Verify subdivisions, kinematic turnarounds, scale, and controller invariants."""
    static_dir = Path(__file__).resolve().parents[1] / "src" / "training_aid" / "static"
    sound_js = (static_dir / "sound.js").read_text(encoding="utf-8")
    motion_js = (static_dir / "motion.js").read_text(encoding="utf-8")

    flam_match = re.search(r"FLAM_GUARD_SEC\s*=\s*([0-9.]+)", sound_js)
    lookahead_match = re.search(r"LOOKAHEAD_SEC\s*=\s*([0-9.]+)", sound_js)
    rest_match = re.search(r"REST_PULSE_INTERVAL_SEC\s*=\s*([0-9.]+)", sound_js)
    assert flam_match is not None
    assert lookahead_match is not None
    assert rest_match is not None
    flam_guard = float(flam_match.group(1))
    assert flam_guard >= 0.045
    assert float(lookahead_match.group(1)) == pytest.approx(0.14)
    assert float(rest_match.group(1)) == pytest.approx(2.0)

    scale_block = re.search(
        r"SCALE\s*=\s*Object\.freeze\(\{(.*?)\}\);",
        sound_js,
        re.DOTALL,
    )
    assert scale_block is not None
    parsed_scale = {
        note: float(hz)
        for note, hz in re.findall(r"([A-G]\d):\s*([0-9.]+)", scale_block.group(1))
    }
    assert parsed_scale == _EXPECTED_SOUND_SCALE

    for mode, frac in _TURNAROUND_BY_MODE.items():
        assert re.search(rf"{mode}:\s*{frac}\b", motion_js) is not None
        assert re.search(rf"{mode}:\s*{frac}\b", sound_js) is not None

    assert len(ARCHETYPE_COACHING) == 18
    subdiv_buckets: set[int] = set()
    for meta in ARCHETYPE_COACHING.values():
        rep_sec = float(meta["rep_seconds"])
        is_hold = bool(meta["is_hold"])
        mode = str(meta["tempo_mode"])
        subdiv_buckets.add(_expected_subdivisions(rep_sec, is_hold=is_hold))
        _verify_rep_grid(rep_sec, mode, is_hold=is_hold, flam_guard=flam_guard)
    assert subdiv_buckets == {2, 4, 8}

    for mode in ("explosive", "standard", "alternating"):
        _verify_rep_grid(2.6, mode, is_hold=False, flam_guard=flam_guard)

    for controller_invariant in (
        "storage.setItem(STORAGE_KEY, themeId)",
        'setTheme(lastActiveTheme || "minimal")',
        "audioCtx.currentTime - audioAnchorTime",
        "phaseElapsed += dt",
        "totalReps - repIndex <= (isHold ? 3 : 2)",
        "round4(turnaround * repSeconds)",
        "stopAllNodes()",
        "stopScheduledNodes()",
    ):
        assert controller_invariant in sound_js


def test_sound_js_behavioral_mock_webaudio_harness() -> None:
    """Verify motion.js + sound.js behavioral harness via Node when on PATH."""
    static_dir = Path(__file__).resolve().parents[1] / "src" / "training_aid" / "static"
    motion_path = static_dir / "motion.js"
    sound_path = static_dir / "sound.js"
    assert motion_path.is_file()
    assert sound_path.is_file()

    for js_path in (motion_path, sound_path):
        src = js_path.read_text(encoding="utf-8")
        assert src.count("{") == src.count("}")
        assert src.count("(") == src.count(")")

    node_bin = shutil.which("node")
    if node_bin is None:
        return

    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _SOUND_JS_HARNESS],
        env={
            **os.environ,
            "TA_MOTION_JS": str(motion_path),
            "TA_SOUND_JS": str(sound_path),
            "TA_COACHING_JSON": json.dumps(ARCHETYPE_COACHING),
        },
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert json.loads(proc.stdout) == {"ok": True}
