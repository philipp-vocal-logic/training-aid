# Copyright (c) 2026 Philipp Kaaden
"""2D forward-kinematics exercise rig and SVG asset generator."""

import json
import math
import sys
from html import escape
from pathlib import Path
from typing import Any

SVGS_DIR = Path(__file__).resolve().parent / "static" / "svgs"

Point = tuple[float, float]
LimbAngles = tuple[float, float]
SpineAngles = tuple[float, float, float]

_HALF_TURN_DEG = 180.0
_FULL_TURN_DEG = 360.0

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

BACK_RACK_ARCHETYPES: frozenset[str] = frozenset({"squat", "lunge", "calf_raise"})

STD_BONES: dict[str, float] = {
    "lumbar": 22.0,
    "thoracic": 22.0,
    "neck": 19.0,
    "uarm": 25.0,
    "farm": 24.0,
    "thigh": 36.0,
    "shin": 36.0,
    "back_dx": -5.0,
    "back_dy": -2.0,
}

_EQUIPMENT_ALIASES: dict[str, str] = {
    "body_only": "body_only",
    "none": "body_only",
    "bodyweight": "body_only",
    "foam_roll": "body_only",
    "exercise_ball": "body_only",
    "other": "body_only",
    "dumbbell": "dumbbell",
    "dumbbells": "dumbbell",
    "medicine_ball": "dumbbell",
    "barbell": "barbell",
    "barbells": "barbell",
    "e_z_curl_bar": "barbell",
    "ez_curl_bar": "barbell",
    "ez_bar": "barbell",
    "full_gym": "barbell",
    "kettlebells": "kettlebells",
    "kettlebell": "kettlebells",
    "kettlebell_bands": "kettlebells",
    "bands": "bands",
    "band": "bands",
    "resistance_band": "bands",
    "resistance_bands": "bands",
    "cable": "cable",
    "cables": "cable",
    "machine": "machine",
    "machines": "machine",
}

_STATIC_FIXTURES: dict[str, str] = {
    "bench": (
        '<rect x="50" y="136" width="96" height="8" rx="4" fill="#334155" '
        'stroke="#475569" stroke-width="1.2" />'
        '<line x1="66" y1="144" x2="66" y2="174" stroke="#334155" '
        'stroke-width="5" stroke-linecap="round" />'
        '<line x1="130" y1="144" x2="130" y2="174" stroke="#334155" '
        'stroke-width="5" stroke-linecap="round" />'
    ),
    "incline_bench": (
        '<line x1="68" y1="98" x2="130" y2="140" stroke="#334155" '
        'stroke-width="8" stroke-linecap="round" />'
        '<line x1="126" y1="140" x2="148" y2="136" stroke="#334155" '
        'stroke-width="7" stroke-linecap="round" />'
        '<line x1="84" y1="110" x2="76" y2="174" stroke="#475569" '
        'stroke-width="4.5" stroke-linecap="round" />'
        '<line x1="134" y1="140" x2="138" y2="174" stroke="#475569" '
        'stroke-width="4.5" stroke-linecap="round" />'
    ),
    "dip_box": (
        '<rect x="42" y="138" width="54" height="36" rx="6" fill="#1e293b" '
        'stroke="#475569" stroke-width="1.8" />'
    ),
    "pull_station": (
        '<line x1="72" y1="18" x2="72" y2="174" stroke="#334155" '
        'stroke-width="5" stroke-linecap="round" />'
        '<line x1="72" y1="18" x2="138" y2="18" stroke="#475569" '
        'stroke-width="5" stroke-linecap="round" />'
        '<line x1="94" y1="20" x2="138" y2="20" stroke="#94a3b8" '
        'stroke-width="3.2" stroke-linecap="round" />'
        '<rect x="86" y="140" width="38" height="7" rx="3.5" fill="#334155" '
        'stroke="#475569" stroke-width="1.2" />'
        '<line x1="104" y1="147" x2="104" y2="174" stroke="#334155" '
        'stroke-width="4.5" stroke-linecap="round" />'
    ),
    "leg_bench": (
        '<line x1="76" y1="74" x2="90" y2="128" stroke="#334155" '
        'stroke-width="7.5" stroke-linecap="round" />'
        '<rect x="86" y="126" width="52" height="7" rx="3.5" fill="#334155" '
        'stroke="#475569" stroke-width="1.2" />'
        '<line x1="94" y1="133" x2="90" y2="174" stroke="#475569" '
        'stroke-width="4.5" stroke-linecap="round" />'
        '<line x1="130" y1="133" x2="134" y2="174" stroke="#475569" '
        'stroke-width="4.5" stroke-linecap="round" />'
        '<circle cx="134" cy="126" r="4" fill="#0f172a" stroke="#64748b" '
        'stroke-width="1.5" />'
    ),
    "calf_block": (
        '<rect x="118" y="167" width="32" height="7" rx="2.5" fill="#334155" '
        'stroke="#64748b" stroke-width="1.2" />'
    ),
}


def _step(origin: Point, length: float, angle_deg: float) -> Point:
    rad = math.radians(angle_deg)
    return (origin[0] + length * math.cos(rad), origin[1] + length * math.sin(rad))


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
    mid_spine = _step(hip, bones["lumbar"], pose["lumbar"])
    shoulder = _step(mid_spine, bones["thoracic"], pose["thoracic"])
    head = _step(shoulder, bones["neck"], pose["neck"])

    hip_b: Point = (hip[0] + bones["back_dx"], hip[1] + bones["back_dy"])
    shoulder_b: Point = (
        shoulder[0] + bones["back_dx"],
        shoulder[1] + bones["back_dy"],
    )

    knee_f = _step(hip, bones["thigh"], thigh_f)
    foot_f = _step(knee_f, bones["shin"], shin_f)
    knee_b = _step(hip_b, bones["thigh"], thigh_b)
    foot_b = _step(knee_b, bones["shin"], shin_b)

    elbow_f = _step(shoulder, bones["uarm"], uarm_f)
    hand_f = _step(elbow_f, bones["farm"], farm_f)
    elbow_b = _step(shoulder_b, bones["uarm"], uarm_b)
    hand_b = _step(elbow_b, bones["farm"], farm_b)

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


