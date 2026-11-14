# Copyright (c) 2026 Philipp Kaaden
"""Integration tests for Training Aid static PWA bundle, CLI, and FK rig."""

from __future__ import annotations

import json
import os
import threading
import tomllib
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

import training_aid
from training_aid.audit import (
    EXPECTED_ARCHETYPE_COUNT,
    EXPECTED_CATALOG_COUNT,
    REPO_ROOT,
)
from training_aid.audit.catalog_checks import (
    VALID_REQUIRED_EQUIPMENT_IDS,
    _check_compiled_exercise_entry,
)
from training_aid.cli import NoCacheStaticRequestHandler
from training_aid.compiler import (
    CATALOG_SCHEMA_VERSION,
    build_exercise_metadata,
    build_pwa,
    compute_required_equipment,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.kinematics import (
    CANONICAL_EQUIPMENT_MODES,
    AnimationRegistry,
    compile_animation_spec,
    compute_shadow,
    lerp_pose,
    load_animation_registry,
    normalize_equipment,
    render_archetype_svg,
    solve_fk,
)
from training_aid.kinematics.svg_props import render_equipment_props

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
    "required_equipment",
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
    """Verify 1:1 static PWA bundle files, schema v2 catalog, and zero deps."""
    required_files = [
        "index.html",
        "manifest.webmanifest",
        "sw.js",
        "icon.svg",
        "app.js",
        "core/constants.js",
        "core/prescription.js",
        "core/catalog.js",
        "core/generator.js",
        "core/projections.js",
        "core/stats.js",
        "core/workout-engine.js",
        "state/codec.js",
        "state/store.js",
        "rig/motion.js",
        "audio/presets.js",
        "audio/pattern.js",
        "audio/synth.js",
        "audio/controller.js",
        "ui/dom.js",
        "ui/scope.js",
        "ui/fullscreen.js",
        "ui/wake-lock.js",
        "ui/preview-loop.js",
        "ui/modal.js",
        "ui/progress-chart.js",
        "ui/widgets.js",
        "views/setup.js",
        "views/plan.js",
        "views/quick.js",
        "views/edit.js",
        "views/workout.js",
        "views/progress.js",
        "styles/tokens.css",
        "styles/primitives.css",
        "styles/layout.css",
        "styles/workout.css",
        "styles/screens.css",
        "data/catalog.json",
    ]
    for rel in required_files:
        assert (built_pwa / rel).is_file(), f"Missing bundle file: {rel}"

    assert not (built_pwa / "static").exists()
    assert not (built_pwa / "qr.js").exists()
    registry = load_animation_registry()
    expected_svg_combos = len(registry.specs) * 7
    thumbs = list((built_pwa / "svgs" / "thumbs").glob("*.svg"))
    assert len(thumbs) == expected_svg_combos

    payload = json.loads((built_pwa / "data" / "catalog.json").read_text("utf-8"))
    assert payload["schema_version"] == CATALOG_SCHEMA_VERSION == 2
    assert set(payload["programs"].keys()) == {
        "equipment_programs",
        "intensity_labels",
    }
    assert len(payload["exercises"]) == EXPECTED_CATALOG_COUNT
    assert len(payload["svgs"]) == expected_svg_combos
    for svg_key, markup in payload["svgs"].items():
        assert ":" in svg_key
        assert markup.startswith("<svg")
        assert "data-pose-a=" in markup

    sample_ex = payload["exercises"][0]
    assert set(sample_ex.keys()) == EXPECTED_COMPILED_KEYS
    assert sample_ex["svg_key"] in payload["svgs"]
    assert isinstance(sample_ex["required_equipment"], list)
    assert str(sample_ex["thumb_url"]).removeprefix("./").startswith("svgs/thumbs/")

    by_id = {ex["id"]: ex for ex in payload["exercises"]}
    assert by_id["Pullups"]["required_equipment"] == ["pull_up_bar"]
    assert by_id["Band_Assisted_Pull-Up"]["required_equipment"] == [
        "pull_up_bar",
        "bands",
    ]
    assert by_id["Rope_Climb"]["required_equipment"] == ["__other__"]
    assert by_id["Bench_Dips"]["required_equipment"] == ["bench"]
    assert by_id["Dumbbell_Bench_Press"]["required_equipment"] == [
        "dumbbell",
        "bench",
    ]
    assert by_id["Bodyweight_Squat"]["required_equipment"] == []

    index_html = (built_pwa / "index.html").read_text("utf-8")
    assert "Content-Security-Policy" in index_html
    assert "default-src 'self'" in index_html
    assert "script-src 'self'" in index_html
    assert '<script type="module" src="./app.js"></script>' in index_html
    assert "<title>Training Aid" in index_html
    assert '<meta name="apple-mobile-web-app-title" content="Train" />' in index_html
    assert '<h1 class="boot-title">Training Aid</h1>' in index_html
    assert "toast-root" not in index_html

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
    """Serve built PWA via NoCacheStaticRequestHandler and verify headers & ?v= bust."""

    class QuietHandler(NoCacheStaticRequestHandler):
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
            "/?v=a1b2c3d4e5f6",
            "/index.html",
            "/sw.js",
            "/manifest.webmanifest",
            "/app.js",
            "/app.js?v=a1b2c3d4e5f6",
            "/ui/sw-update.js",
            "/core/constants.js",
            "/core/workout-engine.js",
            "/state/store.js",
            "/rig/motion.js",
            "/audio/controller.js",
            "/ui/dom.js",
            "/ui/fullscreen.js",
            "/views/workout.js",
            "/styles/tokens.css",
            "/data/catalog.json",
        ):
            with urlopen(f"{base}{route}", timeout=5) as resp:  # noqa: S310
                assert resp.status == 200
                assert resp.headers.get("Cache-Control") == "no-cache"
                assert len(resp.read()) > 0

        with urlopen(  # noqa: S310
            f"{base}/svgs/thumbs/squat__kettlebells.svg?v=v1-a1b2c3d4e5f6",
            timeout=5,
        ) as resp:
            body = resp.read()
            assert resp.status == 200
            assert resp.headers.get("Cache-Control") == "no-cache"
            assert b"<svg" in body
            assert b'data-equipment="kettlebells"' in body
            assert b"js-kb-handle-f" not in body
            assert b"data-pose-a" not in body

        for missing_route in ("/qr.js", "/svgs/thumbs/nonexistent.svg"):
            with pytest.raises(HTTPError) as exc_info:
                urlopen(f"{base}{missing_route}", timeout=5)  # noqa: S310
            assert exc_info.value.code == 404
    finally:
        server.shutdown()
        server.server_close()


