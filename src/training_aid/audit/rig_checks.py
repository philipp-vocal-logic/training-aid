# Copyright (c) 2026 Philipp Kaaden
"""Forward-kinematics pose bounds, SVG safe-grip, and motion.js rig audit checks."""

from __future__ import annotations

import json
import math
import os
import xml.etree.ElementTree as ET
from typing import TYPE_CHECKING, Any

from training_aid.audit.models import (
    REPO_ROOT,
    AuditConfig,
    AuditSectionResult,
)
from training_aid.audit.node_runner import find_node_binary, run_node_command

try:
    from training_aid.kinematics import (
        CANONICAL_EQUIPMENT_MODES,
        AnimationRegistry,
        lerp_pose,
        load_animation_registry,
        normalize_equipment,
        solve_fk,
    )
except ModuleNotFoundError:  # pragma: no cover
    CANONICAL_EQUIPMENT_MODES = (
        "body_only",
        "barbell",
        "dumbbell",
        "kettlebells",
        "bands",
        "cable",
        "machine",
    )

if TYPE_CHECKING:
    from pathlib import Path

    from training_aid.compiler import CatalogExercise

__all__ = [
    "HANDHELD_WEIGHT_MODES",
    "audit_animations_and_safe_grip",
    "verify_motion_js_safe_grip",
]

