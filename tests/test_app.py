# Copyright (c) 2026 Philipp Kaaden
"""Integration tests for Training Aid static PWA bundle, CLI, and FK rig."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import tomllib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

import training_aid
from training_aid.audit import (
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_CATALOG_COUNT,
    EXPECTED_SVG_COMBO_COUNT,
    REPO_ROOT,
    find_node_binary,
)
from training_aid.builder import (
    CANONICAL_EQUIPMENT_MODES,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.coaching import (
    build_exercise_metadata,
    load_archetype_coaching,
)
from training_aid.svg_assets import (
    compute_shadow,
    lerp_pose,
    load_animation_registry,
    normalize_equipment,
    render_archetype_svg,
    solve_fk,
)

EXPECTED_COMPILED_KEYS: set[str] = {
    "id",
    "name",
    "category",
    "equipment",
    "primary_muscle",
    "archetype",
    "eq_mode",
    "svg_key",
    "thumb_url",
    "rep_seconds",
    "is_hold",
    "unit",
    "how_to",
    "cue_work",
    "cue_return",
    "tempo_mode",
    "is_alternating",
}


@pytest.fixture(scope="module")
def built_pwa(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Reuse TA_DIST_DIR when set, or build the static PWA once per module."""
    env_dist = os.environ.get("TA_DIST_DIR")
    if env_dist:
        dist_path = Path(env_dist)
        if (dist_path / "data" / "catalog.json").is_file():
            return dist_path
    out_dir = tmp_path_factory.mktemp("pwa_dist") / "dist"
    summary = build_pwa(out_dir)
    return Path(summary["output_dir"])


def test_build_pwa_static_bundle_and_catalog_schema(built_pwa: Path) -> None:
    """Verify static PWA bundle files, compiled catalog schema, and zero deps."""
    required_files = [
        "index.html",
        "manifest.webmanifest",
        "sw.js",
        "icon.svg",
        "domain.js",
        "recommender.js",
        "codec.js",
        "store.js",
        "qr.js",
        "dom.js",
        "views/setup.js",
        "views/plan.js",
        "views/quick.js",
        "views/edit.js",
        "views/workout.js",
        "views/progress.js",
        "app.js",
        "static/style.css",
        "static/motion.js",
        "static/sound-presets.js",
        "static/sound-pattern.js",
        "static/sound-synth.js",
        "static/sound.js",
        "data/catalog.json",
    ]
    for rel in required_files:
        assert (built_pwa / rel).is_file(), f"Missing bundle file: {rel}"

    assert not (built_pwa / "static" / "svgs").exists()
    thumbs = list((built_pwa / "svgs" / "thumbs").glob("*.svg"))
    assert len(thumbs) == EXPECTED_SVG_COMBO_COUNT

    payload = json.loads((built_pwa / "data" / "catalog.json").read_text("utf-8"))
    assert payload["schema_version"] == 1
    assert len(payload["exercises"]) == EXPECTED_CATALOG_COUNT
    assert len(payload["svgs"]) == EXPECTED_SVG_COMBO_COUNT
    for svg_key, markup in payload["svgs"].items():
        assert ":" in svg_key
        assert markup.startswith("<svg")
        assert "data-pose-a=" in markup

    sample_ex = payload["exercises"][0]
    assert set(sample_ex.keys()) == EXPECTED_COMPILED_KEYS
    assert sample_ex["svg_key"] in payload["svgs"]
    assert str(sample_ex["thumb_url"]).removeprefix("./").startswith("svgs/thumbs/")

    index_html = (built_pwa / "index.html").read_text("utf-8")
    assert "Content-Security-Policy" in index_html
    assert "default-src 'self'" in index_html
    assert "script-src 'self'" in index_html

    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text("utf-8"))
    assert pyproject["project"]["dependencies"] == []
    assert pyproject["tool"]["ruff"]["lint"]["select"] == ["ALL"]


def test_cli_build_only_entrypoint(tmp_path: Path) -> None:
    """Verify the training-aid CLI parser and --build-only execution."""
    parser = training_aid.build_arg_parser()
    args = parser.parse_args(["--build-only", "--out-dir", str(tmp_path / "out")])
    assert args.build_only is True

    rc = training_aid.main(["--build-only", "--out-dir", str(tmp_path / "cli_dist")])
    assert rc == 0
    assert (tmp_path / "cli_dist" / "data" / "catalog.json").is_file()