def test_fk_rig_kinematics_and_lean_thumbnails() -> None:
    """Verify Python 2D FK rig solver, coaching metadata, and lean thumbnails."""
    registry = load_animation_registry()
    specs = registry.specs
    arch_coaching = registry.coaching
    assert len(specs) == EXPECTED_ARCHETYPE_COUNT
    assert set(arch_coaching.keys()) == set(specs.keys())
    assert {"barbell", "dumbbell", "kettlebells"} <= set(registry.prop_geometry.keys())

    catalog = load_catalog_exercises()
    assert len(catalog) == EXPECTED_CATALOG_COUNT
    programs = load_programs_config()
    assert set(programs.keys()) == {"equipment_programs", "intensity_labels"}

    sample = catalog[0]
    meta = build_exercise_metadata(
        sample,
        archetype_coaching=arch_coaching,
    )
    assert meta["archetype"] == sample.archetype
    assert meta["how_to"]
    assert meta["cue_work"]
    assert meta["cue_return"]
    assert isinstance(compute_required_equipment(sample), list)
    assert normalize_equipment("kettlebells", "squat", registry=registry) == (
        "kettlebells"
    )

    for arch_name in ("squat", "plank", "hinge"):
        spec = specs[arch_name]
        pose_mid = lerp_pose(spec["pose_a"], spec["pose_b"], 0.5)
        joints = solve_fk(spec["bones"], pose_mid)
        sh_cx, sh_rx = compute_shadow(joints)
        assert sh_rx >= 22.0
        assert 40.0 <= sh_cx <= 200.0

    for eq_mode in CANONICAL_EQUIPMENT_MODES:
        full_svg = render_archetype_svg(
            "squat", equipment=eq_mode, thumbnail=False, registry=registry
        )
        thumb_svg = render_archetype_svg(
            "squat", equipment=eq_mode, thumbnail=True, registry=registry
        )
        assert "data-pose-a=" in full_svg
        assert 'class="js-' in full_svg
        assert "data-pose-a=" not in thumb_svg
        assert 'class="js-' not in thumb_svg
        assert len(thumb_svg) < len(full_svg)


