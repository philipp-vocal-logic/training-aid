# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog, CLI, safe-grip, thumbnail, prescription, and PWA tests."""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tomllib
import xml.etree.ElementTree as ET
from typing import TYPE_CHECKING

import pytest

from training_aid import audit
from training_aid.audit import (
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_CATALOG_COUNT,
    AuditReport,
    AuditSectionResult,
    find_node_binary,
    run_catalog_audit,
    verify_motion_js_safe_grip,
)
from training_aid.builder import (
    CatalogExercise,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.coaching import (
    EXERCISE_COACHING,
    build_exercise_guidance,
    classify_archetype,
    exercise_svg_url,
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
    from pathlib import Path

REPO_ROOT = audit.REPO_ROOT

_HOLD_AND_CUSTOMIZER_HARNESS = """\
const fs = require("node:fs");
const path = require("node:path");
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const distDir = process.env.TA_DIST_DIR;
const catalog = JSON.parse(
  fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8")
);
const storeMod = require(path.join(distDir, "store.js"));

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
  };
}

const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));
const plank = byId.get("Plank");
const expectedHold = { light: 24, moderate: 30, intense: 36 };
for (const [intensity, expSec] of Object.entries(expectedHold)) {
  const presc = storeMod.defaultPrescriptionForExercise(
    { equipment: "full_gym", starting_intensity: intensity },
    plank
  );
  assert(presc.reps === expSec && presc.reps >= 24, `hold reps ${intensity}`);
  assert(presc.weight_kg === null, "Plank must not prescribe weight");
  const scaled = storeMod.computeScaledTarget(
    {
      id: "rx1",
      exercise_id: plank.id,
      sets: presc.sets,
      base_reps: presc.reps,
      base_weight_kg: presc.weight_kg,
    },
    0,
    plank
  );
  assert(
    scaled.formatted === `${presc.sets} \u00d7 ${expSec} sec`,
    `scaled Plank ${scaled.formatted}`
  );
}

const weightedPlank = storeMod.computeScaledTarget(
  {
    id: "rx2",
    exercise_id: plank.id,
    sets: 3,
    base_reps: 30,
    base_weight_kg: 10,
  },
  0,
  plank
);
assert(
  weightedPlank.formatted.includes("sec") &&
    weightedPlank.formatted.includes("10 kg"),
  `weighted Plank ${weightedPlank.formatted}`
);

// Browse tier reachability
const gymStore = storeMod.createStore({ storage: makeStorage(), catalog });
gymStore.setupPlan({
  name: "Gym",
  equipment: "full_gym",
  starting_intensity: "moderate",
  days_per_week: 2,
});
assert(
  gymStore.searchCatalog("", 1000).length === 876,
  "full_gym must browse all 876 exercises"
);

const bwStore = storeMod.createStore({ storage: makeStorage(), catalog });
bwStore.setupPlan({
  name: "BW",
  equipment: "body_only",
  starting_intensity: "moderate",
  days_per_week: 2,
});
const bwRows = bwStore.searchCatalog("", 1000);
const bwEquips = new Set(bwRows.map((r) => r.equipment));
assert(
  bwEquips.size === 4 &&
    bwEquips.has("body only") &&
    bwEquips.has("foam roll") &&
    bwEquips.has("exercise ball") &&
    bwEquips.has("other"),
  "body_only equipment tier mismatch"
);

// Customizer flow: add day, search & add 3 exercises, build playlist, complete
const newDay = gymStore.addWorkoutDay();
for (const exId of ["Barbell_Glute_Bridge", "Goblet_Squat", "Side_Bridge"]) {
  const ex = byId.get(exId);
  const hits = gymStore.searchCatalog(ex.name, 20);
  assert(hits.some((h) => h.id === exId), `search missing ${exId}`);
  const added = gymStore.addExerciseToRoutine(newDay.id, exId);
  assert(Boolean(added), `addExerciseToRoutine failed for ${exId}`);
}

const card = gymStore.buildRoutineCards([newDay.id])[0];
assert(
  card.exercises[1].thumb_url === "./svgs/thumbs/squat__kettlebells.svg",
  "Goblet_Squat thumb_url"
);
assert(
  card.exercises[2].scaled.formatted === "3 \u00d7 30 sec",
  "Side_Bridge hold prescription"
);

const playlist = gymStore.buildPlaylist(newDay.id);
assert(playlist.length === 3, "playlist length");
for (const item of playlist) {
  assert(item.instructions.length >= 1, `empty instructions on ${item.exercise_id}`);
  assert(Boolean(item.how_to), `empty how_to on ${item.exercise_id}`);
  const svgMarkup = catalog.svgs[item.svg_key];
  assert(
    svgMarkup && !svgMarkup.includes('data-bar-mode="shoulder"'),
    `unsafe bar_mode on ${item.exercise_id}`
  );
}
assert(playlist[2].is_hold === true && playlist[2].reps === 30, "Side_Bridge hold");

const doneLog = gymStore.completeWorkout(newDay.id, {
  next_intensity_choice: "keep",
  duration_minutes: 20,
});
assert(doneLog.routine_id === newDay.id, "completed log routine_id");
process.stdout.write(JSON.stringify({ ok: true }));
"""


def _parse_svg(svg_markup: str) -> ET.Element:
    """Parse trusted in-process SVG markup into an ElementTree element."""
    return ET.fromstring(svg_markup)  # noqa: S314


@pytest.fixture(scope="module")
def catalog_report() -> AuditReport:
    """Run the full 876-exercise E2E catalog and static PWA audit once per module."""
    return run_catalog_audit()


@pytest.fixture(scope="module")
def exercises() -> list[CatalogExercise]:
    """Load all 876 CatalogExercise entries sorted by ID."""
    return sorted(load_catalog_exercises(), key=lambda ex: ex.id)


@pytest.fixture(scope="module")
def built_pwa_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Compile the static PWA bundle once per module for thumbnail & store checks."""
    out_dir = tmp_path_factory.mktemp("e2e_pwa_dist") / "dist"
    build_pwa(out_dir)
    return out_dir


def test_run_catalog_audit_passes_all_876_exercises(
    catalog_report: AuditReport,
) -> None:
    """Verify run_catalog_audit() passes every section across all 876 exercises."""
    assert catalog_report.exercise_count == EXPECTED_CATALOG_COUNT == 876
    assert catalog_report.archetype_count == EXPECTED_ARCHETYPE_COUNT == 18
    assert catalog_report.errors == []
    assert catalog_report.passed is True

    expected_sections = (
        "catalog_and_pwa_bundle",
        "coaching_integration",
        "animations_and_safe_grip",
        "pwa_programs_and_node_e2e",
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
    """Verify CLI script entrypoints, README docs, and audit exit codes."""
    pyproject = tomllib.loads(
        (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    )
    scripts = pyproject["project"]["scripts"]
    assert scripts.get("training-aid") == "training_aid:main"
    assert scripts.get("training-aid-check") == "training_aid.audit:main"

    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "uv run training-aid-check" in readme

    passing_report = AuditReport(
        exercise_count=876,
        archetype_count=18,
        sections=(AuditSectionResult("catalog_and_pwa_bundle", 876, ()),),
    )
    monkeypatch.setattr(audit, "run_catalog_audit", lambda: passing_report)
    with pytest.raises(SystemExit) as ok_exc:
        audit.main()
    assert ok_exc.value.code == 0

    failing_report = AuditReport(
        exercise_count=876,
        archetype_count=18,
        sections=(
            AuditSectionResult("catalog_and_pwa_bundle", 876, ("injected failure",)),
        ),
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


def _check_weighted_combo_svg(arch: str, eq_mode: str, *, thumb: bool) -> None:
    root = _parse_svg(render_archetype_svg(arch, equipment=eq_mode, thumbnail=thumb))
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


def test_safe_grip_and_floor_bounds_across_catalog_and_motion_js(
    exercises: list[CatalogExercise],
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
        if eq_mode in {"barbell", "dumbbell", "kettlebells"}:
            for thumb in (False, True):
                _check_weighted_combo_svg(arch, eq_mode, thumb=thumb)

    motion_errors = verify_motion_js_safe_grip(
        audit.STATIC_DIR / "motion.js",
        combos,
    )
    assert motion_errors == []


def test_equipment_aware_thumbnails_in_compiled_bundle(
    exercises: list[CatalogExercise],
    built_pwa_dir: Path,
) -> None:
    """Verify equipment-aware static thumbnail URLs and compiled SVG files on disk."""
    by_id = {ex.id: ex for ex in exercises}
    pushups = by_id["Pushups"]
    band_skull = by_id["Band_Skull_Crusher"]
    goblet = by_id["Goblet_Squat"]

    assert exercise_svg_url("pushup", "body only") == (
        "./svgs/thumbs/pushup__body_only.svg"
    )
    assert build_exercise_guidance(pushups)["svg_url"] == (
        "./svgs/thumbs/pushup__body_only.svg"
    )
    band_url = build_exercise_guidance(band_skull)["svg_url"]
    goblet_url = build_exercise_guidance(goblet)["svg_url"]
    assert band_url == "./svgs/thumbs/triceps_extension__bands.svg"
    assert goblet_url == "./svgs/thumbs/squat__kettlebells.svg"

    kb_path = built_pwa_dir / goblet_url.removeprefix("./")
    band_path = built_pwa_dir / band_url.removeprefix("./")
    assert kb_path.is_file()
    assert band_path.is_file()

    kb_root = _parse_svg(kb_path.read_text(encoding="utf-8"))
    assert kb_root.attrib.get("data-equipment") == "kettlebells"
    assert kb_root.find(".//*[@class='js-kb-handle-f']") is not None


def test_hold_prescriptions_all_18_program_archetypes_and_customizer_e2e(
    exercises: list[CatalogExercise],
    built_pwa_dir: Path,
) -> None:
    """Verify hold durations >= 24s, 18 program archetypes, browse tiers, & playlist."""
    by_id = {ex.id: ex for ex in exercises}
    programs_cfg = load_programs_config()

    for ex in exercises:
        assert ex.instructions
        assert all(isinstance(step, str) and step.strip() for step in ex.instructions)
        entry = EXERCISE_COACHING[ex.id]
        assert bool(entry["is_hold"]) == (entry["tempo_mode"] == "hold")

    program_archetypes = {
        classify_archetype(by_id[ex_id])
        for prog in programs_cfg["equipment_programs"].values()
        for _rname, specs in prog["routines"]
        for ex_id, _reps, _weight in specs
    }
    assert program_archetypes == set(ARCHETYPE_SPECS.keys())

    node_bin = find_node_binary()
    assert node_bin is not None, "Node.js binary is required for customizer E2E test"

    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _HOLD_AND_CUSTOMIZER_HARNESS],
        env={**os.environ, "TA_DIST_DIR": str(built_pwa_dir)},
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert proc.returncode == 0, f"Node harness failed:\n{proc.stdout}\n{proc.stderr}"
    assert json.loads(proc.stdout) == {"ok": True}