VIEWPORT_MIN = 0.0
VIEWPORT_MAX_X = 240.0
VIEWPORT_MAX_JOINT_Y = 174.0
FLOOR_Y = 175.0
HEAD_RADIUS = 11.5
MAX_KB_HANDLE_DIST = 3.0
MAX_RACK_HAND_SHOULDER_DIST = 28.0
SVG_COORD_TOL = 0.03
BONE_LEN_TOL = 1e-6
SAMPLE_TS: tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 1.0)
HANDHELD_WEIGHT_MODES: frozenset[str] = frozenset(
    {"barbell", "dumbbell", "kettlebells"}
)
RACK_ARCHETYPES: frozenset[str] = frozenset({"squat", "lunge", "calf_raise"})
SEGMENT_PAIRS: tuple[tuple[str, str, str], ...] = (
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


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Compute Euclidean distance between two 2D points."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _parse_svg(markup: str) -> ET.Element:
    """Parse trusted local SVG XML markup."""
    return ET.fromstring(markup)  # noqa: S314


def _circle_bounds_error(
    label: str,
    center: tuple[float, float],
    radius: float,
) -> list[str]:
    """Verify a circle of `radius` at `center` stays within the SVG viewport."""
    cx, cy = center
    max_x = VIEWPORT_MAX_X + SVG_COORD_TOL
    max_y = FLOOR_Y + SVG_COORD_TOL
    in_x = cx - radius >= -SVG_COORD_TOL and cx + radius <= max_x
    in_y = cy - radius >= -SVG_COORD_TOL and cy + radius <= max_y
    if in_x and in_y:
        return []
    return [f"{label} circle ({cx:.2f}, {cy:.2f}) r={radius} out of viewport bounds"]


def _build_prop_circles(
    prop_geometry: dict[str, dict[str, float]],
) -> dict[str, tuple[tuple[str, float, float], ...]]:
    """Build `(joint_key, dy, radius)` bounds specs from `registry.prop_geometry`."""
    bb = prop_geometry["barbell"]
    db = prop_geometry["dumbbell"]
    kb = prop_geometry["kettlebells"]
    return {
        "barbell": (
            ("hand_f", 0.0, float(bb["front_r"])),
            ("hand_b", 0.0, float(bb["back_r"])),
        ),
        "dumbbell": (
            ("hand_f", 0.0, float(db["front_r"])),
            ("hand_b", 0.0, float(db["back_r"])),
        ),
        "kettlebells": (
            ("hand_f", float(kb["handle_dy"]), float(kb["handle_r"])),
            ("hand_f", float(kb["front_dy"]), float(kb["front_r"])),
            ("hand_b", float(kb["back_dy"]), float(kb["back_r"])),
        ),
    }


def _check_pose_and_props(
    label: str,
    spec: dict[str, Any],
    points: dict[str, tuple[float, float]],
    eq_mode: str,
    prop_circles: dict[str, tuple[tuple[str, float, float], ...]],
) -> list[str]:
    """Check bone-length preservation, joint/head viewport bounds, and prop bounds."""
    bones = spec["bones"]
    bar_mode = str(spec["bar_mode"])
    errors = [
        f"{label}: bone '{bone_key}' length {_dist(points[p1], points[p2]):.4f} != "
        f"{bones[bone_key]:.4f}"
        for p1, p2, bone_key in SEGMENT_PAIRS
        if abs(_dist(points[p1], points[p2]) - bones[bone_key]) > BONE_LEN_TOL
    ]

    for joint_name, (jx, jy) in points.items():
        if not (
            VIEWPORT_MIN <= jx <= VIEWPORT_MAX_X
            and VIEWPORT_MIN <= jy <= VIEWPORT_MAX_JOINT_Y
        ):
            errors.append(f"{label}: joint '{joint_name}' ({jx:.2f}, {jy:.2f}) OOB")

    hx, hy = points["head"]
    if not (
        HEAD_RADIUS <= hx <= VIEWPORT_MAX_X - HEAD_RADIUS
        and HEAD_RADIUS <= hy <= VIEWPORT_MAX_JOINT_Y
    ):
        errors.append(f"{label}: head ({hx:.2f}, {hy:.2f}) clips viewport")

    if bar_mode == "shoulder":
        errors.append(f"{label}: forbidden bar_mode='shoulder'")

    for joint_key, dy, radius in prop_circles.get(eq_mode, ()):
        jx, jy = points[joint_key]
        errors.extend(_circle_bounds_error(f"{label} {eq_mode}", (jx, jy + dy), radius))

    return errors


def _check_handheld_svg_weights(
    label: str,
    root: ET.Element,
    eq_mode: str,
    hands: tuple[tuple[float, float], tuple[float, float]],
) -> list[str]:
    """Verify handheld weight circles and kettlebell handles attach to hands."""
    weight_f = root.find(".//*[@class='js-weight']")
    weight_b = root.find(".//*[@class='js-weight-b']")
    if weight_f is None or weight_b is None:
        return [f"{label}: {eq_mode} missing .js-weight or .js-weight-b"]

    hf, hb = hands
    wf = (float(weight_f.attrib["cx"]), float(weight_f.attrib["cy"]))
    wb = (float(weight_b.attrib["cx"]), float(weight_b.attrib["cy"]))
    errs = [
        *_circle_bounds_error(f"{label} .js-weight", wf, float(weight_f.attrib["r"])),
        *_circle_bounds_error(f"{label} .js-weight-b", wb, float(weight_b.attrib["r"])),
    ]
    if eq_mode in {"barbell", "dumbbell"}:
        if _dist(wf, hf) > SVG_COORD_TOL or _dist(wb, hb) > SVG_COORD_TOL:
            errs.append(f"{label}: {eq_mode} weight detached from hands")
    elif eq_mode == "kettlebells":
        handle = root.find(".//*[@class='js-kb-handle-f']")
        if handle is None:
            errs.append(f"{label}: missing .js-kb-handle-f for kettlebells")
        else:
            h_pt = (float(handle.get("cx", 0)), float(handle.get("cy", 0)))
            if _dist(h_pt, hf) > MAX_KB_HANDLE_DIST:
                errs.append(f"{label}: kettlebell handle detached from front hand")
    return errs


def _check_inline_svg_safe_grip(
    label: str,
    root: ET.Element,
    arch: str,
    eq_mode: str,
) -> list[str]:
    """Verify inline SVG dataset attributes and hand-to-prop attachment."""
    errors: list[str] = []
    if (root.get("data-archetype"), root.get("data-equipment")) != (arch, eq_mode):
        errors.append(f"{label}: mismatched data-archetype or data-equipment")
    if root.get("data-bar-mode") == "shoulder":
        errors.append(f"{label}: forbidden data-bar-mode='shoulder'")

    farm_f = root.find(".//*[@class='js-farm-f']")
    farm_b = root.find(".//*[@class='js-farm-b']")
    if farm_f is None or farm_b is None:
        errors.append(f"{label}: missing .js-farm-f or .js-farm-b element")
        return errors

    if eq_mode not in HANDHELD_WEIGHT_MODES:
        if root.find(".//*[@class='js-weight']") is not None:
            errors.append(f"{label}: {eq_mode} unexpectedly renders .js-weight")
        return errors

    hf = (float(farm_f.attrib["x2"]), float(farm_f.attrib["y2"]))
    hb = (float(farm_b.attrib["x2"]), float(farm_b.attrib["y2"]))
    errors.extend(_check_handheld_svg_weights(label, root, eq_mode, (hf, hb)))
    return errors


def verify_motion_js_safe_grip(
    motion_js_path: Path,
    combos: list[tuple[str, str]],
) -> list[str]:
    """Verify motion.js safe-grip invariants via static check and Node ESM helper."""
    if not motion_js_path.is_file():
        return [f"Missing motion.js: {motion_js_path}"]

    src = motion_js_path.read_text(encoding="utf-8")
    if "function renderPoseState" not in src:
        return ["motion.js missing function renderPoseState"]

    errors: list[str] = []
    render_body = src[src.index("function renderPoseState") :]
    if "querySelector" in render_body or 'barMode === "shoulder"' in render_body:
        errors.append(
            "motion.js violates renderPoseState static invariants "
            "(querySelector or shoulder barMode inside renderPoseState)"
        )

    node_bin = find_node_binary()
    helper = REPO_ROOT / "tests" / "check_motion_rig.mjs"
    handheld = [(arch, eq) for arch, eq in combos if eq in HANDHELD_WEIGHT_MODES]
    if node_bin is not None and handheld and helper.is_file():
        registry = load_animation_registry()
        specs = registry.specs
        coaching = registry.coaching
        items = [
            {
                **specs[arch],
                "arch": arch,
                "eq_mode": eq,
                "tempo_mode": coaching[arch]["tempo_mode"],
            }
            for arch, eq in handheld
        ]
        env = {
            **os.environ,
            "TA_MOTION_JS": str(motion_js_path.resolve()),
            "TA_COMBOS_JSON": json.dumps(items),
        }
        proc = run_node_command([node_bin, str(helper)], env)
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout).strip()
            errors.append(f"Node motion.js helper failed: {detail}")
        else:
            failures = json.loads(proc.stdout).get("failures", [])
            errors.extend(f"Node motion.js: {msg}" for msg in failures)
    return errors