def _make_front_test_spec(std_bones: dict[str, float]) -> dict[str, object]:
    front_cfg = {
        "label": "Front Fly Test",
        "view": "front",
        "fixture": None,
        "default_equipment": "bands",
        "bar_mode": "hands",
        "hold_style": "settle",
        "band_anchor": [120.0, 74.0],
        "band_target": "span",
        "cable_anchor": [92.0, 74.0],
        "cable_target": "hand",
        "coaching": {
            "rep_seconds": 2.4,
            "is_hold": False,
            "how_to": "Test cue",
            "cue_work": "Pull",
            "cue_return": "Return",
            "tempo_mode": "standard",
        },
        "pose_a": {
            "hip": [120.0, 102.0],
            "spine": [-90.0, -90.0, -90.0],
            "arm_f": {"target": [134.0, 74.0], "bend_sign": 1},
            "arm_b": {"target": [106.0, 74.0], "bend_sign": -1},
            "leg_f": [90.0, 90.0],
            "leg_b": [90.0, 90.0],
        },
        "pose_b": {
            "hip": [116.0, 102.0],
            "spine": [-90.0, -90.0, -90.0],
            "arm_f": {"target": [176.0, 70.0], "bend_sign": 1},
            "arm_b": {"target": [64.0, 70.0], "bend_sign": -1},
            "leg_f": [86.0, 90.0],
            "leg_b": [94.0, 90.0],
        },
    }
    return compile_animation_spec(front_cfg, std_bones)


def test_front_view_ik_and_fk_sockets() -> None:
    """Verify coronal front-view IK/FK bilateral sockets, swap_sides, and shadow."""
    base_reg = load_animation_registry()
    spec = _make_front_test_spec(dict(base_reg.std_bones))
    assert spec["view"] == "front"

    joints_b = solve_fk(spec["bones"], spec["pose_b"], view="front")
    assert joints_b["shoulder_f"][0] == pytest.approx(116.0 + 14.5)
    assert joints_b["shoulder_b"][0] == pytest.approx(116.0 - 14.5)
    assert joints_b["hip_f"][0] == pytest.approx(116.0 + 9.5)
    assert joints_b["hip_b"][0] == pytest.approx(116.0 - 9.5)
    assert joints_b["hand_f"][0] == pytest.approx(176.0, abs=0.5)
    assert joints_b["hand_b"][0] == pytest.approx(64.0, abs=0.5)

    swapped = solve_fk(spec["bones"], spec["pose_b"], swap_sides=True, view="front")
    assert swapped["hip"][0] == pytest.approx(240.0 - joints_b["hip"][0])
    assert swapped["head"][0] == pytest.approx(240.0 - joints_b["head"][0])
    assert swapped["shoulder_f"][0] == pytest.approx(240.0 - joints_b["shoulder_b"][0])
    assert swapped["hip_f"][0] == pytest.approx(240.0 - joints_b["hip_b"][0])
    assert swapped["hand_f"][0] == pytest.approx(240.0 - joints_b["hand_b"][0])
    assert swapped["hand_f"][1] == pytest.approx(joints_b["hand_b"][1])

    side_joints = solve_fk(
        base_reg.specs["squat"]["bones"],
        base_reg.specs["squat"]["pose_a"],
    )
    assert side_joints["hip_f"] == side_joints["hip"]
    assert side_joints["shoulder_f"] == side_joints["shoulder"]

    sym_joints = solve_fk(spec["bones"], spec["pose_a"], view="front")
    sym_cx, _ = compute_shadow(sym_joints)
    assert sym_cx == pytest.approx(120.0, abs=0.6)


