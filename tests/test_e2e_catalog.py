# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog, CLI, safe-grip, thumbnail, prescription, and workout tests."""

from __future__ import annotations

import html
import json
import math
import re
import subprocess
import sys
import tomllib
import xml.etree.ElementTree as ET
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, col, create_engine, select
from sqlmodel.pool import StaticPool

from training_aid import audit
from training_aid.audit import (
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_CATALOG_COUNT,
    AuditReport,
    AuditSectionResult,
    run_catalog_audit,
    verify_motion_js_safe_grip,
)
from training_aid.coaching import (
    EXERCISE_COACHING,
    build_exercise_guidance,
    classify_archetype,
)
from training_aid.database import get_session
from training_aid.main import app, search_exercises_for_user
from training_aid.models import (
    Exercise,
    RoutineExercise,
    TrainingPlan,
    User,
)
from training_aid.services import (
    EQUIPMENT_PROGRAMS,
    compute_scaled_target,
    default_prescription_for_exercise,
    seed_exercises,
)
from training_aid.svg_assets import (
    ANIMATIONS_JSON,
    ARCHETYPE_SPECS,
    lerp_pose,
    normalize_equipment,
    render_archetype_svg,
    solve_fk,
)

if TYPE_CHECKING:
    from collections.abc import Generator
    from pathlib import Path

REPO_ROOT = audit.REPO_ROOT


def _parse_svg(svg_markup: str) -> ET.Element:
    """Parse trusted in-process SVG markup into an ElementTree element."""
    return ET.fromstring(svg_markup)  # noqa: S314


@pytest.fixture(scope="module")
def catalog_report() -> AuditReport:
    """Run the full 876-exercise E2E catalog audit once per test module."""
    return run_catalog_audit()


@pytest.fixture
def session() -> Generator[Session]:
    """Provide an isolated in-memory SQLite session seeded with all 876 exercises."""
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
    """Provide a FastAPI TestClient wired to the isolated test session."""

    def override_get_session() -> Generator[Session]:
        yield session

    prev = dict(app.dependency_overrides)
    app.dependency_overrides[get_session] = override_get_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev)


def test_run_catalog_audit_passes_all_876_exercises(
    catalog_report: AuditReport,
) -> None:
    """Verify run_catalog_audit() passes every section across all 876 exercises."""
    assert catalog_report.exercise_count == EXPECTED_CATALOG_COUNT == 876
    assert catalog_report.archetype_count == EXPECTED_ARCHETYPE_COUNT == 18
    assert catalog_report.errors == []
    assert catalog_report.passed is True

    expected_sections = (
        "catalog_seeding",
        "coaching_integration",
        "animations_and_safe_grip",
        "programs_and_customizer_e2e",
    )
    assert tuple(sec.name for sec in catalog_report.sections) == expected_sections
    for sec in catalog_report.sections:
        assert sec.checked == 876
        assert sec.passed is True
        assert sec.errors == ()


