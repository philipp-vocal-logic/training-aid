# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog, coaching, kinematic rig, safe-grip, and HTTP audit suite."""

from __future__ import annotations

import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, col, create_engine, select
from sqlmodel.pool import StaticPool

from training_aid import coaching, services, svg_assets
from training_aid.coaching import (
    ARCHETYPE_COACHING,
    build_exercise_guidance,
    classify_archetype,
    is_hold_exercise,
)
from training_aid.database import get_session
from training_aid.main import app, search_exercises_for_user
from training_aid.models import Exercise, RoutineExercise, User, WorkoutRoutine
from training_aid.services import (
    compute_scaled_target,
    default_prescription_for_exercise,
    load_programs_config,
    seed_exercises,
)
from training_aid.svg_assets import (
    ARCHETYPE_SPECS,
    lerp_pose,
    normalize_equipment,
    solve_fk,
)

if TYPE_CHECKING:
    from collections.abc import Generator

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
STATIC_DIR = Path(__file__).resolve().parent / "static"

EXPECTED_CATALOG_COUNT = 876
EXPECTED_ARCHETYPE_COUNT = 18
HTTP_OK = 200
HTTP_SEE_OTHER = 303
WORKOUT_BATCH_SIZE = 44
BROWSE_ALL_LIMIT = 1000

MIN_HOLD_REPS = 20
MIN_WEIGHT_KG = 2.0
MAX_WEIGHT_KG = 250.0

VIEWPORT_MIN = 0.0
VIEWPORT_MAX_X = 240.0
VIEWPORT_MAX_JOINT_Y = 174.0
FLOOR_Y = 175.0
HEAD_RADIUS = 11.5

BARBELL_FRONT_RADIUS = 11.5
BARBELL_BACK_RADIUS = 10.0
BARBELL_SHAFT_DX = 6.0
BARBELL_SHAFT_DY = 2.0
DUMBBELL_FRONT_RADIUS = 8.2
DUMBBELL_BACK_RADIUS = 7.0
KETTLEBELL_HANDLE_RADIUS = 5.0
KETTLEBELL_FRONT_RADIUS = 8.4
KETTLEBELL_BACK_RADIUS = 7.2
KETTLEBELL_HANDLE_DY = 2.5
KETTLEBELL_FRONT_DY = 9.0
KETTLEBELL_BACK_DY = 8.0
MAX_KB_HANDLE_DIST = 3.0
MAX_RACK_HAND_SHOULDER_DIST = 28.0

SVG_COORD_TOL = 0.03
BONE_LEN_TOL = 1e-6

SAMPLE_TS: tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 1.0)
HOLD_SAMPLE_PHASES: tuple[float, ...] = (0.0, 0.2, 0.45, 1.0, 1.5)
BREATH_WAVES: tuple[float, ...] = (-1.0, 0.0, 1.0)

