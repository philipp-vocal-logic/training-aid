# Copyright (c) 2026 Philipp Kaaden
"""Static PWA compilation, HTTP serving, Node E2E, kinematic, and audio test suite."""

from __future__ import annotations

import functools
import json
import math
import os
import re
import subprocess
import threading
import tomllib
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

import training_aid
from training_aid.audit import find_node_binary
from training_aid.builder import (
    CANONICAL_EQUIPMENT_MODES,
    CATALOG_SCHEMA_VERSION,
    CatalogExercise,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.coaching import (
    ARCHETYPE_COACHING,
    EXERCISE_COACHING,
    build_exercise_guidance,
    classify_archetype,
    is_hold_exercise,
)
from training_aid.svg_assets import (
    ANIMATIONS_JSON,
    ARCHETYPE_SPECS,
    BONE_KEYS,
    POSE_KEYS,
    STD_BONES,
    SVGS_DIR,
    compile_animation_spec,
    compute_shadow,
    evaluate_archetype_pose,
    lerp_pose,
    load_svg_markup,
    normalize_equipment,
    pregenerate_all_svgs,
    render_archetype_svg,
    solve_fk,
)

if TYPE_CHECKING:
    from collections.abc import Generator

REPO_ROOT = Path(__file__).resolve().parents[1]

_EXPECTED_SOUND_THEMES: tuple[tuple[str, str], ...] = (
    ("off", "Off"),
    ("minimal", "Minimal Cues"),
    ("techno", "Techno Pulse"),
    ("trance", "Trance Arp"),
    ("studio", "Studio Kit"),
)

_EXPECTED_SOUND_SCALE: dict[str, float] = {
    "A2": 110.0,
    "C3": 130.81,
    "D3": 146.83,
    "E3": 164.81,
    "G3": 196.0,
    "A3": 220.0,
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "G4": 392.0,
    "A4": 440.0,
    "C5": 523.25,
    "E5": 659.25,
}

_TURNAROUND_BY_MODE: dict[str, float] = {
    "standard": 0.43,
    "explosive": 0.31,
    "alternating": 0.5,
    "hold": 1.0,
}

_PWA_INTEGRATION_HARNESS = """\
const fs = require("node:fs");
const path = require("node:path");
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

(async () => {
  const distDir = process.env.TA_DIST_DIR;
  const catalog = JSON.parse(
    fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8")
  );
  const storeMod = require(path.join(distDir, "store.js"));
  const qrMod = require(path.join(distDir, "qr.js"));

  function makeStorage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => { map.set(String(k), String(v)); },
      removeItem: (k) => { map.delete(String(k)); },
      clear: () => { map.clear(); },
    };
  }

  // 1. Tailored body_only light 2x/week onboarding
  const bwStore = storeMod.createStore({ storage: makeStorage(), catalog });
  assert(bwStore.hasActivePlan() === false, "fresh store must have no active plan");
  const bwState = bwStore.setupPlan({
    name: "Philipp",
    equipment: "body_only",
    starting_intensity: "light",
    days_per_week: 2,
  });
  assert(bwStore.hasActivePlan() === true, "plan must be active after setupPlan");
  assert(bwState.profile.equipment === "body_only", "equipment mismatch");
  assert(bwState.profile.starting_intensity === "light", "intensity mismatch");
  assert(bwState.profile.weekly_goal === 2, "weekly_goal mismatch");
  assert(bwState.plan.name === "Body Only Plan (2x/Week)", "plan name mismatch");
  assert(bwState.plan.routines.length === 2, "expected 2 routines");
  for (const ex of bwState.plan.routines[0].exercises) {
    assert(ex.sets === 2, "light intensity must use 2 sets");
    assert(ex.base_weight_kg === null, "body_only must omit base_weight_kg");
  }

  // 2. Full-gym workout scaling, +10% / -10% adaptation, and floor clamping
  const gymStore = storeMod.createStore({ storage: makeStorage(), catalog });
  gymStore.setupPlan({
    name: "Sam",
    equipment: "full_gym",
    starting_intensity: "moderate",
    days_per_week: 3,
  });
  const r1Playlist = gymStore.buildPlaylist("r1");
  assert(r1Playlist.length === 4, "expected 4 exercises in Day 1");
  assert(r1Playlist[0].sets === 3, "moderate intensity must use 3 sets");
  assert(Boolean(r1Playlist[0].how_to), "playlist item missing how_to");

  gymStore.completeWorkout("r1", {
    next_intensity_choice: "more",
    duration_minutes: 28,
  });
  const r1Adapted = gymStore.buildRoutineCards(["r1"])[0];
  assert(r1Adapted.intensity_percent === 110, "expected 110% on adapted r1");
  assert(
    r1Adapted.exercises[0].scaled.formatted === "3 \u00d7 8 @ 44 kg",
    `expected '3 x 8 @ 44 kg', got '${r1Adapted.exercises[0].scaled.formatted}'`
  );

  gymStore.completeWorkout("r2", {
    next_intensity_choice: "less",
    duration_minutes: 24,
  });
  const r2Adapted = gymStore.buildRoutineCards(["r2"])[0];
  assert(r2Adapted.intensity_percent === 90, "expected 90% on adapted r2");
  assert(
    r2Adapted.exercises[0].scaled.formatted === "3 \u00d7 8 @ 36 kg",
    `expected '3 x 8 @ 36 kg', got '${r2Adapted.exercises[0].scaled.formatted}'`
  );

  // Pure scaling & streak parity
  const pushupItem = {
    id: "rx1",
    exercise_id: "Pushups",
    sets: 3,
    base_reps: 10,
    base_weight_kg: null,
  };
  assert(
    storeMod.computeScaledTarget(pushupItem, 0).formatted === "3 \u00d7 10 reps",
    "base rep format"
  );
  assert(
    storeMod.computeScaledTarget(pushupItem, 1).formatted === "3 \u00d7 11 reps",
    "+10% rep format"
  );
  assert(
    storeMod.computeScaledTarget(pushupItem, -1).formatted === "3 \u00d7 9 reps",
    "-10% rep format"
  );
  assert(
    storeMod.applyIntensityFeedback(-5, "less") === -5,
    "intensity floor clamp at -5"
  );

  const streakLogs = [
    { completed_at: "2026-11-11T12:00:00Z" },
    { completed_at: "2026-11-04T12:00:00Z" },
  ];
  assert(
    storeMod.computeWeekStreak(streakLogs, "2026-11-12T12:00:00Z") === 2,
    "2-week streak"
  );
  // Cross-year ISO week boundary: 2025-12-29 and 2026-01-02 are both 2026-W01
  const crossYearLogs = [
    { completed_at: "2026-01-02T10:00:00Z" },
    { completed_at: "2025-12-24T10:00:00Z" },
  ];
  assert(
    storeMod.computeWeekStreak(crossYearLogs, "2026-01-03T10:00:00Z") === 2,
    "Cross-year ISO week streak"
  );

  // 3. Routine customization & SVG thumbnail search
  const dbStore = storeMod.createStore({ storage: makeStorage(), catalog });
  dbStore.setupPlan({
    name: "Jordan",
    equipment: "dumbbells",
    starting_intensity: "intense",
    days_per_week: 3,
  });
  const day4 = dbStore.addWorkoutDay();
  assert(day4.id === "r4" && day4.name === "Day 4", "addWorkoutDay id/name");
  const hits = dbStore.searchCatalog("Pushups", 10);
  assert(hits[0].id === "Pushups", "exact match Pushups must rank first");
  assert(
    hits[0].thumb_url === "./svgs/thumbs/pushup__body_only.svg",
    "Pushups thumb_url"
  );
  const added = dbStore.addExerciseToRoutine(day4.id, "Pushups");
  assert(added.sets === 4 && added.base_reps === 12, "intense Pushups 4x12");
  const day4Card = dbStore.buildRoutineCards([day4.id])[0];
  assert(
    day4Card.exercises[0].scaled.formatted === "4 \u00d7 12 reps",
    "Day 4 scaled Pushups"
  );
  assert(
    dbStore.removeExerciseFromRoutine(day4.id, added.id) === true,
    "removeExerciseFromRoutine"
  );
  assert(
    dbStore.getRoutine(day4.id).exercises.length === 0,
    "Day 4 empty after removal"
  );

  // 4. #import= deflate-raw roundtrip, JSON backup export/import, and QR SVG
  const shareFrag = await gymStore.encodeShareFragment();
  assert(
    shareFrag.startsWith("#import=z.") && shareFrag.length < 700,
    "compact deflate-raw share fragment"
  );
  const phoneStore = storeMod.createStore({ storage: makeStorage(), catalog });
  phoneStore.setupPlan({
    name: "PhoneUser",
    equipment: "body_only",
    starting_intensity: "light",
    days_per_week: 2,
  });
  phoneStore.completeWorkout("r1", { next_intensity_choice: "keep" });
  const preview = await phoneStore.decodeShareFragment(shareFrag);
  assert(preview.routineCount === 3 && preview.exerciseCount === 12, "share counts");
  preview.apply({ keepExistingLogs: true });
  assert(phoneStore.getLogsDesc().length === 1, "existing local logs preserved");

  const backupJson = gymStore.exportBackupJson({ includeLogs: true });
  const restoredStore = storeMod.createStore({ storage: makeStorage(), catalog });
  restoredStore.importBackupJson(backupJson);
  assert(restoredStore.getLogsDesc().length === 2, "backup logs restored");
  assert(restoredStore.getState().profile.name === "Sam", "backup profile restored");

  const qrSvg = qrMod.renderSvg("https://trainer.local/" + shareFrag);
  assert(
    qrSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') &&
      qrSvg.includes('<path d="M'),
    "QR SVG output"
  );

  // 5. Pure helpers exported on app.js
  const appHelpers = require(path.join(distDir, "app.js"));
  assert(appHelpers.normalizeEqProp("medicine ball") === "dumbbell", "medicine ball");
  assert(
    appHelpers.normalizeEqProp("e-z curl bar") === "barbell",
    "e-z curl bar"
  );
  assert(
    appHelpers.resolveCatalogSvgKey(catalog.svgs, "squat:medicine ball") ===
      "squat:dumbbell",
    "resolveCatalogSvgKey"
  );
  assert(
    appHelpers.resolveCatalogSvg(catalog.svgs, "squat:kettlebells").includes(
      "js-kb-handle-f"
    ),
    "resolveCatalogSvg"
  );
  assert(
    appHelpers.formatLogDate("2026-11-12T10:00:00Z") === "Nov 12",
    "formatLogDate"
  );

  process.stdout.write(JSON.stringify({ ok: true }));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
"""

_SOUND_JS_HARNESS = """\
const fs = require("node:fs");
const motionPath = process.env.TA_MOTION_JS;
const soundPath = process.env.TA_SOUND_JS;
const coaching = JSON.parse(process.env.TA_COACHING_JSON);
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

globalThis.window = globalThis;

function makeParam(init) {
  return {
    value: init,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
  };
}

class MockAudioContext {
  constructor() {
    this.currentTime = 10.0;
    this.state = "running";
    this.sampleRate = 44100;
    this.destination = { kind: "dest" };
    this.sources = [];
    this.nodes = [];
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  _node(n) {
    this.nodes.push(n);
    return n;
  }
  _source(s) {
    this.sources.push(s);
    this.nodes.push(s);
    return s;
  }
  createOscillator() {
    return this._source({
      type: "sine",
      frequency: makeParam(440),
      started: false,
      immediateStopped: false,
      disconnected: false,
      onended: null,
      connect() {},
      disconnect() { this.disconnected = true; },
      start() { this.started = true; },
      stop(...args) { if (args.length === 0) this.immediateStopped = true; },
    });
  }
  createGain() {
    return this._node({
      gain: makeParam(1),
      disconnected: false,
      connect() {},
      disconnect() { this.disconnected = true; },
    });
  }
  createBiquadFilter() {
    return this._node({
      type: "lowpass",
      frequency: makeParam(1000),
      Q: makeParam(1),
      disconnected: false,
      connect() {},
      disconnect() { this.disconnected = true; },
    });
  }
  createBuffer(_ch, len, sr) {
    const arr = new Float32Array(len);
    return { sampleRate: sr, length: len, getChannelData: () => arr };
  }
  createBufferSource() {
    return this._source({
      buffer: null,
      started: false,
      immediateStopped: false,
      disconnected: false,
      onended: null,
      connect() {},
      disconnect() { this.disconnected = true; },
      start() { this.started = true; },
      stop(...args) { if (args.length === 0) this.immediateStopped = true; },
    });
  }
}
globalThis.AudioContext = MockAudioContext;

new Function(fs.readFileSync(motionPath, "utf8"))();
new Function(fs.readFileSync(soundPath, "utf8"))();

const TM = globalThis.TrainingMotion;
const TS = globalThis.TrainingSound;
assert(TM && TS, "TrainingMotion and TrainingSound must load");
assert(TS.STORAGE_KEY === "training_aid_sound_theme", "STORAGE_KEY mismatch");
assert(
  JSON.stringify(TS.THEMES.map((t) => [t.id, t.label])) ===
    JSON.stringify([
      ["off", "Off"],
      ["minimal", "Minimal Cues"],
      ["techno", "Techno Pulse"],
      ["trance", "Trance Arp"],
      ["studio", "Studio Kit"],
    ]),
  "THEMES mismatch"
);

for (const [arch, meta] of Object.entries(coaching)) {
  const expectedSub = meta.is_hold ? 2 : meta.rep_seconds >= 2.4 ? 8 : 4;
  assert(
    TS.subdivisionsForRep(meta.rep_seconds, meta.is_hold) === expectedSub,
    `subdivisions mismatch for ${arch}`
  );
  for (const silent of ["off", "minimal"]) {
    const emptyPat = TS.buildRepPattern({
      theme: silent,
      repSeconds: meta.rep_seconds,
    });
    assert(emptyPat.length === 0, `${silent} must return []`);
  }
  for (const theme of ["techno", "trance", "studio"]) {
    const pat = TS.buildRepPattern({
      theme,
      repSeconds: meta.rep_seconds,
      tempoMode: meta.tempo_mode,
      isHold: meta.is_hold,
      repIndex: 8,
      totalReps: 10,
    });
    assert(
      pat.length >= 1 && pat[0].role === "downbeat" && pat[0].offsetSec === 0,
      "downbeat"
    );
    assert(pat.every((e) => e.isFinalStretch === true), "final stretch");
    const early = TS.buildRepPattern({
      theme,
      repSeconds: meta.rep_seconds,
      tempoMode: meta.tempo_mode,
      isHold: meta.is_hold,
      repIndex: 0,
      totalReps: 10,
    });
    assert(early.every((e) => e.isFinalStretch === false), "early rep");
    const turns = pat.filter((e) => e.role === "turnaround");
    if (meta.is_hold) {
      assert(turns.length === 0, "hold omits turnaround");
    } else {
      const turnFrac = TM.turnaroundForMode(meta.tempo_mode);
      const expectedOff = Number((turnFrac * meta.rep_seconds).toFixed(4));
      assert(
        turns.length === 1 && turns[0].offsetSec === expectedOff,
        `turnaround ${arch}`
      );
      for (const sub of pat.filter((e) => e.role === "subdivision")) {
        assert(Math.abs(sub.offsetSec - expectedOff) >= 0.045, `flam ${arch}`);
      }
    }
  }
}

const tempoPairs = [
  ["explosive", 0.31],
  ["standard", 0.43],
  ["alternating", 0.5],
];
for (const [mode, frac] of tempoPairs) {
  for (const theme of ["techno", "trance", "studio"]) {
    const pat = TS.buildRepPattern({
      theme,
      repSeconds: 2.6,
      tempoMode: mode,
      isHold: false,
    });
    const turn = pat.find((e) => e.role === "turnaround");
    assert(
      turn && turn.offsetSec === Number((frac * 2.6).toFixed(4)),
      `mode ${mode}`
    );
  }
}

const store = {};
const mockStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const ctrl = TS.createController({
  turnaroundForMode: TM.turnaroundForMode,
  storage: mockStorage,
});
assert(ctrl.getTheme() === "minimal" && !ctrl.isMuted(), "default minimal");
ctrl.setTheme("trance");
assert(store[TS.STORAGE_KEY] === "trance", "persisted trance");
ctrl.toggleMute();
assert(
  ctrl.getTheme() === "off" &&
    ctrl.isMuted() &&
    store[TS.STORAGE_KEY] === "off",
  "muted"
);
ctrl.toggleMute();
assert(ctrl.getTheme() === "trance" && !ctrl.isMuted(), "restored trance");

const ctx = ctrl.ensureAudio();
assert(ctx instanceof MockAudioContext, "AudioContext created");
ctrl.beginPhase("ACTIVE", {
  repSeconds: 2.8,
  reps: 4,
  tempoMode: "standard",
  isHold: false,
});
assert(ctx.sources.length > 0, "lookahead primed");
ctx.currentTime = 10.65;
assert(Math.abs(ctrl.advancePhase(0.016) - 0.65) < 1e-6, "clock tracks currentTime");

const prePauseSources = ctx.sources.slice();
ctrl.pause();
assert(
  prePauseSources.every((s) => s.immediateStopped && s.disconnected),
  "pause cleanup"
);
assert(ctx.nodes.every((n) => n.disconnected), "pause disconnects nodes");
assert(Math.abs(ctrl.advancePhase(0.5) - 0.65) < 1e-6, "paused freezes elapsed");

ctrl.resume();
ctrl.toggleMute();
assert(Math.abs(ctrl.advancePhase(0.25) - 0.9) < 1e-6, "off falls back to dt");

ctrl.toggleMute();
const preStopCount = ctx.sources.length;
ctrl.startSignal();
assert(ctx.sources.length > preStopCount, "cue scheduled");
ctrl.stopAll();
assert(
  ctx.sources.every((s) => s.immediateStopped && s.disconnected),
  "stopAll cleanup"
);

process.stdout.write(JSON.stringify({ ok: true }));
"""


def _parse_svg(svg_markup: str) -> ET.Element:
    """Parse trusted in-process SVG markup into an ElementTree element."""
    return ET.fromstring(svg_markup)  # noqa: S314


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


class _QuietHTTPHandler(SimpleHTTPRequestHandler):
    """Silent static file HTTP handler for local server tests."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        """Suppress per-request stderr logging during test runs."""


@pytest.fixture(scope="module")
def built_pwa(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Compile the zero-backend static PWA bundle once per test module."""
    out_dir = tmp_path_factory.mktemp("pwa_dist") / "dist"
    summary = build_pwa(out_dir)
    assert summary["output_dir"] == out_dir
    return out_dir


@pytest.fixture(scope="module")
def catalog_by_id() -> dict[str, CatalogExercise]:
    """Load all 876 CatalogExercise records indexed by ID."""
    return {ex.id: ex for ex in load_catalog_exercises()}


@pytest.fixture(scope="module")
def live_pwa_base_url(built_pwa: Path) -> Generator[str]:
    """Serve the compiled PWA bundle on an ephemeral localhost HTTP port."""
    handler = functools.partial(_QuietHTTPHandler, directory=str(built_pwa))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_build_pwa_static_bundle_and_catalog_schema(
    built_pwa: Path,
    catalog_by_id: dict[str, CatalogExercise],
) -> None:
    """Verify static PWA compilation output, catalog schema, CSP, and zero deps."""
    expected_files = (
        "index.html",
        "manifest.webmanifest",
        "sw.js",
        "icon.svg",
        "store.js",
        "qr.js",
        "app.js",
        "static/style.css",
        "static/motion.js",
        "static/sound.js",
        "data/catalog.json",
    )
    for rel_path in expected_files:
        assert (built_pwa / rel_path).is_file(), f"Missing {rel_path} in dist/"

    thumbs = list((built_pwa / "svgs" / "thumbs").glob("*.svg"))
    assert len(thumbs) == len(ARCHETYPE_SPECS) * len(CANONICAL_EQUIPMENT_MODES) == 126

    payload = json.loads((built_pwa / "data" / "catalog.json").read_text("utf-8"))
    assert payload["schema_version"] == CATALOG_SCHEMA_VERSION == 1
    assert len(payload["exercises"]) == len(catalog_by_id) == 876
    assert len(payload["svgs"]) == 144

    for eq_key, prog in payload["programs"]["equipment_programs"].items():
        for _routine_name, specs in prog["routines"]:
            for ex_id, *_ in specs:
                assert ex_id in catalog_by_id, f"Missing {ex_id} in {eq_key}"

    index_html = (built_pwa / "index.html").read_text(encoding="utf-8")
    assert "Content-Security-Policy" in index_html
    assert "default-src 'self'" in index_html
    assert "connect-src 'self'" in index_html
    assert 'id="app-root"' in index_html

    pyproject = tomllib.loads(
        (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    )
    assert pyproject["project"]["dependencies"] == []


def test_cli_build_only_entrypoint(tmp_path: Path) -> None:
    """Verify training-aid CLI --build-only flag compiles bundle and exits 0."""
    parser = training_aid.build_arg_parser()
    parsed = parser.parse_args(["--build-only", "--out-dir", str(tmp_path / "custom")])
    assert parsed.build_only is True
    assert parsed.out_dir == tmp_path / "custom"

    rc = training_aid.main(["--build-only", "--out-dir", str(tmp_path / "out")])
    assert rc == 0
    assert (tmp_path / "out" / "index.html").is_file()
    assert (tmp_path / "out" / "data" / "catalog.json").is_file()
    assert (tmp_path / "out" / "svgs" / "thumbs" / "squat__barbell.svg").is_file()


def _http_get(url: str) -> tuple[int, str, bytes]:
    with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310
        return resp.status, resp.headers.get_content_type(), resp.read()


def test_live_threading_http_server_static_serving(live_pwa_base_url: str) -> None:
    """Verify compiled static PWA assets serve cleanly over stdlib HTTP."""
    status, ctype, body = _http_get(f"{live_pwa_base_url}/")
    assert status == 200
    assert ctype == "text/html"
    assert b'id="app-root"' in body

    routes = (
        ("/index.html", "text/html", b"manifest.webmanifest"),
        ("/sw.js", "javascript", b"APP_SHELL_ASSETS"),
        ("/manifest.webmanifest", "application", b"Training Aid"),
        ("/store.js", "javascript", b"TrainingStore"),
        ("/qr.js", "javascript", b"TrainingQR"),
        ("/app.js", "javascript", b"TrainingApp"),
        ("/static/style.css", "text/css", b"100dvh"),
        ("/static/motion.js", "javascript", b"TrainingMotion"),
        ("/static/sound.js", "javascript", b"TrainingSound"),
        ("/data/catalog.json", "application/json", b'"schema_version":1'),
        ("/svgs/thumbs/squat__kettlebells.svg", "image/svg+xml", b"js-kb-handle-f"),
    )
    for path, expected_ctype_part, marker in routes:
        code, got_ctype, payload = _http_get(f"{live_pwa_base_url}{path}")
        assert code == 200
        assert expected_ctype_part in got_ctype
        assert marker in payload

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _http_get(f"{live_pwa_base_url}/svgs/thumbs/nonexistent.svg")
    assert exc_info.value.code == 404


def test_node_store_qr_and_app_integration(built_pwa: Path) -> None:
    """Verify setup, workout adaptation, streaks, share tokens, backups, and QR."""
    node_bin = find_node_binary()
    assert node_bin is not None, "Node.js binary is required for PWA integration tests"

    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _PWA_INTEGRATION_HARNESS],
        env={**os.environ, "TA_DIST_DIR": str(built_pwa)},
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert proc.returncode == 0, f"Node harness failed:\n{proc.stdout}\n{proc.stderr}"
    assert json.loads(proc.stdout) == {"ok": True}


def test_pregenerated_svgs_motion_js_and_minimal_coaching(
    catalog_by_id: dict[str, CatalogExercise],
) -> None:
    """Verify pregenerated SVGs, static assets, and minimal coaching metadata."""
    written = pregenerate_all_svgs()
    assert len(written) == len(ARCHETYPE_SPECS) == len(ARCHETYPE_COACHING) == 18
    assert set(ARCHETYPE_SPECS.keys()) == set(ARCHETYPE_COACHING.keys())

    for archetype in ARCHETYPE_SPECS:
        svg_path = SVGS_DIR / f"{archetype}.svg"
        assert svg_path.exists()
        root = _parse_svg(svg_path.read_text(encoding="utf-8"))
        assert root.attrib.get("preserveAspectRatio") == "xMidYMid meet"
        assert root.attrib.get("viewBox") == "0 0 240 200"
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])
        bones = json.loads(root.attrib["data-bones"])
        assert set(pose_a.keys()) == set(pose_b.keys())
        assert set(BONE_KEYS).issubset(bones.keys())

    static_dir = REPO_ROOT / "src" / "training_aid" / "static"
    motion_text = (static_dir / "motion.js").read_text(encoding="utf-8")
    assert "TrainingMotion" in motion_text

    css_text = (static_dir / "style.css").read_text(encoding="utf-8")
    assert "100dvh" in css_text
    assert "narrow-shell" not in css_text
    assert "@media (prefers-reduced-motion: reduce)" in css_text

    for meta in ARCHETYPE_COACHING.values():
        assert len(meta["cue_work"].split()) <= 2
        assert len(meta["cue_return"].split()) <= 2
        assert meta["tempo_mode"] in {"standard", "explosive", "alternating", "hold"}

    squat = catalog_by_id["Bodyweight_Squat"]
    plank = catalog_by_id["Plank"]
    pushup = catalog_by_id["Pushups"]
    assert classify_archetype(squat) == "squat"
    assert classify_archetype(pushup) == "pushup"

    plank_guide = build_exercise_guidance(plank)
    assert plank_guide["archetype"] == "plank"
    assert plank_guide["is_hold"] is True
    assert plank_guide["unit"] == "sec"