def test_live_threading_http_server_static_serving(built_pwa: Path) -> None:
    """Serve the built PWA over ThreadingHTTPServer and verify static routes."""

    class QuietHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=str(built_pwa), **kwargs)

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    try:
        for route in (
            "/",
            "/index.html",
            "/sw.js",
            "/manifest.webmanifest",
            "/domain.js",
            "/codec.js",
            "/store.js",
            "/qr.js",
            "/dom.js",
            "/views/workout.js",
            "/app.js",
            "/static/style.css",
            "/static/motion.js",
            "/static/sound-presets.js",
            "/static/sound-pattern.js",
            "/static/sound-synth.js",
            "/static/sound.js",
            "/data/catalog.json",
        ):
            with urlopen(f"{base}{route}", timeout=5) as resp:  # noqa: S310
                assert resp.status == 200
                assert len(resp.read()) > 0

        with urlopen(  # noqa: S310
            f"{base}/svgs/thumbs/squat__kettlebells.svg", timeout=5
        ) as resp:
            body = resp.read()
            assert resp.status == 200
            assert b"<svg" in body
            assert b'data-equipment="kettlebells"' in body
            assert b"js-kb-handle-f" not in body
            assert b"data-pose-a" not in body

        with pytest.raises(HTTPError) as exc_info:
            urlopen(f"{base}/svgs/thumbs/nonexistent.svg", timeout=5)  # noqa: S310
        assert exc_info.value.code == 404
    finally:
        server.shutdown()
        server.server_close()


def test_node_standalone_test_suites(built_pwa: Path) -> None:
    """Execute the standalone Node test suites against the built PWA bundle."""
    node_bin = find_node_binary()
    assert node_bin is not None, "Node binary is required for client JS test suites"
    env = {**os.environ, "TA_DIST_DIR": str(built_pwa)}
    proc = subprocess.run(  # noqa: S603
        [
            node_bin,
            "--test",
            str(REPO_ROOT / "tests" / "pwa_store_qr.test.cjs"),
            str(REPO_ROOT / "tests" / "pwa_ui_audio.test.cjs"),
            str(REPO_ROOT / "tests" / "pwa_sound_layers.test.cjs"),
        ],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert proc.returncode == 0, f"Node tests failed:\n{proc.stdout}\n{proc.stderr}"


def test_fk_rig_kinematics_and_lean_thumbnails() -> None:
    """Verify Python 2D FK rig solver, coaching metadata, and lean thumbnails."""
    _std_bones, _aliases, specs = load_animation_registry()
    assert len(specs) == EXPECTED_ARCHETYPE_COUNT

    arch_coaching = load_archetype_coaching()
    assert set(arch_coaching.keys()) == set(specs.keys())
    assert not (REPO_ROOT / "data" / "exercise_coaching.json").exists()

    catalog = load_catalog_exercises()
    assert len(catalog) == EXPECTED_CATALOG_COUNT
    programs = load_programs_config()
    assert "equipment_programs" in programs
    assert "setup_equipment_props" in programs

    sample = catalog[0]
    meta = build_exercise_metadata(
        sample,
        archetype_coaching=arch_coaching,
    )
    assert meta["archetype"] == sample.archetype
    assert meta["how_to"]
    assert meta["cue_work"]
    assert meta["cue_return"]
    assert normalize_equipment("kettlebells", "squat") == "kettlebells"

    for arch_name in ("squat", "plank", "hinge"):
        spec = specs[arch_name]
        pose_mid = lerp_pose(spec["pose_a"], spec["pose_b"], 0.5)
        joints = solve_fk(spec["bones"], pose_mid)
        sh_cx, sh_rx = compute_shadow(joints)
        assert sh_rx >= 22.0
        assert 40.0 <= sh_cx <= 200.0

    for eq_mode in CANONICAL_EQUIPMENT_MODES:
        full_svg = render_archetype_svg("squat", equipment=eq_mode, thumbnail=False)
        thumb_svg = render_archetype_svg("squat", equipment=eq_mode, thumbnail=True)
        assert "data-pose-a=" in full_svg
        assert 'class="js-' in full_svg
        assert "data-pose-a=" not in thumb_svg
        assert 'class="js-' not in thumb_svg
        assert len(thumb_svg) < len(full_svg)
