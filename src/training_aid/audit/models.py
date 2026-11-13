# Copyright (c) 2026 Philipp Kaaden
"""Configuration and result data models for the Training Aid static PWA audit."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"
PWA_DIR = REPO_ROOT / "src" / "training_aid" / "pwa"

EXPECTED_CATALOG_COUNT = 876
EXPECTED_ARCHETYPE_COUNT = 25
EXPECTED_SVG_COMBO_COUNT = 175

__all__ = [
    "DATA_DIR",
    "EXPECTED_ARCHETYPE_COUNT",
    "EXPECTED_CATALOG_COUNT",
    "EXPECTED_SVG_COMBO_COUNT",
    "PWA_DIR",
    "REPO_ROOT",
    "AuditConfig",
    "AuditReport",
    "AuditSectionResult",
]


@dataclass(frozen=True, slots=True)
class AuditConfig:
    """File-path configuration for the end-to-end static PWA audit."""

    exercises_path: Path = DATA_DIR / "exercises.json"
    animations_path: Path = DATA_DIR / "animations.json"
    programs_path: Path = DATA_DIR / "programs.json"
    pwa_dir: Path = PWA_DIR
    motion_js_path: Path | None = None
    expected_count: int = EXPECTED_CATALOG_COUNT

    def __post_init__(self) -> None:
        """Resolve default motion.js path inside pwa_dir when omitted."""
        if self.motion_js_path is None:
            object.__setattr__(
                self, "motion_js_path", self.pwa_dir / "rig" / "motion.js"
            )

    @property
    def resolved_motion_js_path(self) -> Path:
        """Return the concrete motion.js path to verify."""
        return self.motion_js_path or (self.pwa_dir / "rig" / "motion.js")


@dataclass(frozen=True, slots=True)
class AuditSectionResult:
    """Pass/fail status and diagnostic messages for a single audit section."""

    name: str
    checked: int
    errors: tuple[str, ...]

    @property
    def passed(self) -> bool:
        """Return True when the audit section recorded zero errors."""
        return len(self.errors) == 0


@dataclass(frozen=True, slots=True)
class AuditReport:
    """Aggregated end-to-end catalog, coaching, rig, and static PWA audit report."""

    exercise_count: int
    archetype_count: int
    sections: tuple[AuditSectionResult, ...]

    @property
    def errors(self) -> list[str]:
        """Return all error strings flattened across every audit section."""
        return [f"[{sec.name}] {err}" for sec in self.sections for err in sec.errors]

    @property
    def passed(self) -> bool:
        """Return True when every audit section passed with zero errors."""
        return all(sec.passed for sec in self.sections)
