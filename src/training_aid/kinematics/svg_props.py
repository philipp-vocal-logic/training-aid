# Copyright (c) 2026 Philipp Kaaden
"""Static gym fixture and equipment prop SVG markup builders."""

from typing import Any

from training_aid.kinematics.fk_solver import Point

__all__ = [
    "render_equipment_props",
    "render_fixture",
    "svg_class_attr",
]

_FRONT_BAR_OVERHANG = 8.0

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


def svg_class_attr(name: str, *, interactive: bool) -> str:
    """Return a `class="..."` attribute fragment only for interactive SVGs."""
    return f' class="{name}"' if interactive else ""


def render_fixture(
    fixture: str | None,
    t: float,
    eq_mode: str,
    *,
    interactive: bool,
) -> str:
    """Render static gym fixture or pulse ring SVG markup."""
    if fixture is None:
        return ""
    if fixture == "pulse":
        r = 21.0 + 9.0 * t
        return (
            f"<circle{svg_class_attr('js-pulse', interactive=interactive)} "
            f'cx="132" cy="144" r="{r:.2f}" fill="none" '
            'stroke="#34d399" stroke-width="2.5" stroke-opacity="0.45" />'
        )
    if fixture == "pushup_bars" and eq_mode in {"dumbbell", "kettlebells", "barbell"}:
        return ""
    return _STATIC_FIXTURES.get(fixture, "")


def _render_dumbbell(
    joints: dict[str, Point],
    geom: dict[str, float],
    *,
    interactive: bool,
) -> tuple[str, str]:
    back = (
        f"<circle{svg_class_attr('js-weight-b', interactive=interactive)} "
        f'cx="{joints["hand_b"][0]:.2f}" cy="{joints["hand_b"][1]:.2f}" '
        f'r="{geom["back_r"]:g}" fill="#059669" fill-opacity="0.68" />'
    )
    front = (
        f"<circle{svg_class_attr('js-weight', interactive=interactive)} "
        f'cx="{joints["hand_f"][0]:.2f}" cy="{joints["hand_f"][1]:.2f}" '
        f'r="{geom["front_r"]:g}" fill="#10b981" stroke="#d1fae5" '
        'stroke-width="1.8" />'
        f"<circle{svg_class_attr('js-weight-cap', interactive=interactive)} "
        f'cx="{joints["hand_f"][0]:.2f}" cy="{joints["hand_f"][1]:.2f}" '
        f'r="{geom["cap_r"]:g}" fill="#064e3b" />'
    )
    return (back, front)


def _render_kettlebells(
    joints: dict[str, Point],
    geom: dict[str, float],
    *,
    interactive: bool,
) -> tuple[str, str]:
    kb_by = joints["hand_b"][1] + geom["back_dy"]
    kb_fy = joints["hand_f"][1] + geom["front_dy"]
    hdl_fy = joints["hand_f"][1] + geom["handle_dy"]
    back = (
        f"<circle{svg_class_attr('js-weight-b', interactive=interactive)} "
        f'cx="{joints["hand_b"][0]:.2f}" cy="{kb_by:.2f}" '
        f'r="{geom["back_r"]:g}" fill="#047857" fill-opacity="0.68" />'
    )
    front = (
        f"<circle{svg_class_attr('js-kb-handle-f', interactive=interactive)} "
        f'cx="{joints["hand_f"][0]:.2f}" cy="{hdl_fy:.2f}" '
        f'r="{geom["handle_r"]:g}" fill="none" stroke="#d1fae5" '
        'stroke-width="2.2" />'
        f"<circle{svg_class_attr('js-weight', interactive=interactive)} "
        f'cx="{joints["hand_f"][0]:.2f}" cy="{kb_fy:.2f}" '
        f'r="{geom["front_r"]:g}" fill="#10b981" stroke="#ecfdf5" '
        'stroke-width="1.6" />'
    )
    return (back, front)


def _render_barbell(
    joints: dict[str, Point],
    geom: dict[str, float],
    *,
    interactive: bool,
    is_front: bool = False,
) -> tuple[str, str]:
    p_b = joints["hand_b"]
    p_f = joints["hand_f"]
    if is_front:
        left_h, right_h = (p_b, p_f) if p_b[0] <= p_f[0] else (p_f, p_b)
        sx1, sy1 = left_h[0] - _FRONT_BAR_OVERHANG, left_h[1]
        sx2, sy2 = right_h[0] + _FRONT_BAR_OVERHANG, right_h[1]
    else:
        sx1, sy1 = p_b[0] - geom["shaft_dx"], p_b[1] - geom["shaft_dy"]
        sx2, sy2 = p_f[0] + geom["shaft_dx"], p_f[1] + geom["shaft_dy"]
    back = (
        f"<circle{svg_class_attr('js-weight-b', interactive=interactive)} "
        f'cx="{p_b[0]:.2f}" cy="{p_b[1]:.2f}" r="{geom["back_r"]:g}" '
        'fill="#047857" fill-opacity="0.72" stroke="#6ee7b7" '
        'stroke-width="1.2" />'
        f"<line{svg_class_attr('js-bar-shaft', interactive=interactive)} "
        f'x1="{sx1:.2f}" y1="{sy1:.2f}" x2="{sx2:.2f}" y2="{sy2:.2f}" '
        'stroke="#cbd5e1" stroke-width="3.4" stroke-linecap="round" />'
    )
    front = (
        f"<circle{svg_class_attr('js-weight', interactive=interactive)} "
        f'cx="{p_f[0]:.2f}" cy="{p_f[1]:.2f}" r="{geom["front_r"]:g}" '
        'fill="#10b981" stroke="#ecfdf5" stroke-width="2" />'
        f"<circle{svg_class_attr('js-bar-hub', interactive=interactive)} "
        f'cx="{p_f[0]:.2f}" cy="{p_f[1]:.2f}" r="{geom["hub_r"]:g}" '
        'fill="#0f172a" stroke="#a7f3d0" stroke-width="1.2" />'
    )
    return (back, front)