def _check_combo_svg_and_thumb(
    combo: tuple[str, str],
    spec: dict[str, Any],
    svgs: dict[str, Any],
    dist_dir: Path,
    prop_circles: dict[str, tuple[tuple[str, float, float], ...]],
) -> list[str]:
    """Validate inline SVG, thumbnail SVG, and FK trajectory for one combo."""
    arch, eq_mode = combo
    errors: list[str] = []
    inline_markup = str(svgs.get(f"{arch}:{eq_mode}") or "")
    if not inline_markup:
        errors.append(f"Missing inline SVG for {arch}:{eq_mode}")
    else:
        errors.extend(
            _check_inline_svg_safe_grip(
                f"svgs[{arch}:{eq_mode}]",
                _parse_svg(inline_markup),
                arch,
                eq_mode,
            )
        )

    thumb_path = dist_dir / "svgs" / "thumbs" / f"{arch}__{eq_mode}.svg"
    if not thumb_path.is_file():
        errors.append(f"Missing thumbnail SVG: {thumb_path.name}")
    else:
        thumb_text = thumb_path.read_text(encoding="utf-8")
        thumb_root = _parse_svg(thumb_text)
        attrs_ok = (
            thumb_root.get("data-archetype"),
            thumb_root.get("data-equipment"),
        ) == (arch, eq_mode)
        if not attrs_ok or 'data-pose-a="' in thumb_text or 'class="js-' in thumb_text:
            errors.append(
                f"{thumb_path.name}: invalid thumbnail attrs or unstripped js-* classes"
            )

    bones = spec["bones"]
    pose_a = spec["pose_a"]
    pose_b = spec["pose_b"]
    for swap in (False, True):
        for t in SAMPLE_TS:
            points = solve_fk(bones, lerp_pose(pose_a, pose_b, t), swap_sides=swap)
            label = f"{arch}:{eq_mode} t={t}"
            errors.extend(
                _check_pose_and_props(label, spec, points, eq_mode, prop_circles)
            )
            is_rack = eq_mode == "body_only" and arch in RACK_ARCHETYPES and not swap
            far_from_shoulder = (
                _dist(points["hand_f"], points["shoulder"])
                > MAX_RACK_HAND_SHOULDER_DIST
            )
            if is_rack and (
                points["hand_f"][1] >= points["mid_spine"][1] or far_from_shoulder
            ):
                errors.append(f"{arch} t={t}: rack hand position invalid")
    return errors


def audit_animations_and_safe_grip(
    cfg: AuditConfig,
    exercises: list[CatalogExercise],
    dist_dir: Path,
    catalog: dict[str, Any],
    registry: AnimationRegistry,
) -> AuditSectionResult:
    """Verify all 126 SVG combos, FK trajectories, and motion.js safe-grip."""
    errors: list[str] = []
    specs = registry.specs
    prop_circles = _build_prop_circles(registry.prop_geometry)
    all_combos = [
        (arch, eq_mode)
        for arch in sorted(specs)
        for eq_mode in CANONICAL_EQUIPMENT_MODES
    ]
    all_combos_set = set(all_combos)
    svgs = catalog.get("svgs", {})

    for combo in all_combos:
        errors.extend(
            _check_combo_svg_and_thumb(
                combo, specs[combo[0]], svgs, dist_dir, prop_circles
            )
        )

    for ex in exercises:
        norm_eq = normalize_equipment(ex.equipment, ex.archetype, registry=registry)
        if (ex.archetype, norm_eq) not in all_combos_set:
            errors.append(
                f"{ex.id}: unexpected normalized combo ({ex.archetype}, {norm_eq})"
            )

    errors.extend(verify_motion_js_safe_grip(cfg.resolved_motion_js_path, all_combos))
    return AuditSectionResult("animations_and_safe_grip", len(exercises), tuple(errors))
