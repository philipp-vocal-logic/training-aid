# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog, coaching, kinematic rig, safe-grip, and static PWA audit."""

from __future__ import annotations

import contextlib
import os
import sys
import tempfile
from pathlib import Path

from training_aid.audit.catalog_checks import (
    audit_catalog_and_pwa_bundle,
    audit_coaching_integration,
    audit_programs_config,
)
from training_aid.audit.models import (
    DATA_DIR,
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_CATALOG_COUNT,
    EXPECTED_SVG_COMBO_COUNT,
    PWA_DIR,
    REPO_ROOT,
    AuditConfig,
    AuditReport,
    AuditSectionResult,
)
from training_aid.audit.node_runner import (
    find_node_binary,
    verify_pwa_bundle_with_node,
)
from training_aid.audit.rig_checks import (
    audit_animations_and_safe_grip,
    verify_motion_js_safe_grip,
)

with contextlib.suppress(ModuleNotFoundError):
    from training_aid.kinematics import load_animation_registry

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
    "find_node_binary",
    "main",
    "run_catalog_audit",
    "verify_motion_js_safe_grip",
    "verify_pwa_bundle_with_node",
]


def run_catalog_audit(
    config: AuditConfig | None = None,
    dist_dir: Path | None = None,
) -> AuditReport:
    """Run exhaustive end-to-end checks across all 876 exercises and the static PWA."""
    cfg = config or AuditConfig()
    registry = load_animation_registry(cfg.animations_path)
    specs = registry.specs
    env_dist = os.environ.get("TA_DIST_DIR") if config is None else None
    resolved_dist = dist_dir or (Path(env_dist) if env_dist else None)

    with tempfile.TemporaryDirectory(prefix="training_aid_audit_") as tmp_str:
        reuse = (
            resolved_dist is not None
            and (resolved_dist / "data" / "catalog.json").is_file()
        )
        target = (
            resolved_dist
            if (reuse and resolved_dist is not None)
            else Path(tmp_str) / "dist"
        )
        sec_bundle, exercises, catalog = audit_catalog_and_pwa_bundle(
            cfg, target, reuse=reuse
        )
        sec_coaching = audit_coaching_integration(exercises, catalog, registry)
        sec_rig = audit_animations_and_safe_grip(
            cfg, exercises, target, catalog, registry
        )
        pwa_errors = audit_programs_config(cfg, {ex.id: ex for ex in exercises}, specs)
        pwa_errors.extend(verify_pwa_bundle_with_node(target))
        sec_pwa = AuditSectionResult(
            "pwa_programs_and_node_e2e", len(exercises), tuple(pwa_errors)
        )
        return AuditReport(
            len(exercises),
            len(specs),
            (sec_bundle, sec_coaching, sec_rig, sec_pwa),
        )


def main() -> None:
    """Execute `run_catalog_audit()` as a CLI check and exit non-zero on any failure."""
    report = run_catalog_audit()
    header = (
        f"Training Aid Audit — {report.exercise_count} ex, "
        f"{report.archetype_count} arch\n"
    )
    sys.stdout.write(header)
    for sec in report.sections:
        status = "PASS" if sec.passed else f"FAIL ({len(sec.errors)} errors)"
        sys.stdout.write(f"  [{status}] {sec.name} (checked={sec.checked})\n")
    if not report.passed:
        for err in report.errors:
            sys.stderr.write(f"  - {err}\n")
        raise SystemExit(1)
    sys.stdout.write("All E2E catalog, coaching, rig, and static PWA checks PASSED.\n")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
