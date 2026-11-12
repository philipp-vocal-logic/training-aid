from html import escape
import json
import math
from pathlib import Path
from typing import Any

SVGS_DIR = Path(__file__).resolve().parent / "static" / "svgs"

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


def _step(origin: Point, length: float, angle_deg: float) -> Point:
    rad = math.radians(angle_deg)
    return (origin[0] + length * math.cos(rad), origin[1] + length * math.sin(rad))


def _solve_2link_ik(
    root: Point,
    target: Point,
    l1: float,
    l2: float,
    *,
    bend_sign: int = -1,
    near_a1: float | None = None,
    near_a2: float | None = None,
) -> tuple[float, float]:
    dx = target[0] - root[0]
    dy = target[1] - root[1]
    dist = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, math.hypot(dx, dy)))
    base = math.atan2(dy, dx)
    cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2.0 * l1 * dist)))
    theta1 = base + bend_sign * math.acos(cos_a)
    mid = (root[0] + l1 * math.cos(theta1), root[1] + l1 * math.sin(theta1))
    theta2 = math.atan2(target[1] - mid[1], target[0] - mid[0])
    deg1 = math.degrees(theta1)
    deg2 = math.degrees(theta2)
    if near_a1 is not None:
        while deg1 - near_a1 > 180.0:
            deg1 -= 360.0
        while deg1 - near_a1 < -180.0:
            deg1 += 360.0
    if near_a2 is not None:
        while deg2 - near_a2 > 180.0:
            deg2 -= 360.0
        while deg2 - near_a2 < -180.0:
            deg2 += 360.0
    return (round(deg1, 2), round(deg2, 2))


def _pose(
    *,
    hip_x: float,
    hip_y: float,
    lumbar: float,
    thoracic: float,
    neck: float,
    uarm_f: float,
    farm_f: float,
    uarm_b: float,
    farm_b: float,
    thigh_f: float,
    shin_f: float,
    thigh_b: float,
    shin_b: float,
) -> dict[str, float]:
    return {
        "hip_x": round(hip_x, 2),
        "hip_y": round(hip_y, 2),
        "lumbar": round(lumbar, 2),
        "thoracic": round(thoracic, 2),
        "neck": round(neck, 2),
        "uarm_f": round(uarm_f, 2),
        "farm_f": round(farm_f, 2),
        "uarm_b": round(uarm_b, 2),
        "farm_b": round(farm_b, 2),
        "thigh_f": round(thigh_f, 2),
        "shin_f": round(shin_f, 2),
        "thigh_b": round(thigh_b, 2),
        "shin_b": round(shin_b, 2),
    }


def lerp_pose(
    pose_a: dict[str, float], pose_b: dict[str, float], t: float
) -> dict[str, float]:
    return {k: pose_a[k] + (pose_b[k] - pose_a[k]) * t for k in POSE_KEYS}


def solve_fk(
    bones: dict[str, float],
    pose: dict[str, float],
    *,
    swap_sides: bool = False,
) -> dict[str, Point]:
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
    archetype: str, t: float, *, swap_sides: bool = False
) -> dict[str, Point]:
    spec = ARCHETYPE_SPECS.get(archetype, ARCHETYPE_SPECS["squat"])
    pose = lerp_pose(spec["pose_a"], spec["pose_b"], t)
    return solve_fk(spec["bones"], pose, swap_sides=swap_sides)


def compute_shadow(joints: dict[str, Point]) -> tuple[float, float]:
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