EXPECTED_CATALOG_KEYS: frozenset[str] = frozenset(
    {
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
)
VALID_TEMPO_MODES: frozenset[str] = frozenset(
    {"standard", "explosive", "alternating", "hold"}
)
HANDHELD_WEIGHT_MODES: frozenset[str] = frozenset(
    {"barbell", "dumbbell", "kettlebells"}
)
RACK_ARCHETYPES: frozenset[str] = frozenset({"squat", "lunge", "calf_raise"})
WEIGHTED_EQUIPMENT: frozenset[str] = frozenset(
    {"barbell", "dumbbell", "kettlebells", "cable", "machine", "e-z curl bar"}
)

TIER_ALLOWED_EQUIPMENT: dict[str, frozenset[str] | None] = {
    "body_only": frozenset({"body only", "foam roll", "exercise ball", "other"}),
    "dumbbells": frozenset(
        {
            "dumbbell",
            "medicine ball",
            "body only",
            "foam roll",
            "exercise ball",
            "other",
        }
    ),
    "kettlebell_bands": frozenset(
        {
            "kettlebells",
            "bands",
            "body only",
            "foam roll",
            "exercise ball",
            "other",
        }
    ),
    "full_gym": None,
}

_SEGMENT_PAIRS: tuple[tuple[str, str, str], ...] = (
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

_PLAYLIST_RE = re.compile(r"const\s+PLAYLIST\s*=\s*(\[.*?\]);\s*\n", re.DOTALL)

_NODE_MOTION_HARNESS = """\
const fs = require("node:fs");
const motionSrc = fs.readFileSync(process.env.TA_MOTION_JS, "utf8");
const combos = JSON.parse(process.env.TA_COMBOS_JSON);
globalThis.window = globalThis;
new Function(motionSrc)();
const TM = globalThis.TrainingMotion;
if (!TM || typeof TM.bindSvg !== "function") {
  throw new Error("TrainingMotion.bindSvg missing");
}

function makeEl() {
  return {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
  };
}

const SELECTORS = [
  ".js-head", ".js-neck", ".js-torso", ".js-thigh-f", ".js-shin-f",
  ".js-thigh-b", ".js-shin-b", ".js-forefoot-f", ".js-forefoot-b",
  ".js-uarm-f", ".js-farm-f", ".js-uarm-b", ".js-farm-b",
  ".js-j-shoulder", ".js-j-hip", ".js-j-knee", ".js-j-elbow",
  ".js-weight", ".js-weight-cap", ".js-weight-b", ".js-kb-handle-f",
  ".js-bar-shaft", ".js-bar-hub", ".js-band-f", ".js-band-b",
  ".js-cable", ".js-cable-grip", ".js-shadow", ".js-aura", ".js-ring",
  ".js-pulse",
];

const failures = [];
for (const item of combos) {
  const els = {};
  for (const sel of SELECTORS) els[sel] = makeEl();
  const svgEl = {
    dataset: {
      bones: JSON.stringify(item.bones),
      poseA: JSON.stringify(item.pose_a),
      poseB: JSON.stringify(item.pose_b),
      tempoMode: item.tempo_mode,
      holdStyle: item.hold_style,
      equipment: item.eq_mode,
      barMode: item.bar_mode,
    },
    querySelector(sel) { return els[sel] || null; },
  };
  const rig = TM.bindSvg(svgEl);
  const runs = [];
  for (const swap of [false, true]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      runs.push(() => rig.applyPose(t, { swapSides: swap }));
    }
  }
  runs.push(() => rig.applyHold(0.25));
  runs.push(() => rig.applyHold(1.0));
  for (const ph of [0, 0.8, 2.4]) {
    runs.push(() => rig.applyRestBreath(ph));
  }

  for (let i = 0; i < runs.length; i++) {
    runs[i]();
    const handF = [
      parseFloat(els[".js-farm-f"].attrs.x2),
      parseFloat(els[".js-farm-f"].attrs.y2),
    ];
    const handB = [
      parseFloat(els[".js-farm-b"].attrs.x2),
      parseFloat(els[".js-farm-b"].attrs.y2),
    ];
    const wf = [
      parseFloat(els[".js-weight"].attrs.cx),
      parseFloat(els[".js-weight"].attrs.cy),
    ];
    const wb = [
      parseFloat(els[".js-weight-b"].attrs.cx),
      parseFloat(els[".js-weight-b"].attrs.cy),
    ];
    const isPoseRun = i < 10;
    if (item.eq_mode === "barbell" || item.eq_mode === "dumbbell") {
      const df = Math.hypot(wf[0] - handF[0], wf[1] - handF[1]);
      const db = Math.hypot(wb[0] - handB[0], wb[1] - handB[1]);
      if (df > 0.03 || db > 0.03) {
        failures.push(`${item.arch}:${item.eq_mode} detached df=${df} db=${db}`);
        break;
      }
      const rf = item.eq_mode === "barbell" ? 11.5 : 8.2;
      const rb = item.eq_mode === "barbell" ? 10.0 : 7.0;
      if (isPoseRun && (wf[1] + rf > 175.01 || wb[1] + rb > 175.01 ||
          wf[0] - rf < -0.01 || wf[0] + rf > 240.01)) {
        failures.push(
          `${item.arch}:${item.eq_mode} out of bounds wf=${wf} wb=${wb}`
        );
        break;
      }
    } else if (item.eq_mode === "kettlebells") {
      const hdl = [
        parseFloat(els[".js-kb-handle-f"].attrs.cx),
        parseFloat(els[".js-kb-handle-f"].attrs.cy),
      ];
      const dh = Math.hypot(hdl[0] - handF[0], hdl[1] - handF[1]);
      if (dh > 3.0) {
        failures.push(`${item.arch}:kettlebells handle detached dh=${dh}`);
        break;
      }
      if (isPoseRun && (wf[1] + 8.4 > 175.01 || wb[1] + 7.2 > 175.01 ||
          wf[0] - 8.4 < -0.01 || wf[0] + 8.4 > 240.01)) {
        failures.push(
          `${item.arch}:kettlebells bell out of bounds wf=${wf} wb=${wb}`
        );
        break;
      }
    }
  }
}
process.stdout.write(JSON.stringify({ failures }));
"""


@dataclass(frozen=True, slots=True)
class AuditConfig:
    """File-path and allowlist configuration for the end-to-end catalog audit."""

    exercises_path: Path = DATA_DIR / "exercises.json"
    coaching_path: Path = DATA_DIR / "exercise_coaching.json"
    animations_path: Path = DATA_DIR / "animations.json"
    programs_path: Path = DATA_DIR / "programs.json"
    motion_js_path: Path = STATIC_DIR / "motion.js"
    svgs_dir: Path = STATIC_DIR / "svgs"
    expected_count: int = EXPECTED_CATALOG_COUNT
    fallback_allowlist: frozenset[str] = field(
        default_factory=lambda: frozenset(
            getattr(coaching, "ARCHETYPE_FALLBACK_ALLOWLIST", ())
        )
    )


@dataclass(frozen=True, slots=True)
class AuditSectionResult:
    """Pass/fail status and diagnostic messages for a single audit section."""

    name: str
    checked: int
    errors: tuple[str, ...]

    @property
    def passed(self) -> bool:
        """Return True when the audit section recorded zero errors."""
        return len(self.errors) == 0


@dataclass(frozen=True, slots=True)
class AuditReport:
    """Aggregated end-to-end catalog, coaching, rig, and HTTP audit report."""

    exercise_count: int
    archetype_count: int
    sections: tuple[AuditSectionResult, ...]

    @property
    def errors(self) -> list[str]:
        """Return all error strings flattened across every audit section."""
        return [f"[{sec.name}] {err}" for sec in self.sections for err in sec.errors]

    @property
    def passed(self) -> bool:
        """Return True when every audit section passed with zero errors."""
        return all(sec.passed for sec in self.sections)


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _parse_svg(svg_markup: str) -> ET.Element:
    return ET.fromstring(svg_markup)  # noqa: S314


def _has_nonempty_instructions(raw_steps: object) -> bool:
    if not isinstance(raw_steps, list) or not raw_steps:
        return False
    return all(isinstance(step, str) and bool(step.strip()) for step in raw_steps)


def _check_circle_bounds(
    label: str,
    center: tuple[float, float],
    radius: float,
    errors: list[str],
) -> None:
    cx, cy = center
    if cx - radius < VIEWPORT_MIN - SVG_COORD_TOL:
        errors.append(f"{label} left edge {cx - radius:.2f} < 0")
    if cx + radius > VIEWPORT_MAX_X + SVG_COORD_TOL:
        errors.append(f"{label} right edge {cx + radius:.2f} > {VIEWPORT_MAX_X}")
    if cy - radius < VIEWPORT_MIN - SVG_COORD_TOL:
        errors.append(f"{label} top edge {cy - radius:.2f} < 0")
    if cy + radius > FLOOR_Y + SVG_COORD_TOL:
        errors.append(
            f"{label} bottom edge {cy + radius:.2f} > {FLOOR_Y} (floor penetration)"
        )


def _validate_raw_catalog_items(
    raw_items: list[Any],
    expected_count: int,
    errors: list[str],
) -> set[str]:
    if len(raw_items) != expected_count:
        errors.append(
            f"exercises.json count {len(raw_items)} != expected {expected_count}"
        )
    raw_ids: list[str] = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            errors.append(f"exercises.json[{idx}] is not an object")
            continue
        ex_id = str(item.get("id") or "").strip()
        raw_ids.append(ex_id)
        if set(item.keys()) != EXPECTED_CATALOG_KEYS:
            errors.append(f"{ex_id or idx}: unexpected catalog schema keys")
        if not ex_id:
            errors.append(f"exercises.json[{idx}] has empty id")
        if not _has_nonempty_instructions(item.get("instructions")):
            errors.append(f"{ex_id}: raw instructions in exercises.json is empty")

    unique_ids = set(raw_ids)
    if len(unique_ids) != len(raw_items):
        errors.append(
            f"Duplicate exercise IDs: {len(unique_ids)} unique vs {len(raw_items)}"
        )
    return unique_ids


def _validate_seeded_exercises(
    seeded: list[Exercise],
    errors: list[str],
) -> None:
    for ex in seeded:
        for field_name in ("id", "name", "category", "equipment", "primary_muscle"):
            val = getattr(ex, field_name, "")
            if not isinstance(val, str) or not val.strip():
                errors.append(f"{ex.id}: empty seeded field {field_name}")
        if not _has_nonempty_instructions(ex.instructions):
            errors.append(f"{ex.id}: seeded Exercise.instructions is empty")


def _audit_catalog_and_seeding(
    cfg: AuditConfig,
    session: Session,
) -> tuple[AuditSectionResult, list[Exercise], set[str]]:
    if not cfg.exercises_path.is_file():
        return (
            AuditSectionResult(
                "catalog_seeding",
                0,
                (f"Missing exercises catalog: {cfg.exercises_path}",),
            ),
            [],
            set(),
        )

    raw_items = json.loads(cfg.exercises_path.read_text(encoding="utf-8"))
    if not isinstance(raw_items, list):
        return (
            AuditSectionResult(
                "catalog_seeding", 0, ("exercises.json root must be a JSON list",)
            ),
            [],
            set(),
        )

    errors: list[str] = []
    unique_raw_ids = _validate_raw_catalog_items(raw_items, cfg.expected_count, errors)
    seeded_count = seed_exercises(session, exercises_path=cfg.exercises_path)
    seeded = list(session.exec(select(Exercise).order_by(col(Exercise.id))).all())

    if seeded_count != len(raw_items) or len(seeded) != len(raw_items):
        errors.append(
            f"Seeded count mismatch: returned={seeded_count}, "
            f"rows={len(seeded)}, raw={len(raw_items)}"
        )
    if {ex.id for ex in seeded} != unique_raw_ids:
        errors.append("Seeded Exercise IDs do not match exercises.json IDs")

    _validate_seeded_exercises(seeded, errors)
    return (
        AuditSectionResult("catalog_seeding", len(seeded), tuple(errors)),
        seeded,
        unique_raw_ids,
    )


def _probe_fallback_archetype(ex: Exercise) -> str:
    probe = Exercise(
        id=f"__audit__ {ex.id}",
        name=ex.name,
        category=ex.category,
        level=ex.level,
        equipment=ex.equipment,
        primary_muscle=ex.primary_muscle,
        secondary_muscles=ex.secondary_muscles,
        instructions_json=ex.instructions_json,
    )
    return classify_archetype(probe)


def _check_single_exercise_coaching(
    ex: Exercise,
    entry: object,
    allowlist: frozenset[str],
    errors: list[str],
) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        errors.append(f"{ex.id}: missing coaching dict entry")
        return None

    arch = str(entry.get("archetype") or "")
    tempo_mode = str(entry.get("tempo_mode") or "")
    is_hold_flag = bool(entry.get("is_hold"))

    if arch not in ARCHETYPE_SPECS:
        errors.append(f"{ex.id}: invalid archetype '{arch}'")
    if tempo_mode not in VALID_TEMPO_MODES:
        errors.append(f"{ex.id}: invalid tempo_mode '{tempo_mode}'")
    if is_hold_flag != (tempo_mode == "hold"):
        errors.append(
            f"{ex.id}: is_hold={is_hold_flag} != (tempo_mode=='hold') [{tempo_mode}]"
        )
    if ex.category.lower() == "stretching" and not is_hold_flag:
        errors.append(f"{ex.id}: stretching exercise must have is_hold=True")
    if classify_archetype(ex) != arch:
        errors.append(f"{ex.id}: classify_archetype={classify_archetype(ex)} != {arch}")

    fb_arch = _probe_fallback_archetype(ex)
    if fb_arch != arch and ex.id not in allowlist:
        errors.append(f"{ex.id}: coaching '{arch}' diverges from fallback '{fb_arch}'")

    guide = build_exercise_guidance(ex)
    _check_guidance_fields(ex, guide, errors)
    return guide


def _check_guidance_fields(
    ex: Exercise,
    guide: dict[str, Any],
    errors: list[str],
) -> None:
    if bool(guide.get("is_hold")) != (guide.get("tempo_mode") == "hold"):
        errors.append(f"{ex.id}: guidance is_hold/tempo_mode mismatch")
    if bool(guide.get("is_hold")) != is_hold_exercise(ex):
        errors.append(f"{ex.id}: guidance is_hold != is_hold_exercise(ex)")
    if is_hold_exercise(ex) != is_hold_exercise(ex.id):
        errors.append(f"{ex.id}: is_hold_exercise(ex) != is_hold_exercise(ex.id)")

    for str_key in ("how_to", "cue_work", "cue_return", "svg_url", "svg_markup"):
        val = guide.get(str_key)
        if not isinstance(val, str) or not val.strip():
            errors.append(f"{ex.id}: empty or missing guidance['{str_key}']")

    if not _has_nonempty_instructions(guide.get("instructions")):
        errors.append(
            f"{ex.id}: build_exercise_guidance missing non-empty instructions"
        )


def _check_live_workout_how_to(client: TestClient, session: Session) -> list[str]:
    errors: list[str] = []
    setup_res = client.post(
        "/setup",
        data={
            "name": "CoachingAudit",
            "equipment": "full_gym",
            "starting_intensity": "moderate",
            "days_per_week": "4",
        },
        follow_redirects=False,
    )
    if setup_res.status_code != HTTP_SEE_OTHER:
        return [f"POST /setup returned {setup_res.status_code}"]

    routine = session.exec(
        select(WorkoutRoutine).order_by(col(WorkoutRoutine.day_order))
    ).first()
    if routine is None or routine.id is None:
        return ["No WorkoutRoutine created during /setup"]

    ws = client.get(f"/workouts/{routine.id}")
    if ws.status_code != HTTP_OK:
        return [f"GET /workouts/{routine.id} returned {ws.status_code}"]

    if "What to do:" in ws.text:
        errors.append("workout_session.html contains forbidden 'What to do:' text")

    playlist_match = _PLAYLIST_RE.search(ws.text)
    if playlist_match is None:
        errors.append("workout_session.html missing PLAYLIST JSON payload")
        return errors

    playlist = json.loads(playlist_match.group(1))
    if not playlist:
        errors.append("Workout playlist is unexpectedly empty")
        return errors

    first_how_to = str(playlist[0].get("how_to") or "").strip()
    dom_before_script, _, script_part = ws.text.partition("<script>")
    if not first_how_to or first_how_to not in html.unescape(dom_before_script):
        errors.append(
            "workout_session.html does not render live how_to text in stage DOM"
        )
    if ".how_to" not in script_part:
        errors.append(
            "workout_session.html script does not update coaching how_to dynamically"
        )
    return errors


def _audit_coaching_integration(
    cfg: AuditConfig,
    seeded: list[Exercise],
    raw_ids: set[str],
    client: TestClient,
    session: Session,
) -> tuple[AuditSectionResult, dict[str, dict[str, Any]]]:
    guidances: dict[str, dict[str, Any]] = {}
    if not cfg.coaching_path.is_file():
        return (
            AuditSectionResult(
                "coaching_integration",
                0,
                (f"Missing exercise_coaching.json: {cfg.coaching_path}",),
            ),
            guidances,
        )

    errors: list[str] = []
    coaching_map = json.loads(cfg.coaching_path.read_text(encoding="utf-8"))
    if set(coaching_map.keys()) != raw_ids:
        missing = sorted(raw_ids - set(coaching_map.keys()))[:5]
        extra = sorted(set(coaching_map.keys()) - raw_ids)[:5]
        errors.append(
            f"exercise_coaching.json ID parity mismatch: "
            f"missing={missing} extra={extra}"
        )

    if len(ARCHETYPE_SPECS) != EXPECTED_ARCHETYPE_COUNT:
        errors.append(
            f"ARCHETYPE_SPECS count {len(ARCHETYPE_SPECS)} "
            f"!= {EXPECTED_ARCHETYPE_COUNT}"
        )
    if set(ARCHETYPE_COACHING.keys()) != set(ARCHETYPE_SPECS.keys()):
        errors.append("ARCHETYPE_COACHING keys diverge from ARCHETYPE_SPECS")

    for ex in seeded:
        guide = _check_single_exercise_coaching(
            ex, coaching_map.get(ex.id), cfg.fallback_allowlist, errors
        )
        if guide is not None:
            guidances[ex.id] = guide

    errors.extend(_check_live_workout_how_to(client, session))
    return (
        AuditSectionResult("coaching_integration", len(seeded), tuple(errors)),
        guidances,
    )


def _check_joint_and_bone_bounds(
    label: str,
    bones: dict[str, float],
    pts: dict[str, tuple[float, float]],
    errors: list[str],
) -> None:
    for p1_key, p2_key, bone_key in _SEGMENT_PAIRS:
        actual = _dist(pts[p1_key], pts[p2_key])
        if abs(actual - bones[bone_key]) > BONE_LEN_TOL:
            errors.append(
                f"{label}: bone {bone_key} distorted "
                f"({actual:.6f} != {bones[bone_key]})"
            )

    for joint_name, (jx, jy) in pts.items():
        if not (VIEWPORT_MIN <= jx <= VIEWPORT_MAX_X):
            errors.append(f"{label}: {joint_name} x={jx:.2f} outside 0..240")
        if not (VIEWPORT_MIN <= jy <= VIEWPORT_MAX_JOINT_Y):
            errors.append(f"{label}: {joint_name} y={jy:.2f} outside 0..174")

    hx, hy = pts["head"]
    if not (HEAD_RADIUS <= hx <= VIEWPORT_MAX_X - HEAD_RADIUS):
        errors.append(f"{label}: head x={hx:.2f} clips viewport")
    if not (HEAD_RADIUS <= hy <= VIEWPORT_MAX_JOINT_Y):
        errors.append(f"{label}: head y={hy:.2f} clips viewport")


def _check_barbell_bounds(
    label: str,
    hand_f: tuple[float, float],
    hand_b: tuple[float, float],
    errors: list[str],
) -> None:
    _check_circle_bounds(f"{label} barbell front", hand_f, BARBELL_FRONT_RADIUS, errors)
    _check_circle_bounds(f"{label} barbell back", hand_b, BARBELL_BACK_RADIUS, errors)
    for end_name, sx, sy in (
        ("shaft-b", hand_b[0] - BARBELL_SHAFT_DX, hand_b[1] - BARBELL_SHAFT_DY),
        ("shaft-f", hand_f[0] + BARBELL_SHAFT_DX, hand_f[1] + BARBELL_SHAFT_DY),
    ):
        if not (VIEWPORT_MIN <= sx <= VIEWPORT_MAX_X) or not (
            VIEWPORT_MIN <= sy <= FLOOR_Y
        ):
            errors.append(f"{label} {end_name} ({sx:.2f}, {sy:.2f}) out of bounds")


def _check_kinematic_weight_props(
    label: str,
    eq_mode: str,
    bar_mode: str,
    pts: dict[str, tuple[float, float]],
    errors: list[str],
) -> None:
    if bar_mode == "shoulder":
        errors.append(f"{label}: forbidden bar_mode='shoulder'")
        return

    hand_f = pts["hand_f"]
    hand_b = pts["hand_b"]
    if eq_mode == "barbell":
        _check_barbell_bounds(label, hand_f, hand_b, errors)
    elif eq_mode == "dumbbell":
        _check_circle_bounds(
            f"{label} dumbbell front", hand_f, DUMBBELL_FRONT_RADIUS, errors
        )
        _check_circle_bounds(
            f"{label} dumbbell back", hand_b, DUMBBELL_BACK_RADIUS, errors
        )
    elif eq_mode == "kettlebells":
        hdl_center = (hand_f[0], hand_f[1] + KETTLEBELL_HANDLE_DY)
        kb_front = (hand_f[0], hand_f[1] + KETTLEBELL_FRONT_DY)
        kb_back = (hand_b[0], hand_b[1] + KETTLEBELL_BACK_DY)
        if _dist(hand_f, hdl_center) > MAX_KB_HANDLE_DIST:
            errors.append(f"{label}: kettlebell handle detached from hand_f")
        _check_circle_bounds(
            f"{label} kb handle", hdl_center, KETTLEBELL_HANDLE_RADIUS, errors
        )
        _check_circle_bounds(
            f"{label} kb front", kb_front, KETTLEBELL_FRONT_RADIUS, errors
        )
        _check_circle_bounds(
            f"{label} kb back", kb_back, KETTLEBELL_BACK_RADIUS, errors
        )


def _check_non_handheld_svg_props(
    label: str,
    root: ET.Element,
    eq_mode: str,
    errors: list[str],
) -> None:
    wf_el = root.find(".//*[@class='js-weight']")
    if eq_mode == "body_only":
        errors.extend(
            f"{label}: body_only unexpectedly renders .{cls}"
            for cls in ("js-weight", "js-bar-shaft", "js-band-f", "js-cable")
            if root.find(f".//*[@class='{cls}']") is not None
        )
    elif eq_mode == "bands":
        if root.find(".//*[@class='js-band-f']") is None or wf_el is not None:
            errors.append(f"{label}: bands SVG missing .js-band-f or has .js-weight")
    elif eq_mode in {"cable", "machine"} and (
        root.find(".//*[@class='js-cable']") is None or wf_el is not None
    ):
        errors.append(f"{label}: {eq_mode} SVG missing .js-cable or has .js-weight")


def _check_handheld_svg_props(
    label: str,
    root: ET.Element,
    eq_mode: str,
    hands: tuple[tuple[float, float], tuple[float, float]],
    errors: list[str],
) -> None:
    hand_f, hand_b = hands
    wf_el = root.find(".//*[@class='js-weight']")
    wb_el = root.find(".//*[@class='js-weight-b']")
    if wf_el is None or wb_el is None:
        errors.append(f"{label}: {eq_mode} missing .js-weight or .js-weight-b")
        return

    wf = (float(wf_el.attrib["cx"]), float(wf_el.attrib["cy"]))
    wb = (float(wb_el.attrib["cx"]), float(wb_el.attrib["cy"]))
    _check_circle_bounds(f"{label} .js-weight", wf, float(wf_el.attrib["r"]), errors)
    _check_circle_bounds(f"{label} .js-weight-b", wb, float(wb_el.attrib["r"]), errors)

    if eq_mode in {"barbell", "dumbbell"}:
        if _dist(wf, hand_f) > SVG_COORD_TOL or _dist(wb, hand_b) > SVG_COORD_TOL:
            errors.append(
                f"{label}: {eq_mode} weight detached from hands "
                f"(df={_dist(wf, hand_f):.2f}, db={_dist(wb, hand_b):.2f})"
            )
        if eq_mode == "barbell":
            _check_barbell_svg_elements(label, root, hand_f, errors)
    elif eq_mode == "kettlebells":
        _check_kettlebell_svg_elements(label, root, (hand_f, hand_b), (wf, wb), errors)


def _check_barbell_svg_elements(
    label: str,
    root: ET.Element,
    hand_f: tuple[float, float],
    errors: list[str],
) -> None:
    hub_el = root.find(".//*[@class='js-bar-hub']")
    shaft_el = root.find(".//*[@class='js-bar-shaft']")
    if root.attrib.get("data-bar-mode") != "hands":
        errors.append(f"{label}: barbell SVG data-bar-mode != 'hands'")
    if hub_el is None or shaft_el is None:
        errors.append(f"{label}: barbell missing .js-bar-hub or .js-bar-shaft")
        return
    hub = (float(hub_el.attrib["cx"]), float(hub_el.attrib["cy"]))
    if _dist(hub, hand_f) > SVG_COORD_TOL:
        errors.append(f"{label}: .js-bar-hub detached from hand_f")


def _check_kettlebell_svg_elements(
    label: str,
    root: ET.Element,
    hands: tuple[tuple[float, float], tuple[float, float]],
    weights: tuple[tuple[float, float], tuple[float, float]],
    errors: list[str],
) -> None:
    hand_f, hand_b = hands
    wf, wb = weights
    hdl_el = root.find(".//*[@class='js-kb-handle-f']")
    if hdl_el is None:
        errors.append(f"{label}: kettlebells missing .js-kb-handle-f")
        return
    hdl = (float(hdl_el.attrib["cx"]), float(hdl_el.attrib["cy"]))
    _check_circle_bounds(
        f"{label} .js-kb-handle-f", hdl, float(hdl_el.attrib["r"]), errors
    )
    if _dist(hdl, hand_f) > MAX_KB_HANDLE_DIST:
        errors.append(
            f"{label}: kettlebell handle detached (dist={_dist(hdl, hand_f):.2f})"
        )
    if (
        abs(wf[1] - (hand_f[1] + KETTLEBELL_FRONT_DY)) > SVG_COORD_TOL
        or abs(wb[1] - (hand_b[1] + KETTLEBELL_BACK_DY)) > SVG_COORD_TOL
    ):
        errors.append(f"{label}: kettlebell bell clamped/detached from hand offset")


def _check_rendered_svg_safe_grip_and_props(
    label: str,
    root: ET.Element,
    arch: str,
    eq_mode: str,
    errors: list[str],
) -> None:
    if root.attrib.get("data-archetype") != arch:
        errors.append(
            f"{label}: data-archetype={root.attrib.get('data-archetype')} != {arch}"
        )
    if root.attrib.get("data-equipment") != eq_mode:
        errors.append(
            f"{label}: data-equipment={root.attrib.get('data-equipment')} != {eq_mode}"
        )
    if root.attrib.get("data-bar-mode") == "shoulder":
        errors.append(f"{label}: SVG has forbidden data-bar-mode='shoulder'")

    farm_f = root.find(".//*[@class='js-farm-f']")
    farm_b = root.find(".//*[@class='js-farm-b']")
    if farm_f is None or farm_b is None:
        errors.append(f"{label}: missing forearm elements .js-farm-f/.js-farm-b")
        return

    if eq_mode not in HANDHELD_WEIGHT_MODES:
        _check_non_handheld_svg_props(label, root, eq_mode, errors)
        return

    hand_f = (float(farm_f.attrib["x2"]), float(farm_f.attrib["y2"]))
    hand_b = (float(farm_b.attrib["x2"]), float(farm_b.attrib["y2"]))
    _check_handheld_svg_props(label, root, eq_mode, (hand_f, hand_b), errors)


def _check_motion_js_source(motion_js_path: Path, errors: list[str]) -> bool:
    if not motion_js_path.is_file():
        errors.append(f"Missing motion.js: {motion_js_path}")
        return False

    src = motion_js_path.read_text(encoding="utf-8")
    if src.count("{") != src.count("}") or src.count("(") != src.count(")"):
        errors.append("motion.js has unbalanced braces or parentheses")

    if "function renderPoseState" not in src:
        errors.append("motion.js missing function renderPoseState")
        return True

    render_body = src[src.index("function renderPoseState") :]
    if "querySelector" in render_body:
        errors.append("motion.js calls querySelector inside/after renderPoseState")
    if 'barMode === "shoulder"' in render_body or "barMode == 'shoulder'" in src:
        errors.append("motion.js still contains shoulder barMode detachment branch")
    if "Math.min(159" in render_body or "Math.min(165" in render_body:
        errors.append("motion.js still clamps kettlebell y via Math.min(159/165)")
    return True


def _run_node_motion_harness(
    node_bin: str,
    motion_js_path: Path,
    handheld_combos: list[tuple[str, str]],
    errors: list[str],
) -> None:
    payload = [
        {
            "arch": arch,
            "eq_mode": eq_mode,
            "bones": ARCHETYPE_SPECS[arch]["bones"],
            "pose_a": ARCHETYPE_SPECS[arch]["pose_a"],
            "pose_b": ARCHETYPE_SPECS[arch]["pose_b"],
            "tempo_mode": ARCHETYPE_SPECS[arch]["coaching"]["tempo_mode"],
            "hold_style": ARCHETYPE_SPECS[arch]["hold_style"],
            "bar_mode": ARCHETYPE_SPECS[arch]["bar_mode"],
        }
        for arch, eq_mode in handheld_combos
    ]
    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _NODE_MOTION_HARNESS],
        env={
            **os.environ,
            "TA_MOTION_JS": str(motion_js_path),
            "TA_COMBOS_JSON": json.dumps(payload),
        },
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        errors.append(f"Node motion.js harness failed: {proc.stderr.strip()}")
        return
    parsed = json.loads(proc.stdout)
    errors.extend(f"Node motion.js: {msg}" for msg in parsed.get("failures", []))


def verify_motion_js_safe_grip(
    motion_js_path: Path,
    combos: list[tuple[str, str]],
) -> list[str]:
    """Verify motion.js safe-grip invariants via static source check, math, and Node.

    Args:
        motion_js_path: Path to `motion.js`.
        combos: Sequence of `(archetype, eq_mode)` pairs to verify.

    Returns:
        List of diagnostic error strings (empty if all checks pass).
    """
    errors: list[str] = []
    if not _check_motion_js_source(motion_js_path, errors):
        return errors

    handheld_combos = [
        (arch, eq_mode) for arch, eq_mode in combos if eq_mode in HANDHELD_WEIGHT_MODES
    ]
    for arch, eq_mode in handheld_combos:
        spec = ARCHETYPE_SPECS[arch]
        bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
        bar_mode = str(spec["bar_mode"])
        for phase in HOLD_SAMPLE_PHASES:
            if spec["hold_style"] == "pulse":
                t_hold = 0.5 - 0.5 * math.cos(phase * math.pi)
            else:
                settle = min(1.0, phase / 0.45)
                breath = 0.92 + 0.08 * (0.5 - 0.5 * math.cos(phase * math.pi))
                t_hold = settle * breath
            pts = solve_fk(bones, lerp_pose(pa, pb, t_hold))
            _check_kinematic_weight_props(
                f"motion.js hold {arch}:{eq_mode} p={phase}",
                eq_mode,
                bar_mode,
                pts,
                errors,
            )
        for wave in BREATH_WAVES:
            breath_pose = {
                **pa,
                "lumbar": pa["lumbar"] - 0.7 * wave,
                "thoracic": pa["thoracic"] - 1.7 * wave,
                "neck": pa["neck"] + 1.0 * wave,
                "uarm_f": pa["uarm_f"] + 1.2 * wave,
                "uarm_b": pa["uarm_b"] + 1.2 * wave,
            }
            pts = solve_fk(bones, breath_pose)
            if bar_mode == "shoulder":
                errors.append(f"motion.js breath {arch}:{eq_mode}: shoulder bar_mode")
            elif (
                eq_mode == "kettlebells"
                and _dist(
                    pts["hand_f"],
                    (pts["hand_f"][0], pts["hand_f"][1] + KETTLEBELL_HANDLE_DY),
                )
                > MAX_KB_HANDLE_DIST
            ):
                errors.append(f"motion.js breath {arch}:kettlebells handle detached")

    node_bin = shutil.which("node")
    if node_bin is not None and handheld_combos:
        _run_node_motion_harness(node_bin, motion_js_path, handheld_combos, errors)
    return errors


def _check_single_archetype_rig(
    arch: str,
    spec: dict[str, Any],
    svgs_dir: Path,
    errors: list[str],
) -> None:
    if spec.get("bar_mode") == "shoulder":
        errors.append(f"ARCHETYPE_SPECS[{arch}] has bar_mode='shoulder'")
    static_svg_path = svgs_dir / f"{arch}.svg"
    if not static_svg_path.is_file():
        errors.append(f"Missing pregenerated static SVG: {static_svg_path}")
    else:
        static_root = _parse_svg(static_svg_path.read_text(encoding="utf-8"))
        if static_root.attrib.get("data-bar-mode") == "shoulder":
            errors.append(f"{arch}.svg static file has data-bar-mode='shoulder'")

    bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
    for swap in (False, True):
        for t in SAMPLE_TS:
            pts = solve_fk(bones, lerp_pose(pa, pb, t), swap_sides=swap)
            _check_joint_and_bone_bounds(
                f"{arch} swap={swap} t={t}", bones, pts, errors
            )
            if arch in RACK_ARCHETYPES and not swap:
                if pts["hand_f"][1] >= pts["mid_spine"][1]:
                    errors.append(
                        f"{arch} t={t}: hand_f y={pts['hand_f'][1]:.2f} "
                        "below rack height"
                    )
                if _dist(pts["hand_f"], pts["shoulder"]) > MAX_RACK_HAND_SHOULDER_DIST:
                    errors.append(
                        f"{arch} t={t}: hand_f too far from shoulder for rack grip"
                    )


def _audit_archetype_rig_invariants(cfg: AuditConfig) -> list[str]:
    errors: list[str] = []
    if cfg.animations_path.is_file():
        raw_anim = json.loads(cfg.animations_path.read_text(encoding="utf-8")).get(
            "animations", {}
        )
        errors.extend(
            f"animations.json[{arch}] uses bar_mode='shoulder'"
            for arch, arch_cfg in raw_anim.items()
            if arch_cfg.get("bar_mode") == "shoulder"
        )
    else:
        errors.append(f"Missing animations.json: {cfg.animations_path}")

    for arch, spec in ARCHETYPE_SPECS.items():
        _check_single_archetype_rig(arch, spec, cfg.svgs_dir, errors)
    return errors


def _fetch_cached_svg_url(
    client: TestClient,
    svg_url: str,
    cache: dict[str, tuple[int, str, ET.Element | None]],
) -> tuple[int, str, ET.Element | None]:
    if svg_url not in cache:
        res = client.get(svg_url)
        ctype = res.headers.get("content-type", "")
        parsed_thumb: ET.Element | None = None
        if res.status_code == HTTP_OK:
            try:
                parsed_thumb = _parse_svg(res.text)
            except ET.ParseError:
                parsed_thumb = None
        cache[svg_url] = (res.status_code, ctype, parsed_thumb)
    return cache[svg_url]


def _check_combo_kinematic_sweep(
    combos: list[tuple[str, str]],
    errors: list[str],
) -> None:
    for arch, eq_mode in combos:
        if eq_mode not in HANDHELD_WEIGHT_MODES:
            continue
        spec = ARCHETYPE_SPECS[arch]
        bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
        bar_mode = str(spec["bar_mode"])
        for swap in (False, True):
            for t in SAMPLE_TS:
                pts = solve_fk(bones, lerp_pose(pa, pb, t), swap_sides=swap)
                _check_kinematic_weight_props(
                    f"{arch}:{eq_mode} swap={swap} t={t}",
                    eq_mode,
                    bar_mode,
                    pts,
                    errors,
                )


def _audit_animations_and_safe_grip(
    cfg: AuditConfig,
    seeded: list[Exercise],
    guidances: dict[str, dict[str, Any]],
    client: TestClient,
) -> AuditSectionResult:
    errors = _audit_archetype_rig_invariants(cfg)
    seen_combos: set[tuple[str, str]] = set()
    svg_url_cache: dict[str, tuple[int, str, ET.Element | None]] = {}

    for ex in seeded:
        guide = guidances.get(ex.id) or build_exercise_guidance(ex)
        arch = str(guide.get("archetype") or "squat")
        if arch not in ARCHETYPE_SPECS:
            errors.append(f"{ex.id}: unknown archetype '{arch}'")
            continue

        eq_mode = normalize_equipment(ex.equipment, arch)
        seen_combos.add((arch, eq_mode))

        try:
            live_root = _parse_svg(str(guide["svg_markup"]))
        except ET.ParseError as exc:
            errors.append(f"{ex.id}: invalid guidance svg_markup XML ({exc})")
            continue

        _check_rendered_svg_safe_grip_and_props(
            f"{ex.id} live_svg", live_root, arch, eq_mode, errors
        )

        svg_url = str(guide.get("svg_url") or "")
        status_code, ctype, thumb_root = _fetch_cached_svg_url(
            client, svg_url, svg_url_cache
        )
        if status_code != HTTP_OK or "image/svg+xml" not in ctype or thumb_root is None:
            errors.append(
                f"{ex.id}: svg_url '{svg_url}' failed "
                f"(status={status_code}, type={ctype})"
            )
        else:
            _check_rendered_svg_safe_grip_and_props(
                f"{ex.id} thumb_svg({svg_url})", thumb_root, arch, eq_mode, errors
            )

    sorted_combos = sorted(seen_combos)
    _check_combo_kinematic_sweep(sorted_combos, errors)
    errors.extend(verify_motion_js_safe_grip(cfg.motion_js_path, sorted_combos))
    return AuditSectionResult("animations_and_safe_grip", len(seeded), tuple(errors))


def _check_program_spec_entry(
    tier: str,
    spec_entry: tuple[str, int, float | None],
    by_id: dict[str, Exercise],
    covered_archetypes: set[str],
    errors: list[str],
) -> None:
    ex_id, reps, weight = spec_entry
    ex = by_id.get(ex_id)
    if ex is None:
        errors.append(f"programs.json[{tier}]: missing exercise '{ex_id}'")
        return

    covered_archetypes.add(classify_archetype(ex))
    allowed_eq = TIER_ALLOWED_EQUIPMENT.get(tier)
    if allowed_eq is not None and ex.equipment not in allowed_eq:
        errors.append(
            f"programs.json[{tier}][{ex_id}]: equipment '{ex.equipment}' "
            f"incompatible with tier '{tier}'"
        )
    if is_hold_exercise(ex) and reps < MIN_HOLD_REPS:
        errors.append(
            f"programs.json[{tier}][{ex_id}]: hold reps {reps} < {MIN_HOLD_REPS}"
        )
    if tier == "body_only" and weight is not None:
        errors.append(f"programs.json[body_only][{ex_id}]: unexpected weight {weight}")
    elif weight is not None and not (MIN_WEIGHT_KG <= weight <= MAX_WEIGHT_KG):
        errors.append(f"programs.json[{tier}][{ex_id}]: implausible weight {weight}")
    elif (
        tier != "body_only"
        and ex.equipment in WEIGHTED_EQUIPMENT
        and not is_hold_exercise(ex)
        and weight is None
    ):
        errors.append(f"programs.json[{tier}][{ex_id}]: weighted exercise missing load")


def _audit_programs_config(
    cfg: AuditConfig,
    by_id: dict[str, Exercise],
) -> list[str]:
    if not cfg.programs_path.is_file():
        return [f"Missing programs.json: {cfg.programs_path}"]

    errors: list[str] = []
    programs_cfg = load_programs_config(cfg.programs_path)
    covered_archetypes: set[str] = set()

    for tier, prog in programs_cfg["equipment_programs"].items():
        for _routine_name, specs in prog["routines"]:
            for spec_entry in specs:
                _check_program_spec_entry(
                    tier, spec_entry, by_id, covered_archetypes, errors
                )

    missing_archs = sorted(set(ARCHETYPE_SPECS.keys()) - covered_archetypes)
    if missing_archs:
        errors.append(
            f"programs.json missing archetypes ({len(missing_archs)}): {missing_archs}"
        )
    return errors


def _check_exercise_prescriptions(ex: Exercise, errors: list[str]) -> None:
    hold = is_hold_exercise(ex)
    for equip_tier in ("body_only", "full_gym"):
        for intensity in ("light", "moderate", "intense"):
            user = User(
                name="RxAudit",
                equipment=equip_tier,
                starting_intensity=intensity,
            )
            sets, reps, weight = default_prescription_for_exercise(user, ex)
            if sets < 1 or reps < 1:
                errors.append(f"{ex.id}: invalid prescription {sets}x{reps}")
            if hold and reps < MIN_HOLD_REPS:
                errors.append(f"{ex.id} ({intensity}): hold {reps}s < {MIN_HOLD_REPS}s")
            item = RoutineExercise(
                routine_id=1,
                exercise_id=ex.id,
                sets=sets,
                base_reps=reps,
                base_weight_kg=weight,
            )
            scaled = compute_scaled_target(item, 0, exercise=ex)
            if hold and "sec" not in scaled.formatted:
                errors.append(
                    f"{ex.id} ({intensity}): hold '{scaled.formatted}' missing 'sec'"
                )

    if hold:
        weighted_hold = RoutineExercise(
            routine_id=1,
            exercise_id=ex.id,
            sets=3,
            base_reps=30,
            base_weight_kg=10.0,
        )
        w_scaled = compute_scaled_target(weighted_hold, 0, exercise=ex)
        if "sec" not in w_scaled.formatted:
            errors.append(
                f"{ex.id}: weighted hold '{w_scaled.formatted}' missing 'sec'"
            )


def _audit_prescriptions_and_browse(
    seeded: list[Exercise],
    session: Session,
) -> list[str]:
    errors: list[str] = []
    for tier, allowed in TIER_ALLOWED_EQUIPMENT.items():
        probe_user = User(name=f"Browse-{tier}", equipment=tier)
        rows = search_exercises_for_user(
            session, probe_user, q="", limit=BROWSE_ALL_LIMIT
        )
        returned_ids = {row["exercise"].id for row in rows}
        expected_ids = {
            ex.id for ex in seeded if allowed is None or ex.equipment in allowed
        }
        if returned_ids != expected_ids:
            missing = sorted(expected_ids - returned_ids)[:5]
            extra = sorted(returned_ids - expected_ids)[:5]
            errors.append(
                f"Default browse q='' mismatch for tier '{tier}': "
                f"got {len(returned_ids)}/{len(expected_ids)} "
                f"(missing={missing}, extra={extra})"
            )

    for ex in seeded:
        _check_exercise_prescriptions(ex, errors)
    return errors


def _audit_search_reachability_http(
    seeded: list[Exercise],
    guidances: dict[str, dict[str, Any]],
    routine_id: int,
    client: TestClient,
) -> list[str]:
    errors: list[str] = []
    for ex in seeded:
        res = client.get(
            f"/routines/{routine_id}/search",
            params={"q": ex.name},
        )
        if res.status_code != HTTP_OK:
            errors.append(f"{ex.id}: search status {res.status_code}")
            continue
        if f'value="{ex.id}"' not in res.text:
            errors.append(f"{ex.id}: not found via /routines/id/search?q={ex.name}")
        expected_svg_url = html.escape(
            str((guidances.get(ex.id) or build_exercise_guidance(ex))["svg_url"]),
            quote=True,
        )
        if expected_svg_url not in res.text:
            errors.append(f"{ex.id}: search card missing thumbnail {expected_svg_url}")
    return errors


def _check_workout_batch_http(
    plan_id: int,
    chunk: list[Exercise],
    client: TestClient,
    errors: list[str],
) -> None:
    add_day = client.post(
        f"/plans/{plan_id}/add-day",
        follow_redirects=False,
    )
    if add_day.status_code != HTTP_SEE_OTHER:
        errors.append(f"add-day returned {add_day.status_code}")
        return

    routine_id = int(add_day.headers.get("location", "").rstrip("/").split("/")[-2])
    for ex in chunk:
        add_res = client.post(
            f"/routines/{routine_id}/add-exercise",
            data={"exercise_id": ex.id},
            follow_redirects=False,
        )
        if add_res.status_code != HTTP_SEE_OTHER:
            errors.append(f"{ex.id}: add-exercise returned {add_res.status_code}")

    if client.get(f"/routines/{routine_id}/edit").status_code != HTTP_OK:
        errors.append(f"Routine {routine_id}: edit page failed")

    ws_res = client.get(f"/workouts/{routine_id}")
    if ws_res.status_code != HTTP_OK:
        errors.append(f"Routine {routine_id}: workout status {ws_res.status_code}")
        return

    match = _PLAYLIST_RE.search(ws_res.text)
    if match is None:
        errors.append(f"Routine {routine_id}: missing PLAYLIST in workout HTML")
        return

    playlist = json.loads(match.group(1))
    if len(playlist) != len(chunk):
        errors.append(
            f"Routine {routine_id}: playlist len {len(playlist)} != {len(chunk)}"
        )
        return

    for ex, pl_item in zip(chunk, playlist, strict=True):
        _check_playlist_item(ex, pl_item, errors)


def _check_playlist_item(
    ex: Exercise,
    pl_item: dict[str, Any],
    errors: list[str],
) -> None:
    if pl_item.get("name") != ex.name:
        errors.append(f"{ex.id}: workout playlist name mismatch")
    if not str(pl_item.get("how_to") or "").strip():
        errors.append(f"{ex.id}: workout playlist missing how_to")
    if not _has_nonempty_instructions(pl_item.get("instructions")):
        errors.append(f"{ex.id}: workout playlist missing instructions")
    if bool(pl_item.get("is_hold")) and int(pl_item.get("reps", 0)) < MIN_HOLD_REPS:
        errors.append(
            f"{ex.id}: workout hold reps {pl_item.get('reps')} < {MIN_HOLD_REPS}"
        )


def _audit_customizer_and_workouts_http(
    seeded: list[Exercise],
    guidances: dict[str, dict[str, Any]],
    client: TestClient,
    session: Session,
) -> list[str]:
    setup_res = client.post(
        "/setup",
        data={
            "name": "CustomizerAudit",
            "equipment": "full_gym",
            "starting_intensity": "moderate",
            "days_per_week": "2",
        },
        follow_redirects=False,
    )
    if setup_res.status_code != HTTP_SEE_OTHER:
        return [f"Customizer /setup failed with {setup_res.status_code}"]

    base_routine = session.exec(
        select(WorkoutRoutine).order_by(col(WorkoutRoutine.id).desc())
    ).first()
    if base_routine is None or base_routine.id is None:
        return ["Customizer /setup created no routine"]

    errors = _audit_search_reachability_http(seeded, guidances, base_routine.id, client)
    for batch_start in range(0, len(seeded), WORKOUT_BATCH_SIZE):
        chunk = seeded[batch_start : batch_start + WORKOUT_BATCH_SIZE]
        _check_workout_batch_http(base_routine.plan_id, chunk, client, errors)
    return errors


def _audit_programs_and_customizer(
    cfg: AuditConfig,
    seeded: list[Exercise],
    guidances: dict[str, dict[str, Any]],
    client: TestClient,
    session: Session,
) -> AuditSectionResult:
    by_id = {ex.id: ex for ex in seeded}
    errors = _audit_programs_config(cfg, by_id)
    errors.extend(_audit_prescriptions_and_browse(seeded, session))
    errors.extend(
        _audit_customizer_and_workouts_http(seeded, guidances, client, session)
    )
    return AuditSectionResult("programs_and_customizer_e2e", len(seeded), tuple(errors))


def run_catalog_audit(config: AuditConfig | None = None) -> AuditReport:
    """Run exhaustive end-to-end checks across all 876 exercises and 18 archetypes.

    Args:
        config: Optional `AuditConfig` overriding file paths or fallback allowlist.

    Returns:
        Structured `AuditReport` with per-section results and flattened errors.
    """
    cfg = config or AuditConfig()
    audit_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(audit_engine)

    with Session(audit_engine) as session:

        def _override_session() -> Generator[Session]:
            yield session

        prev_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_session] = _override_session
        try:
            client = TestClient(app)
            sec_catalog, seeded, raw_ids = _audit_catalog_and_seeding(cfg, session)
            sec_coaching, guidances = _audit_coaching_integration(
                cfg, seeded, raw_ids, client, session
            )
            sec_rig = _audit_animations_and_safe_grip(cfg, seeded, guidances, client)
            sec_programs = _audit_programs_and_customizer(
                cfg, seeded, guidances, client, session
            )
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(prev_overrides)

    return AuditReport(
        exercise_count=len(seeded),
        archetype_count=len(svg_assets.ARCHETYPE_SPECS),
        sections=(sec_catalog, sec_coaching, sec_rig, sec_programs),
    )


def main() -> None:
    """Execute `run_catalog_audit()` as a CLI check and exit non-zero on any failure."""
    load_programs_config.cache_clear()
    services.EQUIPMENT_PROGRAMS.update(load_programs_config()["equipment_programs"])
    report = run_catalog_audit()

    sys.stdout.write(
        f"Training Aid E2E Catalog Audit — {report.exercise_count} exercises, "
        f"{report.archetype_count} archetypes\n"
    )
    for section in report.sections:
        status = "PASS" if section.passed else f"FAIL ({len(section.errors)} errors)"
        sys.stdout.write(f"  [{status}] {section.name} (checked={section.checked})\n")

    if not report.passed:
        sys.stderr.write(f"\nAudit FAILED with {len(report.errors)} error(s):\n")
        for err in report.errors:
            sys.stderr.write(f"  - {err}\n")
        raise SystemExit(1)

    sys.stdout.write("\nAll E2E catalog, coaching, rig, and HTTP checks PASSED.\n")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