def _assert_rig_kinematics_and_bounds(
    archetype: str,
    bones: dict[str, float],
    pose_a: dict[str, float],
    pose_b: dict[str, float],
) -> None:
    segment_pairs = (
        ("hip", "mid_spine", "lumbar"),
        ("mid_spine", "shoulder", "thoracic"),
        ("shoulder", "head", "neck"),
        ("shoulder", "elbow_f", "uarm"),
        ("elbow_f", "hand_f", "farm"),
        ("shoulder_b", "elbow_b", "uarm"),
        ("elbow_b", "hand_b", "farm"),
        ("hip", "knee_f", "thigh"),
        ("knee_f", "foot_f", "shin"),
        ("hip_b", "knee_b", "thigh"),
        ("knee_b", "foot_b", "shin"),
    )
    for swap in (False, True):
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            pose = lerp_pose(pose_a, pose_b, t)
            pts = solve_fk(bones, pose, swap_sides=swap)

            for p1_key, p2_key, bone_key in segment_pairs:
                assert _dist(pts[p1_key], pts[p2_key]) == pytest.approx(
                    bones[bone_key], abs=1e-9
                )

            for joint_name, (jx, jy) in pts.items():
                assert 0.0 <= jx <= 240.0, (
                    f"{archetype} t={t} {joint_name} x={jx} outside viewBox"
                )
                assert 0.0 <= jy <= 174.0, (
                    f"{archetype} t={t} {joint_name} y={jy} penetrates floor/top"
                )
            hx, hy = pts["head"]
            assert 11.5 <= hx <= 228.5, (
                f"{archetype} t={t} head x clips outside bounds: ({hx}, {hy})"
            )
            assert 11.5 <= hy <= 174.0, (
                f"{archetype} t={t} head y clips outside bounds: ({hx}, {hy})"
            )