def _render_tethered_props(
    eq_mode: str,
    spec: dict[str, Any],
    joints: dict[str, Point],
    *,
    interactive: bool,
) -> tuple[list[str], str, str]:
    if eq_mode == "bands":
        ax, ay = spec["band_anchor"]
        b_target = str(spec.get("band_target", "hand"))
        attrs = [
            f'data-anchor-x="{ax:.2f}"',
            f'data-anchor-y="{ay:.2f}"',
            f'data-band-target="{b_target}"',
        ]
        if b_target == "span":
            hb, hf = joints["hand_b"], joints["hand_f"]
            back = (
                f"<line{svg_class_attr('js-band-b', interactive=interactive)} "
                f'x1="{hb[0]:.2f}" y1="{hb[1]:.2f}" x2="{hf[0]:.2f}" '
                f'y2="{hf[1]:.2f}" stroke="#059669" stroke-width="2.6" '
                'stroke-opacity="0.72" stroke-linecap="round" />'
            )
            front = (
                f"<line{svg_class_attr('js-band-f', interactive=interactive)} "
                f'x1="{hb[0]:.2f}" y1="{hb[1]:.2f}" x2="{hf[0]:.2f}" '
                f'y2="{hf[1]:.2f}" stroke="#34d399" stroke-width="3.2" '
                'stroke-linecap="round" />'
            )
            return (attrs, back, front)
        if b_target == "shoulder":
            tb_pt, tf_pt = joints["shoulder_b"], joints["shoulder_f"]
        elif b_target == "foot":
            tb_pt, tf_pt = joints["foot_b"], joints["foot_f"]
        else:
            tb_pt, tf_pt = joints["hand_b"], joints["hand_f"]
        back = (
            f'<circle cx="{ax:.2f}" cy="{ay:.2f}" r="3.5" fill="#0f172a" '
            'stroke="#34d399" stroke-width="1.6" />'
            f"<line{svg_class_attr('js-band-b', interactive=interactive)} "
            f'x1="{ax:.2f}" y1="{ay:.2f}" x2="{tb_pt[0]:.2f}" '
            f'y2="{tb_pt[1]:.2f}" stroke="#059669" stroke-width="2.6" '
            'stroke-opacity="0.72" stroke-linecap="round" />'
        )
        front = (
            f"<line{svg_class_attr('js-band-f', interactive=interactive)} "
            f'x1="{ax:.2f}" y1="{ay:.2f}" x2="{tf_pt[0]:.2f}" '
            f'y2="{tf_pt[1]:.2f}" stroke="#34d399" stroke-width="3.2" '
            'stroke-linecap="round" />'
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
        f"<line{svg_class_attr('js-cable', interactive=interactive)} "
        f'x1="{ax:.2f}" y1="{ay:.2f}" x2="{att_pt[0]:.2f}" '
        f'y2="{att_pt[1]:.2f}" stroke="#94a3b8" stroke-width="2.4" '
        'stroke-linecap="round" />'
    )
    front = (
        f"<circle{svg_class_attr('js-cable-grip', interactive=interactive)} "
        f'cx="{att_pt[0]:.2f}" cy="{att_pt[1]:.2f}" r="5.2" fill="#10b981" '
        'stroke="#ecfdf5" stroke-width="1.6" />'
    )
    return (attrs, back, front)


def render_equipment_props(
    eq_mode: str,
    spec: dict[str, Any],
    joints: dict[str, Point],
    prop_geometry: dict[str, dict[str, float]],
    *,
    interactive: bool,
) -> tuple[list[str], str, str]:
    """Render equipment SVG attributes plus back/front prop markup layers."""
    attrs: list[str] = [f'data-equipment="{eq_mode}"']
    if eq_mode == "barbell":
        attrs.append(f'data-bar-mode="{spec["bar_mode"]}"')

    forefoot_pt: Point | None = spec.get("forefoot")
    if forefoot_pt is not None:
        attrs.append(f'data-forefoot-x="{forefoot_pt[0]:.2f}"')
        attrs.append(f'data-forefoot-y="{forefoot_pt[1]:.2f}"')

    if eq_mode == "barbell":
        back, front = _render_barbell(
            joints,
            prop_geometry[eq_mode],
            interactive=interactive,
            is_front=spec.get("view") == "front",
        )
        return (attrs, back, front)
    handheld_renderers = {
        "dumbbell": _render_dumbbell,
        "kettlebells": _render_kettlebells,
    }
    if eq_mode in handheld_renderers:
        back, front = handheld_renderers[eq_mode](
            joints,
            prop_geometry[eq_mode],
            interactive=interactive,
        )
        return (attrs, back, front)
    if eq_mode in {"bands", "cable", "machine"}:
        t_attrs, back, front = _render_tethered_props(
            eq_mode,
            spec,
            joints,
            interactive=interactive,
        )
        attrs.extend(t_attrs)
        return (attrs, back, front)
    return (attrs, "", "")