def _build_archetype_specs() -> dict[str, dict[str, Any]]:
    specs: dict[str, dict[str, Any]] = {}

    # 1. Squat
    b_sq = {**STD_BONES, "thigh": 37.0, "shin": 37.0}
    tf_a, sf_a = _solve_2link_ik((114, 98), (126, 168), 37, 37, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik((109, 96), (118, 166), 37, 37, bend_sign=-1)
    tf_b, sf_b = _solve_2link_ik(
        (98, 132), (126, 168), 37, 37, bend_sign=-1, near_a1=tf_a, near_a2=sf_a
    )
    tb_b, sb_b = _solve_2link_ik(
        (93, 130), (118, 166), 37, 37, bend_sign=-1, near_a1=tb_a, near_a2=sb_a
    )
    specs["squat"] = {
        "label": "Squat",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (124.0, 173.0),
        "band_target": "shoulder",
        "cable_anchor": (152.0, 170.0),
        "bones": b_sq,
        "pose_a": _pose(
            hip_x=114,
            hip_y=98,
            lumbar=-86,
            thoracic=-86,
            neck=-84,
            uarm_f=102,
            farm_f=-48,
            uarm_b=100,
            farm_b=-44,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=98,
            hip_y=132,
            lumbar=-62,
            thoracic=-58,
            neck=-68,
            uarm_f=68,
            farm_f=-28,
            uarm_b=66,
            farm_b=-24,
            thigh_f=tf_b,
            shin_f=sf_b,
            thigh_b=tb_b,
            shin_b=sb_b,
        ),
    }

    # 2. Lunge
    b_lg = {**STD_BONES, "thigh": 37.0, "shin": 37.0, "back_dx": -3.0, "back_dy": -1.0}
    tf_a, sf_a = _solve_2link_ik((118, 108), (150, 169), 37, 37, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik((115, 107), (84, 169), 37, 37, bend_sign=-1)
    tf_b, sf_b = _solve_2link_ik(
        (118, 131), (150, 169), 37, 37, bend_sign=-1, near_a1=tf_a, near_a2=sf_a
    )
    tb_b, sb_b = _solve_2link_ik(
        (115, 130), (84, 169), 37, 37, bend_sign=-1, near_a1=tb_a, near_a2=sb_a
    )
    specs["lunge"] = {
        "label": "Lunge",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (150.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (176.0, 168.0),
        "bones": b_lg,
        "pose_a": _pose(
            hip_x=118,
            hip_y=108,
            lumbar=-88,
            thoracic=-88,
            neck=-86,
            uarm_f=98,
            farm_f=-42,
            uarm_b=96,
            farm_b=-38,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=118,
            hip_y=131,
            lumbar=-86,
            thoracic=-86,
            neck=-84,
            uarm_f=74,
            farm_f=-28,
            uarm_b=72,
            farm_b=-24,
            thigh_f=tf_b,
            shin_f=sf_b,
            thigh_b=tb_b,
            shin_b=sb_b,
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
    uf_a, ff_a = _solve_2link_ik(sh_pua, (162.0, 169.0), 29, 29, bend_sign=1)
    ub_a, fb_a = _solve_2link_ik(
        (sh_pua[0] - 4, sh_pua[1] - 2), (158.0, 167.0), 29, 29, bend_sign=1
    )
    tf_a, sf_a = _solve_2link_ik(hip_pua, (53.0, 169.0), 37.5, 37.5, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik(
        (hip_pua[0] - 4, hip_pua[1] - 2), (49.0, 167.0), 37.5, 37.5, bend_sign=-1
    )

    hip_pub = (125.5, 152.0)
    sh_pub = _step(_step(hip_pub, 22, -11.0), 22, -11.0)
    uf_b, ff_b = _solve_2link_ik(
        sh_pub, (162.0, 169.0), 29, 29, bend_sign=1, near_a1=uf_a, near_a2=ff_a
    )
    ub_b, fb_b = _solve_2link_ik(
        (sh_pub[0] - 4, sh_pub[1] - 2),
        (158.0, 167.0),
        29,
        29,
        bend_sign=1,
        near_a1=ub_a,
        near_a2=fb_a,
    )
    tf_b, sf_b = _solve_2link_ik(
        hip_pub, (53.0, 169.0), 37.5, 37.5, bend_sign=-1, near_a1=tf_a, near_a2=sf_a
    )
    tb_b, sb_b = _solve_2link_ik(
        (hip_pub[0] - 4, hip_pub[1] - 2),
        (49.0, 167.0),
        37.5,
        37.5,
        bend_sign=-1,
        near_a1=tb_a,
        near_a2=sb_a,
    )
    specs["pushup"] = {
        "label": "Pushup",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (162.0, 172.0),
        "band_target": "shoulder",
        "cable_anchor": (162.0, 172.0),
        "bones": b_pu,
        "pose_a": _pose(
            hip_x=hip_pua[0],
            hip_y=hip_pua[1],
            lumbar=-26,
            thoracic=-26,
            neck=-22,
            uarm_f=uf_a,
            farm_f=ff_a,
            uarm_b=ub_a,
            farm_b=fb_a,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=hip_pub[0],
            hip_y=hip_pub[1],
            lumbar=-11,
            thoracic=-11,
            neck=-7,
            uarm_f=uf_b,
            farm_f=ff_b,
            uarm_b=ub_b,
            farm_b=fb_b,
            thigh_f=tf_b,
            shin_f=sf_b,
            thigh_b=tb_b,
            shin_b=sb_b,
        ),
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
    tf_a, sf_a = _solve_2link_ik(hip_pla, (52.0, 170.0), 36.2, 36.2, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik(
        (hip_pla[0] - 4, hip_pla[1] - 2), (48.0, 168.0), 36.2, 36.2, bend_sign=-1
    )
    hip_plb = (120.0, 142.0)
    tf_b, sf_b = _solve_2link_ik(
        hip_plb, (52.0, 170.0), 36.2, 36.2, bend_sign=-1, near_a1=tf_a, near_a2=sf_a
    )
    tb_b, sb_b = _solve_2link_ik(
        (hip_plb[0] - 4, hip_plb[1] - 2),
        (48.0, 168.0),
        36.2,
        36.2,
        bend_sign=-1,
        near_a1=tb_a,
        near_a2=sb_a,
    )
    specs["plank"] = {
        "label": "Plank",
        "fixture": "pulse",
        "default_equipment": "body_only",
        "band_anchor": (164.0, 172.0),
        "band_target": "shoulder",
        "cable_anchor": (164.0, 172.0),
        "bones": b_pl,
        "pose_a": _pose(
            hip_x=hip_pla[0],
            hip_y=hip_pla[1],
            lumbar=-8,
            thoracic=-8,
            neck=-4,
            uarm_f=88,
            farm_f=0,
            uarm_b=88,
            farm_b=0,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=hip_plb[0],
            hip_y=hip_plb[1],
            lumbar=-4,
            thoracic=-5,
            neck=-2,
            uarm_f=88,
            farm_f=0,
            uarm_b=88,
            farm_b=0,
            thigh_f=tf_b,
            shin_f=sf_b,
            thigh_b=tb_b,
            shin_b=sb_b,
        ),
    }

    # 5. Hinge
    b_hg = {**STD_BONES, "thigh": 36.0, "shin": 36.0}
    tf_a, sf_a = _solve_2link_ik((114, 100), (122, 170), 36, 36, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik((109, 98), (116, 168), 36, 36, bend_sign=-1)
    tf_b, sf_b = _solve_2link_ik(
        (92, 105), (122, 170), 36, 36, bend_sign=-1, near_a1=tf_a, near_a2=sf_a
    )
    tb_b, sb_b = _solve_2link_ik(
        (87, 103), (116, 168), 36, 36, bend_sign=-1, near_a1=tb_a, near_a2=sb_a
    )
    specs["hinge"] = {
        "label": "Hip Hinge",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (122.0, 173.0),
        "band_target": "shoulder",
        "cable_anchor": (158.0, 170.0),
        "bones": b_hg,
        "pose_a": _pose(
            hip_x=114,
            hip_y=100,
            lumbar=-87,
            thoracic=-87,
            neck=-85,
            uarm_f=84,
            farm_f=80,
            uarm_b=86,
            farm_b=82,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=92,
            hip_y=105,
            lumbar=-22,
            thoracic=-20,
            neck=-18,
            uarm_f=88,
            farm_f=88,
            uarm_b=90,
            farm_b=90,
            thigh_f=tf_b,
            shin_f=sf_b,
            thigh_b=tb_b,
            shin_b=sb_b,
        ),
    }

    # 6. Glute Bridge
    b_gb = {**STD_BONES, "thigh": 36.0, "shin": 36.0, "back_dx": -4.0, "back_dy": -2.0}
    tf_a, sf_a = _solve_2link_ik((116, 164), (166, 170), 36, 36, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik((112, 162), (160, 168), 36, 36, bend_sign=-1)
    tf_b, sf_b = _solve_2link_ik(
        (114, 136), (166, 170), 36, 36, bend_sign=-1, near_a1=tf_a, near_a2=sf_a
    )
    tb_b, sb_b = _solve_2link_ik(
        (110, 134), (160, 168), 36, 36, bend_sign=-1, near_a1=tb_a, near_a2=sb_a
    )
    specs["glute_bridge"] = {
        "label": "Glute Bridge",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (115.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (115.0, 173.0),
        "bones": b_gb,
        "pose_a": _pose(
            hip_x=116,
            hip_y=164,
            lumbar=183,
            thoracic=184,
            neck=196,
            uarm_f=10,
            farm_f=4,
            uarm_b=10,
            farm_b=4,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=114,
            hip_y=136,
            lumbar=144,
            thoracic=146,
            neck=192,
            uarm_f=10,
            farm_f=4,
            uarm_b=10,
            farm_b=4,
            thigh_f=tf_b,
            shin_f=sf_b,
            thigh_b=tb_b,
            shin_b=sb_b,
        ),
    }

    # 7. Crunch Core
    b_cc = {**STD_BONES, "thigh": 36.0, "shin": 36.0, "back_dx": -4.0, "back_dy": -2.0}
    tf_a, sf_a = _solve_2link_ik((120, 164), (170, 170), 36, 36, bend_sign=-1)
    tb_a, sb_a = _solve_2link_ik((116, 162), (164, 168), 36, 36, bend_sign=-1)
    specs["crunch_core"] = {
        "label": "Crunch Core",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (42.0, 168.0),
        "band_target": "hand",
        "cable_anchor": (42.0, 148.0),
        "bones": b_cc,
        "pose_a": _pose(
            hip_x=120,
            hip_y=164,
            lumbar=-174,
            thoracic=-168,
            neck=-152,
            uarm_f=-88,
            farm_f=-192,
            uarm_b=-94,
            farm_b=-192,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
        ),
        "pose_b": _pose(
            hip_x=120,
            hip_y=164,
            lumbar=-152,
            thoracic=-108,
            neck=-88,
            uarm_f=-36,
            farm_f=-162,
            uarm_b=-44,
            farm_b=-162,
            thigh_f=tf_a,
            shin_f=sf_a,
            thigh_b=tb_a,
            shin_b=sb_a,
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
    uf_mc, ff_mc = _solve_2link_ik(sh_mc, (160.0, 169.0), 30, 30, bend_sign=1)
    ub_mc, fb_mc = _solve_2link_ik(
        (sh_mc[0] - 3, sh_mc[1] - 1.5), (156.0, 167.5), 30, 30, bend_sign=1
    )
    t_ext, s_ext = _solve_2link_ik(hip_mc, (59.5, 166.0), 35, 35, bend_sign=-1)
    t_drv, s_drv = 18.0, 176.0
    specs["mountain_climber"] = {
        "label": "Mountain Climber",
        "fixture": None,
        "default_equipment": "body_only",
        "band_anchor": (58.0, 172.0),
        "band_target": "hand",
        "cable_anchor": (58.0, 172.0),
        "bones": b_mc,
        "pose_a": _pose(
            hip_x=hip_mc[0],
            hip_y=hip_mc[1],
            lumbar=-18,
            thoracic=-18,
            neck=-16,
            uarm_f=uf_mc,
            farm_f=ff_mc,
            uarm_b=ub_mc,
            farm_b=fb_mc,
            thigh_f=t_drv,
            shin_f=s_drv,
            thigh_b=t_ext,
            shin_b=s_ext,
        ),
        "pose_b": _pose(
            hip_x=hip_mc[0],
            hip_y=hip_mc[1],
            lumbar=-18,
            thoracic=-18,
            neck=-16,
            uarm_f=uf_mc,
            farm_f=ff_mc,
            uarm_b=ub_mc,
            farm_b=fb_mc,
            thigh_f=t_ext,
            shin_f=s_ext,
            thigh_b=t_drv,
            shin_b=s_drv,
        ),
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
    uf_da, ff_da = _solve_2link_ik(sh_da, (88.0, 138.0), 27, 27, bend_sign=1)
    ub_da, fb_da = _solve_2link_ik(
        (sh_da[0] - 4, sh_da[1] - 2), (84.0, 136.0), 27, 27, bend_sign=1
    )
    tf_da, sf_da = _solve_2link_ik(hip_da, (164.0, 169.0), 36.5, 36.5, bend_sign=-1)
    tb_da, sb_da = _solve_2link_ik(
        (hip_da[0] - 4, hip_da[1] - 2), (160.0, 167.0), 36.5, 36.5, bend_sign=-1
    )

    hip_db = (108.0, 151.0)
    sh_db = _step(_step(hip_db, 22, -94.0), 22, -92.0)
    uf_db, ff_db = _solve_2link_ik(
        sh_db, (88.0, 138.0), 27, 27, bend_sign=1, near_a1=uf_da, near_a2=ff_da
    )
    ub_db, fb_db = _solve_2link_ik(
        (sh_db[0] - 4, sh_db[1] - 2),
        (84.0, 136.0),
        27,
        27,
        bend_sign=1,
        near_a1=ub_da,
        near_a2=fb_da,
    )
    tf_db, sf_db = _solve_2link_ik(
        hip_db, (164.0, 169.0), 36.5, 36.5, bend_sign=-1, near_a1=tf_da, near_a2=sf_da
    )
    tb_db, sb_db = _solve_2link_ik(
        (hip_db[0] - 4, hip_db[1] - 2),
        (160.0, 167.0),
        36.5,
        36.5,
        bend_sign=-1,
        near_a1=tb_da,
        near_a2=sb_da,
    )
    specs["dip"] = {
        "label": "Triceps Dip",
        "fixture": "dip_box",
        "default_equipment": "body_only",
        "band_anchor": (88.0, 138.0),
        "band_target": "shoulder",
        "cable_anchor": (88.0, 138.0),
        "bones": b_dp,
        "pose_a": _pose(
            hip_x=hip_da[0],
            hip_y=hip_da[1],
            lumbar=-94,
            thoracic=-92,
            neck=-88,
            uarm_f=uf_da,
            farm_f=ff_da,
            uarm_b=ub_da,
            farm_b=fb_da,
            thigh_f=tf_da,
            shin_f=sf_da,
            thigh_b=tb_da,
            shin_b=sb_da,
        ),
        "pose_b": _pose(
            hip_x=hip_db[0],
            hip_y=hip_db[1],
            lumbar=-94,
            thoracic=-92,
            neck=-88,
            uarm_f=uf_db,
            farm_f=ff_db,
            uarm_b=ub_db,
            farm_b=fb_db,
            thigh_f=tf_db,
            shin_f=sf_db,
            thigh_b=tb_db,
            shin_b=sb_db,
        ),
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
    tf_op, sf_op = _solve_2link_ik((116, 108), (126, 171), 34, 34, bend_sign=-1)
    tb_op, sb_op = _solve_2link_ik((110, 106), (108, 169), 34, 34, bend_sign=-1)
    specs["overhead_press"] = {
        "label": "Overhead Press",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (124.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (124.0, 172.0),
        "bones": b_op,
        "pose_a": _pose(
            hip_x=116,
            hip_y=108,
            lumbar=-88,
            thoracic=-89,
            neck=-86,
            uarm_f=52,
            farm_f=-76,
            uarm_b=46,
            farm_b=-78,
            thigh_f=tf_op,
            shin_f=sf_op,
            thigh_b=tb_op,
            shin_b=sb_op,
        ),
        "pose_b": _pose(
            hip_x=116,
            hip_y=108,
            lumbar=-89,
            thoracic=-92,
            neck=-87,
            uarm_f=-82,
            farm_f=-86,
            uarm_b=-88,
            farm_b=-88,
            thigh_f=tf_op,
            shin_f=sf_op,
            thigh_b=tb_op,
            shin_b=sb_op,
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
    tf_bp, sf_bp = _solve_2link_ik((132, 129), (170, 171), 35, 35, bend_sign=-1)
    tb_bp, sb_bp = _solve_2link_ik((128, 127), (164, 169), 35, 35, bend_sign=-1)
    specs["bench_press"] = {
        "label": "Bench Press",
        "fixture": "bench",
        "default_equipment": "barbell",
        "band_anchor": (90.0, 172.0),
        "band_target": "hand",
        "cable_anchor": (90.0, 170.0),
        "bones": b_bp,
        "pose_a": _pose(
            hip_x=132,
            hip_y=129,
            lumbar=-178,
            thoracic=-178,
            neck=-172,
            uarm_f=48,
            farm_f=-86,
            uarm_b=44,
            farm_b=-86,
            thigh_f=tf_bp,
            shin_f=sf_bp,
            thigh_b=tb_bp,
            shin_b=sb_bp,
        ),
        "pose_b": _pose(
            hip_x=132,
            hip_y=129,
            lumbar=-178,
            thoracic=-178,
            neck=-172,
            uarm_f=-86,
            farm_f=-88,
            uarm_b=-88,
            farm_b=-88,
            thigh_f=tf_bp,
            shin_f=sf_bp,
            thigh_b=tb_bp,
            shin_b=sb_bp,
        ),
    }

    # 12. Row Pull
    b_rw = {**STD_BONES, "uarm": 25.0, "farm": 24.0, "thigh": 36.0, "shin": 36.0}
    tf_rw, sf_rw = _solve_2link_ik((94, 106), (122, 171), 36, 36, bend_sign=-1)
    tb_rw, sb_rw = _solve_2link_ik((89, 104), (115, 169), 36, 36, bend_sign=-1)
    specs["row_pull"] = {
        "label": "Row Pull",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (158.0, 172.0),
        "band_target": "hand",
        "cable_anchor": (186.0, 128.0),
        "bones": b_rw,
        "pose_a": _pose(
            hip_x=94,
            hip_y=106,
            lumbar=-30,
            thoracic=-28,
            neck=-24,
            uarm_f=88,
            farm_f=86,
            uarm_b=86,
            farm_b=84,
            thigh_f=tf_rw,
            shin_f=sf_rw,
            thigh_b=tb_rw,
            shin_b=sb_rw,
        ),
        "pose_b": _pose(
            hip_x=94,
            hip_y=106,
            lumbar=-32,
            thoracic=-30,
            neck=-26,
            uarm_f=196,
            farm_f=70,
            uarm_b=186,
            farm_b=72,
            thigh_f=tf_rw,
            shin_f=sf_rw,
            thigh_b=tb_rw,
            shin_b=sb_rw,
        ),
    }

    # 13. Curl
    b_cu = {**STD_BONES, "thigh": 36.0, "shin": 36.0}
    tf_cu, sf_cu = _solve_2link_ik((114, 102), (122, 171), 36, 36, bend_sign=-1)
    tb_cu, sb_cu = _solve_2link_ik((109, 100), (114, 169), 36, 36, bend_sign=-1)
    specs["curl"] = {
        "label": "Bicep Curl",
        "fixture": None,
        "default_equipment": "dumbbell",
        "band_anchor": (126.0, 173.0),
        "band_target": "hand",
        "cable_anchor": (156.0, 170.0),
        "bones": b_cu,
        "pose_a": _pose(
            hip_x=114,
            hip_y=102,
            lumbar=-88,
            thoracic=-88,
            neck=-86,
            uarm_f=88,
            farm_f=76,
            uarm_b=86,
            farm_b=74,
            thigh_f=tf_cu,
            shin_f=sf_cu,
            thigh_b=tb_cu,
            shin_b=sb_cu,
        ),
        "pose_b": _pose(
            hip_x=114,
            hip_y=102,
            lumbar=-88,
            thoracic=-89,
            neck=-86,
            uarm_f=78,
            farm_f=-58,
            uarm_b=80,
            farm_b=-46,
            thigh_f=tf_cu,
            shin_f=sf_cu,
            thigh_b=tb_cu,
            shin_b=sb_cu,
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
    tf_vp, sf_vp = _solve_2link_ik((106, 134), (148, 171), 34, 34, bend_sign=-1)
    tb_vp, sb_vp = _solve_2link_ik((101, 132), (142, 169), 34, 34, bend_sign=-1)
    specs["vertical_pull"] = {
        "label": "Vertical Pull",
        "fixture": "pull_station",
        "default_equipment": "cable",
        "band_anchor": (116.0, 20.0),
        "band_target": "hand",
        "cable_anchor": (116.0, 20.0),
        "bones": b_vp,
        "pose_a": _pose(
            hip_x=106,
            hip_y=134,
            lumbar=-88,
            thoracic=-86,
            neck=-82,
            uarm_f=-76,
            farm_f=-84,
            uarm_b=-80,
            farm_b=-86,
            thigh_f=tf_vp,
            shin_f=sf_vp,
            thigh_b=tb_vp,
            shin_b=sb_vp,
        ),
        "pose_b": _pose(
            hip_x=106,
            hip_y=134,
            lumbar=-94,
            thoracic=-98,
            neck=-86,
            uarm_f=102,
            farm_f=-58,
            uarm_b=96,
            farm_b=-62,
            thigh_f=tf_vp,
            shin_f=sf_vp,
            thigh_b=tb_vp,
            shin_b=sb_vp,
        ),
    }

    # 15. Triceps Extension (incline bench skull crusher: pinned humerus, elbow extension)
    b_te = {
        **STD_BONES,
        "uarm": 24.0,
        "farm": 24.0,
        "thigh": 35.0,
        "shin": 35.0,
        "back_dx": -4.0,
        "back_dy": -2.0,
    }
    tf_te, sf_te = _solve_2link_ik((128, 132), (168, 171), 35, 35, bend_sign=-1)
    tb_te, sb_te = _solve_2link_ik((124, 130), (162, 169), 35, 35, bend_sign=-1)
    specs["triceps_extension"] = {
        "label": "Triceps Extension",
        "fixture": "incline_bench",
        "default_equipment": "dumbbell",
        "band_anchor": (52.0, 170.0),
        "band_target": "hand",
        "cable_anchor": (48.0, 168.0),
        "bones": b_te,
        "pose_a": _pose(
            hip_x=128,
            hip_y=132,
            lumbar=-146,
            thoracic=-144,
            neck=-136,
            uarm_f=-98,
            farm_f=-174,
            uarm_b=-102,
            farm_b=-176,
            thigh_f=tf_te,
            shin_f=sf_te,
            thigh_b=tb_te,
            shin_b=sb_te,
        ),
        "pose_b": _pose(
            hip_x=128,
            hip_y=132,
            lumbar=-146,
            thoracic=-144,
            neck=-136,
            uarm_f=-94,
            farm_f=-82,
            uarm_b=-98,
            farm_b=-84,
            thigh_f=tf_te,
            shin_f=sf_te,
            thigh_b=tb_te,
            shin_b=sb_te,
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
            hip_x=96,
            hip_y=122,
            lumbar=-102,
            thoracic=-100,
            neck=-90,
            uarm_f=72,
            farm_f=86,
            uarm_b=74,
            farm_b=86,
            thigh_f=4,
            shin_f=102,
            thigh_b=4,
            shin_b=98,
        ),
        "pose_b": _pose(
            hip_x=96,
            hip_y=122,
            lumbar=-102,
            thoracic=-100,
            neck=-90,
            uarm_f=72,
            farm_f=86,
            uarm_b=74,
            farm_b=86,
            thigh_f=2,
            shin_f=4,
            thigh_b=2,
            shin_b=8,
        ),
    }

    # 17. Calf Raise (standing plantarflexion elevating body from ball of foot)
    b_cr = {**STD_BONES, "thigh": 34.0, "shin": 34.0}
    tf_ca, sf_ca = _solve_2link_ik((114, 105), (119, 170), 34, 34, bend_sign=-1)
    tb_ca, sb_ca = _solve_2link_ik((109, 103), (114, 168), 34, 34, bend_sign=-1)
    tf_cb, sf_cb = _solve_2link_ik(
        (120, 91), (124, 156), 34, 34, bend_sign=-1, near_a1=tf_ca, near_a2=sf_ca
    )
    tb_cb, sb_cb = _solve_2link_ik(
        (115, 89), (119, 154), 34, 34, bend_sign=-1, near_a1=tb_ca, near_a2=sb_ca
    )
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
            hip_x=114,
            hip_y=105,
            lumbar=-88,
            thoracic=-88,
            neck=-86,
            uarm_f=102,
            farm_f=-48,
            uarm_b=100,
            farm_b=-44,
            thigh_f=tf_ca,
            shin_f=sf_ca,
            thigh_b=tb_ca,
            shin_b=sb_ca,
        ),
        "pose_b": _pose(
            hip_x=120,
            hip_y=91,
            lumbar=-88,
            thoracic=-88,
            neck=-86,
            uarm_f=98,
            farm_f=-46,
            uarm_b=96,
            farm_b=-42,
            thigh_f=tf_cb,
            shin_f=sf_cb,
            thigh_b=tb_cb,
            shin_b=sb_cb,
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
            hip_x=116,
            hip_y=162,
            lumbar=-154,
            thoracic=-116,
            neck=-96,
            uarm_f=-36,
            farm_f=-146,
            uarm_b=-142,
            farm_b=-52,
            thigh_f=-114,
            shin_f=10,
            thigh_b=-20,
            shin_b=-8,
        ),
        "pose_b": _pose(
            hip_x=116,
            hip_y=162,
            lumbar=-156,
            thoracic=-124,
            neck=-102,
            uarm_f=-142,
            farm_f=-52,
            uarm_b=-36,
            farm_b=-146,
            thigh_f=-20,
            shin_f=-8,
            thigh_b=-114,
            shin_b=10,
        ),
    }

    return specs


ARCHETYPE_SPECS: dict[str, dict[str, Any]] = _build_archetype_specs()


def normalize_equipment(equipment: str | None, archetype: str = "squat") -> str:
    spec = ARCHETYPE_SPECS.get(archetype, ARCHETYPE_SPECS["squat"])
    if equipment is None:
        return str(spec["default_equipment"])

    raw = equipment.strip().lower().replace("-", "_").replace(" ", "_")
    if not raw or raw in {"body_only", "none", "bodyweight", "foam_roll", "exercise_ball", "other"}:
        return "body_only"
    if raw in {"dumbbell", "dumbbells", "medicine_ball"}:
        return "dumbbell"
    if raw in {"barbell", "barbells", "e_z_curl_bar", "ez_curl_bar", "ez_bar", "full_gym"}:
        return "barbell"
    if raw in {"kettlebells", "kettlebell", "kettlebell_bands"}:
        return "kettlebells"
    if raw in {"bands", "band", "resistance_band", "resistance_bands"}:
        return "bands"
    if raw in {"cable", "cables"}:
        return "cable"
    if raw in {"machine", "machines"}:
        return "machine"
    return str(spec["default_equipment"])


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
    if fixture == "bench":
        return (
            '<rect x="50" y="136" width="96" height="8" rx="4" fill="#334155" stroke="#475569" stroke-width="1.2" />'
            '<line x1="66" y1="144" x2="66" y2="174" stroke="#334155" stroke-width="5" stroke-linecap="round" />'
            '<line x1="130" y1="144" x2="130" y2="174" stroke="#334155" stroke-width="5" stroke-linecap="round" />'
        )
    if fixture == "incline_bench":
        return (
            '<line x1="68" y1="98" x2="130" y2="140" stroke="#334155" stroke-width="8" stroke-linecap="round" />'
            '<line x1="126" y1="140" x2="148" y2="136" stroke="#334155" stroke-width="7" stroke-linecap="round" />'
            '<line x1="84" y1="110" x2="76" y2="174" stroke="#475569" stroke-width="4.5" stroke-linecap="round" />'
            '<line x1="134" y1="140" x2="138" y2="174" stroke="#475569" stroke-width="4.5" stroke-linecap="round" />'
        )
    if fixture == "dip_box":
        return (
            '<rect x="42" y="138" width="54" height="36" rx="6" fill="#1e293b" stroke="#475569" stroke-width="1.8" />'
        )
    if fixture == "pulse":
        r = 21.0 + 9.0 * t
        return (
            f'<circle class="js-pulse" cx="132" cy="144" r="{r:.2f}" fill="none" '
            'stroke="#34d399" stroke-width="2.5" stroke-opacity="0.45" />'
        )
    if fixture == "pull_station":
        return (
            '<line x1="72" y1="18" x2="72" y2="174" stroke="#334155" stroke-width="5" stroke-linecap="round" />'
            '<line x1="72" y1="18" x2="138" y2="18" stroke="#475569" stroke-width="5" stroke-linecap="round" />'
            '<line x1="94" y1="20" x2="138" y2="20" stroke="#94a3b8" stroke-width="3.2" stroke-linecap="round" />'
            '<rect x="86" y="140" width="38" height="7" rx="3.5" fill="#334155" stroke="#475569" stroke-width="1.2" />'
            '<line x1="104" y1="147" x2="104" y2="174" stroke="#334155" stroke-width="4.5" stroke-linecap="round" />'
        )
    if fixture == "leg_bench":
        return (
            '<line x1="76" y1="74" x2="90" y2="128" stroke="#334155" stroke-width="7.5" stroke-linecap="round" />'
            '<rect x="86" y="126" width="52" height="7" rx="3.5" fill="#334155" stroke="#475569" stroke-width="1.2" />'
            '<line x1="94" y1="133" x2="90" y2="174" stroke="#475569" stroke-width="4.5" stroke-linecap="round" />'
            '<line x1="130" y1="133" x2="134" y2="174" stroke="#475569" stroke-width="4.5" stroke-linecap="round" />'
            '<circle cx="134" cy="126" r="4" fill="#0f172a" stroke="#64748b" stroke-width="1.5" />'
        )
    if fixture == "calf_block":
        return (
            '<rect x="118" y="167" width="32" height="7" rx="2.5" fill="#334155" stroke="#64748b" stroke-width="1.2" />'
        )
    return ""


def render_archetype_svg(
    archetype: str,
    equipment: str | None = None,
    *,
    thumbnail: bool = False,
) -> str:
    arch = archetype if archetype in ARCHETYPE_SPECS else "squat"
    spec = ARCHETYPE_SPECS[arch]
    bones = spec["bones"]
    pa = spec["pose_a"]
    pb = spec["pose_b"]
    eq_mode = normalize_equipment(equipment, arch)

    t_init = 0.9 if thumbnail else 0.0
    pose_init = lerp_pose(pa, pb, t_init)
    j = solve_fk(bones, pose_init)

    pose_a_attr = escape(json.dumps(pa, separators=(",", ":")), quote=True)
    pose_b_attr = escape(json.dumps(pb, separators=(",", ":")), quote=True)
    bones_attr = escape(json.dumps(bones, separators=(",", ":")), quote=True)
    label = escape(str(spec["label"]), quote=True)
    grad_id = f"glow-{arch}"

    aura_cx, aura_cy = _compute_aura_center(spec)
    aura_r = 80.0 + 8.0 * t_init
    ring_r = 62.0 + 6.0 * t_init
    shadow_cx, shadow_rx = compute_shadow(j)

    extra_svg_attrs: list[str] = [f'data-equipment="{eq_mode}"']
    bar_mode = "shoulder" if arch in BACK_RACK_ARCHETYPES else "hands"
    if eq_mode == "barbell":
        extra_svg_attrs.append(f'data-bar-mode="{bar_mode}"')

    forefoot_pt: Point | None = spec.get("forefoot")
    if forefoot_pt is not None:
        extra_svg_attrs.append(f'data-forefoot-x="{forefoot_pt[0]:.2f}"')
        extra_svg_attrs.append(f'data-forefoot-y="{forefoot_pt[1]:.2f}"')

    fixture_markup = _render_fixture(spec["fixture"], t_init)

    prop_back_markup = ""
    prop_front_markup = ""

    if eq_mode == "dumbbell":
        prop_back_markup = (
            f'<circle class="js-weight-b" cx="{j["hand_b"][0]:.2f}" cy="{j["hand_b"][1]:.2f}" '
            'r="7" fill="#059669" fill-opacity="0.68" />'
        )
        prop_front_markup = (
            f'<circle class="js-weight" cx="{j["hand_f"][0]:.2f}" cy="{j["hand_f"][1]:.2f}" '
            'r="8.2" fill="#10b981" stroke="#d1fae5" stroke-width="1.8" />'
            f'<circle class="js-weight-cap" cx="{j["hand_f"][0]:.2f}" cy="{j["hand_f"][1]:.2f}" '
            'r="3" fill="#064e3b" />'
        )
    elif eq_mode == "kettlebells":
        kb_by = min(165.0, j["hand_b"][1] + 8.0)
        kb_fy = min(165.0, j["hand_f"][1] + 9.0)
        hdl_fy = min(159.0, j["hand_f"][1] + 2.5)
        prop_back_markup = (
            f'<circle class="js-weight-b" cx="{j["hand_b"][0]:.2f}" cy="{kb_by:.2f}" '
            'r="7.2" fill="#047857" fill-opacity="0.68" />'
        )
        prop_front_markup = (
            f'<circle class="js-kb-handle-f" cx="{j["hand_f"][0]:.2f}" cy="{hdl_fy:.2f}" '
            'r="5" fill="none" stroke="#d1fae5" stroke-width="2.2" />'
            f'<circle class="js-weight" cx="{j["hand_f"][0]:.2f}" cy="{kb_fy:.2f}" '
            'r="8.4" fill="#10b981" stroke="#ecfdf5" stroke-width="1.6" />'
        )
    elif eq_mode == "barbell":
        p_b = j["shoulder_b"] if bar_mode == "shoulder" else j["hand_b"]
        p_f = j["shoulder"] if bar_mode == "shoulder" else j["hand_f"]
        sx1, sy1 = p_b[0] - 6.0, p_b[1] - 2.0
        sx2, sy2 = p_f[0] + 6.0, p_f[1] + 2.0
        prop_back_markup = (
            f'<circle class="js-weight-b" cx="{p_b[0]:.2f}" cy="{p_b[1]:.2f}" '
            'r="10" fill="#047857" fill-opacity="0.72" stroke="#6ee7b7" stroke-width="1.2" />'
            f'<line class="js-bar-shaft" x1="{sx1:.2f}" y1="{sy1:.2f}" x2="{sx2:.2f}" y2="{sy2:.2f}" '
            'stroke="#cbd5e1" stroke-width="3.4" stroke-linecap="round" />'
        )
        prop_front_markup = (
            f'<circle class="js-weight" cx="{p_f[0]:.2f}" cy="{p_f[1]:.2f}" '
            'r="11.5" fill="#10b981" stroke="#ecfdf5" stroke-width="2" />'
            f'<circle class="js-bar-hub" cx="{p_f[0]:.2f}" cy="{p_f[1]:.2f}" '
            'r="3.8" fill="#0f172a" stroke="#a7f3d0" stroke-width="1.2" />'
        )
    elif eq_mode == "bands":
        ax, ay = spec["band_anchor"]
        b_target = str(spec.get("band_target", "hand"))
        extra_svg_attrs.append(f'data-anchor-x="{ax:.2f}"')
        extra_svg_attrs.append(f'data-anchor-y="{ay:.2f}"')
        extra_svg_attrs.append(f'data-band-target="{b_target}"')
        if b_target == "shoulder":
            tb_pt, tf_pt = j["shoulder_b"], j["shoulder"]
        elif b_target == "foot":
            tb_pt, tf_pt = j["foot_b"], j["foot_f"]
        else:
            tb_pt, tf_pt = j["hand_b"], j["hand_f"]
        prop_back_markup = (
            f'<circle cx="{ax:.2f}" cy="{ay:.2f}" r="3.5" fill="#0f172a" stroke="#34d399" stroke-width="1.6" />'
            f'<line class="js-band-b" x1="{ax:.2f}" y1="{ay:.2f}" x2="{tb_pt[0]:.2f}" y2="{tb_pt[1]:.2f}" '
            'stroke="#059669" stroke-width="2.6" stroke-opacity="0.72" stroke-linecap="round" />'
        )
        prop_front_markup = (
            f'<line class="js-band-f" x1="{ax:.2f}" y1="{ay:.2f}" x2="{tf_pt[0]:.2f}" y2="{tf_pt[1]:.2f}" '
            'stroke="#34d399" stroke-width="3.2" stroke-linecap="round" />'
        )
    elif eq_mode in {"cable", "machine"}:
        ax, ay = spec["cable_anchor"]
        c_target = str(spec.get("cable_target", "hand"))
        extra_svg_attrs.append(f'data-anchor-x="{ax:.2f}"')
        extra_svg_attrs.append(f'data-anchor-y="{ay:.2f}"')
        extra_svg_attrs.append(f'data-cable-target="{c_target}"')
        att_pt = j["foot_f"] if c_target == "foot" else j["hand_f"]
        prop_back_markup = (
            f'<circle cx="{ax:.2f}" cy="{ay:.2f}" r="4.8" fill="#1e293b" stroke="#94a3b8" stroke-width="1.8" />'
            f'<line class="js-cable" x1="{ax:.2f}" y1="{ay:.2f}" x2="{att_pt[0]:.2f}" y2="{att_pt[1]:.2f}" '
            'stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round" />'
        )
        prop_front_markup = (
            f'<circle class="js-cable-grip" cx="{att_pt[0]:.2f}" cy="{att_pt[1]:.2f}" '
            'r="5.2" fill="#10b981" stroke="#ecfdf5" stroke-width="1.6" />'
        )

    forefoot_b_markup = ""
    forefoot_f_markup = ""
    if forefoot_pt is not None:
        fb_toe = (forefoot_pt[0] - 5.0, forefoot_pt[1] - 1.0)
        forefoot_b_markup = (
            f'<line class="js-forefoot-b" x1="{j["foot_b"][0]:.2f}" y1="{j["foot_b"][1]:.2f}" '
            f'x2="{fb_toe[0]:.2f}" y2="{fb_toe[1]:.2f}" />'
        )
        forefoot_f_markup = (
            f'<line class="js-forefoot-f" x1="{j["foot_f"][0]:.2f}" y1="{j["foot_f"][1]:.2f}" '
            f'x2="{forefoot_pt[0]:.2f}" y2="{forefoot_pt[1]:.2f}" />'
        )

    extra_attr_str = " ".join(extra_svg_attrs)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" preserveAspectRatio="xMidYMid meet" class="exercise-svg" role="img" aria-label="{label}" data-archetype="{arch}" data-bones="{bones_attr}" data-pose-a="{pose_a_attr}" data-pose-b="{pose_b_attr}" {extra_attr_str}>
  <defs>
    <radialGradient id="{grad_id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.18" />
      <stop offset="65%" stop-color="#10b981" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle class="js-aura" cx="{aura_cx}" cy="{aura_cy}" r="{aura_r:.2f}" fill="url(#{grad_id})" />
  <circle class="js-ring" cx="{aura_cx}" cy="{aura_cy}" r="{ring_r:.2f}" fill="none" stroke="#34d399" stroke-opacity="0.14" stroke-width="1.2" stroke-dasharray="3 6" />
  <line x1="16" y1="175" x2="224" y2="175" stroke="#334155" stroke-width="3" stroke-linecap="round" />
  <ellipse class="js-shadow" cx="{shadow_cx:.2f}" cy="176" rx="{shadow_rx:.2f}" ry="3.5" fill="#10b981" fill-opacity="0.22" />
  {fixture_markup}
  <g stroke="#64748b" stroke-width="8" stroke-linecap="round">
    <line class="js-thigh-b" x1="{j['hip_b'][0]:.2f}" y1="{j['hip_b'][1]:.2f}" x2="{j['knee_b'][0]:.2f}" y2="{j['knee_b'][1]:.2f}" />
    <line class="js-shin-b" x1="{j['knee_b'][0]:.2f}" y1="{j['knee_b'][1]:.2f}" x2="{j['foot_b'][0]:.2f}" y2="{j['foot_b'][1]:.2f}" />
    {forefoot_b_markup}
    <line class="js-uarm-b" x1="{j['shoulder_b'][0]:.2f}" y1="{j['shoulder_b'][1]:.2f}" x2="{j['elbow_b'][0]:.2f}" y2="{j['elbow_b'][1]:.2f}" />
    <line class="js-farm-b" x1="{j['elbow_b'][0]:.2f}" y1="{j['elbow_b'][1]:.2f}" x2="{j['hand_b'][0]:.2f}" y2="{j['hand_b'][1]:.2f}" />
  </g>
  {prop_back_markup}
  <g stroke="#e2e8f0" stroke-width="9.5" stroke-linecap="round">
    <line class="js-thigh-f" x1="{j['hip'][0]:.2f}" y1="{j['hip'][1]:.2f}" x2="{j['knee_f'][0]:.2f}" y2="{j['knee_f'][1]:.2f}" />
    <line class="js-shin-f" x1="{j['knee_f'][0]:.2f}" y1="{j['knee_f'][1]:.2f}" x2="{j['foot_f'][0]:.2f}" y2="{j['foot_f'][1]:.2f}" />
    {forefoot_f_markup}
  </g>
  <line class="js-neck" x1="{j['shoulder'][0]:.2f}" y1="{j['shoulder'][1]:.2f}" x2="{j['head'][0]:.2f}" y2="{j['head'][1]:.2f}" stroke="#cbd5e1" stroke-width="6.5" stroke-linecap="round" />
  <path class="js-torso" d="M {j['hip'][0]:.2f} {j['hip'][1]:.2f} Q {j['mid_spine'][0]:.2f} {j['mid_spine'][1]:.2f} {j['shoulder'][0]:.2f} {j['shoulder'][1]:.2f}" fill="none" stroke="#f8fafc" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" />
  <g stroke="#34d399" stroke-width="8.8" stroke-linecap="round">
    <line class="js-uarm-f" x1="{j['shoulder'][0]:.2f}" y1="{j['shoulder'][1]:.2f}" x2="{j['elbow_f'][0]:.2f}" y2="{j['elbow_f'][1]:.2f}" />
    <line class="js-farm-f" x1="{j['elbow_f'][0]:.2f}" y1="{j['elbow_f'][1]:.2f}" x2="{j['hand_f'][0]:.2f}" y2="{j['hand_f'][1]:.2f}" />
  </g>
  <g fill="#0f172a" stroke="#34d399" stroke-width="1.6">
    <circle class="js-j-shoulder" cx="{j['shoulder'][0]:.2f}" cy="{j['shoulder'][1]:.2f}" r="3" />
    <circle class="js-j-hip" cx="{j['hip'][0]:.2f}" cy="{j['hip'][1]:.2f}" r="3" />
    <circle class="js-j-knee" cx="{j['knee_f'][0]:.2f}" cy="{j['knee_f'][1]:.2f}" r="2.8" />
    <circle class="js-j-elbow" cx="{j['elbow_f'][0]:.2f}" cy="{j['elbow_f'][1]:.2f}" r="2.8" />
  </g>
  <circle class="js-head" cx="{j['head'][0]:.2f}" cy="{j['head'][1]:.2f}" r="11.5" fill="#34d399" stroke="#ecfdf5" stroke-width="1.6" />
  {prop_front_markup}
</svg>
"""


def pregenerate_all_svgs(output_dir: Path = SVGS_DIR) -> list[Path]:
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
    arch = archetype if archetype in ARCHETYPE_SPECS else "squat"
    target = svg_dir / f"{arch}.svg"
    if not target.exists():
        pregenerate_all_svgs(svg_dir)
    return render_archetype_svg(arch, equipment=equipment, thumbnail=False)


if __name__ == "__main__":
    files = pregenerate_all_svgs()
    print(f"Pregenerated {len(files)} SVG files in {SVGS_DIR}")