def test_fk_zero_bone_distortion_and_viewport_bounds_all_18_archetypes() -> None:
    """Verify zero bone-length distortion and viewport bounds for all archetypes."""
    assert len(ARCHETYPE_SPECS) == 18

    for archetype in ARCHETYPE_SPECS:
        svg_text = render_archetype_svg(archetype, thumbnail=False)
        root = _parse_svg(svg_text)
        aria_label = root.attrib.get("aria-label", "")
        assert aria_label
        assert "_" not in aria_label
        assert aria_label[0].isupper()

        bones = json.loads(root.attrib["data-bones"])
        pose_a = json.loads(root.attrib["data-pose-a"])
        pose_b = json.loads(root.attrib["data-pose-b"])

        torso_el = root.find(".//*[@class='js-torso']")
        neck_el = root.find(".//*[@class='js-neck']")
        assert torso_el is not None
        assert torso_el.tag.endswith("path")
        assert " Q " in torso_el.attrib.get("d", "")
        assert neck_el is not None
        assert neck_el.tag.endswith("line")

        j0 = solve_fk(bones, lerp_pose(pose_a, pose_b, 0.0))
        expected_cx, expected_rx = compute_shadow(j0)
        shadow_el = root.find(".//*[@class='js-shadow']")
        assert shadow_el is not None
        assert float(shadow_el.attrib["cx"]) == pytest.approx(expected_cx, abs=0.05)
        assert float(shadow_el.attrib["rx"]) == pytest.approx(expected_rx, abs=0.05)

        _assert_rig_kinematics_and_bounds(archetype, bones, pose_a, pose_b)

    ohp_j0 = solve_fk(
        ARCHETYPE_SPECS["overhead_press"]["bones"],
        ARCHETYPE_SPECS["overhead_press"]["pose_a"],
    )
    assert ohp_j0["shoulder"] != ohp_j0["shoulder_b"]

    plank_aura = _parse_svg(render_archetype_svg("plank")).find(
        ".//*[@class='js-aura']"
    )
    squat_aura = _parse_svg(render_archetype_svg("squat")).find(
        ".//*[@class='js-aura']"
    )
    assert plank_aura is not None
    assert squat_aura is not None
    assert float(plank_aura.attrib["cy"]) > float(squat_aura.attrib["cy"]) + 15.0


