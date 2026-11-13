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
)

__all__ = [
    "BONE_KEYS",
    "POSE_KEYS",
    "Point",
    "compute_aura_center",
    "compute_shadow",
    "lerp_pose",
    "solve_fk",
    "step_point",
]


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
) -> dict[str, Point]:
    """Solve 2D forward kinematics joint coordinates from bone lengths and angles."""
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

    hip: Point = (pose["hip_x"], pose["hip_y"])
    mid_spine = step_point(hip, bones["lumbar"], pose["lumbar"])
    shoulder = step_point(mid_spine, bones["thoracic"], pose["thoracic"])
    head = step_point(shoulder, bones["neck"], pose["neck"])

    hip_b: Point = (hip[0] + bones["back_dx"], hip[1] + bones["back_dy"])
    shoulder_b: Point = (
        shoulder[0] + bones["back_dx"],
        shoulder[1] + bones["back_dy"],
    )

    knee_f = step_point(hip, bones["thigh"], thigh_f)
    foot_f = step_point(knee_f, bones["shin"], shin_f)
    knee_b = step_point(hip_b, bones["thigh"], thigh_b)
    foot_b = step_point(knee_b, bones["shin"], shin_b)

    elbow_f = step_point(shoulder, bones["uarm"], uarm_f)
    hand_f = step_point(elbow_f, bones["farm"], farm_f)
    elbow_b = step_point(shoulder_b, bones["uarm"], uarm_b)
    hand_b = step_point(elbow_b, bones["farm"], farm_b)

    return {
        "hip": hip,
        "mid_spine": mid_spine,
        "shoulder": shoulder,
        "head": head,
        "hip_b": hip_b,
        "shoulder_b": shoulder_b,
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
    )
    min_x = min(xs)
    max_x = max(xs)
    cx = (min_x + max_x) * 0.5
    rx = max(22.0, min(82.0, (max_x - min_x) * 0.5 + 12.0))
    return (cx, rx)


def compute_aura_center(spec: dict[str, Any]) -> Point:
    """Compute clamped backdrop aura center from the mid-rep FK pose."""
    j_mid = solve_fk(spec["bones"], lerp_pose(spec["pose_a"], spec["pose_b"], 0.5))
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
