# Copyright (c) 2026 Philipp Kaaden
"""2D forward-kinematics exercise rig and SVG asset generator."""

import json
import math
import sys
from html import escape
from pathlib import Path
from typing import Any

SVGS_DIR = Path(__file__).resolve().parent / "static" / "svgs"
ANIMATIONS_JSON = Path(__file__).resolve().parents[2] / "data" / "animations.json"

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

CANONICAL_EQUIPMENT_MODES: tuple[str, ...] = (
    "body_only",
    "barbell",
    "dumbbell",
    "kettlebells",
    "bands",
    "cable",
    "machine",
)

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
    "pushup_bars": (
        '<line x1="148" y1="154" x2="170" y2="154" stroke="#64748b" '
        'stroke-width="3.5" stroke-linecap="round" />'
        '<line x1="152" y1="154" x2="149" y2="174" stroke="#475569" '
        'stroke-width="3.2" stroke-linecap="round" />'
        '<line x1="166" y1="154" x2="169" y2="174" stroke="#475569" '
        'stroke-width="3.2" stroke-linecap="round" />'
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
    mid_spine = _step(hip, bones["lumbar"], spine[0])
    shoulder = _step(mid_spine, bones["thoracic"], spine[1])
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


def load_animation_registry(
    path: Path = ANIMATIONS_JSON,
) -> tuple[dict[str, float], dict[str, str], dict[str, dict[str, Any]]]:
    """Load standard bone lengths, equipment aliases, and compiled rig specs."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    std_bones = {str(k): float(v) for k, v in raw["std_bones"].items()}
    aliases = {str(k): str(v) for k, v in raw["equipment_aliases"].items()}
    specs = {
        str(arch): compile_animation_spec(cfg, std_bones)
        for arch, cfg in raw["animations"].items()
    }
    return (std_bones, aliases, specs)


STD_BONES, _EQUIPMENT_ALIASES, ARCHETYPE_SPECS = load_animation_registry()


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


def _render_fixture(
    fixture: str | None,
    t: float,
    eq_mode: str = "body_only",
) -> str:
    if fixture is None:
        return ""
    if fixture == "pulse":
        r = 21.0 + 9.0 * t
        return (
            f'<circle class="js-pulse" cx="132" cy="144" r="{r:.2f}" fill="none" '
            'stroke="#34d399" stroke-width="2.5" stroke-opacity="0.45" />'
        )
    if fixture == "pushup_bars" and eq_mode in {"dumbbell", "kettlebells", "barbell"}:
        return ""
    return _STATIC_FIXTURES.get(fixture, "")


def _render_handheld_props(
    eq_mode: str,
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
        kb_by = joints["hand_b"][1] + 8.0
        kb_fy = joints["hand_f"][1] + 9.0
        hdl_fy = joints["hand_f"][1] + 2.5
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

    p_b = joints["hand_b"]
    p_f = joints["hand_f"]
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
        back, front = _render_handheld_props(eq_mode, joints)
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
    tempo_mode = escape(str(spec["coaching"]["tempo_mode"]), quote=True)
    hold_style = escape(str(spec["hold_style"]), quote=True)
    grad_id = f"glow-{arch}"

    aura_cx, aura_cy = _compute_aura_center(spec)
    aura_r = 80.0 + 8.0 * t_init
    ring_r = 62.0 + 6.0 * t_init
    shadow_cx, shadow_rx = compute_shadow(j)

    bar_mode = str(spec["bar_mode"])
    extra_svg_attrs, prop_back_markup, prop_front_markup = _render_equipment_props(
        eq_mode, bar_mode, spec, j
    )
    forefoot_b_markup, forefoot_f_markup = _render_forefoot_lines(
        spec.get("forefoot"), j
    )
    fixture_markup = _render_fixture(spec["fixture"], t_init, eq_mode)
    extra_attr_str = " ".join(extra_svg_attrs)

    svg_open = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" '
        'preserveAspectRatio="xMidYMid meet" class="exercise-svg" role="img" '
        f'aria-label="{label}" data-archetype="{arch}" '
        f'data-tempo-mode="{tempo_mode}" data-hold-style="{hold_style}" '
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