def test_decoupled_equipment_props_and_baked_thumbnails() -> None:
    """Verify equipment-specific SVG props and peak-pose static thumbnails."""
    bb_squat = _parse_svg(render_archetype_svg("squat", equipment="barbell"))
    assert bb_squat.attrib.get("data-equipment") == "barbell"
    assert bb_squat.attrib.get("data-bar-mode") == "hands"
    assert bb_squat.find(".//*[@class='js-bar-shaft']") is not None
    assert bb_squat.find(".//*[@class='js-weight']") is not None

    bw_row = _parse_svg(render_archetype_svg("row_pull", equipment="body only"))
    bw_hinge = _parse_svg(render_archetype_svg("hinge", equipment="body only"))
    assert bw_row.find(".//*[@class='js-weight']") is None
    assert bw_hinge.find(".//*[@class='js-weight']") is None

    band_hinge = _parse_svg(render_archetype_svg("hinge", equipment="bands"))
    assert band_hinge.attrib.get("data-equipment") == "bands"
    assert "data-anchor-x" in band_hinge.attrib
    assert "data-anchor-y" in band_hinge.attrib
    assert band_hinge.find(".//*[@class='js-band-f']") is not None
    assert band_hinge.find(".//*[@class='js-band-b']") is not None
    assert band_hinge.find(".//*[@class='js-weight']") is None

    cable_pull = _parse_svg(render_archetype_svg("vertical_pull", equipment="cable"))
    assert cable_pull.find(".//*[@class='js-cable']") is not None
    assert cable_pull.find(".//*[@class='js-cable-grip']") is not None

    kb_squat = _parse_svg(render_archetype_svg("squat", equipment="kettlebells"))
    assert kb_squat.find(".//*[@class='js-kb-handle-f']") is not None
    assert kb_squat.find(".//*[@class='js-weight']") is not None

    pregenerate_all_svgs()
    for archetype in ARCHETYPE_SPECS:
        static_svg = (SVGS_DIR / f"{archetype}.svg").read_text(encoding="utf-8")
        live_t0_svg = load_svg_markup(archetype)
        baked_thumb_svg = render_archetype_svg(archetype, thumbnail=True)
        assert static_svg == baked_thumb_svg
        assert static_svg != live_t0_svg


