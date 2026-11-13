# Copyright (c) 2026 Philipp Kaaden
"""2-link inverse-kinematics pose compiler for declarative animation specs."""

import math
from typing import Any

from training_aid.kinematics.fk_solver import Point, step_point

LimbAngles = tuple[float, float]
SpineAngles = tuple[float, float, float]

_HALF_TURN_DEG = 180.0
_FULL_TURN_DEG = 360.0

__all__ = ["compile_animation_spec"]


def _unwrap_deg(deg: float, near: float | None) -> float:
    if near is None:
        return deg
    while deg - near > _HALF_TURN_DEG:
        deg -= _FULL_TURN_DEG
    while deg - near < -_HALF_TURN_DEG:
        deg += _FULL_TURN_DEG
    return deg


def _solve_2link_ik(
    root: Point,
    target: Point,
    lengths: tuple[float, float],
    *,
    bend_sign: int = -1,
    near: LimbAngles | None = None,
) -> LimbAngles:
    l1, l2 = lengths
    dx = target[0] - root[0]
    dy = target[1] - root[1]
    dist = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, math.hypot(dx, dy)))
    base = math.atan2(dy, dx)
    cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2.0 * l1 * dist)))
    theta1 = base + bend_sign * math.acos(cos_a)
    mid = (root[0] + l1 * math.cos(theta1), root[1] + l1 * math.sin(theta1))
    theta2 = math.atan2(target[1] - mid[1], target[0] - mid[0])
    deg1 = _unwrap_deg(math.degrees(theta1), near[0] if near is not None else None)
    deg2 = _unwrap_deg(math.degrees(theta2), near[1] if near is not None else None)
    return (round(deg1, 2), round(deg2, 2))


def _pose(
    hip: Point,
    spine: SpineAngles,
    arm_f: LimbAngles,
    arm_b: LimbAngles,
    legs: tuple[LimbAngles, LimbAngles],
) -> dict[str, float]:
    leg_f, leg_b = legs
    return {
        "hip_x": round(hip[0], 2),
        "hip_y": round(hip[1], 2),
        "lumbar": round(spine[0], 2),
        "thoracic": round(spine[1], 2),
        "neck": round(spine[2], 2),
        "uarm_f": round(arm_f[0], 2),
        "farm_f": round(arm_f[1], 2),
        "uarm_b": round(arm_b[0], 2),
        "farm_b": round(arm_b[1], 2),
        "thigh_f": round(leg_f[0], 2),
        "shin_f": round(leg_f[1], 2),
        "thigh_b": round(leg_b[0], 2),
        "shin_b": round(leg_b[1], 2),
    }


def _compile_limb(
    limb_spec: list[float] | dict[str, Any],
    roots: dict[str, Point],
    default_root: str,
    lengths: tuple[float, float],
    near: LimbAngles | None,
) -> LimbAngles:
    if isinstance(limb_spec, list):
        return (float(limb_spec[0]), float(limb_spec[1]))
    root_name = str(limb_spec.get("root", default_root))
    target: Point = (float(limb_spec["target"][0]), float(limb_spec["target"][1]))
    bend_sign = int(limb_spec.get("bend_sign", -1))
    return _solve_2link_ik(
        roots[root_name],
        target,
        lengths,
        bend_sign=bend_sign,
        near=near,
    )


def _compile_pose(
    pose_spec: dict[str, Any],
    bones: dict[str, float],
    prev_spec: dict[str, Any] | None = None,
    prev_limbs: dict[str, LimbAngles] | None = None,
) -> tuple[dict[str, float], dict[str, LimbAngles]]:
    hip: Point = (float(pose_spec["hip"][0]), float(pose_spec["hip"][1]))
    spine: SpineAngles = (
        float(pose_spec["spine"][0]),
        float(pose_spec["spine"][1]),
        float(pose_spec["spine"][2]),
    )
    mid_spine = step_point(hip, bones["lumbar"], spine[0])
    shoulder = step_point(mid_spine, bones["thoracic"], spine[1])
    roots: dict[str, Point] = {
        "hip": hip,
        "hip_b": (hip[0] + bones["back_dx"], hip[1] + bones["back_dy"]),
        "shoulder": shoulder,
        "shoulder_b": (shoulder[0] + bones["back_dx"], shoulder[1] + bones["back_dy"]),
    }
    limb_defs: tuple[tuple[str, str, tuple[float, float]], ...] = (
        ("arm_f", "shoulder", (bones["uarm"], bones["farm"])),
        ("arm_b", "shoulder_b", (bones["uarm"], bones["farm"])),
        ("leg_f", "hip", (bones["thigh"], bones["shin"])),
        ("leg_b", "hip_b", (bones["thigh"], bones["shin"])),
    )
    limbs: dict[str, LimbAngles] = {}
    for key, default_root, lengths in limb_defs:
        raw_limb = pose_spec[key]
        near: LimbAngles | None = None
        if isinstance(raw_limb, dict) and prev_limbs is not None:
            default_unwrap = prev_spec is not None and isinstance(prev_spec[key], dict)
            if bool(raw_limb.get("unwrap", default_unwrap)):
                near = prev_limbs[key]
        limbs[key] = _compile_limb(raw_limb, roots, default_root, lengths, near)

    compiled = _pose(
        hip,
        spine,
        limbs["arm_f"],
        limbs["arm_b"],
        (limbs["leg_f"], limbs["leg_b"]),
    )
    return (compiled, limbs)


def compile_animation_spec(
    cfg: dict[str, Any],
    std_bones: dict[str, float],
) -> dict[str, Any]:
    """Compile a declarative animation entry into FK poses and rig metadata."""
    bones: dict[str, float] = {
        **std_bones,
        **{k: float(v) for k, v in cfg.get("bones", {}).items()},
    }
    pose_a, limbs_a = _compile_pose(cfg["pose_a"], bones)
    pose_b, _ = _compile_pose(cfg["pose_b"], bones, cfg["pose_a"], limbs_a)
    band_anchor = cfg["band_anchor"]
    cable_anchor = cfg["cable_anchor"]
    spec: dict[str, Any] = {
        "label": str(cfg["label"]),
        "fixture": cfg.get("fixture"),
        "default_equipment": str(cfg["default_equipment"]),
        "bar_mode": str(cfg.get("bar_mode", "hands")),
        "hold_style": str(cfg.get("hold_style", "settle")),
        "band_anchor": (float(band_anchor[0]), float(band_anchor[1])),
        "band_target": str(cfg.get("band_target", "hand")),
        "cable_anchor": (float(cable_anchor[0]), float(cable_anchor[1])),
        "cable_target": str(cfg.get("cable_target", "hand")),
        "bones": bones,
        "pose_a": pose_a,
        "pose_b": pose_b,
        "coaching": dict(cfg["coaching"]),
    }
    forefoot = cfg.get("forefoot")
    if forefoot is not None:
        spec["forefoot"] = (float(forefoot[0]), float(forefoot[1]))
    return spec
