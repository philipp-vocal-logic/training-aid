# Copyright (c) 2026 Philipp Kaaden
"""Node.js binary discovery and standalone ES module test suite runner."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from training_aid.audit.models import REPO_ROOT

__all__ = [
    "find_node_binary",
    "run_node_command",
    "verify_pwa_bundle_with_node",
]


def find_node_binary() -> str | None:
    """Locate a Node.js executable on PATH or under standard user-local directories."""
    env_bin = os.environ.get("TA_NODE_BIN")
    if env_bin and Path(env_bin).is_file() and os.access(env_bin, os.X_OK):
        return env_bin
    if which_bin := shutil.which("node"):
        return which_bin
    home = Path.home()
    roots = (home / ".local" / "share", home / ".nvm" / "versions" / "node")
    for base_dir, pattern in zip(
        roots, ("*/node-v*/bin/node", "*/bin/node"), strict=True
    ):
        if base_dir.is_dir():
            for candidate in sorted(base_dir.glob(pattern), reverse=True):
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return str(candidate)
    return None


def run_node_command(
    args: list[str],
    env: dict[str, str],
    *,
    timeout: int = 60,
) -> subprocess.CompletedProcess[str]:
    """Run a Node.js subprocess with captured stdout/stderr and timeout."""
    kwargs: dict[str, Any] = {
        "env": env,
        "capture_output": True,
        "text": True,
    }
    return subprocess.run(args, check=False, timeout=timeout, **kwargs)  # noqa: S603


def verify_pwa_bundle_with_node(dist_dir: Path) -> list[str]:
    """Run standalone Node.js ES module test suites against a compiled PWA directory."""
    node_bin = find_node_binary()
    if node_bin is None:
        return ["Node.js binary not found for static PWA E2E suite"]

    tests_dir = REPO_ROOT / "tests"
    suites = [str(p) for p in sorted(tests_dir.glob("*.test.mjs"))]
    if not suites:
        return ["No *.test.mjs test suites discovered in tests/"]

    env = {**os.environ, "TA_DIST_DIR": str(dist_dir)}
    proc = run_node_command([node_bin, "--test", *suites], env)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        return [f"Node PWA E2E failed:\n{detail}"]
    return []
