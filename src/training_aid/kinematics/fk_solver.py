# Copyright (c) 2026 Philipp Kaaden
"""Pure 2D forward-kinematics solver and spatial bounds helpers."""

import math
from typing import Any

Point = tuple[float, float]

POSE_KEYS: tuple[str, ...] = (
    "hip_x",
    "hip_y",
    "lumbar",
    "thoracic",
    "neck",
    "uarm_f",
    "farm_f",
    "uarm_b",
    "farm_b",
    "thigh_f",
    "shin_f",
    "thigh_b",
    "shin_b",
)

BONE_KEYS: tuple[str, ...] = (
    "lumbar",
    "thoracic",
    "neck",
    "uarm",
    "farm",
    "thigh",
    "shin",
    "back_dx",
    "back_dy",
    "clavicle_r",
    "pelvis_r",
)

_VIEWPORT_WIDTH = 240.0
_HALF_TURN_DEG = 180.0
_DEFAULT_CLAVICLE_R = 14.5
_DEFAULT_PELVIS_R = 9.5

__all__ = [
    "BONE_KEYS",
    "POSE_KEYS",
    "Point",
    "compute_aura_center",
    "compute_shadow",
    "compute_sockets",
    "lerp_pose",
    "solve_fk",
    "step_point",
]


def compute_sockets(
    hip: Point,
    shoulder: Point,
    spine: tuple[float, float],
    bones: dict[str, float],
    *,
    view: str = "side",
) -> tuple[Point, Point, Point, Point]:
    """Return `(hip_f, hip_b, shoulder_f, shoulder_b)` socket coordinates."""
    lumbar, thoracic = spine
    if view == "front":
        pelvis_r = bones.get("pelvis_r", _DEFAULT_PELVIS_R)
        clavicle_r = bones.get("clavicle_r", _DEFAULT_CLAVICLE_R)
        lum_rad = math.radians(lumbar)
        tho_rad = math.radians(thoracic)
        nx_l, ny_l = -math.sin(lum_rad), math.cos(lum_rad)
        nx_t, ny_t = -math.sin(tho_rad), math.cos(tho_rad)
        return (
            (hip[0] + pelvis_r * nx_l, hip[1] + pelvis_r * ny_l),
            (hip[0] - pelvis_r * nx_l, hip[1] - pelvis_r * ny_l),
            (shoulder[0] + clavicle_r * nx_t, shoulder[1] + clavicle_r * ny_t),
            (shoulder[0] - clavicle_r * nx_t, shoulder[1] - clavicle_r * ny_t),
        )
    back_dx = bones["back_dx"]
    back_dy = bones["back_dy"]
    return (
        hip,
        (hip[0] + back_dx, hip[1] + back_dy),
        shoulder,
        (shoulder[0] + back_dx, shoulder[1] + back_dy),
    )


def step_point(origin: Point, length: float, angle_deg: float) -> Point:
    """Advance from `origin` by `length` along `angle_deg` in SVG coordinates."""
    rad = math.radians(angle_deg)
    return (origin[0] + length * math.cos(rad), origin[1] + length * math.sin(rad))


def lerp_pose(
    pose_a: dict[str, float],
    pose_b: dict[str, float],
    t: float,
) -> dict[str, float]:
    """Interpolate linearly between two FK pose dictionaries."""
    return {k: pose_a[k] + (pose_b[k] - pose_a[k]) * t for k in POSE_KEYS}