def test_expanded_taxonomy_accuracy_holds_and_tempo_metadata(
    catalog_by_id: dict[str, CatalogExercise],
) -> None:
    """Verify exercise archetype classification, hold units, and tempo modes."""
    expected_mappings = {
        "Wide-Grip_Lat_Pulldown": "vertical_pull",
        "Pullups": "vertical_pull",
        "Band_Skull_Crusher": "triceps_extension",
        "Leg_Extensions": "leg_extension_curl",
        "Lying_Leg_Curls": "leg_extension_curl",
        "Hyperextensions_Back_Extensions": "hinge",
        "Air_Bike": "bicycle_crunch",
        "Standing_Calf_Raises": "calf_raise",
    }
    for ex_id, expected_arch in expected_mappings.items():
        ex = catalog_by_id[ex_id]
        assert classify_archetype(ex) == expected_arch

    stretches = [ex for ex in catalog_by_id.values() if ex.category == "stretching"][
        :10
    ]
    assert len(stretches) > 0
    for stretch_ex in stretches:
        assert is_hold_exercise(stretch_ex) is True
        assert is_hold_exercise(stretch_ex.id) is True
        guide = build_exercise_guidance(stretch_ex)
        assert guide["is_hold"] is True
        assert guide["unit"] == "sec"
        assert guide["tempo_mode"] == "hold"

    jump_squat = catalog_by_id["Freehand_Jump_Squat"]
    air_bike = catalog_by_id["Air_Bike"]
    band_skull = catalog_by_id["Band_Skull_Crusher"]
    barbell_squat = catalog_by_id["Barbell_Full_Squat"]

    assert build_exercise_guidance(jump_squat)["tempo_mode"] == "explosive"
    air_guide = build_exercise_guidance(air_bike)
    assert air_guide["tempo_mode"] == "alternating"
    assert air_guide["is_alternating"] is True

    band_guide = build_exercise_guidance(band_skull)
    assert "js-band-f" in band_guide["svg_markup"]
    assert "js-weight" not in band_guide["svg_markup"]

    bb_guide = build_exercise_guidance(barbell_squat)
    assert "js-bar-shaft" in bb_guide["svg_markup"]


