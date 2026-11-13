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
    STATIC_DIR,
    AuditConfig,
    run_catalog_audit,
    verify_motion_js_safe_grip,
)
from training_aid.audit import (
    main as audit_main,
)
from training_aid.builder import (
    CANONICAL_EQUIPMENT_MODES,
    CatalogExercise,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.coaching import (
    build_exercise_metadata,
    classify_archetype,
    classify_archetype_fallback,
    is_hold_exercise,
    load_archetype_coaching,
    load_exercise_coaching,
)
from training_aid.svg_assets import (
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
    built_pwa_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify training-aid-check CLI exit codes and safe-grip failure detection."""
    monkeypatch.setenv("TA_DIST_DIR", str(built_pwa_dir))
    with pytest.raises(SystemExit) as exc_ok:
        audit_main()
    assert exc_ok.value.code == 0

    bad_cfg = AuditConfig(
        exercises_path=tmp_path / "missing_exercises.json",
        coaching_path=DATA_DIR / "exercise_coaching.json",
        animations_path=DATA_DIR / "animations.json",
        programs_path=DATA_DIR / "programs.json",
        motion_js_path=STATIC_DIR / "motion.js",
        pwa_dir=PWA_DIR,
    )
    bad_report = run_catalog_audit(config=bad_cfg)
    assert not bad_report.passed
    assert len(bad_report.errors) > 0

    bad_motion = tmp_path / "bad_motion.js"
    bad_motion.write_text("window.TrainingMotion = {};\n", encoding="utf-8")
    grip_errs = verify_motion_js_safe_grip(bad_motion, [("squat", "barbell")])
    assert len(grip_errs) > 0

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "training-aid" in readme


def test_catalog_safe_grip_and_floor_bounds() -> None:
    """Verify hand-to-handle distances and floor bounds across all catalog poses."""
    catalog = load_catalog_exercises()
    assert len(catalog) == EXPECTED_CATALOG_COUNT
    _std_bones, _aliases, specs = load_animation_registry()
    assert len(specs) == EXPECTED_ARCHETYPE_COUNT

    combos = {
        (
            classify_archetype(ex),
            normalize_equipment(ex.equipment, classify_archetype(ex)),
        )
        for ex in catalog
    }
    assert len(combos) > 50

    for arch, eq_mode in sorted(combos):
        spec = specs[arch]
        for alpha in (0.0, 0.25, 0.5, 0.75, 1.0):
            pose = lerp_pose(spec["pose_a"], spec["pose_b"], alpha)
            joints = solve_fk(spec["bones"], pose)
            for j_name, (jx, jy) in joints.items():
                assert math.isfinite(jx)
                assert math.isfinite(jy)
                assert jy <= 175.0, f"{arch}:{eq_mode} {j_name} below floor: {jy}"
            if eq_mode in {"barbell", "dumbbell", "kettlebells", "cable", "bands"}:
                hf = joints["hand_f"]
                hb = joints["hand_b"]
                span = math.hypot(hf[0] - hb[0], hf[1] - hb[1])
                assert span <= 145.0, f"{arch}:{eq_mode} excessive hand span: {span}"


def test_sparse_exercise_coaching_overrides_and_archetypes() -> None:
    """Verify sparse exercise_coaching.json overrides and archetype coverage."""
    _std_bones, _aliases, specs = load_animation_registry()
    arch_coaching = load_archetype_coaching()
    ex_coaching = load_exercise_coaching()
    assert set(arch_coaching.keys()) == set(specs.keys())
    assert 0 < len(ex_coaching) < 80

    catalog = load_catalog_exercises()
    by_id = {ex.id: ex for ex in catalog}
    for ex_id, override in ex_coaching.items():
        assert ex_id in by_id, f"Unknown exercise override ID: {ex_id}"
        ex = by_id[ex_id]
        meta = build_exercise_metadata(
            ex, coaching_map=ex_coaching, archetype_coaching=arch_coaching
        )
        if "archetype" in override:
            assert meta["archetype"] == override["archetype"]
        if "is_hold" in override and ex.category.lower() != "stretching":
            assert meta["is_hold"] == bool(override["is_hold"])

    plank = CatalogExercise(id="Plank", name="Plank", category="strength")
    squat = CatalogExercise(
        id="Barbell_Squat", name="Barbell Squat", category="strength"
    )
    assert is_hold_exercise(plank) is True
    assert is_hold_exercise(squat) is False
    assert classify_archetype_fallback(plank) == "plank"


def test_programs_config_18_archetype_coverage_and_setup_props() -> None:
    """Verify preset programs cover all 18 archetypes and setup_equipment_props."""
    _std_bones, _aliases, specs = load_animation_registry()
    programs_cfg = load_programs_config()
    eq_programs = programs_cfg["equipment_programs"]
    assert len(eq_programs) == 4

    by_id = {ex.id: ex for ex in load_catalog_exercises()}
    covered_archetypes: set[str] = set()
    for prog in eq_programs.values():
        for _routine_name, slot_specs in prog["routines"]:
            for ex_id, _reps, _weight in slot_specs:
                assert ex_id in by_id
                covered_archetypes.add(classify_archetype(by_id[ex_id]))

    assert covered_archetypes == set(specs.keys())

    setup_props = programs_cfg["setup_equipment_props"]
    assert set(setup_props.keys()) == set(eq_programs.keys())
    for prop_mode in setup_props.values():
        assert prop_mode in CANONICAL_EQUIPMENT_MODES
