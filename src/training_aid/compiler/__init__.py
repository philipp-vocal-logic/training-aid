# Copyright (c) 2026 Philipp Kaaden
"""Static PWA compiler, catalog builder, and Service Worker stamper."""

from training_aid.compiler.bundler import (
    DEFAULT_DIST_DIR,
    PWA_SRC_DIR,
    build_pwa,
    stamp_service_worker,
)
from training_aid.compiler.catalog_builder import (
    CATALOG_SCHEMA_VERSION,
    DATA_DIR,
    DEFAULT_ANIMATIONS_JSON,
    DEFAULT_EXERCISES_JSON,
    DEFAULT_PROGRAMS_JSON,
    build_catalog_payload,
    compute_required_equipment,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.compiler.coaching import CatalogExercise, build_exercise_metadata

__all__ = [
    "CATALOG_SCHEMA_VERSION",
    "DATA_DIR",
    "DEFAULT_ANIMATIONS_JSON",
    "DEFAULT_DIST_DIR",
    "DEFAULT_EXERCISES_JSON",
    "DEFAULT_PROGRAMS_JSON",
    "PWA_SRC_DIR",
    "CatalogExercise",
    "build_catalog_payload",
    "build_exercise_metadata",
    "build_pwa",
    "compute_required_equipment",
    "load_catalog_exercises",
    "load_programs_config",
    "stamp_service_worker",
]