def test_svg_public_api_and_ruff_config_contract() -> None:
    """Verify svg_assets public helpers and pyproject.toml Ruff configuration."""
    assert len(POSE_KEYS) == 13
    assert set(STD_BONES.keys()) == set(BONE_KEYS)
    assert normalize_equipment("e-z curl bar", "curl") == "barbell"
    assert normalize_equipment(None, "vertical_pull") == "cable"

    mid_joints = evaluate_archetype_pose("mountain_climber", 0.5, swap_sides=True)
    assert "hip" in mid_joints
    assert "hand_f" in mid_joints

    pyproject_path = REPO_ROOT / "pyproject.toml"
    pyproject = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    assert pyproject["project"]["name"] == "training-aid"

    tool_cfg = pyproject.get("tool", {})
    assert "ruff" in tool_cfg
    ruff_cfg = tool_cfg["ruff"]
    assert "format" in ruff_cfg
    assert "lint" in ruff_cfg
    lint_cfg = ruff_cfg["lint"]
    assert "ALL" in lint_cfg.get("select", [])
    assert "N" in lint_cfg.get("extend-select", []) or "N" in lint_cfg.get("select", [])
    assert "pep8-naming" in lint_cfg


def test_declarative_animations_json_and_ik_compiler() -> None:
    """Verify animations.json unifies rig + coaching config with declarative IK."""
    raw = json.loads(ANIMATIONS_JSON.read_text(encoding="utf-8"))
    assert {"std_bones", "equipment_aliases", "animations"} <= set(raw.keys())
    animations = raw["animations"]
    assert set(animations.keys()) == set(ARCHETYPE_SPECS.keys())

    grounded = (
        "squat",
        "lunge",
        "pushup",
        "plank",
        "hinge",
        "glute_bridge",
        "dip",
        "calf_raise",
    )
    for arch in grounded:
        pose_a_cfg = animations[arch]["pose_a"]
        has_ik = any(
            isinstance(pose_a_cfg[limb], dict) and "target" in pose_a_cfg[limb]
            for limb in ("arm_f", "arm_b", "leg_f", "leg_b")
        )
        assert has_ik, f"{arch} should preserve declarative IK targets in animations"

    for arch, cfg in animations.items():
        compiled = compile_animation_spec(cfg, STD_BONES)
        assert compiled["pose_a"] == ARCHETYPE_SPECS[arch]["pose_a"]
        assert compiled["pose_b"] == ARCHETYPE_SPECS[arch]["pose_b"]
        assert compiled["coaching"] == ARCHETYPE_COACHING[arch]

    plank_svg = _parse_svg(render_archetype_svg("plank"))
    squat_svg = _parse_svg(render_archetype_svg("squat"))
    bike_svg = _parse_svg(render_archetype_svg("bicycle_crunch"))
    assert plank_svg.attrib.get("data-hold-style") == "pulse"
    assert plank_svg.attrib.get("data-tempo-mode") == "hold"
    assert squat_svg.attrib.get("data-hold-style") == "settle"
    assert squat_svg.attrib.get("data-tempo-mode") == "standard"
    assert bike_svg.attrib.get("data-tempo-mode") == "alternating"