def test_front_view_svg_and_props() -> None:
    """Verify front-view SVG layers, thumbnails, barbell shaft, and span bands."""
    base_reg = load_animation_registry()
    spec = _make_front_test_spec(dict(base_reg.std_bones))
    joints_b = solve_fk(spec["bones"], spec["pose_b"], view="front")

    synth_reg = AnimationRegistry(
        std_bones=base_reg.std_bones,
        prop_geometry=base_reg.prop_geometry,
        equipment_aliases=base_reg.equipment_aliases,
        specs={**base_reg.specs, "front_test": spec},
        coaching={**base_reg.coaching, "front_test": dict(spec["coaching"])},
    )
    front_svg = render_archetype_svg(
        "front_test", equipment="bands", thumbnail=False, registry=synth_reg
    )
    front_thumb = render_archetype_svg(
        "front_test", equipment="bands", thumbnail=True, registry=synth_reg
    )
    side_svg = render_archetype_svg(
        "squat", equipment="barbell", thumbnail=False, registry=synth_reg
    )
    assert 'data-view="front"' in front_svg
    assert 'data-view="front"' in front_thumb
    assert "data-view=" not in side_svg
    for cls_name in (
        "js-clavicle",
        "js-pelvis",
        "js-j-shoulder-b",
        "js-j-hip-b",
        "js-j-knee-b",
        "js-j-elbow-b",
    ):
        assert cls_name in front_svg
        assert cls_name not in front_thumb
    assert 'data-band-target="span"' in front_svg
    assert '<circle cx="120.00" cy="74.00" r="3.5"' not in front_svg

    bb_attrs, bb_back, _ = render_equipment_props(
        "barbell",
        spec,
        joints_b,
        base_reg.prop_geometry,
        interactive=True,
    )
    assert 'data-equipment="barbell"' in bb_attrs
    assert f'x1="{joints_b["hand_b"][0] - 8.0:.2f}"' in bb_back
    assert f'y1="{joints_b["hand_b"][1]:.2f}"' in bb_back
    assert f'x2="{joints_b["hand_f"][0] + 8.0:.2f}"' in bb_back
    assert f'y2="{joints_b["hand_f"][1]:.2f}"' in bb_back

    crossed_joints = {
        **joints_b,
        "hand_f": (70.0, 70.0),
        "hand_b": (170.0, 70.0),
    }
    _, cr_bb_back, _ = render_equipment_props(
        "barbell",
        spec,
        crossed_joints,
        base_reg.prop_geometry,
        interactive=True,
    )
    assert 'x1="62.00"' in cr_bb_back
    assert 'x2="178.00"' in cr_bb_back

    shoulder_spec = {**spec, "band_target": "shoulder"}
    _, sh_back, sh_front = render_equipment_props(
        "bands",
        shoulder_spec,
        joints_b,
        base_reg.prop_geometry,
        interactive=True,
    )
    assert f'x2="{joints_b["shoulder_b"][0]:.2f}"' in sh_back
    assert f'x2="{joints_b["shoulder_f"][0]:.2f}"' in sh_front


def test_pull_up_closed_chain_kinematics_and_fixture() -> None:
    """Verify pull_up overhead bar fixture, grip coordinates, and airborne motion."""
    reg = load_animation_registry()
    spec = reg.specs["pull_up"]
    assert spec["view"] == "front"
    assert spec["fixture"] == "pullup_bar"
    assert spec["pose_b"]["hip_y"] < spec["pose_a"]["hip_y"] - 25.0

    joints_a = solve_fk(spec["bones"], spec["pose_a"], view="front")
    joints_b = solve_fk(spec["bones"], spec["pose_b"], view="front")
    assert joints_a["hand_f"] == pytest.approx((146.0, 28.0), abs=0.2)
    assert joints_a["hand_b"] == pytest.approx((94.0, 28.0), abs=0.2)
    assert joints_b["hand_f"] == pytest.approx((146.0, 28.0), abs=0.2)
    assert joints_b["hand_b"] == pytest.approx((94.0, 28.0), abs=0.2)
    assert 11.5 <= joints_b["head"][1] < 28.0

    for eq_mode in CANONICAL_EQUIPMENT_MODES:
        for alpha in (0.0, 0.25, 0.5, 0.75, 1.0):
            pose = lerp_pose(spec["pose_a"], spec["pose_b"], alpha)
            joints = solve_fk(spec["bones"], pose, view="front")
            assert joints["elbow_f"][0] > 134.5
            assert joints["elbow_b"][0] < 105.5
            assert joints["foot_f"][1] < 174.0
            assert joints["foot_b"][1] < 174.0
        svg = render_archetype_svg(
            "pull_up", equipment=eq_mode, thumbnail=False, registry=reg
        )
        assert 'y1="28" x2="182" y2="28"' in svg
        assert "<rect" not in svg


