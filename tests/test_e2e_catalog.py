# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog audit, safe-grip bounds, and coaching override tests."""

from __future__ import annotations

import math
import os
from pathlib import Path

import pytest

from training_aid.audit import (
    DATA_DIR,
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_CATALOG_COUNT,
    PWA_DIR,
    REPO_ROOT,
    AuditConfig,
    AuditReport,
    AuditSectionResult,
    run_catalog_audit,
    verify_motion_js_safe_grip,
)
from training_aid.audit import (
    main as audit_main,
)
from training_aid.compiler import (
    CatalogExercise,
    build_exercise_metadata,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.kinematics import (
    lerp_pose,
    load_animation_registry,
    normalize_equipment,
    solve_fk,
)


@pytest.fixture(scope="module")
def built_pwa_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Reuse TA_DIST_DIR when set, or build once per module."""
    env_dist = os.environ.get("TA_DIST_DIR")
    if env_dist:
        dist_path = Path(env_dist)
        if (dist_path / "data" / "catalog.json").is_file():
            return dist_path
    out_dir = tmp_path_factory.mktemp("audit_dist") / "dist"
    summary = build_pwa(out_dir)
    return Path(summary["output_dir"])


def test_run_catalog_audit_full_report(built_pwa_dir: Path) -> None:
    """Run the full 4-section catalog audit and verify zero errors."""
    report = run_catalog_audit(dist_dir=built_pwa_dir)
    assert report.passed, f"Audit failed with errors: {report.errors}"
    assert report.exercise_count == EXPECTED_CATALOG_COUNT
    assert report.archetype_count == EXPECTED_ARCHETYPE_COUNT
    assert len(report.sections) == 4
    section_names = [s.name for s in report.sections]
    assert section_names == [
        "catalog_and_pwa_bundle",
        "coaching_integration",
        "animations_and_safe_grip",
        "pwa_programs_and_node_e2e",
    ]
    for sec in report.sections:
        assert sec.passed, f"Section {sec.name} failed: {sec.errors}"
        assert sec.checked == EXPECTED_CATALOG_COUNT


def test_audit_cli_and_motion_safe_grip_failure_detection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify training-aid-check CLI exit codes and safe-grip failure detection."""
    ok_report = AuditReport(1, 1, (AuditSectionResult("ok", 1, ()),))
    monkeypatch.setattr("training_aid.audit.run_catalog_audit", lambda: ok_report)
    with pytest.raises(SystemExit) as exc_ok:
        audit_main()
    assert exc_ok.value.code == 0

    fail_report = AuditReport(1, 1, (AuditSectionResult("bad", 1, ("boom",)),))
    monkeypatch.setattr("training_aid.audit.run_catalog_audit", lambda: fail_report)
    with pytest.raises(SystemExit) as exc_fail:
        audit_main()
    assert exc_fail.value.code == 1

    bad_cfg = AuditConfig(
        exercises_path=tmp_path / "missing_exercises.json",
        animations_path=DATA_DIR / "animations.json",
        programs_path=DATA_DIR / "programs.json",
        pwa_dir=PWA_DIR,
    )
    bad_report = run_catalog_audit(config=bad_cfg)
    assert not bad_report.passed
    assert len(bad_report.errors) > 0

    bad_motion = tmp_path / "bad_motion.js"
    bad_motion.write_text("export const RIG_SELECTORS = [];\n", encoding="utf-8")
    grip_errs = verify_motion_js_safe_grip(bad_motion, [("squat", "barbell")])
    assert len(grip_errs) > 0

    bad_query_motion = tmp_path / "bad_query_motion.js"
    bad_query_motion.write_text(
        "function renderPoseState(svg) { return svg.querySelector('.js-head'); }\n",
        encoding="utf-8",
    )
    query_errs = verify_motion_js_safe_grip(bad_query_motion, [])
    assert any("static invariants" in err for err in query_errs)

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "training-aid" in readme


def test_catalog_safe_grip_and_floor_bounds() -> None:
    """Verify hand-to-handle distances and floor bounds across all catalog poses."""
    catalog = load_catalog_exercises()
    assert len(catalog) == EXPECTED_CATALOG_COUNT
    registry = load_animation_registry()
    specs = registry.specs
    assert len(specs) == EXPECTED_ARCHETYPE_COUNT

    combos = {
        (
            ex.archetype,
            normalize_equipment(ex.equipment, ex.archetype, registry=registry),
        )
        for ex in catalog
    }
    assert len(combos) > 50

    for arch, eq_mode in sorted(combos):
        spec = specs[arch]
        view = str(spec.get("view", "side"))
        for swap in (False, True):
            for alpha in (0.0, 0.25, 0.5, 0.75, 1.0):
                pose = lerp_pose(spec["pose_a"], spec["pose_b"], alpha)
                joints = solve_fk(spec["bones"], pose, swap_sides=swap, view=view)
                for j_name, (jx, jy) in joints.items():
                    assert math.isfinite(jx)
                    assert math.isfinite(jy)
                    assert jy <= 175.0, f"{arch}:{eq_mode} {j_name} below floor: {jy}"
                if eq_mode in {"barbell", "dumbbell", "kettlebells", "cable", "bands"}:
                    hf = joints["hand_f"]
                    hb = joints["hand_b"]
                    span = math.hypot(hf[0] - hb[0], hf[1] - hb[1])
                    assert span <= 145.0, (
                        f"{arch}:{eq_mode} excessive hand span: {span}"
                    )


def test_baked_exercise_coaching_and_archetypes() -> None:
    """Verify pre-baked exercises.json coaching attributes and archetype coverage."""
    registry = load_animation_registry()
    specs = registry.specs
    arch_coaching = registry.coaching
    assert set(arch_coaching.keys()) == set(specs.keys())
    assert not (DATA_DIR / "exercise_coaching.json").exists()

    catalog = load_catalog_exercises()
    by_id = {ex.id: ex for ex in catalog}
    assert set(specs.keys()) == {ex.archetype for ex in catalog}

    assert by_id["Plank"].is_hold is True
    assert by_id["Plank"].archetype == "plank"
    assert by_id["Plank"].tempo_mode == "hold"
    assert by_id["Plate_Pinch"].is_hold is True
    assert by_id["Lateral_Bound"].tempo_mode == "explosive"
    assert by_id["Lateral_Bound"].is_alternating is True
    assert by_id["Lateral_Bound"].archetype == "side_lunge"
    assert by_id["Side_Lateral_Raise"].archetype == "lateral_raise"
    assert by_id["Dumbbell_Flyes"].archetype == "chest_fly"
    assert by_id["Band_Pull_Apart"].archetype == "rear_fly"
    assert by_id["Barbell_Shrug"].archetype == "upright_row"
    assert by_id["Dumbbell_Side_Bend"].archetype == "side_bend"
    assert by_id["Barbell_Squat"].is_hold is False

    stretch = CatalogExercise(
        id="Test_Stretch",
        name="Test Stretch",
        category="stretching",
        archetype="hinge",
    )
    stretch_meta = build_exercise_metadata(stretch, archetype_coaching=arch_coaching)
    assert stretch_meta["is_hold"] is True
    assert stretch_meta["tempo_mode"] == "hold"
    assert stretch_meta["unit"] == "sec"
    assert stretch_meta["cue_work"] == "Hold"
    assert stretch_meta["cue_return"] == "Breathe"


def test_programs_config_18_archetype_coverage() -> None:
    """Verify preset programs cover all 24 archetypes and omit legacy keys."""
    registry = load_animation_registry()
    specs = registry.specs
    programs_cfg = load_programs_config()
    assert set(programs_cfg.keys()) == {"equipment_programs", "intensity_labels"}

    eq_programs = programs_cfg["equipment_programs"]
    assert len(eq_programs) == 4

    by_id = {ex.id: ex for ex in load_catalog_exercises()}
    covered_archetypes: set[str] = set()
    for prog in eq_programs.values():
        for _routine_name, slot_specs in prog["routines"]:
            for ex_id, _reps, _weight in slot_specs:
                assert ex_id in by_id
                covered_archetypes.add(by_id[ex_id].archetype)

    assert covered_archetypes == set(specs.keys())
