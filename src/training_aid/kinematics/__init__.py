# Copyright (c) 2026 Philipp Kaaden
"""2D human kinematics, IK pose compilation, and SVG rig rendering."""

from training_aid.kinematics.fk_solver import (
    BONE_KEYS,
    POSE_KEYS,
    Point,
    compute_aura_center,
    compute_shadow,
    lerp_pose,
    solve_fk,
)
from training_aid.kinematics.ik_compiler import compile_animation_spec
from training_aid.kinematics.registry import (
    ANIMATIONS_JSON,
    CANONICAL_EQUIPMENT_MODES,
    AnimationRegistry,
    load_animation_registry,
    normalize_equipment,
)
from training_aid.kinematics.svg_renderer import render_archetype_svg

__all__ = [
    "ANIMATIONS_JSON",
    "BONE_KEYS",
    "CANONICAL_EQUIPMENT_MODES",
    "POSE_KEYS",
    "AnimationRegistry",
    "Point",
    "compile_animation_spec",
    "compute_aura_center",
    "compute_shadow",
    "lerp_pose",
    "load_animation_registry",
    "normalize_equipment",
    "render_archetype_svg",
    "solve_fk",
]