def evaluate_archetype_pose(
    archetype: str,
    t: float,
    *,
    swap_sides: bool = False,
) -> dict[str, Point]:
    """Evaluate 2D joint coordinates for an exercise archetype at phase t."""
    spec = ARCHETYPE_SPECS.get(archetype, ARCHETYPE_SPECS["squat"])
    pose = lerp_pose(spec["pose_a"], spec["pose_b"], t)
    return solve_fk(spec["bones"], pose, swap_sides=swap_sides)


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


def _build_foundation_specs() -> dict[str, dict[str, Any]]:
    specs: dict[str, dict[str, Any]] = {}

    # 1. Squat
    b_sq = {**STD_BONES, "thigh": 37.0, "shin": 37.0}
    sq_lf_a = _solve_2link_ik((114, 98), (126, 168), (37, 37))
    sq_lb_a = _solve_2link_ik((109, 96), (118, 166), (37, 37))
    sq_lf_b = _solve_2link_ik((98, 132), (126, 168), (37, 37), near=sq_lf_a)
    sq_lb_b = _solve_2link_ik((93, 130), (118, 166), (37, 37), near=sq_lb_a)
    specs["squat"] = {
        "label": "Squat",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (124.0, 173.0),
        "band_target": "shoulder",
        "cable_anchor": (152.0, 170.0),
        "bones": b_sq,
        "pose_a": _pose(
            (114, 98), (-86, -86, -84), (102, -48), (100, -44), (sq_lf_a, sq_lb_a)
        ),
        "pose_b": _pose(
            (98, 132), (-62, -58, -68), (68, -28), (66, -24), (sq_lf_b, sq_lb_b)
        ),
    }

    # 2. Lunge
    b_lg = {**STD_BONES, "thigh": 37.0, "shin": 37.0, "back_dx": -3.0, "back_dy": -1.0}
    lg_lf_a = _solve_2link_ik((118, 108), (150, 169), (37, 37))
    lg_lb_a = _solve_2link_ik((115, 107), (84, 169), (37, 37))
    lg_lf_b = _solve_2link_ik((118, 131), (150, 169), (37, 37), near=lg_lf_a)
    lg_lb_b = _solve_2link_ik((115, 130), (84, 169), (37, 37), near=lg_lb_a)
    specs["lunge"] = {
        "label": "Lunge",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (150.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (176.0, 168.0),
        "bones": b_lg,
        "pose_a": _pose(
            (118, 108), (-88, -88, -86), (98, -42), (96, -38), (lg_lf_a, lg_lb_a)
        ),
        "pose_b": _pose(
            (118, 131), (-86, -86, -84), (74, -28), (72, -24), (lg_lf_b, lg_lb_b)
        ),
    }

    # 3. Pushup (rigid straight plank pivoting about toes)
    b_pu = {
        **STD_BONES,
        "uarm": 29.0,
        "farm": 29.0,
        "thigh": 37.5,
        "shin": 37.5,
        "back_dx": -4.0,
        "back_dy": -2.0,
    }
    hip_pua = (119.0, 134.0)
    sh_pua = _step(_step(hip_pua, 22, -26.0), 22, -26.0)
    pu_af_a = _solve_2link_ik(sh_pua, (162.0, 169.0), (29, 29), bend_sign=1)
    pu_ab_a = _solve_2link_ik(
        (sh_pua[0] - 4, sh_pua[1] - 2), (158.0, 167.0), (29, 29), bend_sign=1
    )
    pu_lf_a = _solve_2link_ik(hip_pua, (53.0, 169.0), (37.5, 37.5))
    pu_lb_a = _solve_2link_ik(
        (hip_pua[0] - 4, hip_pua[1] - 2), (49.0, 167.0), (37.5, 37.5)
    )
    hip_pub = (125.5, 152.0)
    sh_pub = _step(_step(hip_pub, 22, -11.0), 22, -11.0)
    pu_af_b = _solve_2link_ik(
        sh_pub, (162.0, 169.0), (29, 29), bend_sign=1, near=pu_af_a
    )
    pu_ab_b = _solve_2link_ik(
        (sh_pub[0] - 4, sh_pub[1] - 2),
        (158.0, 167.0),
        (29, 29),
        bend_sign=1,
        near=pu_ab_a,
    )
    pu_lf_b = _solve_2link_ik(hip_pub, (53.0, 169.0), (37.5, 37.5), near=pu_lf_a)
    pu_lb_b = _solve_2link_ik(
        (hip_pub[0] - 4, hip_pub[1] - 2), (49.0, 167.0), (37.5, 37.5), near=pu_lb_a
    )
    specs["pushup"] = {
        "label": "Pushup",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (162.0, 172.0),
        "band_target": "shoulder",
        "cable_anchor": (162.0, 172.0),
        "bones": b_pu,
        "pose_a": _pose(hip_pua, (-26, -26, -22), pu_af_a, pu_ab_a, (pu_lf_a, pu_lb_a)),
        "pose_b": _pose(hip_pub, (-11, -11, -7), pu_af_b, pu_ab_b, (pu_lf_b, pu_lb_b)),
    }

    # 4. Plank
    b_pl = {
        **STD_BONES,
        "uarm": 28.0,
        "farm": 24.0,
        "thigh": 36.2,
        "shin": 36.2,
        "back_dx": -4.0,
        "back_dy": -2.0,
    }
    hip_pla = (120.0, 146.0)
    pl_lf_a = _solve_2link_ik(hip_pla, (52.0, 170.0), (36.2, 36.2))
    pl_lb_a = _solve_2link_ik(
        (hip_pla[0] - 4, hip_pla[1] - 2), (48.0, 168.0), (36.2, 36.2)
    )
    hip_plb = (120.0, 142.0)
    pl_lf_b = _solve_2link_ik(hip_plb, (52.0, 170.0), (36.2, 36.2), near=pl_lf_a)
    pl_lb_b = _solve_2link_ik(
        (hip_plb[0] - 4, hip_plb[1] - 2), (48.0, 168.0), (36.2, 36.2), near=pl_lb_a
    )
    specs["plank"] = {
        "label": "Plank",
        "fixture": "pulse",
        "default_equipment": "body_only",
        "band_anchor": (164.0, 172.0),
        "band_target": "shoulder",
        "cable_anchor": (164.0, 172.0),
        "bones": b_pl,
        "pose_a": _pose(hip_pla, (-8, -8, -4), (88, 0), (88, 0), (pl_lf_a, pl_lb_a)),
        "pose_b": _pose(hip_plb, (-4, -5, -2), (88, 0), (88, 0), (pl_lf_b, pl_lb_b)),
    }

    # 5. Hinge
    b_hg = {**STD_BONES, "thigh": 36.0, "shin": 36.0}
    hg_lf_a = _solve_2link_ik((114, 100), (122, 170), (36, 36))
    hg_lb_a = _solve_2link_ik((109, 98), (116, 168), (36, 36))
    hg_lf_b = _solve_2link_ik((92, 105), (122, 170), (36, 36), near=hg_lf_a)
    hg_lb_b = _solve_2link_ik((87, 103), (116, 168), (36, 36), near=hg_lb_a)
    specs["hinge"] = {
        "label": "Hip Hinge",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (122.0, 173.0),
        "band_target": "shoulder",
        "cable_anchor": (158.0, 170.0),
        "bones": b_hg,
        "pose_a": _pose(
            (114, 100), (-87, -87, -85), (84, 80), (86, 82), (hg_lf_a, hg_lb_a)
        ),
        "pose_b": _pose(
            (92, 105), (-22, -20, -18), (88, 88), (90, 90), (hg_lf_b, hg_lb_b)
        ),
    }

    # 6. Glute Bridge
    b_gb = {**STD_BONES, "thigh": 36.0, "shin": 36.0, "back_dx": -4.0, "back_dy": -2.0}
    gb_lf_a = _solve_2link_ik((116, 164), (166, 170), (36, 36))
    gb_lb_a = _solve_2link_ik((112, 162), (160, 168), (36, 36))
    gb_lf_b = _solve_2link_ik((114, 136), (166, 170), (36, 36), near=gb_lf_a)
    gb_lb_b = _solve_2link_ik((110, 134), (160, 168), (36, 36), near=gb_lb_a)
    specs["glute_bridge"] = {
        "label": "Glute Bridge",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (115.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (115.0, 173.0),
        "bones": b_gb,
        "pose_a": _pose(
            (116, 164), (183, 184, 196), (10, 4), (10, 4), (gb_lf_a, gb_lb_a)
        ),
        "pose_b": _pose(
            (114, 136), (144, 146, 192), (10, 4), (10, 4), (gb_lf_b, gb_lb_b)
        ),
    }

    return specs


def _build_calisthenic_and_press_specs() -> dict[str, dict[str, Any]]:
    specs: dict[str, dict[str, Any]] = {}

    # 7. Crunch Core
    b_cc = {**STD_BONES, "thigh": 36.0, "shin": 36.0, "back_dx": -4.0, "back_dy": -2.0}
    cc_lf = _solve_2link_ik((120, 164), (170, 170), (36, 36))
    cc_lb = _solve_2link_ik((116, 162), (164, 168), (36, 36))
    specs["crunch_core"] = {
        "label": "Crunch Core",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (42.0, 168.0),
        "band_target": "hand",
        "cable_anchor": (42.0, 148.0),
        "bones": b_cc,
        "pose_a": _pose(
            (120, 164), (-174, -168, -152), (-88, -192), (-94, -192), (cc_lf, cc_lb)
        ),
        "pose_b": _pose(
            (120, 164), (-152, -108, -88), (-36, -162), (-44, -162), (cc_lf, cc_lb)
        ),
    }

    # 8. Mountain Climber
    b_mc = {
        **STD_BONES,
        "uarm": 30.0,
        "farm": 30.0,
        "thigh": 35.0,
        "shin": 35.0,
        "back_dx": -3.0,
        "back_dy": -1.5,
    }
    hip_mc = (114.0, 124.0)
    sh_mc = _step(_step(hip_mc, 22, -18.0), 22, -18.0)
    mc_af = _solve_2link_ik(sh_mc, (160.0, 169.0), (30, 30), bend_sign=1)
    mc_ab = _solve_2link_ik(
        (sh_mc[0] - 3, sh_mc[1] - 1.5), (156.0, 167.5), (30, 30), bend_sign=1
    )
    mc_ext = _solve_2link_ik(hip_mc, (59.5, 166.0), (35, 35))
    mc_drv: LimbAngles = (18.0, 176.0)
    specs["mountain_climber"] = {
        "label": "Mountain Climber",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (58.0, 172.0),
        "band_target": "hand",
        "cable_anchor": (58.0, 172.0),
        "bones": b_mc,
        "pose_a": _pose(hip_mc, (-18, -18, -16), mc_af, mc_ab, (mc_drv, mc_ext)),
        "pose_b": _pose(hip_mc, (-18, -18, -16), mc_af, mc_ab, (mc_ext, mc_drv)),
    }

    # 9. Dip
    b_dp = {
        **STD_BONES,
        "uarm": 27.0,
        "farm": 27.0,
        "thigh": 36.5,
        "shin": 36.5,
        "back_dx": -4.0,
        "back_dy": -2.0,
    }
    hip_da = (104.0, 133.0)
    sh_da = _step(_step(hip_da, 22, -94.0), 22, -92.0)
    dp_af_a = _solve_2link_ik(sh_da, (88.0, 138.0), (27, 27), bend_sign=1)
    dp_ab_a = _solve_2link_ik(
        (sh_da[0] - 4, sh_da[1] - 2), (84.0, 136.0), (27, 27), bend_sign=1
    )
    dp_lf_a = _solve_2link_ik(hip_da, (164.0, 169.0), (36.5, 36.5))
    dp_lb_a = _solve_2link_ik(
        (hip_da[0] - 4, hip_da[1] - 2), (160.0, 167.0), (36.5, 36.5)
    )
    hip_db = (108.0, 151.0)
    sh_db = _step(_step(hip_db, 22, -94.0), 22, -92.0)
    dp_af_b = _solve_2link_ik(sh_db, (88.0, 138.0), (27, 27), bend_sign=1, near=dp_af_a)
    dp_ab_b = _solve_2link_ik(
        (sh_db[0] - 4, sh_db[1] - 2),
        (84.0, 136.0),
        (27, 27),
        bend_sign=1,
        near=dp_ab_a,
    )
    dp_lf_b = _solve_2link_ik(hip_db, (164.0, 169.0), (36.5, 36.5), near=dp_lf_a)
    dp_lb_b = _solve_2link_ik(
        (hip_db[0] - 4, hip_db[1] - 2), (160.0, 167.0), (36.5, 36.5), near=dp_lb_a
    )
    specs["dip"] = {
        "label": "Triceps Dip",
        "fixture": "dip_box",
        "default_equipment": "body_only",
        "band_anchor": (88.0, 138.0),
        "band_target": "shoulder",
        "cable_anchor": (88.0, 138.0),
        "bones": b_dp,
        "pose_a": _pose(hip_da, (-94, -92, -88), dp_af_a, dp_ab_a, (dp_lf_a, dp_lb_a)),
        "pose_b": _pose(hip_db, (-94, -92, -88), dp_af_b, dp_ab_b, (dp_lf_b, dp_lb_b)),
    }

    # 10. Overhead Press (3/4 sagittal profile facing right)
    b_op = {
        **STD_BONES,
        "lumbar": 21.0,
        "thoracic": 21.0,
        "neck": 18.0,
        "uarm": 23.0,
        "farm": 22.0,
        "thigh": 34.0,
        "shin": 34.0,
        "back_dx": -6.0,
        "back_dy": -2.0,
    }
    op_lf = _solve_2link_ik((116, 108), (126, 171), (34, 34))
    op_lb = _solve_2link_ik((110, 106), (108, 169), (34, 34))
    specs["overhead_press"] = {
        "label": "Overhead Press",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (124.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (124.0, 172.0),
        "bones": b_op,
        "pose_a": _pose(
            (116, 108), (-88, -89, -86), (52, -76), (46, -78), (op_lf, op_lb)
        ),
        "pose_b": _pose(
            (116, 108), (-89, -92, -87), (-82, -86), (-88, -88), (op_lf, op_lb)
        ),
    }

    # 11. Bench Press
    b_bp = {
        **STD_BONES,
        "uarm": 24.0,
        "farm": 24.0,
        "thigh": 35.0,
        "shin": 35.0,
        "back_dx": -4.0,
        "back_dy": -2.0,
    }
    bp_lf = _solve_2link_ik((132, 129), (170, 171), (35, 35))
    bp_lb = _solve_2link_ik((128, 127), (164, 169), (35, 35))
    specs["bench_press"] = {
        "label": "Bench Press",
        "fixture": "bench",
        "default_equipment": "barbell",
        "band_anchor": (90.0, 172.0),
        "band_target": "hand",
        "cable_anchor": (90.0, 170.0),
        "bones": b_bp,
        "pose_a": _pose(
            (132, 129), (-178, -178, -172), (48, -86), (44, -86), (bp_lf, bp_lb)
        ),
        "pose_b": _pose(
            (132, 129), (-178, -178, -172), (-86, -88), (-88, -88), (bp_lf, bp_lb)
        ),
    }

    # 12. Row Pull
    b_rw = {**STD_BONES, "uarm": 25.0, "farm": 24.0, "thigh": 36.0, "shin": 36.0}
    rw_lf = _solve_2link_ik((94, 106), (122, 171), (36, 36))
    rw_lb = _solve_2link_ik((89, 104), (115, 169), (36, 36))
    specs["row_pull"] = {
        "label": "Row Pull",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (158.0, 172.0),
        "band_target": "hand",
        "cable_anchor": (186.0, 128.0),
        "bones": b_rw,
        "pose_a": _pose((94, 106), (-30, -28, -24), (88, 86), (86, 84), (rw_lf, rw_lb)),
        "pose_b": _pose(
            (94, 106), (-32, -30, -26), (196, 70), (186, 72), (rw_lf, rw_lb)
        ),
    }

    return specs


def _build_isolation_and_pull_specs() -> dict[str, dict[str, Any]]:
    specs: dict[str, dict[str, Any]] = {}

    # 13. Curl
    b_cu = {**STD_BONES, "thigh": 36.0, "shin": 36.0}
    cu_lf = _solve_2link_ik((114, 102), (122, 171), (36, 36))
    cu_lb = _solve_2link_ik((109, 100), (114, 169), (36, 36))
    specs["curl"] = {
        "label": "Bicep Curl",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (126.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (156.0, 170.0),
        "bones": b_cu,
        "pose_a": _pose(
            (114, 102), (-88, -88, -86), (88, 76), (86, 74), (cu_lf, cu_lb)
        ),
        "pose_b": _pose(
            (114, 102), (-88, -89, -86), (78, -58), (80, -46), (cu_lf, cu_lb)
        ),
    }

    # 14. Vertical Pull (overhead bar/pulley fixture + vertical pull to upper chest)
    b_vp = {
        **STD_BONES,
        "lumbar": 21.0,
        "thoracic": 21.0,
        "neck": 18.0,
        "uarm": 26.0,
        "farm": 25.0,
        "thigh": 34.0,
        "shin": 34.0,
    }
    vp_lf = _solve_2link_ik((106, 134), (148, 171), (34, 34))
    vp_lb = _solve_2link_ik((101, 132), (142, 169), (34, 34))
    specs["vertical_pull"] = {
        "label": "Vertical Pull",
        "fixture": "pull_station",
        "default_equipment": "cable",
        "band_anchor": (116.0, 20.0),
        "band_target": "hand",
        "cable_anchor": (116.0, 20.0),
        "bones": b_vp,
        "pose_a": _pose(
            (106, 134), (-88, -86, -82), (-76, -84), (-80, -86), (vp_lf, vp_lb)
        ),
        "pose_b": _pose(
            (106, 134), (-94, -98, -86), (102, -58), (96, -62), (vp_lf, vp_lb)
        ),
    }

    # 15. Triceps Extension (incline skull crusher: pinned humerus, elbow extension)
    b_te = {
        **STD_BONES,
        "uarm": 24.0,
        "farm": 24.0,
        "thigh": 35.0,
        "shin": 35.0,
        "back_dx": -4.0,
        "back_dy": -2.0,
    }
    te_lf = _solve_2link_ik((128, 132), (168, 171), (35, 35))
    te_lb = _solve_2link_ik((124, 130), (162, 169), (35, 35))
    specs["triceps_extension"] = {
        "label": "Triceps Extension",
        "fixture": "incline_bench",
        "default_equipment": "dumbbell",
        "band_anchor": (52.0, 170.0),
        "band_target": "hand",
        "cable_anchor": (48.0, 168.0),
        "bones": b_te,
        "pose_a": _pose(
            (128, 132), (-146, -144, -136), (-98, -174), (-102, -176), (te_lf, te_lb)
        ),
        "pose_b": _pose(
            (128, 132), (-146, -144, -136), (-94, -82), (-98, -84), (te_lf, te_lb)
        ),
    }

    # 16. Leg Extension & Curl (seated bench fixture + isolated knee extension/flexion)
    b_le = {**STD_BONES, "thigh": 36.0, "shin": 36.0, "back_dx": -4.0, "back_dy": -2.0}
    specs["leg_extension_curl"] = {
        "label": "Leg Extension and Curl",
        "fixture": "leg_bench",
        "default_equipment": "machine",
        "band_anchor": (96.0, 166.0),
        "band_target": "foot",
        "cable_anchor": (96.0, 164.0),
        "cable_target": "foot",
        "bones": b_le,
        "pose_a": _pose(
            (96, 122), (-102, -100, -90), (72, 86), (74, 86), ((4, 102), (4, 98))
        ),
        "pose_b": _pose(
            (96, 122), (-102, -100, -90), (72, 86), (74, 86), ((2, 4), (2, 8))
        ),
    }

    # 17. Calf Raise (standing plantarflexion elevating body from ball of foot)
    b_cr = {**STD_BONES, "thigh": 34.0, "shin": 34.0}
    cr_lf_a = _solve_2link_ik((114, 105), (119, 170), (34, 34))
    cr_lb_a = _solve_2link_ik((109, 103), (114, 168), (34, 34))
    cr_lf_b = _solve_2link_ik((120, 91), (124, 156), (34, 34), near=cr_lf_a)
    cr_lb_b = _solve_2link_ik((115, 89), (119, 154), (34, 34), near=cr_lb_a)
    specs["calf_raise"] = {
        "label": "Calf Raise",
        "fixture": "calf_block",
        "forefoot": (136.0, 167.0),
        "default_equipment": "body_only",
        "band_anchor": (130.0, 173.0),
        "band_target": "shoulder",
        "cable_anchor": (154.0, 170.0),
        "bones": b_cr,
        "pose_a": _pose(
            (114, 105), (-88, -88, -86), (102, -48), (100, -44), (cr_lf_a, cr_lb_a)
        ),
        "pose_b": _pose(
            (120, 91), (-88, -88, -86), (98, -46), (96, -42), (cr_lf_b, cr_lb_b)
        ),
    }

    # 18. Bicycle Crunch (supine spinal flexion + alternating pedaling legs off floor)
    b_bc = {**STD_BONES, "thigh": 34.0, "shin": 34.0, "back_dx": -4.0, "back_dy": -2.0}
    specs["bicycle_crunch"] = {
        "label": "Bicycle Crunch",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (184.0, 146.0),
        "band_target": "foot",
        "cable_anchor": (42.0, 142.0),
        "bones": b_bc,
        "pose_a": _pose(
            (116, 162),
            (-154, -116, -96),
            (-36, -146),
            (-142, -52),
            ((-114, 10), (-20, -8)),
        ),
        "pose_b": _pose(
            (116, 162),
            (-156, -124, -102),
            (-142, -52),
            (-36, -146),
            ((-20, -8), (-114, 10)),
        ),
    }

    return specs


def _build_archetype_specs() -> dict[str, dict[str, Any]]:
    return {
        **_build_foundation_specs(),
        **_build_calisthenic_and_press_specs(),
        **_build_isolation_and_pull_specs(),
    }


ARCHETYPE_SPECS: dict[str, dict[str, Any]] = _build_archetype_specs()


def normalize_equipment(equipment: str | None, archetype: str = "squat") -> str:
    """Normalize raw equipment text into a supported SVG prop mode."""
    spec = ARCHETYPE_SPECS.get(archetype, ARCHETYPE_SPECS["squat"])
    default_eq = str(spec["default_equipment"])
    if equipment is None:
        return default_eq

    raw = equipment.strip().lower().replace("-", "_").replace(" ", "_")
    if not raw:
        return "body_only"
    return _EQUIPMENT_ALIASES.get(raw, default_eq)


def _compute_aura_center(spec: dict[str, Any]) -> Point:
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


def _render_fixture(fixture: str | None, t: float) -> str:
    if fixture is None:
        return ""
    if fixture == "pulse":
        r = 21.0 + 9.0 * t
        return (
            f'<circle class="js-pulse" cx="132" cy="144" r="{r:.2f}" fill="none" '
            'stroke="#34d399" stroke-width="2.5" stroke-opacity="0.45" />'
        )
    return _STATIC_FIXTURES.get(fixture, "")


def _render_handheld_props(
    eq_mode: str,
    bar_mode: str,
    joints: dict[str, Point],
) -> tuple[str, str]:
    if eq_mode == "dumbbell":
        back = (
            f'<circle class="js-weight-b" cx="{joints["hand_b"][0]:.2f}" '
            f'cy="{joints["hand_b"][1]:.2f}" r="7" fill="#059669" '
            'fill-opacity="0.68" />'
        )
        front = (
            f'<circle class="js-weight" cx="{joints["hand_f"][0]:.2f}" '
            f'cy="{joints["hand_f"][1]:.2f}" r="8.2" fill="#10b981" '
            'stroke="#d1fae5" stroke-width="1.8" />'
            f'<circle class="js-weight-cap" cx="{joints["hand_f"][0]:.2f}" '
            f'cy="{joints["hand_f"][1]:.2f}" r="3" fill="#064e3b" />'
        )
        return (back, front)

    if eq_mode == "kettlebells":
        kb_by = min(165.0, joints["hand_b"][1] + 8.0)
        kb_fy = min(165.0, joints["hand_f"][1] + 9.0)
        hdl_fy = min(159.0, joints["hand_f"][1] + 2.5)
        back = (
            f'<circle class="js-weight-b" cx="{joints["hand_b"][0]:.2f}" '
            f'cy="{kb_by:.2f}" r="7.2" fill="#047857" fill-opacity="0.68" />'
        )
        front = (
            f'<circle class="js-kb-handle-f" cx="{joints["hand_f"][0]:.2f}" '
            f'cy="{hdl_fy:.2f}" r="5" fill="none" stroke="#d1fae5" '
            'stroke-width="2.2" />'
            f'<circle class="js-weight" cx="{joints["hand_f"][0]:.2f}" '
            f'cy="{kb_fy:.2f}" r="8.4" fill="#10b981" stroke="#ecfdf5" '
            'stroke-width="1.6" />'
        )
        return (back, front)

    p_b = joints["shoulder_b"] if bar_mode == "shoulder" else joints["hand_b"]
    p_f = joints["shoulder"] if bar_mode == "shoulder" else joints["hand_f"]
    sx1, sy1 = p_b[0] - 6.0, p_b[1] - 2.0
    sx2, sy2 = p_f[0] + 6.0, p_f[1] + 2.0
    back = (
        f'<circle class="js-weight-b" cx="{p_b[0]:.2f}" cy="{p_b[1]:.2f}" '
        'r="10" fill="#047857" fill-opacity="0.72" stroke="#6ee7b7" '
        'stroke-width="1.2" />'
        f'<line class="js-bar-shaft" x1="{sx1:.2f}" y1="{sy1:.2f}" '
        f'x2="{sx2:.2f}" y2="{sy2:.2f}" stroke="#cbd5e1" stroke-width="3.4" '
        'stroke-linecap="round" />'
    )
    front = (
        f'<circle class="js-weight" cx="{p_f[0]:.2f}" cy="{p_f[1]:.2f}" '
        'r="11.5" fill="#10b981" stroke="#ecfdf5" stroke-width="2" />'
        f'<circle class="js-bar-hub" cx="{p_f[0]:.2f}" cy="{p_f[1]:.2f}" '
        'r="3.8" fill="#0f172a" stroke="#a7f3d0" stroke-width="1.2" />'
    )
    return (back, front)


def _render_tethered_props(
    eq_mode: str,
    spec: dict[str, Any],
    joints: dict[str, Point],
) -> tuple[list[str], str, str]:
    if eq_mode == "bands":
        ax, ay = spec["band_anchor"]
        b_target = str(spec.get("band_target", "hand"))
        attrs = [
            f'data-anchor-x="{ax:.2f}"',
            f'data-anchor-y="{ay:.2f}"',
            f'data-band-target="{b_target}"',
        ]
        if b_target == "shoulder":
            tb_pt, tf_pt = joints["shoulder_b"], joints["shoulder"]
        elif b_target == "foot":
            tb_pt, tf_pt = joints["foot_b"], joints["foot_f"]
        else:
            tb_pt, tf_pt = joints["hand_b"], joints["hand_f"]
        back = (
            f'<circle cx="{ax:.2f}" cy="{ay:.2f}" r="3.5" fill="#0f172a" '
            'stroke="#34d399" stroke-width="1.6" />'
            f'<line class="js-band-b" x1="{ax:.2f}" y1="{ay:.2f}" '
            f'x2="{tb_pt[0]:.2f}" y2="{tb_pt[1]:.2f}" stroke="#059669" '
            'stroke-width="2.6" stroke-opacity="0.72" stroke-linecap="round" />'
        )
        front = (
            f'<line class="js-band-f" x1="{ax:.2f}" y1="{ay:.2f}" '
            f'x2="{tf_pt[0]:.2f}" y2="{tf_pt[1]:.2f}" stroke="#34d399" '
            'stroke-width="3.2" stroke-linecap="round" />'
        )
        return (attrs, back, front)

    ax, ay = spec["cable_anchor"]
    c_target = str(spec.get("cable_target", "hand"))
    attrs = [
        f'data-anchor-x="{ax:.2f}"',
        f'data-anchor-y="{ay:.2f}"',
        f'data-cable-target="{c_target}"',
    ]
    att_pt = joints["foot_f"] if c_target == "foot" else joints["hand_f"]
    back = (
        f'<circle cx="{ax:.2f}" cy="{ay:.2f}" r="4.8" fill="#1e293b" '
        'stroke="#94a3b8" stroke-width="1.8" />'
        f'<line class="js-cable" x1="{ax:.2f}" y1="{ay:.2f}" '
        f'x2="{att_pt[0]:.2f}" y2="{att_pt[1]:.2f}" stroke="#94a3b8" '
        'stroke-width="2.4" stroke-linecap="round" />'
    )
    front = (
        f'<circle class="js-cable-grip" cx="{att_pt[0]:.2f}" '
        f'cy="{att_pt[1]:.2f}" r="5.2" fill="#10b981" stroke="#ecfdf5" '
        'stroke-width="1.6" />'
    )
    return (attrs, back, front)


def _render_equipment_props(
    eq_mode: str,
    bar_mode: str,
    spec: dict[str, Any],
    joints: dict[str, Point],
) -> tuple[list[str], str, str]:
    attrs: list[str] = [f'data-equipment="{eq_mode}"']
    if eq_mode == "barbell":
        attrs.append(f'data-bar-mode="{bar_mode}"')

    forefoot_pt: Point | None = spec.get("forefoot")
    if forefoot_pt is not None:
        attrs.append(f'data-forefoot-x="{forefoot_pt[0]:.2f}"')
        attrs.append(f'data-forefoot-y="{forefoot_pt[1]:.2f}"')

    if eq_mode in {"dumbbell", "kettlebells", "barbell"}:
        back, front = _render_handheld_props(eq_mode, bar_mode, joints)
        return (attrs, back, front)
    if eq_mode in {"bands", "cable", "machine"}:
        t_attrs, back, front = _render_tethered_props(eq_mode, spec, joints)
        attrs.extend(t_attrs)
        return (attrs, back, front)
    return (attrs, "", "")


def _render_forefoot_lines(
    forefoot_pt: Point | None,
    joints: dict[str, Point],
) -> tuple[str, str]:
    if forefoot_pt is None:
        return ("", "")
    fb_toe = (forefoot_pt[0] - 5.0, forefoot_pt[1] - 1.0)
    back = (
        f'<line class="js-forefoot-b" x1="{joints["foot_b"][0]:.2f}" '
        f'y1="{joints["foot_b"][1]:.2f}" x2="{fb_toe[0]:.2f}" '
        f'y2="{fb_toe[1]:.2f}" />'
    )
    front = (
        f'<line class="js-forefoot-f" x1="{joints["foot_f"][0]:.2f}" '
        f'y1="{joints["foot_f"][1]:.2f}" x2="{forefoot_pt[0]:.2f}" '
        f'y2="{forefoot_pt[1]:.2f}" />'
    )
    return (back, front)


def _svg_line(cls: str, p1: Point, p2: Point, extra: str = "") -> str:
    suffix = f" {extra}" if extra else ""
    return (
        f'<line class="{cls}" x1="{p1[0]:.2f}" y1="{p1[1]:.2f}" '
        f'x2="{p2[0]:.2f}" y2="{p2[1]:.2f}"{suffix} />'
    )


def render_archetype_svg(
    archetype: str,
    equipment: str | None = None,
    *,
    thumbnail: bool = False,
) -> str:
    """Render a complete exercise SVG document with FK rig metadata and props."""
    arch = archetype if archetype in ARCHETYPE_SPECS else "squat"
    spec = ARCHETYPE_SPECS[arch]
    bones = spec["bones"]
    pa = spec["pose_a"]
    pb = spec["pose_b"]
    eq_mode = normalize_equipment(equipment, arch)

    t_init = 0.9 if thumbnail else 0.0
    j = solve_fk(bones, lerp_pose(pa, pb, t_init))

    pose_a_attr = escape(json.dumps(pa, separators=(",", ":")), quote=True)
    pose_b_attr = escape(json.dumps(pb, separators=(",", ":")), quote=True)
    bones_attr = escape(json.dumps(bones, separators=(",", ":")), quote=True)
    label = escape(str(spec["label"]), quote=True)
    grad_id = f"glow-{arch}"

    aura_cx, aura_cy = _compute_aura_center(spec)
    aura_r = 80.0 + 8.0 * t_init
    ring_r = 62.0 + 6.0 * t_init
    shadow_cx, shadow_rx = compute_shadow(j)

    bar_mode = "shoulder" if arch in BACK_RACK_ARCHETYPES else "hands"
    extra_svg_attrs, prop_back_markup, prop_front_markup = _render_equipment_props(
        eq_mode, bar_mode, spec, j
    )
    forefoot_b_markup, forefoot_f_markup = _render_forefoot_lines(
        spec.get("forefoot"), j
    )
    fixture_markup = _render_fixture(spec["fixture"], t_init)
    extra_attr_str = " ".join(extra_svg_attrs)

    svg_open = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" '
        'preserveAspectRatio="xMidYMid meet" class="exercise-svg" role="img" '
        f'aria-label="{label}" data-archetype="{arch}" '
        f'data-bones="{bones_attr}" data-pose-a="{pose_a_attr}" '
        f'data-pose-b="{pose_b_attr}" {extra_attr_str}>'
    )
    aura_line = (
        f'  <circle class="js-aura" cx="{aura_cx}" cy="{aura_cy}" '
        f'r="{aura_r:.2f}" fill="url(#{grad_id})" />'
    )
    ring_line = (
        f'  <circle class="js-ring" cx="{aura_cx}" cy="{aura_cy}" '
        f'r="{ring_r:.2f}" fill="none" stroke="#34d399" '
        'stroke-opacity="0.14" stroke-width="1.2" stroke-dasharray="3 6" />'
    )
    floor_line = (
        '  <line x1="16" y1="175" x2="224" y2="175" stroke="#334155" '
        'stroke-width="3" stroke-linecap="round" />'
    )
    shadow_line = (
        f'  <ellipse class="js-shadow" cx="{shadow_cx:.2f}" cy="176" '
        f'rx="{shadow_rx:.2f}" ry="3.5" fill="#10b981" fill-opacity="0.22" />'
    )
    neck_line = "  " + _svg_line(
        "js-neck",
        j["shoulder"],
        j["head"],
        'stroke="#cbd5e1" stroke-width="6.5" stroke-linecap="round"',
    )
    torso_line = (
        f'  <path class="js-torso" d="M {j["hip"][0]:.2f} {j["hip"][1]:.2f} '
        f"Q {j['mid_spine'][0]:.2f} {j['mid_spine'][1]:.2f} "
        f'{j["shoulder"][0]:.2f} {j["shoulder"][1]:.2f}" fill="none" '
        'stroke="#f8fafc" stroke-width="11" stroke-linecap="round" '
        'stroke-linejoin="round" />'
    )
    head_line = (
        f'  <circle class="js-head" cx="{j["head"][0]:.2f}" '
        f'cy="{j["head"][1]:.2f}" r="11.5" fill="#34d399" stroke="#ecfdf5" '
        'stroke-width="1.6" />'
    )

    lines = [
        svg_open,
        "  <defs>",
        f'    <radialGradient id="{grad_id}" cx="50%" cy="50%" r="50%">',
        '      <stop offset="0%" stop-color="#10b981" stop-opacity="0.18" />',
        '      <stop offset="65%" stop-color="#10b981" stop-opacity="0.04" />',
        '      <stop offset="100%" stop-color="#10b981" stop-opacity="0" />',
        "    </radialGradient>",
        "  </defs>",
        aura_line,
        ring_line,
        floor_line,
        shadow_line,
        f"  {fixture_markup}",
        '  <g stroke="#64748b" stroke-width="8" stroke-linecap="round">',
        f"    {_svg_line('js-thigh-b', j['hip_b'], j['knee_b'])}",
        f"    {_svg_line('js-shin-b', j['knee_b'], j['foot_b'])}",
        f"    {forefoot_b_markup}",
        f"    {_svg_line('js-uarm-b', j['shoulder_b'], j['elbow_b'])}",
        f"    {_svg_line('js-farm-b', j['elbow_b'], j['hand_b'])}",
        "  </g>",
        f"  {prop_back_markup}",
        '  <g stroke="#e2e8f0" stroke-width="9.5" stroke-linecap="round">',
        f"    {_svg_line('js-thigh-f', j['hip'], j['knee_f'])}",
        f"    {_svg_line('js-shin-f', j['knee_f'], j['foot_f'])}",
        f"    {forefoot_f_markup}",
        "  </g>",
        neck_line,
        torso_line,
        '  <g stroke="#34d399" stroke-width="8.8" stroke-linecap="round">',
        f"    {_svg_line('js-uarm-f', j['shoulder'], j['elbow_f'])}",
        f"    {_svg_line('js-farm-f', j['elbow_f'], j['hand_f'])}",
        "  </g>",
        '  <g fill="#0f172a" stroke="#34d399" stroke-width="1.6">',
        (
            f'    <circle class="js-j-shoulder" cx="{j["shoulder"][0]:.2f}" '
            f'cy="{j["shoulder"][1]:.2f}" r="3" />'
        ),
        (
            f'    <circle class="js-j-hip" cx="{j["hip"][0]:.2f}" '
            f'cy="{j["hip"][1]:.2f}" r="3" />'
        ),
        (
            f'    <circle class="js-j-knee" cx="{j["knee_f"][0]:.2f}" '
            f'cy="{j["knee_f"][1]:.2f}" r="2.8" />'
        ),
        (
            f'    <circle class="js-j-elbow" cx="{j["elbow_f"][0]:.2f}" '
            f'cy="{j["elbow_f"][1]:.2f}" r="2.8" />'
        ),
        "  </g>",
        head_line,
        f"  {prop_front_markup}",
        "</svg>",
        "",
    ]
    return "\n".join(lines)


def pregenerate_all_svgs(output_dir: Path = SVGS_DIR) -> list[Path]:
    """Pregenerate static peak-pose SVG thumbnails for all exercise archetypes."""
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for archetype in ARCHETYPE_SPECS:
        target = output_dir / f"{archetype}.svg"
        target.write_text(
            render_archetype_svg(archetype, equipment=None, thumbnail=True),
            encoding="utf-8",
        )
        written.append(target)
    return written


def load_svg_markup(
    archetype: str,
    svg_dir: Path = SVGS_DIR,
    equipment: str | None = None,
) -> str:
    """Ensure static SVGs exist and render live t=0 SVG markup for an archetype."""
    arch = archetype if archetype in ARCHETYPE_SPECS else "squat"
    target = svg_dir / f"{arch}.svg"
    if not target.exists():
        pregenerate_all_svgs(svg_dir)
    return render_archetype_svg(arch, equipment=equipment, thumbnail=False)


if __name__ == "__main__":
    files = pregenerate_all_svgs()
    sys.stdout.write(f"Pregenerated {len(files)} SVG files in {SVGS_DIR}\n")
