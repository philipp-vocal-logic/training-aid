# Copyright (c) 2026 Philipp Kaaden
"""Exercise SVG renderer emitting interactive or lean thumbnail markup."""

import json
from html import escape
from typing import Any

from training_aid.kinematics.fk_solver import (
    Point,
    compute_aura_center,
    compute_shadow,
    lerp_pose,
    solve_fk,
)
from training_aid.kinematics.registry import (
    AnimationRegistry,
    get_default_registry,
    normalize_equipment,
)
from training_aid.kinematics.svg_props import (
    render_equipment_props,
    render_fixture,
    svg_class_attr,
)

__all__ = ["render_archetype_svg"]


def _svg_line(
    cls_name: str,
    p1: Point,
    p2: Point,
    extra: str = "",
    *,
    interactive: bool = True,
) -> str:
    suffix = f" {extra}" if extra else ""
    return (
        f"<line{svg_class_attr(cls_name, interactive=interactive)} "
        f'x1="{p1[0]:.2f}" y1="{p1[1]:.2f}" x2="{p2[0]:.2f}" '
        f'y2="{p2[1]:.2f}"{suffix} />'
    )


def _render_forefoot_lines(
    forefoot_pt: Point | None,
    joints: dict[str, Point],
    *,
    interactive: bool,
) -> tuple[str, str]:
    if forefoot_pt is None:
        return ("", "")
    fb_toe = (forefoot_pt[0] - 5.0, forefoot_pt[1] - 1.0)
    back = _svg_line("js-forefoot-b", joints["foot_b"], fb_toe, interactive=interactive)
    front = _svg_line(
        "js-forefoot-f",
        joints["foot_f"],
        forefoot_pt,
        interactive=interactive,
    )
    return (back, front)


def _build_svg_open(
    arch: str,
    eq_mode: str,
    spec: dict[str, Any],
    extra_attrs: list[str],
    *,
    interactive: bool,
) -> str:
    label = escape(str(spec["label"]), quote=True)
    if not interactive:
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" '
            'preserveAspectRatio="xMidYMid meet" class="exercise-svg" role="img" '
            f'aria-label="{label}" data-archetype="{arch}" '
            f'data-equipment="{eq_mode}">'
        )
    pose_a_attr = escape(json.dumps(spec["pose_a"], separators=(",", ":")), quote=True)
    pose_b_attr = escape(json.dumps(spec["pose_b"], separators=(",", ":")), quote=True)
    bones_attr = escape(json.dumps(spec["bones"], separators=(",", ":")), quote=True)
    tempo_mode = escape(str(spec["coaching"]["tempo_mode"]), quote=True)
    hold_style = escape(str(spec["hold_style"]), quote=True)
    extra_attr_str = " ".join(extra_attrs)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" '
        'preserveAspectRatio="xMidYMid meet" class="exercise-svg" role="img" '
        f'aria-label="{label}" data-archetype="{arch}" '
        f'data-tempo-mode="{tempo_mode}" data-hold-style="{hold_style}" '
        f'data-bones="{bones_attr}" data-pose-a="{pose_a_attr}" '
        f'data-pose-b="{pose_b_attr}" {extra_attr_str}>'
    )


def _joint_marker(
    cls_name: str,
    pt: Point,
    radius: str,
    *,
    interactive: bool,
) -> str:
    return (
        f"    <circle{svg_class_attr(cls_name, interactive=interactive)} "
        f'cx="{pt[0]:.2f}" cy="{pt[1]:.2f}" r="{radius}" />'
    )