def solve_fk(
    bones: dict[str, float],
    pose: dict[str, float],
    *,
    swap_sides: bool = False,
    view: str = "side",
) -> dict[str, Point]:
    """Solve 2D forward kinematics joint coordinates from bone lengths and angles."""
    is_front = view == "front"
    if is_front and swap_sides:
        hip_x = _VIEWPORT_WIDTH - pose["hip_x"]
        hip_y = pose["hip_y"]
        lumbar = -_HALF_TURN_DEG - pose["lumbar"]
        thoracic = -_HALF_TURN_DEG - pose["thoracic"]
        neck = -_HALF_TURN_DEG - pose["neck"]
        uarm_f = _HALF_TURN_DEG - pose["uarm_b"]
        uarm_b = _HALF_TURN_DEG - pose["uarm_f"]
        farm_f = _HALF_TURN_DEG - pose["farm_b"]
        farm_b = _HALF_TURN_DEG - pose["farm_f"]
        thigh_f = _HALF_TURN_DEG - pose["thigh_b"]
        thigh_b = _HALF_TURN_DEG - pose["thigh_f"]
        shin_f = _HALF_TURN_DEG - pose["shin_b"]
        shin_b = _HALF_TURN_DEG - pose["shin_f"]
    else:
        hip_x = pose["hip_x"]
        hip_y = pose["hip_y"]
        lumbar = pose["lumbar"]
        thoracic = pose["thoracic"]
        neck = pose["neck"]
        if swap_sides:
            uarm_f, uarm_b = pose["uarm_b"], pose["uarm_f"]
            farm_f, farm_b = pose["farm_b"], pose["farm_f"]
            thigh_f, thigh_b = pose["thigh_b"], pose["thigh_f"]
            shin_f, shin_b = pose["shin_b"], pose["shin_f"]
        else:
            uarm_f, uarm_b = pose["uarm_f"], pose["uarm_b"]
            farm_f, farm_b = pose["farm_f"], pose["farm_b"]
            thigh_f, thigh_b = pose["thigh_f"], pose["thigh_b"]
            shin_f, shin_b = pose["shin_f"], pose["shin_b"]

    hip: Point = (hip_x, hip_y)
    mid_spine = step_point(hip, bones["lumbar"], lumbar)
    shoulder = step_point(mid_spine, bones["thoracic"], thoracic)
    head = step_point(shoulder, bones["neck"], neck)

    hip_f, hip_b, shoulder_f, shoulder_b = compute_sockets(
        hip,
        shoulder,
        (lumbar, thoracic),
        bones,
        view=view,
    )

    knee_f = step_point(hip_f, bones["thigh"], thigh_f)
    foot_f = step_point(knee_f, bones["shin"], shin_f)
    knee_b = step_point(hip_b, bones["thigh"], thigh_b)
    foot_b = step_point(knee_b, bones["shin"], shin_b)

    elbow_f = step_point(shoulder_f, bones["uarm"], uarm_f)
    hand_f = step_point(elbow_f, bones["farm"], farm_f)
    elbow_b = step_point(shoulder_b, bones["uarm"], uarm_b)
    hand_b = step_point(elbow_b, bones["farm"], farm_b)

    return {
        "hip": hip,
        "hip_f": hip_f,
        "hip_b": hip_b,
        "mid_spine": mid_spine,
        "shoulder": shoulder,
        "shoulder_f": shoulder_f,
        "shoulder_b": shoulder_b,
        "head": head,
        "knee_f": knee_f,
        "foot_f": foot_f,
        "knee_b": knee_b,
        "foot_b": foot_b,
        "elbow_f": elbow_f,
        "hand_f": hand_f,
        "elbow_b": elbow_b,
        "hand_b": hand_b,
    }


def compute_shadow(joints: dict[str, Point]) -> tuple[float, float]:
    """Compute floor shadow horizontal center and radius from joint coordinates."""
    xs = (
        joints["head"][0],
        joints["shoulder"][0],
        joints["hip"][0],
        joints["foot_f"][0],
        joints["foot_b"][0],
        joints["hand_f"][0],
        joints["hand_b"][0],
    )
    min_x = min(xs)
    max_x = max(xs)
    cx = (min_x + max_x) * 0.5
    rx = max(22.0, min(82.0, (max_x - min_x) * 0.5 + 12.0))
    return (cx, rx)


def compute_aura_center(spec: dict[str, Any]) -> Point:
    """Compute clamped backdrop aura center from the mid-rep FK pose."""
    j_mid = solve_fk(
        spec["bones"],
        lerp_pose(spec["pose_a"], spec["pose_b"], 0.5),
        view=str(spec.get("view", "side")),
    )
    ys = (
        j_mid["head"][1],
        j_mid["shoulder"][1],
        j_mid["hip"][1],
        j_mid["knee_f"][1],
        j_mid["foot_f"][1],
    )
    xs = (
        j_mid["head"][0],
        j_mid["shoulder"][0],
        j_mid["hip"][0],
        j_mid["foot_f"][0],
    )
    cy = max(96.0, min(140.0, (min(ys) + max(ys)) * 0.5))
    cx = max(108.0, min(132.0, (min(xs) + max(xs)) * 0.5))
    return (round(cx, 1), round(cy, 1))