def test_declarative_exercise_coaching_and_programs_configs(
    catalog_by_id: dict[str, CatalogExercise],
) -> None:
    """Verify 2-tier exercise coaching and program configs without catalog pollution."""
    data_dir = REPO_ROOT / "data"
    catalog = json.loads((data_dir / "exercises.json").read_text(encoding="utf-8"))
    coaching_map = json.loads(
        (data_dir / "exercise_coaching.json").read_text(encoding="utf-8")
    )
    programs_cfg = load_programs_config(data_dir / "programs.json")

    expected_catalog_keys = {
        "id",
        "name",
        "force",
        "level",
        "mechanic",
        "equipment",
        "primaryMuscles",
        "secondaryMuscles",
        "instructions",
        "category",
        "images",
    }
    assert set(catalog[0].keys()) == expected_catalog_keys

    catalog_ids = {item["id"] for item in catalog}
    assert set(coaching_map.keys()) == catalog_ids
    assert set(EXERCISE_COACHING.keys()) == catalog_ids

    valid_tempos = {"standard", "explosive", "alternating", "hold"}
    for item in catalog:
        entry = coaching_map[item["id"]]
        assert entry["archetype"] in ARCHETYPE_SPECS
        assert entry["tempo_mode"] in valid_tempos
        if item.get("category") == "stretching":
            assert entry["is_hold"] is True
            assert entry["tempo_mode"] == "hold"

    box_jump = catalog_by_id["Box_Jump_Multiple_Response"]
    ab_roller = catalog_by_id["Ab_Roller"]
    shrug = catalog_by_id["Barbell_Shrug"]
    side_bridge = catalog_by_id["Side_Bridge"]
    assert build_exercise_guidance(box_jump)["archetype"] == "squat"
    assert build_exercise_guidance(box_jump)["tempo_mode"] == "explosive"
    assert build_exercise_guidance(ab_roller)["archetype"] == "plank"
    assert build_exercise_guidance(ab_roller)["is_hold"] is False
    assert classify_archetype(shrug) == "row_pull"
    assert is_hold_exercise(side_bridge) is True

    synthetic = CatalogExercise(
        id="Custom_Unlisted_Goblet_Jump_Squat",
        name="Custom Unlisted Goblet Jump Squat",
        category="strength",
        equipment="kettlebells",
        primary_muscle="quadriceps",
    )
    syn_guide = build_exercise_guidance(synthetic)
    assert syn_guide["archetype"] == "squat"
    assert syn_guide["tempo_mode"] == "explosive"

    assert set(programs_cfg["equipment_archetypes"].values()) <= set(ARCHETYPE_SPECS)


def test_pwa_app_and_motion_js_have_zero_hardcoded_archetype_branches() -> None:
    """Verify pwa/app.js and motion.js delegate tempo/hold behavior to data attrs."""
    pwa_app_js = (REPO_ROOT / "src" / "training_aid" / "pwa" / "app.js").read_text(
        encoding="utf-8"
    )
    motion_js = (REPO_ROOT / "src" / "training_aid" / "static" / "motion.js").read_text(
        encoding="utf-8"
    )

    assert 'archetype === "plank"' not in pwa_app_js
    assert "const TURNAROUND_BY_MODE" not in pwa_app_js
    assert "applyHold(" in pwa_app_js
    assert "turnaroundForMode(" in pwa_app_js
    assert "rig.tempoMode" in pwa_app_js

    for symbol in (
        "tempoCurve",
        "applyRestBreath",
        "swapSides",
        "prefersReducedMotion",
        "turnaroundForMode",
        "applyHold",
        "tempoMode",
        "holdStyle",
    ):
        assert symbol in motion_js
    render_state_idx = motion_js.index("function renderPoseState")
    assert "querySelector" in motion_js[:render_state_idx]
    assert "querySelector" not in motion_js[render_state_idx:]


def _expected_subdivisions(rep_seconds: float, *, is_hold: bool) -> int:
    if is_hold:
        return 2
    return 8 if rep_seconds >= 2.4 else 4


def _verify_rep_grid(
    rep_seconds: float,
    tempo_mode: str,
    *,
    is_hold: bool,
    flam_guard: float,
) -> None:
    subdivs = _expected_subdivisions(rep_seconds, is_hold=is_hold)
    sub_offsets = [round((i * rep_seconds) / subdivs, 4) for i in range(1, subdivs)]
    assert all(0.0 < off < rep_seconds for off in sub_offsets)
    if is_hold:
        assert subdivs == 2
        assert sub_offsets == [round(rep_seconds / 2, 4)]
        return

    turnaround = _TURNAROUND_BY_MODE[tempo_mode]
    turn_offset = round(turnaround * rep_seconds, 4)
    assert 0.0 < turn_offset < rep_seconds
    kept_subs = [off for off in sub_offsets if abs(off - turn_offset) >= flam_guard]
    for off in kept_subs:
        assert abs(off - turn_offset) >= 0.045