def test_compute_required_equipment_chest_fly_bench_rules(tmp_path: Path) -> None:
    """Verify equipment-aware 'bench' inference, consolidation, and ID checks."""
    by_id = {ex.id: ex for ex in load_catalog_exercises()}
    expected_by_id: dict[str, list[str]] = {
        "Standing_Cable_Chest_Press": ["machine"],
        "Cable_Chest_Press": ["machine"],
        "Cable_Crossover": ["machine"],
        "Cross_Over_-_With_Bands": ["bands"],
        "Leverage_Chest_Press": ["machine"],
        "Machine_Bench_Press": ["machine"],
        "Dip_Machine": ["machine"],
        "Butterfly": ["machine"],
        "Medicine_Ball_Chest_Pass": ["__other__"],
        "Supine_Chest_Throw": ["__other__"],
        "Chest_Stretch_on_Stability_Ball": ["__other__"],
        "Adductor": ["__other__"],
        "Ab_Roller": ["__other__"],
        "Jerk_Dip_Squat": ["barbell"],
        "Dumbbell_Floor_Press": ["dumbbell"],
        "Bench_Dips": ["bench"],
        "Dips_-_Triceps_Version": ["bench"],
        "Dumbbell_Bench_Press": ["dumbbell", "bench"],
        "Barbell_Bench_Press_-_Medium_Grip": ["barbell", "bench"],
        "Dumbbell_Flyes": ["dumbbell", "bench"],
        "Incline_Dumbbell_Flyes": ["dumbbell", "bench"],
        "Decline_Dumbbell_Flyes": ["dumbbell", "bench"],
        "Around_The_Worlds": ["dumbbell", "bench"],
        "Incline_Cable_Chest_Press": ["machine", "bench"],
        "Flat_Bench_Cable_Flyes": ["machine", "bench"],
        "Bench_Press_-_With_Bands": ["bands", "bench"],
        "Gironda_Sternum_Chins": ["pull_up_bar"],
        "Weighted_Pull_Ups": ["pull_up_bar"],
        "One_Handed_Hang": ["pull_up_bar"],
        "Muscle_Up": ["pull_up_bar"],
        "Band_Assisted_Pull-Up": ["pull_up_bar", "bands"],
        "Rope_Climb": ["__other__"],
    }
    for ex_id, expected in expected_by_id.items():
        assert ex_id in by_id, f"Missing catalog exercise: {ex_id}"
        assert compute_required_equipment(by_id[ex_id]) == expected, ex_id
        assert set(expected) <= VALID_REQUIRED_EQUIPMENT_IDS

    thumb = tmp_path / "svgs" / "thumbs" / "squat__body_only.svg"
    thumb.parent.mkdir(parents=True, exist_ok=True)
    thumb.write_text("<svg/>", encoding="utf-8")
    bad_entry = {
        "id": "Bad_Ex",
        "name": "Bad Ex",
        "category": "strength",
        "equipment": "medicine ball",
        "primary_muscle": "chest",
        "archetype": "squat",
        "eq_mode": "body_only",
        "svg_key": "squat:body_only",
        "thumb_url": "./svgs/thumbs/squat__body_only.svg",
        "rep_seconds": 2.0,
        "is_hold": False,
        "unit": "reps",
        "how_to": "Move",
        "cue_work": "Work",
        "cue_return": "Return",
        "tempo_mode": "standard",
        "is_alternating": False,
        "required_equipment": ["medicine_ball"],
    }
    errs = _check_compiled_exercise_entry(
        bad_entry, {"squat:body_only": "<svg/>"}, tmp_path
    )
    assert any("invalid required_equipment IDs" in err for err in errs)
