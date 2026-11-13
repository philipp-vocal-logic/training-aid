# Copyright (c) 2026 Philipp Kaaden
"""Training Aid zero-backend static PWA package."""

from training_aid.cli import build_arg_parser, main
from training_aid.compiler import DEFAULT_DIST_DIR, build_pwa

__all__ = [
    "DEFAULT_DIST_DIR",
    "build_arg_parser",
    "build_pwa",
    "main",
]