def test_sound_js_asset_and_pwa_workout_hud_integration() -> None:
    """Verify sound.js contract, PWA 5-theme HUD selector, and zero audio files."""
    for folder in ("src", "data"):
        audio_files = [
            p
            for p in (REPO_ROOT / folder).rglob("*")
            if p.suffix.lower() in {".wav", ".mp3", ".ogg", ".flac", ".m4a"}
        ]
        assert audio_files == []

    static_dir = REPO_ROOT / "src" / "training_aid" / "static"
    pwa_dir = REPO_ROOT / "src" / "training_aid" / "pwa"
    sound_js = (static_dir / "sound.js").read_text(encoding="utf-8")
    index_html = (pwa_dir / "index.html").read_text(encoding="utf-8")
    app_js = (pwa_dir / "app.js").read_text(encoding="utf-8")
    style_css = (static_dir / "style.css").read_text(encoding="utf-8")

    for required in (
        "TrainingSound",
        "STORAGE_KEY",
        '"training_aid_sound_theme"',
        "THEMES",
        "subdivisionsForRep",
        "buildRepPattern",
        "createController",
    ):
        assert required in sound_js
    assert "rock" not in sound_js.lower()

    parsed_themes = re.findall(
        r'\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}',
        sound_js,
    )
    assert tuple(parsed_themes) == _EXPECTED_SOUND_THEMES

    assert index_html.index("./static/motion.js") < index_html.index(
        "./static/sound.js"
    )
    assert index_html.index("./static/sound.js") < index_html.index("./app.js")

    for hud_contract in (
        "sound-theme-select",
        "sound-toggle",
        "icon-vol-on",
        "icon-vol-off",
        "createController",
        "Sound.beginPhase(",
        "Sound.advancePhase(",
        "Sound.pause()",
        "Sound.resume()",
        "Sound.stopAll()",
        "Sound.startSignal()",
        "Sound.stopSet()",
        "Sound.workoutComplete()",
        "visibilitychange",
    ):
        assert hud_contract in app_js

    assert ".hud-select" in style_css
    reduced_idx = style_css.index("@media (prefers-reduced-motion: reduce)")
    assert ".hud-select" in style_css[reduced_idx:]


def test_sound_kinematic_rhythm_and_controller_contract() -> None:
    """Verify subdivisions, kinematic turnarounds, scale, and controller invariants."""
    static_dir = REPO_ROOT / "src" / "training_aid" / "static"
    sound_js = (static_dir / "sound.js").read_text(encoding="utf-8")
    motion_js = (static_dir / "motion.js").read_text(encoding="utf-8")

    flam_match = re.search(r"FLAM_GUARD_SEC\s*=\s*([0-9.]+)", sound_js)
    lookahead_match = re.search(r"LOOKAHEAD_SEC\s*=\s*([0-9.]+)", sound_js)
    rest_match = re.search(r"REST_PULSE_INTERVAL_SEC\s*=\s*([0-9.]+)", sound_js)
    assert flam_match is not None
    assert lookahead_match is not None
    assert rest_match is not None
    flam_guard = float(flam_match.group(1))
    assert flam_guard >= 0.045
    assert float(lookahead_match.group(1)) == pytest.approx(0.14)
    assert float(rest_match.group(1)) == pytest.approx(2.0)

    scale_block = re.search(
        r"SCALE\s*=\s*Object\.freeze\(\{(.*?)\}\);",
        sound_js,
        re.DOTALL,
    )
    assert scale_block is not None
    parsed_scale = {
        note: float(hz)
        for note, hz in re.findall(r"([A-G]\d):\s*([0-9.]+)", scale_block.group(1))
    }
    assert parsed_scale == _EXPECTED_SOUND_SCALE

    for mode, frac in _TURNAROUND_BY_MODE.items():
        assert re.search(rf"{mode}:\s*{frac}\b", motion_js) is not None
        assert re.search(rf"{mode}:\s*{frac}\b", sound_js) is not None

    assert len(ARCHETYPE_COACHING) == 18
    subdiv_buckets: set[int] = set()
    for meta in ARCHETYPE_COACHING.values():
        rep_sec = float(meta["rep_seconds"])
        is_hold = bool(meta["is_hold"])
        mode = str(meta["tempo_mode"])
        subdiv_buckets.add(_expected_subdivisions(rep_sec, is_hold=is_hold))
        _verify_rep_grid(rep_sec, mode, is_hold=is_hold, flam_guard=flam_guard)
    assert subdiv_buckets == {2, 4, 8}

    for mode in ("explosive", "standard", "alternating"):
        _verify_rep_grid(2.6, mode, is_hold=False, flam_guard=flam_guard)

    for controller_invariant in (
        "storage.setItem(STORAGE_KEY, themeId)",
        'setTheme(lastActiveTheme || "minimal")',
        "audioCtx.currentTime - audioAnchorTime",
        "phaseElapsed += dt",
        "totalReps - repIndex <= (isHold ? 3 : 2)",
        "round4(turnaround * repSeconds)",
        "stopAllNodes()",
        "stopScheduledNodes()",
    ):
        assert controller_invariant in sound_js


def test_sound_js_behavioral_mock_webaudio_harness() -> None:
    """Verify motion.js + sound.js behavioral harness via Node."""
    static_dir = REPO_ROOT / "src" / "training_aid" / "static"
    motion_path = static_dir / "motion.js"
    sound_path = static_dir / "sound.js"
    assert motion_path.is_file()
    assert sound_path.is_file()

    for js_path in (motion_path, sound_path):
        src = js_path.read_text(encoding="utf-8")
        assert src.count("{") == src.count("}")
        assert src.count("(") == src.count(")")

    node_bin = find_node_binary()
    assert node_bin is not None, "Node.js binary is required for Web Audio harness"

    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _SOUND_JS_HARNESS],
        env={
            **os.environ,
            "TA_MOTION_JS": str(motion_path),
            "TA_SOUND_JS": str(sound_path),
            "TA_COACHING_JSON": json.dumps(ARCHETYPE_COACHING),
        },
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert json.loads(proc.stdout) == {"ok": True}