def test_cli_script_packaging_readme_and_exit_codes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Verify training-aid-check script wiring, README docs, and CLI exit codes."""
    pyproject = tomllib.loads(
        (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    )
    scripts = pyproject["project"]["scripts"]
    assert scripts.get("training-aid-check") == "training_aid.audit:main"

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "uv run training-aid-check" in readme

    passing_report = AuditReport(
        exercise_count=876,
        archetype_count=18,
        sections=(AuditSectionResult("catalog_seeding", 876, ()),),
    )
    monkeypatch.setattr(audit, "run_catalog_audit", lambda: passing_report)
    with pytest.raises(SystemExit) as ok_exc:
        audit.main()
    assert ok_exc.value.code == 0

    failing_report = AuditReport(
        exercise_count=876,
        archetype_count=18,
        sections=(AuditSectionResult("catalog_seeding", 876, ("injected failure",)),),
    )
    monkeypatch.setattr(audit, "run_catalog_audit", lambda: failing_report)
    with pytest.raises(SystemExit) as fail_exc:
        audit.main()
    assert fail_exc.value.code == 1

    bad_motion = tmp_path / "bad_motion.js"
    bad_motion.write_text(
        "function renderPoseState() {\n"
        '  if (barMode === "shoulder") {}\n'
        "  Math.min(165, 1);\n"
        "}\n",
        encoding="utf-8",
    )
    bad_errs = verify_motion_js_safe_grip(bad_motion, [("squat", "barbell")])
    assert any("shoulder" in e for e in bad_errs)
    assert any("Math.min" in e for e in bad_errs)


def test_cli_subprocess_execution() -> None:
    """Verify invoking python -m training_aid.audit exits 0 with summary output."""
    proc = subprocess.run(
        [sys.executable, "-m", "training_aid.audit"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, f"CLI failed:\n{proc.stdout}\n{proc.stderr}"
    assert "876 exercises, 18 archetypes" in proc.stdout
    assert "PASSED" in proc.stdout


def test_safe_grip_and_floor_bounds_across_catalog_and_motion_js(
    session: Session,
) -> None:
    """Verify hands always grip weights and props never penetrate y=175 floor."""
    raw_anim = json.loads(ANIMATIONS_JSON.read_text(encoding="utf-8"))["animations"]
    for arch, cfg in raw_anim.items():
        assert cfg.get("bar_mode") != "shoulder", f"{arch} uses detached shoulder mode"
        assert ARCHETYPE_SPECS[arch]["bar_mode"] == "hands"

    for rack_arch in ("squat", "lunge", "calf_raise"):
        spec = ARCHETYPE_SPECS[rack_arch]
        for t in (0.0, 0.5, 1.0):
            pts = solve_fk(spec["bones"], lerp_pose(spec["pose_a"], spec["pose_b"], t))
            assert pts["hand_f"][1] < pts["mid_spine"][1]
            assert (
                math.hypot(
                    pts["hand_f"][0] - pts["shoulder"][0],
                    pts["hand_f"][1] - pts["shoulder"][1],
                )
                <= 28.0
            )

    exercises = list(session.exec(select(Exercise).order_by(col(Exercise.id))).all())
    assert len(exercises) == 876
    combos = sorted(
        {
            (
                classify_archetype(ex),
                normalize_equipment(ex.equipment, classify_archetype(ex)),
            )
            for ex in exercises
        }
    )

    for arch, eq_mode in combos:
        if eq_mode not in {"barbell", "dumbbell", "kettlebells"}:
            continue
        for thumb in (False, True):
            root = _parse_svg(
                render_archetype_svg(arch, equipment=eq_mode, thumbnail=thumb)
            )
            assert root.attrib.get("data-bar-mode") != "shoulder"
            farm_f = root.find(".//*[@class='js-farm-f']")
            farm_b = root.find(".//*[@class='js-farm-b']")
            wf_el = root.find(".//*[@class='js-weight']")
            wb_el = root.find(".//*[@class='js-weight-b']")
            assert farm_f is not None
            assert farm_b is not None
            assert wf_el is not None
            assert wb_el is not None

            hand_f = (float(farm_f.attrib["x2"]), float(farm_f.attrib["y2"]))
            hand_b = (float(farm_b.attrib["x2"]), float(farm_b.attrib["y2"]))
            wf = (float(wf_el.attrib["cx"]), float(wf_el.attrib["cy"]))
            wb = (float(wb_el.attrib["cx"]), float(wb_el.attrib["cy"]))
            rf = float(wf_el.attrib["r"])
            rb = float(wb_el.attrib["r"])

            assert wf[0] - rf >= 0.0
            assert wf[0] + rf <= 240.0
            assert wf[1] - rf >= 0.0
            assert wf[1] + rf <= 175.0
            assert wb[0] - rb >= 0.0
            assert wb[0] + rb <= 240.0
            assert wb[1] - rb >= 0.0
            assert wb[1] + rb <= 175.0

            if eq_mode in {"barbell", "dumbbell"}:
                assert math.hypot(wf[0] - hand_f[0], wf[1] - hand_f[1]) <= 0.03
                assert math.hypot(wb[0] - hand_b[0], wb[1] - hand_b[1]) <= 0.03
            else:
                hdl_el = root.find(".//*[@class='js-kb-handle-f']")
                assert hdl_el is not None
                hdl = (float(hdl_el.attrib["cx"]), float(hdl_el.attrib["cy"]))
                assert math.hypot(hdl[0] - hand_f[0], hdl[1] - hand_f[1]) <= 3.0

    motion_errors = verify_motion_js_safe_grip(
        audit.STATIC_DIR / "motion.js",
        combos,
    )
    assert motion_errors == []


def test_equipment_aware_thumbnails_and_svg_endpoint(
    client: TestClient,
    session: Session,
) -> None:
    """Verify /svgs/{archetype}.svg endpoint and equipment-aware thumbnail URLs."""
    not_found = client.get("/svgs/nonexistent_archetype.svg")
    assert not_found.status_code == 404

    kb_squat_res = client.get("/svgs/squat.svg?equipment=kettlebells")
    assert kb_squat_res.status_code == 200
    assert "image/svg+xml" in kb_squat_res.headers["content-type"]
    kb_root = _parse_svg(kb_squat_res.text)
    assert kb_root.attrib.get("data-equipment") == "kettlebells"
    assert kb_root.find(".//*[@class='js-kb-handle-f']") is not None

    pushups = session.get(Exercise, "Pushups")
    band_skull = session.get(Exercise, "Band_Skull_Crusher")
    goblet = session.get(Exercise, "Goblet_Squat")
    assert pushups is not None
    assert band_skull is not None
    assert goblet is not None

    assert build_exercise_guidance(pushups)["svg_url"] == "/static/svgs/pushup.svg"
    band_url = build_exercise_guidance(band_skull)["svg_url"]
    goblet_url = build_exercise_guidance(goblet)["svg_url"]
    assert band_url == "/svgs/triceps_extension.svg?equipment=bands"
    assert goblet_url == "/svgs/squat.svg?equipment=kettlebells"

    for url in (band_url, goblet_url):
        res = client.get(url)
        assert res.status_code == 200
        assert "image/svg+xml" in res.headers["content-type"]


def test_hold_prescriptions_all_18_program_archetypes_and_browse_reachability(
    session: Session,
) -> None:
    """Verify hold durations >= 24s, 18 program archetypes, and browse tiers."""
    exercises = list(session.exec(select(Exercise).order_by(col(Exercise.id))).all())
    by_id = {ex.id: ex for ex in exercises}

    for ex in exercises:
        assert ex.instructions
        assert all(isinstance(step, str) and step.strip() for step in ex.instructions)
        entry = EXERCISE_COACHING[ex.id]
        assert bool(entry["is_hold"]) == (entry["tempo_mode"] == "hold")

    program_archetypes = {
        classify_archetype(by_id[ex_id])
        for prog in EQUIPMENT_PROGRAMS.values()
        for _rname, specs in prog["routines"]
        for ex_id, _reps, _weight in specs
    }
    assert program_archetypes == set(ARCHETYPE_SPECS.keys())

    plank = by_id["Plank"]
    expected_hold_reps = {"light": 24, "moderate": 30, "intense": 36}
    for intensity, exp_sec in expected_hold_reps.items():
        user = User(
            name="HoldTester", equipment="full_gym", starting_intensity=intensity
        )
        sets, reps, weight = default_prescription_for_exercise(user, plank)
        assert reps == exp_sec >= 24
        assert weight is None
        item = RoutineExercise(
            routine_id=1,
            exercise_id=plank.id,
            sets=sets,
            base_reps=reps,
            base_weight_kg=weight,
        )
        assert compute_scaled_target(item, 0, exercise=plank).formatted == (
            f"{sets} \u00d7 {exp_sec} sec"
        )

    weighted_plank = RoutineExercise(
        routine_id=1,
        exercise_id=plank.id,
        sets=3,
        base_reps=30,
        base_weight_kg=10.0,
    )
    weighted_fmt = compute_scaled_target(weighted_plank, 0, exercise=plank).formatted
    assert "sec" in weighted_fmt
    assert "10 kg" in weighted_fmt

    full_gym_rows = search_exercises_for_user(
        session, User(name="Gym", equipment="full_gym"), q="", limit=1000
    )
    assert len(full_gym_rows) == 876

    body_rows = search_exercises_for_user(
        session, User(name="BW", equipment="body_only"), q="", limit=1000
    )
    body_equips = {r["exercise"].equipment for r in body_rows}
    assert body_equips == {"body only", "foam roll", "exercise ball", "other"}


def test_http_e2e_customizer_live_how_to_and_workout_session(
    client: TestClient,
    session: Session,
) -> None:
    """Verify full HTTP flow from setup -> customizer -> workout live coaching HUD."""
    setup_res = client.post(
        "/setup",
        data={
            "name": "E2EAthlete",
            "equipment": "full_gym",
            "starting_intensity": "moderate",
            "days_per_week": "2",
        },
        follow_redirects=True,
    )
    assert setup_res.status_code == 200

    plan = session.exec(select(TrainingPlan)).one()
    add_day_res = client.post(f"/plans/{plan.id}/add-day", follow_redirects=False)
    assert add_day_res.status_code == 303
    routine_id = int(add_day_res.headers["location"].rstrip("/").split("/")[-2])

    for ex_id in ("Barbell_Glute_Bridge", "Goblet_Squat", "Side_Bridge"):
        ex = session.get(Exercise, ex_id)
        assert ex is not None
        s_res = client.get(f"/routines/{routine_id}/search", params={"q": ex.name})
        assert s_res.status_code == 200
        assert f'value="{ex_id}"' in s_res.text

        post_res = client.post(
            f"/routines/{routine_id}/add-exercise",
            data={"exercise_id": ex_id},
            follow_redirects=False,
        )
        assert post_res.status_code == 303

    edit_res = client.get(f"/routines/{routine_id}/edit")
    assert edit_res.status_code == 200
    assert "3 \u00d7 30 sec" in edit_res.text
    assert "/svgs/squat.svg?equipment=kettlebells" in edit_res.text

    ws = client.get(f"/workouts/{routine_id}")
    assert ws.status_code == 200
    assert "What to do:" not in ws.text

    dom_before_script, _, script_part = ws.text.partition("<script>")
    playlist_match = re.search(
        r"const\s+PLAYLIST\s*=\s*(\[.*?\]);\s*\n",
        ws.text,
        flags=re.DOTALL,
    )
    assert playlist_match is not None
    playlist = json.loads(playlist_match.group(1))
    assert len(playlist) == 3

    assert playlist[0]["how_to"] in html.unescape(dom_before_script)
    assert ".how_to" in script_part
    for item in playlist:
        assert item["instructions"]
        assert 'data-bar-mode="shoulder"' not in item["svg_markup"]
    assert playlist[2]["is_hold"] is True
    assert playlist[2]["reps"] == 30

    done = client.post(
        f"/workouts/{routine_id}/complete",
        data={"next_intensity_choice": "keep", "duration_minutes": "20"},
        follow_redirects=True,
    )
    assert done.status_code == 200