def render_archetype_svg(
    archetype: str,
    equipment: str | None = None,
    *,
    thumbnail: bool = False,
    registry: AnimationRegistry | None = None,
) -> str:
    """Render a complete exercise SVG document with FK rig metadata and props."""
    reg = registry if registry is not None else get_default_registry()
    arch = archetype if archetype in reg.specs else "squat"
    spec = reg.specs[arch]
    bones = spec["bones"]
    eq_mode = normalize_equipment(equipment, arch, registry=reg)

    interactive = not thumbnail
    t_init = 0.9 if thumbnail else 0.0
    j = solve_fk(bones, lerp_pose(spec["pose_a"], spec["pose_b"], t_init))

    grad_id = f"glow-{arch}"
    aura_cx, aura_cy = compute_aura_center(spec)
    aura_r = 80.0 + 8.0 * t_init
    ring_r = 62.0 + 6.0 * t_init
    shadow_cx, shadow_rx = compute_shadow(j)

    extra_attrs, prop_back, prop_front = render_equipment_props(
        eq_mode,
        spec,
        j,
        reg.prop_geometry,
        interactive=interactive,
    )
    forefoot_b, forefoot_f = _render_forefoot_lines(
        spec.get("forefoot"),
        j,
        interactive=interactive,
    )
    fixture_markup = render_fixture(
        spec["fixture"],
        t_init,
        eq_mode,
        interactive=interactive,
    )
    svg_open = _build_svg_open(
        arch,
        eq_mode,
        spec,
        extra_attrs,
        interactive=interactive,
    )

    neck_line = "  " + _svg_line(
        "js-neck",
        j["shoulder"],
        j["head"],
        'stroke="#cbd5e1" stroke-width="6.5" stroke-linecap="round"',
        interactive=interactive,
    )
    torso_line = (
        f"  <path{svg_class_attr('js-torso', interactive=interactive)} "
        f'd="M {j["hip"][0]:.2f} {j["hip"][1]:.2f} '
        f"Q {j['mid_spine'][0]:.2f} {j['mid_spine'][1]:.2f} "
        f'{j["shoulder"][0]:.2f} {j["shoulder"][1]:.2f}" fill="none" '
        'stroke="#f8fafc" stroke-width="11" stroke-linecap="round" '
        'stroke-linejoin="round" />'
    )
    head_line = (
        f"  <circle{svg_class_attr('js-head', interactive=interactive)} "
        f'cx="{j["head"][0]:.2f}" cy="{j["head"][1]:.2f}" r="11.5" '
        'fill="#34d399" stroke="#ecfdf5" stroke-width="1.6" />'
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
        (
            f"  <circle{svg_class_attr('js-aura', interactive=interactive)} "
            f'cx="{aura_cx}" cy="{aura_cy}" r="{aura_r:.2f}" '
            f'fill="url(#{grad_id})" />'
        ),
        (
            f"  <circle{svg_class_attr('js-ring', interactive=interactive)} "
            f'cx="{aura_cx}" cy="{aura_cy}" r="{ring_r:.2f}" fill="none" '
            'stroke="#34d399" stroke-opacity="0.14" stroke-width="1.2" '
            'stroke-dasharray="3 6" />'
        ),
        (
            '  <line x1="16" y1="175" x2="224" y2="175" stroke="#334155" '
            'stroke-width="3" stroke-linecap="round" />'
        ),
        (
            f"  <ellipse{svg_class_attr('js-shadow', interactive=interactive)} "
            f'cx="{shadow_cx:.2f}" cy="176" rx="{shadow_rx:.2f}" ry="3.5" '
            'fill="#10b981" fill-opacity="0.22" />'
        ),
        f"  {fixture_markup}",
        '  <g stroke="#64748b" stroke-width="8" stroke-linecap="round">',
        "    "
        + _svg_line("js-thigh-b", j["hip_b"], j["knee_b"], interactive=interactive),
        "    "
        + _svg_line("js-shin-b", j["knee_b"], j["foot_b"], interactive=interactive),
        f"    {forefoot_b}",
        "    "
        + _svg_line(
            "js-uarm-b", j["shoulder_b"], j["elbow_b"], interactive=interactive
        ),
        "    "
        + _svg_line("js-farm-b", j["elbow_b"], j["hand_b"], interactive=interactive),
        "  </g>",
        f"  {prop_back}",
        '  <g stroke="#e2e8f0" stroke-width="9.5" stroke-linecap="round">',
        "    "
        + _svg_line("js-thigh-f", j["hip"], j["knee_f"], interactive=interactive),
        "    "
        + _svg_line("js-shin-f", j["knee_f"], j["foot_f"], interactive=interactive),
        f"    {forefoot_f}",
        "  </g>",
        neck_line,
        torso_line,
        '  <g stroke="#34d399" stroke-width="8.8" stroke-linecap="round">',
        "    "
        + _svg_line("js-uarm-f", j["shoulder"], j["elbow_f"], interactive=interactive),
        "    "
        + _svg_line("js-farm-f", j["elbow_f"], j["hand_f"], interactive=interactive),
        "  </g>",
        '  <g fill="#0f172a" stroke="#34d399" stroke-width="1.6">',
        _joint_marker("js-j-shoulder", j["shoulder"], "3", interactive=interactive),
        _joint_marker("js-j-hip", j["hip"], "3", interactive=interactive),
        _joint_marker("js-j-knee", j["knee_f"], "2.8", interactive=interactive),
        _joint_marker("js-j-elbow", j["elbow_f"], "2.8", interactive=interactive),
        "  </g>",
        head_line,
        f"  {prop_front}",
        "</svg>",
        "",
    ]
    return "\n".join(lines)
