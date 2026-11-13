# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog, coaching, kinematic rig, safe-grip, and static PWA audit."""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from training_aid import coaching, svg_assets
from training_aid.builder import (
    CANONICAL_EQUIPMENT_MODES,
    PWA_SRC_DIR,
    STATIC_SRC_DIR,
    CatalogExercise,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.coaching import (
    ARCHETYPE_COACHING,
    build_exercise_guidance,
    classify_archetype,
    is_hold_exercise,
)
from training_aid.svg_assets import (
    ARCHETYPE_SPECS,
    lerp_pose,
    normalize_equipment,
    solve_fk,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
STATIC_DIR = STATIC_SRC_DIR
PWA_DIR = PWA_SRC_DIR

EXPECTED_CATALOG_COUNT = 876
EXPECTED_ARCHETYPE_COUNT = 18
EXPECTED_THUMBNAIL_COUNT = EXPECTED_ARCHETYPE_COUNT * len(CANONICAL_EQUIPMENT_MODES)
EXPECTED_INLINE_SVG_COUNT = EXPECTED_ARCHETYPE_COUNT + EXPECTED_THUMBNAIL_COUNT

MIN_HOLD_REPS = 20
MIN_WEIGHT_KG = 2.0
MAX_WEIGHT_KG = 250.0

VIEWPORT_MIN = 0.0
VIEWPORT_MAX_X = 240.0
VIEWPORT_MAX_JOINT_Y = 174.0
FLOOR_Y = 175.0
HEAD_RADIUS = 11.5

BARBELL_FRONT_RADIUS = 11.5
BARBELL_BACK_RADIUS = 10.0
BARBELL_SHAFT_DX = 6.0
BARBELL_SHAFT_DY = 2.0
DUMBBELL_FRONT_RADIUS = 8.2
DUMBBELL_BACK_RADIUS = 7.0
KETTLEBELL_HANDLE_RADIUS = 5.0
KETTLEBELL_FRONT_RADIUS = 8.4
KETTLEBELL_BACK_RADIUS = 7.2
KETTLEBELL_HANDLE_DY = 2.5
KETTLEBELL_FRONT_DY = 9.0
KETTLEBELL_BACK_DY = 8.0
MAX_KB_HANDLE_DIST = 3.0
MAX_RACK_HAND_SHOULDER_DIST = 28.0

SVG_COORD_TOL = 0.03
BONE_LEN_TOL = 1e-6

SAMPLE_TS: tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 1.0)
HOLD_SAMPLE_PHASES: tuple[float, ...] = (0.0, 0.2, 0.45, 1.0, 1.5)
BREATH_WAVES: tuple[float, ...] = (-1.0, 0.0, 1.0)

EXPECTED_CATALOG_KEYS: frozenset[str] = frozenset(
    {
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
)
EXPECTED_COMPILED_EXERCISE_KEYS: frozenset[str] = frozenset(
    {
        "id",
        "name",
        "category",
        "level",
        "equipment",
        "primary_muscle",
        "secondary_muscles",
        "archetype",
        "eq_mode",
        "svg_key",
        "thumb_url",
        "rep_seconds",
        "is_hold",
        "unit",
        "how_to",
        "instructions",
        "cue_work",
        "cue_return",
        "tempo_mode",
        "is_alternating",
    }
)
REQUIRED_PRECACHE_ASSETS: frozenset[str] = frozenset(
    {
        "./",
        "./index.html",
        "./manifest.webmanifest",
        "./icon.svg",
        "./static/style.css",
        "./static/motion.js",
        "./static/sound.js",
        "./store.js",
        "./qr.js",
        "./app.js",
        "./data/catalog.json",
    }
)
ALLOWED_W3C_NAMESPACE_URLS: frozenset[str] = frozenset(
    {
        "http://www.w3.org/2000/svg",
        "http://www.w3.org/1999/xlink",
    }
)
FORBIDDEN_CDN_TOKENS: tuple[str, ...] = (
    "unpkg.com",
    "jsdelivr.net",
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "htmx.org",
    "chart.js",
)
PRIVACY_SCAN_FILES: tuple[str, ...] = (
    "index.html",
    "manifest.webmanifest",
    "icon.svg",
    "sw.js",
    "store.js",
    "qr.js",
    "app.js",
    "static/style.css",
    "static/motion.js",
    "static/sound.js",
)
REQUIRED_CSP_DIRECTIVES: tuple[str, ...] = (
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
)

VALID_TEMPO_MODES: frozenset[str] = frozenset(
    {"standard", "explosive", "alternating", "hold"}
)
HANDHELD_WEIGHT_MODES: frozenset[str] = frozenset(
    {"barbell", "dumbbell", "kettlebells"}
)
RACK_ARCHETYPES: frozenset[str] = frozenset({"squat", "lunge", "calf_raise"})
WEIGHTED_EQUIPMENT: frozenset[str] = frozenset(
    {"barbell", "dumbbell", "kettlebells", "cable", "machine", "e-z curl bar"}
)

TIER_ALLOWED_EQUIPMENT: dict[str, frozenset[str] | None] = {
    "body_only": frozenset({"body only", "foam roll", "exercise ball", "other"}),
    "dumbbells": frozenset(
        {
            "dumbbell",
            "medicine ball",
            "body only",
            "foam roll",
            "exercise ball",
            "other",
        }
    ),
    "kettlebell_bands": frozenset(
        {
            "kettlebells",
            "bands",
            "body only",
            "foam roll",
            "exercise ball",
            "other",
        }
    ),
    "full_gym": None,
}

_SEGMENT_PAIRS: tuple[tuple[str, str, str], ...] = (
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

_SW_ASSETS_RE = re.compile(
    r"APP_SHELL_ASSETS\s*=\s*(\[[^\]]*\])",
    flags=re.DOTALL,
)
_CSP_META_RE = re.compile(
    r'<meta\s+[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>',
    flags=re.IGNORECASE,
)
_CONTENT_ATTR_RE = re.compile(
    r'(?:content="([^"]+)"|content=\'([^\']+)\')',
    flags=re.IGNORECASE,
)
_URL_RE = re.compile(r"https?://[^\s\"'<>()\\]+", flags=re.IGNORECASE)

_NODE_MOTION_HARNESS = """\
const fs = require("node:fs");
const motionSrc = fs.readFileSync(process.env.TA_MOTION_JS, "utf8");
const combos = JSON.parse(process.env.TA_COMBOS_JSON);
globalThis.window = globalThis;
new Function(motionSrc)();
const TM = globalThis.TrainingMotion;
if (!TM || typeof TM.bindSvg !== "function") {
  throw new Error("TrainingMotion.bindSvg missing");
}

function makeEl() {
  return {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
  };
}

const SELECTORS = [
  ".js-head", ".js-neck", ".js-torso", ".js-thigh-f", ".js-shin-f",
  ".js-thigh-b", ".js-shin-b", ".js-forefoot-f", ".js-forefoot-b",
  ".js-uarm-f", ".js-farm-f", ".js-uarm-b", ".js-farm-b",
  ".js-j-shoulder", ".js-j-hip", ".js-j-knee", ".js-j-elbow",
  ".js-weight", ".js-weight-cap", ".js-weight-b", ".js-kb-handle-f",
  ".js-bar-shaft", ".js-bar-hub", ".js-band-f", ".js-band-b",
  ".js-cable", ".js-cable-grip", ".js-shadow", ".js-aura", ".js-ring",
  ".js-pulse",
];

const failures = [];
for (const item of combos) {
  const els = {};
  for (const sel of SELECTORS) els[sel] = makeEl();
  const svgEl = {
    dataset: {
      bones: JSON.stringify(item.bones),
      poseA: JSON.stringify(item.pose_a),
      poseB: JSON.stringify(item.pose_b),
      tempoMode: item.tempo_mode,
      holdStyle: item.hold_style,
      equipment: item.eq_mode,
      barMode: item.bar_mode,
    },
    querySelector(sel) { return els[sel] || null; },
  };
  const rig = TM.bindSvg(svgEl);
  const runs = [];
  for (const swap of [false, true]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      runs.push(() => rig.applyPose(t, { swapSides: swap }));
    }
  }
  runs.push(() => rig.applyHold(0.25));
  runs.push(() => rig.applyHold(1.0));
  for (const ph of [0, 0.8, 2.4]) {
    runs.push(() => rig.applyRestBreath(ph));
  }

  for (let i = 0; i < runs.length; i++) {
    runs[i]();
    const handF = [
      parseFloat(els[".js-farm-f"].attrs.x2),
      parseFloat(els[".js-farm-f"].attrs.y2),
    ];
    const handB = [
      parseFloat(els[".js-farm-b"].attrs.x2),
      parseFloat(els[".js-farm-b"].attrs.y2),
    ];
    const wf = [
      parseFloat(els[".js-weight"].attrs.cx),
      parseFloat(els[".js-weight"].attrs.cy),
    ];
    const wb = [
      parseFloat(els[".js-weight-b"].attrs.cx),
      parseFloat(els[".js-weight-b"].attrs.cy),
    ];
    const isPoseRun = i < 10;
    if (item.eq_mode === "barbell" || item.eq_mode === "dumbbell") {
      const df = Math.hypot(wf[0] - handF[0], wf[1] - handF[1]);
      const db = Math.hypot(wb[0] - handB[0], wb[1] - handB[1]);
      if (df > 0.03 || db > 0.03) {
        failures.push(`${item.arch}:${item.eq_mode} detached df=${df} db=${db}`);
        break;
      }
      const rf = item.eq_mode === "barbell" ? 11.5 : 8.2;
      const rb = item.eq_mode === "barbell" ? 10.0 : 7.0;
      if (isPoseRun && (wf[1] + rf > 175.01 || wb[1] + rb > 175.01 ||
          wf[0] - rf < -0.01 || wf[0] + rf > 240.01)) {
        failures.push(
          `${item.arch}:${item.eq_mode} out of bounds wf=${wf} wb=${wb}`
        );
        break;
      }
    } else if (item.eq_mode === "kettlebells") {
      const hdl = [
        parseFloat(els[".js-kb-handle-f"].attrs.cx),
        parseFloat(els[".js-kb-handle-f"].attrs.cy),
      ];
      const dh = Math.hypot(hdl[0] - handF[0], hdl[1] - handF[1]);
      if (dh > 3.0) {
        failures.push(`${item.arch}:kettlebells handle detached dh=${dh}`);
        break;
      }
      if (isPoseRun && (wf[1] + 8.4 > 175.01 || wb[1] + 7.2 > 175.01 ||
          wf[0] - 8.4 < -0.01 || wf[0] + 8.4 > 240.01)) {
        failures.push(
          `${item.arch}:kettlebells bell out of bounds wf=${wf} wb=${wb}`
        );
        break;
      }
    }
  }
}
process.stdout.write(JSON.stringify({ failures }));
"""

_NODE_PWA_E2E_HARNESS = """\
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const distDir = process.env.TA_DIST_DIR;
  const failures = [];
  const check = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const catalog = JSON.parse(
    fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8")
  );
  const storeMod = require(path.join(distDir, "store.js"));
  const qrMod = require(path.join(distDir, "qr.js"));

  function makeMemoryStorage() {
    const map = new Map();
    return {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); },
    };
  }

  // 1. Browse tiers, search reachability, prescriptions, and 876-exercise playlists
  const tierAllowed = {
    body_only: new Set(["body only", "foam roll", "exercise ball", "other"]),
    dumbbells: new Set([
      "dumbbell", "medicine ball", "body only", "foam roll", "exercise ball", "other",
    ]),
    kettlebell_bands: new Set([
      "kettlebells", "bands", "body only", "foam roll", "exercise ball", "other",
    ]),
    full_gym: null,
  };

  for (const [tier, allowed] of Object.entries(tierAllowed)) {
    const st = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
    st.setupPlan({
      name: `Browse-${tier}`,
      equipment: tier,
      starting_intensity: "moderate",
      days_per_week: 2,
    });
    const rows = st.searchCatalog("", 1000);
    const gotIds = new Set(rows.map((r) => r.id));
    const expIds = new Set(
      catalog.exercises
        .filter((ex) => !allowed || allowed.has(ex.equipment.toLowerCase()))
        .map((ex) => ex.id)
    );
    check(
      gotIds.size === expIds.size && [...expIds].every((id) => gotIds.has(id)),
      `Browse tier '${tier}' mismatch: got=${gotIds.size} expected=${expIds.size}`
    );
  }

  const fullStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  fullStore.setupPlan({
    name: "CatalogAudit",
    equipment: "full_gym",
    starting_intensity: "moderate",
    days_per_week: 2,
  });

  for (const ex of catalog.exercises) {
    const hits = fullStore.searchCatalog(ex.name, 100);
    const found = hits.find((h) => h.id === ex.id);
    if (!found) {
      failures.push(`${ex.id}: unreachable via searchCatalog('${ex.name}')`);
    } else if (!String(found.thumb_url || "").startsWith("./svgs/thumbs/")) {
      failures.push(`${ex.id}: invalid search thumb_url '${found.thumb_url}'`);
    }

    for (const eqTier of ["body_only", "full_gym"]) {
      for (const intensity of ["light", "moderate", "intense"]) {
        const rx = storeMod.defaultPrescriptionForExercise(
          { equipment: eqTier, starting_intensity: intensity },
          ex
        );
        if (rx.sets < 1 || rx.reps < 1) {
          failures.push(`${ex.id}: invalid prescription ${rx.sets}x${rx.reps}`);
        }
        if (ex.is_hold && rx.reps < 20) {
          failures.push(`${ex.id} (${intensity}): hold reps ${rx.reps} < 20`);
        }
        const scaled = storeMod.computeScaledTarget(
          {
            exercise_id: ex.id,
            sets: rx.sets,
            base_reps: rx.reps,
            base_weight_kg: rx.weight_kg,
          },
          0,
          ex
        );
        if (ex.is_hold && !scaled.formatted.includes("sec")) {
          failures.push(`${ex.id}: hold formatted '${scaled.formatted}' missing 'sec'`);
        }
      }
    }
    if (ex.is_hold) {
      const wScaled = storeMod.computeScaledTarget(
        { exercise_id: ex.id, sets: 3, base_reps: 30, base_weight_kg: 10.0 },
        0,
        ex
      );
      if (!wScaled.formatted.includes("sec")) {
        failures.push(`${ex.id}: weighted hold '${wScaled.formatted}' missing 'sec'`);
      }
    }
  }

  for (let start = 0; start < catalog.exercises.length; start += 44) {
    const batchStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
    batchStore.setupPlan({
      name: "Batch",
      equipment: "full_gym",
      starting_intensity: "moderate",
      days_per_week: 2,
    });
    const rt = batchStore.addWorkoutDay();
    const chunk = catalog.exercises.slice(start, start + 44);
    for (const ex of chunk) {
      batchStore.addExerciseToRoutine(rt.id, ex.id);
    }
    const playlist = batchStore.buildPlaylist(rt.id);
    if (playlist.length !== chunk.length) {
      failures.push(
        `Batch ${start}: playlist len ${playlist.length} != ${chunk.length}`
      );
      continue;
    }
    for (let i = 0; i < chunk.length; i++) {
      const ex = chunk[i];
      const pl = playlist[i];
      if (pl.name !== ex.name) failures.push(`${ex.id}: playlist name mismatch`);
      if (!String(pl.how_to || "").trim()) failures.push(`${ex.id}: empty how_to`);
      if (!Array.isArray(pl.instructions) || pl.instructions.length === 0) {
        failures.push(`${ex.id}: playlist missing instructions`);
      }
      if (!String(pl.svg_markup || "").startsWith("<svg") ||
          pl.svg_markup.includes('data-bar-mode="shoulder"')) {
        failures.push(`${ex.id}: invalid playlist svg_markup`);
      }
      if (pl.is_hold && pl.reps < 20) {
        failures.push(`${ex.id}: playlist hold reps ${pl.reps} < 20`);
      }
    }
  }

  // 2. Scaling, workout adaptation, and ISO-8601 week streak parity
  const adaptStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  adaptStore.setupPlan({
    name: "Sam",
    equipment: "full_gym",
    starting_intensity: "moderate",
    days_per_week: 3,
  });
  const initialCards = adaptStore.buildRoutineCards();
  const day1Id = initialCards[0].routine.id;
  const day2Id = initialCards[1].routine.id;
  adaptStore.completeWorkout(day1Id, {
    next_intensity_choice: "more",
    duration_minutes: 28,
    completed_ids: ["rx1", "rx2", "rx3", "rx4"],
  });
  check(
    adaptStore.getNextRoutineCard().routine.id === day2Id,
    "getNextRoutineCard did not advance to day 2"
  );
  const afterMore = adaptStore.buildRoutineCards();
  check(
    afterMore[0].exercises[0].scaled.formatted === "3 \u00d7 8 @ 44 kg",
    `Expected '3 \u00d7 8 @ 44 kg', got '${afterMore[0].exercises[0].scaled.formatted}'`
  );
  adaptStore.completeWorkout(day2Id, { next_intensity_choice: "less" });
  const afterLess = adaptStore.buildRoutineCards();
  check(
    afterLess[1].exercises[0].scaled.formatted === "3 \u00d7 8 @ 36 kg",
    `Expected '3 \u00d7 8 @ 36 kg', got '${afterLess[1].exercises[0].scaled.formatted}'`
  );
  check(
    storeMod.applyIntensityFeedback(-5, "less") === -5,
    "Intensity floor clamp at -5 failed"
  );
  const streakLogs = [
    { completed_at: "2026-11-12T12:00:00Z" },
    { completed_at: "2026-11-05T12:00:00Z" },
    { completed_at: "2026-10-29T12:00:00Z" },
  ];
  check(
    storeMod.computeWeekStreak(streakLogs, "2026-11-13T12:00:00Z") === 3,
    "ISO week streak calculation mismatch"
  );

  // 3. #import= deflate-raw roundtrip, backup export/import, and security hardening
  const frag = await adaptStore.encodeShareFragment();
  check(
    frag.startsWith("#import=z.") && frag.length < 700,
    `Unexpected share fragment: ${frag.slice(0, 30)} (${frag.length} chars)`
  );
  const targetStorage = makeMemoryStorage();
  const targetStore = storeMod.createStore({ storage: targetStorage, catalog });
  targetStore.setupPlan({
    name: "LocalAthlete",
    equipment: "body_only",
    starting_intensity: "light",
    days_per_week: 2,
  });
  targetStore.completeWorkout("r1", { next_intensity_choice: "keep" });
  const decoded = await targetStore.decodeShareFragment(frag);
  check(
    decoded.routineCount === 3 && decoded.exerciseCount === 12,
    "Decoded share counts mismatch"
  );
  decoded.apply({ keepExistingLogs: true });
  check(
    targetStore.getLogsDesc().length === 1 &&
      targetStore.getNextRoutineCard().routine.id === "r2",
    "Existing local logs were not preserved on #import= apply"
  );
  const freshPhoneStore = storeMod.createStore({
    storage: makeMemoryStorage(),
    catalog,
  });
  (await freshPhoneStore.decodeShareFragment(frag)).apply();
  check(
    freshPhoneStore.getNextRoutineCard().routine.id === "r3",
    "last_routine_id fallback rotation failed after plan-only share import"
  );

  // Zip-bomb (>65536 bytes decompressed) rejection
  const bombPlain = new TextEncoder().encode(
    JSON.stringify({ v: 1, pad: "A".repeat(80000) })
  );
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bombPlain);
  writer.close();
  const bombChunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    bombChunks.push(step.value);
  }
  const bombBuf = Buffer.concat(bombChunks.map((c) => Buffer.from(c)));
  const bombToken = "#import=z." + bombBuf.toString("base64url");
  let bombRejected = false;
  try {
    await targetStore.decodeShareFragment(bombToken);
  } catch {
    bombRejected = true;
  }
  check(bombRejected, "Oversized >64KB deflate-raw zip bomb was not rejected");

  let malformedRejected = false;
  try {
    await targetStore.decodeShareFragment("#import=z.!!!not_valid_base64!!!");
  } catch {
    malformedRejected = true;
  }
  check(malformedRejected, "Malformed #import= token was not rejected");

  // Untrusted JSON backup clamping & unknown exercise filtering
  const untrustedJson = JSON.stringify({
    schema_version: 1,
    profile: {
      name: "  <img src=x onerror=alert(1)>  ",
      equipment: "invalid_tier",
      starting_intensity: "extreme",
      weekly_goal: 99,
      sound_theme: "dubstep",
    },
    plan: {
      name: "Untrusted Plan",
      description: "Desc",
      days_per_week: 99,
      routines: [
        {
          id: "r1",
          name: "Day 1",
          intensity_level: -99,
          exercises: [
            { id: "x1", exercise_id: "Unknown_Fake_Ex", sets: 3, base_reps: 10 },
            {
              id: "x2",
              exercise_id: "Pushups",
              sets: 999,
              base_reps: -5,
              base_weight_kg: 99999,
            },
          ],
        },
      ],
    },
    logs: [],
  });
  const sanitized = targetStore.importBackupJson(untrustedJson, { mergeLogs: true });
  check(
    sanitized.profile.equipment === "body_only",
    "Invalid equipment not normalized"
  );
  check(sanitized.profile.weekly_goal === 7, "weekly_goal not clamped to 7");
  check(
    sanitized.plan.routines[0].intensity_level === -5,
    "intensity_level not clamped"
  );
  check(
    sanitized.plan.routines[0].exercises.length === 1 &&
      sanitized.plan.routines[0].exercises[0].sets === 20 &&
      sanitized.plan.routines[0].exercises[0].base_reps === 1 &&
      sanitized.plan.routines[0].exercises[0].base_weight_kg === 500,
    "Prescription bounds or unknown exercise filtering failed"
  );
  const exported = targetStore.exportBackupJson({ includeLogs: true });
  check(JSON.parse(exported).logs.length === 1, "Backup mergeLogs lost existing log");

  // 4. QR SVG rendering
  const shareUrl = "https://example.local/trainer/" + frag;
  const qrMat = qrMod.encodeMatrix(shareUrl);
  check(
    qrMat.size === qrMat.version * 4 + 17 && qrMat.modules[0][0] === true,
    "QR matrix size or finder corner invalid"
  );
  const qrSvg = qrMod.renderSvg(shareUrl, {
    margin: 2,
    fg: '#090d16" onload="alert(1)',
  });
  check(
    qrSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') &&
      qrSvg.includes('<path d="M') &&
      !qrSvg.includes('onload="alert(1)"'),
    "QR renderSvg output or XML escaping invalid"
  );

  // 5. Live SPA DOM (motion.js + sound.js + store.js + qr.js + app.js) E2E
  const RIG_SELECTORS = [
    ".js-head", ".js-neck", ".js-torso", ".js-thigh-f", ".js-shin-f",
    ".js-thigh-b", ".js-shin-b", ".js-forefoot-f", ".js-forefoot-b",
    ".js-uarm-f", ".js-farm-f", ".js-uarm-b", ".js-farm-b",
    ".js-j-shoulder", ".js-j-hip", ".js-j-knee", ".js-j-elbow",
    ".js-weight", ".js-weight-cap", ".js-weight-b", ".js-kb-handle-f",
    ".js-bar-shaft", ".js-bar-hub", ".js-band-f", ".js-band-b",
    ".js-cable", ".js-cable-grip", ".js-shadow", ".js-aura", ".js-ring",
    ".js-pulse",
  ];

  function toCamel(kebab) {
    return kebab.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  }

  class MockNode {
    constructor(tag) {
      this.tagName = String(tag || "DIV").toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attrs = {};
      this.dataset = {};
      this.style = {};
      this.listeners = new Map();
      this._className = "";
      this._textContent = "";
      this._innerHTML = "";
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = "";
      const self = this;
      this.classList = {
        add(...cls) {
          const set = new Set(self._className.split(/\\s+/).filter(Boolean));
          for (const c of cls) set.add(c);
          self._className = [...set].join(" ");
        },
        remove(...cls) {
          const set = new Set(self._className.split(/\\s+/).filter(Boolean));
          for (const c of cls) set.delete(c);
          self._className = [...set].join(" ");
        },
        toggle(c, force) {
          const set = new Set(self._className.split(/\\s+/).filter(Boolean));
          const shouldAdd = force !== undefined ? Boolean(force) : !set.has(c);
          if (shouldAdd) set.add(c);
          else set.delete(c);
          self._className = [...set].join(" ");
        },
        contains(c) {
          return self._className.split(/\\s+/).includes(c);
        },
      };
    }
    get id() { return this.attrs.id || ""; }
    set id(v) { this.attrs.id = String(v); }
    get className() { return this._className; }
    set className(v) { this._className = String(v); }
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this._textContent + this.children.map((c) => c.textContent || "").join("");
    }
    set textContent(v) {
      this.children = [];
      this._innerHTML = "";
      this._textContent = String(v);
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(markup) {
      this.children = [];
      this._textContent = "";
      this._innerHTML = String(markup);
      if (this._innerHTML.trim().startsWith("<svg")) {
        const svgChild = new MockNode("svg");
        const openTag = this._innerHTML.slice(0, this._innerHTML.indexOf(">") + 1);
        const attrRe = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
        let m;
        while ((m = attrRe.exec(openTag)) !== null) {
          const rawVal = m[2]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
          svgChild.setAttribute(m[1], rawVal);
        }
        const rigMap = {};
        for (const sel of RIG_SELECTORS) {
          rigMap[sel] = new MockNode("g");
        }
        svgChild.querySelector = (sel) => rigMap[sel] || null;
        this.appendChild(svgChild);
      }
    }
    setAttribute(k, v) {
      const sv = String(v);
      this.attrs[k] = sv;
      if (k === "class") this._className = sv;
      if (k.startsWith("data-")) this.dataset[toCamel(k.slice(5))] = sv;
    }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._textContent = "";
      this._innerHTML = "";
      for (const n of nodes) {
        if (n) this.appendChild(n);
      }
    }
    addEventListener(type, fn, opts) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      const set = this.listeners.get(type);
      set.add(fn);
      if (opts && opts.signal && typeof opts.signal.addEventListener === "function") {
        opts.signal.addEventListener("abort", () => set.delete(fn), { once: true });
      }
    }
    removeEventListener(type, fn) {
      const set = this.listeners.get(type);
      if (set) set.delete(fn);
    }
    dispatchEvent(evt) {
      const e = Object.assign(
        { preventDefault() {}, stopPropagation() {}, target: this },
        evt
      );
      const set = this.listeners.get(e.type);
      if (set) {
        for (const fn of [...set]) fn(e);
      }
    }
    click() { this.dispatchEvent({ type: "click" }); }
    blur() {}
    select() {}
    matches(sel) {
      if (sel === "*") return true;
      if (sel.startsWith("#")) return this.id === sel.slice(1);
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      if (sel === "a[data-nav]") {
        return this.tagName === "A" && "nav" in this.dataset;
      }
      return this.tagName === sel.toUpperCase();
    }
    getElementById(id) {
      return this.querySelector("#" + id);
    }
    querySelector(sel) {
      for (const ch of this.children) {
        if (ch.matches && ch.matches(sel)) return ch;
        if (ch.querySelector) {
          const found = ch.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const ch of node.children || []) {
          if (ch.matches && ch.matches(sel)) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    }
  }

  const docRoot = new MockNode("body");
  const topbar = new MockNode("header");
  topbar.id = "app-topbar";
  const brandLink = new MockNode("a");
  brandLink.id = "brand-home-link";
  const nav = new MockNode("nav");
  nav.id = "primary-nav";
  for (const key of ["plan", "progress", "setup"]) {
    const a = new MockNode("a");
    a.dataset.nav = key;
    nav.appendChild(a);
  }
  topbar.appendChild(brandLink);
  topbar.appendChild(nav);
  const appRoot = new MockNode("div");
  appRoot.id = "app-root";
  const modalRoot = new MockNode("div");
  modalRoot.id = "modal-root";
  modalRoot.hidden = true;
  const toastRoot = new MockNode("div");
  toastRoot.id = "toast-root";
  docRoot.appendChild(topbar);
  docRoot.appendChild(appRoot);
  docRoot.appendChild(modalRoot);
  docRoot.appendChild(toastRoot);

  const domStorage = makeMemoryStorage();
  const winListeners = new Map();
  let currentHash = "";
  const activeRafs = new Map();
  const activeIntervals = new Map();
  let timerSeq = 1;

  const mockWindow = globalThis;
  mockWindow.window = mockWindow;
  mockWindow.localStorage = domStorage;
  mockWindow.__TRAINING_CATALOG__ = catalog;
  mockWindow.TrainingStore = storeMod;
  mockWindow.TrainingQR = qrMod;
  mockWindow.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  mockWindow.requestAnimationFrame = (cb) => {
    const id = timerSeq++;
    activeRafs.set(id, cb);
    return id;
  };
  mockWindow.cancelAnimationFrame = (id) => { activeRafs.delete(id); };
  globalThis.setInterval = (cb) => {
    const id = timerSeq++;
    activeIntervals.set(id, cb);
    return id;
  };
  globalThis.clearInterval = (id) => { activeIntervals.delete(id); };
  mockWindow.history = {
    replaceState(_s, _t, url) {
      const idx = String(url).indexOf("#");
      currentHash = idx >= 0 ? String(url).slice(idx) : "";
    },
  };
  mockWindow.location = {
    protocol: "https:",
    origin: "https://trainer.local",
    pathname: "/",
    search: "",
    get href() { return "https://trainer.local/" + currentHash; },
    get hash() { return currentHash; },
    set hash(v) {
      const next = v.startsWith("#") ? v : "#" + v;
      if (currentHash !== next) {
        currentHash = next;
        const set = winListeners.get("hashchange");
        if (set) for (const fn of [...set]) fn({ type: "hashchange" });
      }
    },
  };
  mockWindow.addEventListener = (type, fn, opts) => {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    const set = winListeners.get(type);
    set.add(fn);
    if (opts && opts.signal) {
      opts.signal.addEventListener("abort", () => set.delete(fn), { once: true });
    }
  };
  mockWindow.removeEventListener = (type, fn) => {
    const set = winListeners.get(type);
    if (set) set.delete(fn);
  };

  globalThis.document = {
    readyState: "complete",
    hidden: false,
    title: "",
    body: docRoot,
    documentElement: docRoot,
    createElement: (tag) => new MockNode(tag),
    createElementNS: (_ns, tag) => new MockNode(tag),
    createTextNode: (txt) => {
      const t = new MockNode("#text");
      t.textContent = String(txt);
      return t;
    },
    getElementById: (id) => docRoot.querySelector("#" + id),
    addEventListener: (t, fn, o) => docRoot.addEventListener(t, fn, o),
    removeEventListener: (t, fn) => docRoot.removeEventListener(t, fn),
    execCommand: () => true,
  };

  new Function(
    fs.readFileSync(path.join(distDir, "static", "motion.js"), "utf8")
  )();
  new Function(
    fs.readFileSync(path.join(distDir, "static", "sound.js"), "utf8")
  )();
  new Function(fs.readFileSync(path.join(distDir, "app.js"), "utf8"))();

  await new Promise((r) => setTimeout(r, 10));
  check(currentHash === "#setup", `Expected initial #setup, got '${currentHash}'`);

  // Submit setup with XSS payload in athlete name & full_gym
  const setupForm = appRoot.querySelector(".setup-form");
  const allInputs = setupForm.querySelectorAll("input");
  const nameInput = allInputs.find((n) => n.attrs.name === "name");
  const fullGymRadio = allInputs.find(
    (n) => n.attrs.name === "equipment" && n.value === "full_gym"
  );
  nameInput.value = "<img src=x onerror=alert(1)>";
  for (const inp of allInputs) {
    if (inp.attrs.name === "equipment") inp.checked = inp === fullGymRadio;
  }
  fullGymRadio.dispatchEvent({ type: "change" });
  setupForm.dispatchEvent({ type: "submit" });

  check(currentHash === "#plan", `Expected #plan after setup, got '${currentHash}'`);
  const badNodes = docRoot
    .querySelectorAll("*")
    .filter((n) => n.attrs && ("onerror" in n.attrs || n.tagName === "SCRIPT"));
  check(badNodes.length === 0, "XSS payload created unsafe DOM element/attribute");

  // Navigate to #workout/r1 and verify live how_to coaching HUD
  mockWindow.location.hash = "#workout/r1";
  check(topbar.hidden === true, "Topbar must be hidden during active workout");
  check(
    !appRoot.textContent.includes("What to do:"),
    "Workout view contains forbidden 'What to do:' text"
  );
  const liveStore = storeMod.createStore({ storage: domStorage, catalog });
  const r1Playlist = liveStore.buildPlaylist("r1");
  const howToEl = docRoot.getElementById("ex-how-to");
  const gotHowTo = howToEl && howToEl.textContent;
  check(
    howToEl && gotHowTo === r1Playlist[0].how_to,
    `Initial #ex-how-to '${gotHowTo}' != '${r1Playlist[0].how_to}'`
  );

  // Advance through exercise 1 sets to verify dynamic #ex-how-to update
  const primaryBtn = docRoot.getElementById("primary-btn");
  const skipBtn = docRoot.getElementById("skip-btn");
  primaryBtn.click(); // IDLE -> COUNTDOWN
  skipBtn.click(); // COUNTDOWN -> ACTIVE S1
  for (let s = 1; s < r1Playlist[0].sets; s++) {
    skipBtn.click(); // ACTIVE -> REST
    skipBtn.click(); // REST -> ACTIVE
  }
  skipBtn.click(); // Final set of ex 1 -> REST before ex 2
  check(
    howToEl.textContent === r1Playlist[1].how_to,
    `Dynamic #ex-how-to did not update to ex 2: '${howToEl.textContent}'`
  );

  // Sound theme selector syncs with storage
  const soundSelect = docRoot.getElementById("sound-theme-select");
  soundSelect.value = "techno";
  soundSelect.dispatchEvent({ type: "change" });
  check(
    domStorage.getItem(storeMod.SOUND_STORAGE_KEY) === "techno",
    "Sound selector did not persist sound theme"
  );

  // Early finish -> +10% adaptation -> returns to #plan with status banner
  docRoot.getElementById("early-finish-btn").click();
  const moreTile = appRoot
    .querySelectorAll("button")
    .find((b) => b.value === "more");
  moreTile.click();
  check(currentHash === "#plan", "Finish tile did not return to #plan");
  check(
    appRoot.textContent.includes("+10%"),
    "Post-workout +10% adaptation banner missing on #plan"
  );

  // Navigate #progress -> #edit/r1 and verify zero leaked intervals
  mockWindow.location.hash = "#progress";
  check(
    Boolean(appRoot.querySelector(".progress-svg-chart")),
    "Inline SVG progress chart did not render on #progress"
  );
  mockWindow.location.hash = "#edit/r1";
  check(activeIntervals.size === 0, `Leaked ${activeIntervals.size} intervals`);

  process.stdout.write(JSON.stringify({ failures }));
})().catch((err) => {
  process.stdout.write(
    JSON.stringify({ failures: [`Unhandled Node E2E error: ${err.stack || err}`] })
  );
});
"""


@dataclass(frozen=True, slots=True)
class AuditConfig:
    """File-path and allowlist configuration for the end-to-end static PWA audit."""

    exercises_path: Path = DATA_DIR / "exercises.json"
    coaching_path: Path = DATA_DIR / "exercise_coaching.json"
    animations_path: Path = DATA_DIR / "animations.json"
    programs_path: Path = DATA_DIR / "programs.json"
    motion_js_path: Path = STATIC_DIR / "motion.js"
    svgs_dir: Path = STATIC_DIR / "svgs"
    pwa_dir: Path = PWA_DIR
    expected_count: int = EXPECTED_CATALOG_COUNT
    fallback_allowlist: frozenset[str] = field(
        default_factory=lambda: frozenset(
            getattr(coaching, "ARCHETYPE_FALLBACK_ALLOWLIST", ())
        )
    )


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


def find_node_binary() -> str | None:
    """Locate a Node.js executable on PATH or under standard user-local directories."""
    env_bin = os.environ.get("TA_NODE_BIN")
    if env_bin and Path(env_bin).is_file() and os.access(env_bin, os.X_OK):
        return env_bin

    which_bin = shutil.which("node")
    if which_bin is not None:
        return which_bin

    home = Path.home()
    search_patterns = (
        (home / ".local" / "share", "*/node-v*/bin/node"),
        (home / ".nvm" / "versions" / "node", "*/bin/node"),
    )
    for base_dir, pattern in search_patterns:
        if not base_dir.is_dir():
            continue
        for candidate in sorted(base_dir.glob(pattern), reverse=True):
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _parse_svg(svg_markup: str) -> ET.Element:
    return ET.fromstring(svg_markup)  # noqa: S314


def _has_nonempty_instructions(raw_steps: object) -> bool:
    if not isinstance(raw_steps, (list, tuple)) or not raw_steps:
        return False
    return all(isinstance(step, str) and bool(step.strip()) for step in raw_steps)


def _check_circle_bounds(
    label: str,
    center: tuple[float, float],
    radius: float,
    errors: list[str],
) -> None:
    cx, cy = center
    if cx - radius < VIEWPORT_MIN - SVG_COORD_TOL:
        errors.append(f"{label} left edge {cx - radius:.2f} < 0")
    if cx + radius > VIEWPORT_MAX_X + SVG_COORD_TOL:
        errors.append(f"{label} right edge {cx + radius:.2f} > {VIEWPORT_MAX_X}")
    if cy - radius < VIEWPORT_MIN - SVG_COORD_TOL:
        errors.append(f"{label} top edge {cy - radius:.2f} < 0")
    if cy + radius > FLOOR_Y + SVG_COORD_TOL:
        errors.append(
            f"{label} bottom edge {cy + radius:.2f} > {FLOOR_Y} (floor penetration)"
        )


def _validate_raw_catalog_items(
    raw_items: list[Any],
    expected_count: int,
    errors: list[str],
) -> set[str]:
    if len(raw_items) != expected_count:
        errors.append(
            f"exercises.json count {len(raw_items)} != expected {expected_count}"
        )
    raw_ids: list[str] = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            errors.append(f"exercises.json[{idx}] is not an object")
            continue
        ex_id = str(item.get("id") or "").strip()
        raw_ids.append(ex_id)
        if set(item.keys()) != EXPECTED_CATALOG_KEYS:
            errors.append(f"{ex_id or idx}: unexpected catalog schema keys")
        if not ex_id:
            errors.append(f"exercises.json[{idx}] has empty id")
        if not _has_nonempty_instructions(item.get("instructions")):
            errors.append(f"{ex_id}: raw instructions in exercises.json is empty")

    unique_ids = set(raw_ids)
    if len(unique_ids) != len(raw_items):
        errors.append(
            f"Duplicate exercise IDs: {len(unique_ids)} unique vs {len(raw_items)}"
        )
    return unique_ids


def _validate_loaded_exercises(
    exercises: list[CatalogExercise],
    errors: list[str],
) -> None:
    for ex in exercises:
        for field_name in ("id", "name", "category", "equipment", "primary_muscle"):
            val = getattr(ex, field_name, "")
            if not isinstance(val, str) or not val.strip():
                errors.append(f"{ex.id}: empty CatalogExercise.{field_name}")
        if not _has_nonempty_instructions(ex.instructions):
            errors.append(f"{ex.id}: CatalogExercise.instructions is empty")


def _check_compiled_exercise_entries(
    dist_dir: Path,
    compiled_exercises: list[Any],
    svgs: dict[str, Any],
    errors: list[str],
) -> set[str]:
    compiled_ids: set[str] = set()
    for item in compiled_exercises:
        if not isinstance(item, dict):
            errors.append("catalog.json contains non-dict exercise entry")
            continue
        ex_id = str(item.get("id") or "")
        compiled_ids.add(ex_id)
        if set(item.keys()) != EXPECTED_COMPILED_EXERCISE_KEYS:
            errors.append(f"{ex_id}: compiled exercise keys mismatch")
        svg_key = str(item.get("svg_key") or "")
        if svg_key not in svgs:
            errors.append(f"{ex_id}: missing svg_key '{svg_key}' in catalog.svgs")
        thumb_rel = str(item.get("thumb_url") or "").removeprefix("./")
        if not thumb_rel or not (dist_dir / thumb_rel).is_file():
            errors.append(f"{ex_id}: missing thumbnail file '{thumb_rel}'")
    return compiled_ids


def _check_compiled_catalog_payload(
    dist_dir: Path,
    catalog: dict[str, Any],
    expected_ids: set[str],
    errors: list[str],
) -> None:
    if catalog.get("schema_version") != 1:
        errors.append(f"catalog.json schema_version={catalog.get('schema_version')}")

    compiled_exercises = catalog.get("exercises")
    if not isinstance(compiled_exercises, list):
        errors.append("catalog.json 'exercises' is not a list")
        return

    if len(compiled_exercises) != len(expected_ids):
        errors.append(
            f"catalog.json exercise count {len(compiled_exercises)} "
            f"!= {len(expected_ids)}"
        )

    raw_svgs = catalog.get("svgs")
    svgs = raw_svgs if isinstance(raw_svgs, dict) else {}
    if len(svgs) != EXPECTED_INLINE_SVG_COUNT:
        errors.append(
            f"catalog.json inline SVG count {len(svgs)} != {EXPECTED_INLINE_SVG_COUNT}"
        )

    thumbs_dir = dist_dir / "svgs" / "thumbs"
    thumb_files = list(thumbs_dir.glob("*.svg")) if thumbs_dir.is_dir() else []
    if len(thumb_files) != EXPECTED_THUMBNAIL_COUNT:
        errors.append(
            f"Thumbnail file count {len(thumb_files)} != {EXPECTED_THUMBNAIL_COUNT}"
        )

    compiled_ids = _check_compiled_exercise_entries(
        dist_dir, compiled_exercises, svgs, errors
    )
    if compiled_ids != expected_ids:
        errors.append("Compiled catalog.json IDs diverge from exercises.json IDs")


def _check_manifest_json(dist_dir: Path, errors: list[str]) -> None:
    manifest_path = dist_dir / "manifest.webmanifest"
    if not manifest_path.is_file():
        errors.append("Missing manifest.webmanifest in dist/")
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("display") != "standalone":
        errors.append("manifest.webmanifest display != 'standalone'")
    if manifest.get("start_url") != "./":
        errors.append("manifest.webmanifest start_url != './'")
    for icon in manifest.get("icons", []):
        icon_rel = str(icon.get("src") or "").removeprefix("./")
        if not icon_rel or not (dist_dir / icon_rel).is_file():
            errors.append(f"manifest.webmanifest missing icon '{icon_rel}'")


def _check_manifest_and_service_worker(dist_dir: Path, errors: list[str]) -> None:
    _check_manifest_json(dist_dir, errors)

    sw_path = dist_dir / "sw.js"
    if not sw_path.is_file():
        errors.append("Missing sw.js in dist/")
        return

    sw_src = sw_path.read_text(encoding="utf-8")
    match = _SW_ASSETS_RE.search(sw_src)
    if match is None:
        errors.append("sw.js missing APP_SHELL_ASSETS array")
        return

    raw_array_json = re.sub(r",\s*\]", "]", match.group(1))
    assets = json.loads(raw_array_json)
    missing_req = sorted(REQUIRED_PRECACHE_ASSETS - set(assets))
    if missing_req:
        errors.append(f"sw.js APP_SHELL_ASSETS missing required paths: {missing_req}")
    for rel_url in assets:
        clean_rel = str(rel_url).removeprefix("./")
        target = dist_dir if not clean_rel else dist_dir / clean_rel
        if not target.exists():
            errors.append(f"sw.js precache asset does not exist in dist/: {rel_url}")


def _check_csp_and_zero_external_urls(dist_dir: Path, errors: list[str]) -> None:
    index_path = dist_dir / "index.html"
    if not index_path.is_file():
        errors.append("Missing index.html in dist/")
        return

    index_html = index_path.read_text(encoding="utf-8")
    csp_match = _CSP_META_RE.search(index_html)
    if csp_match is None:
        errors.append("index.html missing Content-Security-Policy meta tag")
    else:
        attr_match = _CONTENT_ATTR_RE.search(csp_match.group(0))
        csp_val = (
            (attr_match.group(1) or attr_match.group(2) or "") if attr_match else ""
        )
        errors.extend(
            f"index.html CSP missing directive: {directive}"
            for directive in REQUIRED_CSP_DIRECTIVES
            if directive not in csp_val
        )
        if "http:" in csp_val or "https:" in csp_val or "*" in csp_val:
            errors.append(f"index.html CSP allows external origins: {csp_val}")

    for rel_file in PRIVACY_SCAN_FILES:
        file_path = dist_dir / rel_file
        if not file_path.is_file():
            errors.append(f"Missing expected PWA file in dist/: {rel_file}")
            continue
        text = file_path.read_text(encoding="utf-8")
        lower_text = text.lower()
        errors.extend(
            f"{rel_file}: contains forbidden external CDN reference '{token}'"
            for token in FORBIDDEN_CDN_TOKENS
            if token in lower_text
        )
        for url in _URL_RE.findall(text):
            cleaned_url = url.rstrip(".,;:'\"`")
            if cleaned_url not in ALLOWED_W3C_NAMESPACE_URLS:
                errors.append(f"{rel_file}: unexpected external URL '{cleaned_url}'")


def _audit_catalog_and_pwa_bundle(
    cfg: AuditConfig,
    dist_dir: Path,
) -> tuple[AuditSectionResult, list[CatalogExercise], set[str], dict[str, Any]]:
    if not cfg.exercises_path.is_file():
        return (
            AuditSectionResult(
                "catalog_and_pwa_bundle",
                0,
                (f"Missing exercises catalog: {cfg.exercises_path}",),
            ),
            [],
            set(),
            {},
        )

    raw_items = json.loads(cfg.exercises_path.read_text(encoding="utf-8"))
    if not isinstance(raw_items, list):
        return (
            AuditSectionResult(
                "catalog_and_pwa_bundle",
                0,
                ("exercises.json root must be a JSON list",),
            ),
            [],
            set(),
            {},
        )

    errors: list[str] = []
    unique_raw_ids = _validate_raw_catalog_items(raw_items, cfg.expected_count, errors)
    exercises = load_catalog_exercises(cfg.exercises_path)
    if {ex.id for ex in exercises} != unique_raw_ids:
        errors.append("load_catalog_exercises IDs do not match exercises.json IDs")
    _validate_loaded_exercises(exercises, errors)

    summary = build_pwa(
        dist_dir,
        data_dir=cfg.exercises_path.parent,
        static_dir=cfg.motion_js_path.parent,
        pwa_dir=cfg.pwa_dir,
    )
    catalog = summary["catalog"]
    _check_compiled_catalog_payload(dist_dir, catalog, unique_raw_ids, errors)
    _check_manifest_and_service_worker(dist_dir, errors)
    _check_csp_and_zero_external_urls(dist_dir, errors)

    return (
        AuditSectionResult("catalog_and_pwa_bundle", len(exercises), tuple(errors)),
        exercises,
        unique_raw_ids,
        catalog,
    )


def _probe_fallback_archetype(ex: CatalogExercise) -> str:
    probe = CatalogExercise(
        id=f"__audit__ {ex.id}",
        name=ex.name,
        category=ex.category,
        level=ex.level,
        equipment=ex.equipment,
        primary_muscle=ex.primary_muscle,
        secondary_muscles=ex.secondary_muscles,
        instructions=ex.instructions,
    )
    return classify_archetype(probe)


def _check_guidance_fields(
    ex: CatalogExercise,
    guide: dict[str, Any],
    errors: list[str],
) -> None:
    if bool(guide.get("is_hold")) != (guide.get("tempo_mode") == "hold"):
        errors.append(f"{ex.id}: guidance is_hold/tempo_mode mismatch")
    if bool(guide.get("is_hold")) != is_hold_exercise(ex):
        errors.append(f"{ex.id}: guidance is_hold != is_hold_exercise(ex)")
    if is_hold_exercise(ex) != is_hold_exercise(ex.id):
        errors.append(f"{ex.id}: is_hold_exercise(ex) != is_hold_exercise(ex.id)")

    for str_key in ("how_to", "cue_work", "cue_return", "svg_url", "svg_markup"):
        val = guide.get(str_key)
        if not isinstance(val, str) or not val.strip():
            errors.append(f"{ex.id}: empty or missing guidance['{str_key}']")

    svg_url = str(guide.get("svg_url") or "")
    if not svg_url.startswith("./svgs/thumbs/"):
        errors.append(f"{ex.id}: svg_url '{svg_url}' is not a relative ./svgs/thumbs/")

    if not _has_nonempty_instructions(guide.get("instructions")):
        errors.append(
            f"{ex.id}: build_exercise_guidance missing non-empty instructions"
        )


def _check_single_exercise_coaching(
    ex: CatalogExercise,
    entry: object,
    allowlist: frozenset[str],
    errors: list[str],
) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        errors.append(f"{ex.id}: missing coaching dict entry")
        return None

    arch = str(entry.get("archetype") or "")
    tempo_mode = str(entry.get("tempo_mode") or "")
    is_hold_flag = bool(entry.get("is_hold"))

    if arch not in ARCHETYPE_SPECS:
        errors.append(f"{ex.id}: invalid archetype '{arch}'")
    if tempo_mode not in VALID_TEMPO_MODES:
        errors.append(f"{ex.id}: invalid tempo_mode '{tempo_mode}'")
    if is_hold_flag != (tempo_mode == "hold"):
        errors.append(
            f"{ex.id}: is_hold={is_hold_flag} != (tempo_mode=='hold') [{tempo_mode}]"
        )
    if ex.category.lower() == "stretching" and not is_hold_flag:
        errors.append(f"{ex.id}: stretching exercise must have is_hold=True")
    if classify_archetype(ex) != arch:
        errors.append(f"{ex.id}: classify_archetype={classify_archetype(ex)} != {arch}")

    fb_arch = _probe_fallback_archetype(ex)
    if fb_arch != arch and ex.id not in allowlist:
        errors.append(f"{ex.id}: coaching '{arch}' diverges from fallback '{fb_arch}'")

    guide = build_exercise_guidance(ex)
    _check_guidance_fields(ex, guide, errors)
    return guide


def _audit_coaching_integration(
    cfg: AuditConfig,
    exercises: list[CatalogExercise],
    raw_ids: set[str],
    catalog: dict[str, Any],
) -> tuple[AuditSectionResult, dict[str, dict[str, Any]]]:
    guidances: dict[str, dict[str, Any]] = {}
    if not cfg.coaching_path.is_file():
        return (
            AuditSectionResult(
                "coaching_integration",
                0,
                (f"Missing exercise_coaching.json: {cfg.coaching_path}",),
            ),
            guidances,
        )

    errors: list[str] = []
    coaching_map = json.loads(cfg.coaching_path.read_text(encoding="utf-8"))
    if set(coaching_map.keys()) != raw_ids:
        missing = sorted(raw_ids - set(coaching_map.keys()))[:5]
        extra = sorted(set(coaching_map.keys()) - raw_ids)[:5]
        errors.append(
            f"exercise_coaching.json ID parity mismatch: "
            f"missing={missing} extra={extra}"
        )

    if len(ARCHETYPE_SPECS) != EXPECTED_ARCHETYPE_COUNT:
        errors.append(
            f"ARCHETYPE_SPECS count {len(ARCHETYPE_SPECS)} "
            f"!= {EXPECTED_ARCHETYPE_COUNT}"
        )
    if set(ARCHETYPE_COACHING.keys()) != set(ARCHETYPE_SPECS.keys()):
        errors.append("ARCHETYPE_COACHING keys diverge from ARCHETYPE_SPECS")

    compiled_by_id = {
        str(item["id"]): item
        for item in catalog.get("exercises", [])
        if isinstance(item, dict) and "id" in item
    }
    for ex in exercises:
        guide = _check_single_exercise_coaching(
            ex, coaching_map.get(ex.id), cfg.fallback_allowlist, errors
        )
        if guide is not None:
            guidances[ex.id] = guide
            comp = compiled_by_id.get(ex.id)
            if comp is not None and (
                comp.get("archetype") != guide["archetype"]
                or comp.get("how_to") != guide["how_to"]
                or comp.get("thumb_url") != guide["svg_url"]
            ):
                errors.append(f"{ex.id}: compiled catalog metadata diverges from guide")

    return (
        AuditSectionResult("coaching_integration", len(exercises), tuple(errors)),
        guidances,
    )


def _check_joint_and_bone_bounds(
    label: str,
    bones: dict[str, float],
    pts: dict[str, tuple[float, float]],
    errors: list[str],
) -> None:
    for p1_key, p2_key, bone_key in _SEGMENT_PAIRS:
        actual = _dist(pts[p1_key], pts[p2_key])
        if abs(actual - bones[bone_key]) > BONE_LEN_TOL:
            errors.append(
                f"{label}: bone {bone_key} distorted "
                f"({actual:.6f} != {bones[bone_key]})"
            )

    for joint_name, (jx, jy) in pts.items():
        if not (VIEWPORT_MIN <= jx <= VIEWPORT_MAX_X):
            errors.append(f"{label}: {joint_name} x={jx:.2f} outside 0..240")
        if not (VIEWPORT_MIN <= jy <= VIEWPORT_MAX_JOINT_Y):
            errors.append(f"{label}: {joint_name} y={jy:.2f} outside 0..174")

    hx, hy = pts["head"]
    if not (HEAD_RADIUS <= hx <= VIEWPORT_MAX_X - HEAD_RADIUS):
        errors.append(f"{label}: head x={hx:.2f} clips viewport")
    if not (HEAD_RADIUS <= hy <= VIEWPORT_MAX_JOINT_Y):
        errors.append(f"{label}: head y={hy:.2f} clips viewport")


def _check_barbell_bounds(
    label: str,
    hand_f: tuple[float, float],
    hand_b: tuple[float, float],
    errors: list[str],
) -> None:
    _check_circle_bounds(f"{label} barbell front", hand_f, BARBELL_FRONT_RADIUS, errors)
    _check_circle_bounds(f"{label} barbell back", hand_b, BARBELL_BACK_RADIUS, errors)
    for end_name, sx, sy in (
        ("shaft-b", hand_b[0] - BARBELL_SHAFT_DX, hand_b[1] - BARBELL_SHAFT_DY),
        ("shaft-f", hand_f[0] + BARBELL_SHAFT_DX, hand_f[1] + BARBELL_SHAFT_DY),
    ):
        if not (VIEWPORT_MIN <= sx <= VIEWPORT_MAX_X) or not (
            VIEWPORT_MIN <= sy <= FLOOR_Y
        ):
            errors.append(f"{label} {end_name} ({sx:.2f}, {sy:.2f}) out of bounds")


def _check_kinematic_weight_props(
    label: str,
    eq_mode: str,
    bar_mode: str,
    pts: dict[str, tuple[float, float]],
    errors: list[str],
) -> None:
    if bar_mode == "shoulder":
        errors.append(f"{label}: forbidden bar_mode='shoulder'")
        return

    hand_f = pts["hand_f"]
    hand_b = pts["hand_b"]
    if eq_mode == "barbell":
        _check_barbell_bounds(label, hand_f, hand_b, errors)
    elif eq_mode == "dumbbell":
        _check_circle_bounds(
            f"{label} dumbbell front", hand_f, DUMBBELL_FRONT_RADIUS, errors
        )
        _check_circle_bounds(
            f"{label} dumbbell back", hand_b, DUMBBELL_BACK_RADIUS, errors
        )
    elif eq_mode == "kettlebells":
        hdl_center = (hand_f[0], hand_f[1] + KETTLEBELL_HANDLE_DY)
        kb_front = (hand_f[0], hand_f[1] + KETTLEBELL_FRONT_DY)
        kb_back = (hand_b[0], hand_b[1] + KETTLEBELL_BACK_DY)
        if _dist(hand_f, hdl_center) > MAX_KB_HANDLE_DIST:
            errors.append(f"{label}: kettlebell handle detached from hand_f")
        _check_circle_bounds(
            f"{label} kb handle", hdl_center, KETTLEBELL_HANDLE_RADIUS, errors
        )
        _check_circle_bounds(
            f"{label} kb front", kb_front, KETTLEBELL_FRONT_RADIUS, errors
        )
        _check_circle_bounds(
            f"{label} kb back", kb_back, KETTLEBELL_BACK_RADIUS, errors
        )


def _check_non_handheld_svg_props(
    label: str,
    root: ET.Element,
    eq_mode: str,
    errors: list[str],
) -> None:
    wf_el = root.find(".//*[@class='js-weight']")
    if eq_mode == "body_only":
        errors.extend(
            f"{label}: body_only unexpectedly renders .{cls}"
            for cls in ("js-weight", "js-bar-shaft", "js-band-f", "js-cable")
            if root.find(f".//*[@class='{cls}']") is not None
        )
    elif eq_mode == "bands":
        if root.find(".//*[@class='js-band-f']") is None or wf_el is not None:
            errors.append(f"{label}: bands SVG missing .js-band-f or has .js-weight")
    elif eq_mode in {"cable", "machine"} and (
        root.find(".//*[@class='js-cable']") is None or wf_el is not None
    ):
        errors.append(f"{label}: {eq_mode} SVG missing .js-cable or has .js-weight")


def _check_barbell_svg_elements(
    label: str,
    root: ET.Element,
    hand_f: tuple[float, float],
    errors: list[str],
) -> None:
    hub_el = root.find(".//*[@class='js-bar-hub']")
    shaft_el = root.find(".//*[@class='js-bar-shaft']")
    if root.attrib.get("data-bar-mode") != "hands":
        errors.append(f"{label}: barbell SVG data-bar-mode != 'hands'")
    if hub_el is None or shaft_el is None:
        errors.append(f"{label}: barbell missing .js-bar-hub or .js-bar-shaft")
        return
    hub = (float(hub_el.attrib["cx"]), float(hub_el.attrib["cy"]))
    if _dist(hub, hand_f) > SVG_COORD_TOL:
        errors.append(f"{label}: .js-bar-hub detached from hand_f")


def _check_kettlebell_svg_elements(
    label: str,
    root: ET.Element,
    hands: tuple[tuple[float, float], tuple[float, float]],
    weights: tuple[tuple[float, float], tuple[float, float]],
    errors: list[str],
) -> None:
    hand_f, hand_b = hands
    wf, wb = weights
    hdl_el = root.find(".//*[@class='js-kb-handle-f']")
    if hdl_el is None:
        errors.append(f"{label}: kettlebells missing .js-kb-handle-f")
        return
    hdl = (float(hdl_el.attrib["cx"]), float(hdl_el.attrib["cy"]))
    _check_circle_bounds(
        f"{label} .js-kb-handle-f", hdl, float(hdl_el.attrib["r"]), errors
    )
    if _dist(hdl, hand_f) > MAX_KB_HANDLE_DIST:
        errors.append(
            f"{label}: kettlebell handle detached (dist={_dist(hdl, hand_f):.2f})"
        )
    if (
        abs(wf[1] - (hand_f[1] + KETTLEBELL_FRONT_DY)) > SVG_COORD_TOL
        or abs(wb[1] - (hand_b[1] + KETTLEBELL_BACK_DY)) > SVG_COORD_TOL
    ):
        errors.append(f"{label}: kettlebell bell clamped/detached from hand offset")


def _check_handheld_svg_props(
    label: str,
    root: ET.Element,
    eq_mode: str,
    hands: tuple[tuple[float, float], tuple[float, float]],
    errors: list[str],
) -> None:
    hand_f, hand_b = hands
    wf_el = root.find(".//*[@class='js-weight']")
    wb_el = root.find(".//*[@class='js-weight-b']")
    if wf_el is None or wb_el is None:
        errors.append(f"{label}: {eq_mode} missing .js-weight or .js-weight-b")
        return

    wf = (float(wf_el.attrib["cx"]), float(wf_el.attrib["cy"]))
    wb = (float(wb_el.attrib["cx"]), float(wb_el.attrib["cy"]))
    _check_circle_bounds(f"{label} .js-weight", wf, float(wf_el.attrib["r"]), errors)
    _check_circle_bounds(f"{label} .js-weight-b", wb, float(wb_el.attrib["r"]), errors)

    if eq_mode in {"barbell", "dumbbell"}:
        if _dist(wf, hand_f) > SVG_COORD_TOL or _dist(wb, hand_b) > SVG_COORD_TOL:
            errors.append(
                f"{label}: {eq_mode} weight detached from hands "
                f"(df={_dist(wf, hand_f):.2f}, db={_dist(wb, hand_b):.2f})"
            )
        if eq_mode == "barbell":
            _check_barbell_svg_elements(label, root, hand_f, errors)
    elif eq_mode == "kettlebells":
        _check_kettlebell_svg_elements(label, root, (hand_f, hand_b), (wf, wb), errors)


def _check_rendered_svg_safe_grip_and_props(
    label: str,
    root: ET.Element,
    arch: str,
    eq_mode: str,
    errors: list[str],
) -> None:
    if root.attrib.get("data-archetype") != arch:
        errors.append(
            f"{label}: data-archetype={root.attrib.get('data-archetype')} != {arch}"
        )
    if root.attrib.get("data-equipment") != eq_mode:
        errors.append(
            f"{label}: data-equipment={root.attrib.get('data-equipment')} != {eq_mode}"
        )
    if root.attrib.get("data-bar-mode") == "shoulder":
        errors.append(f"{label}: SVG has forbidden data-bar-mode='shoulder'")

    farm_f = root.find(".//*[@class='js-farm-f']")
    farm_b = root.find(".//*[@class='js-farm-b']")
    if farm_f is None or farm_b is None:
        errors.append(f"{label}: missing forearm elements .js-farm-f/.js-farm-b")
        return

    if eq_mode not in HANDHELD_WEIGHT_MODES:
        _check_non_handheld_svg_props(label, root, eq_mode, errors)
        return

    hand_f = (float(farm_f.attrib["x2"]), float(farm_f.attrib["y2"]))
    hand_b = (float(farm_b.attrib["x2"]), float(farm_b.attrib["y2"]))
    _check_handheld_svg_props(label, root, eq_mode, (hand_f, hand_b), errors)


def _check_motion_js_source(motion_js_path: Path, errors: list[str]) -> bool:
    if not motion_js_path.is_file():
        errors.append(f"Missing motion.js: {motion_js_path}")
        return False

    src = motion_js_path.read_text(encoding="utf-8")
    if src.count("{") != src.count("}") or src.count("(") != src.count(")"):
        errors.append("motion.js has unbalanced braces or parentheses")

    if "function renderPoseState" not in src:
        errors.append("motion.js missing function renderPoseState")
        return True

    render_body = src[src.index("function renderPoseState") :]
    if "querySelector" in render_body:
        errors.append("motion.js calls querySelector inside/after renderPoseState")
    if 'barMode === "shoulder"' in render_body or "barMode == 'shoulder'" in src:
        errors.append("motion.js still contains shoulder barMode detachment branch")
    if "Math.min(159" in render_body or "Math.min(165" in render_body:
        errors.append("motion.js still clamps kettlebell y via Math.min(159/165)")
    return True


def _run_node_motion_harness(
    node_bin: str,
    motion_js_path: Path,
    handheld_combos: list[tuple[str, str]],
    errors: list[str],
) -> None:
    payload = [
        {
            "arch": arch,
            "eq_mode": eq_mode,
            "bones": ARCHETYPE_SPECS[arch]["bones"],
            "pose_a": ARCHETYPE_SPECS[arch]["pose_a"],
            "pose_b": ARCHETYPE_SPECS[arch]["pose_b"],
            "tempo_mode": ARCHETYPE_SPECS[arch]["coaching"]["tempo_mode"],
            "hold_style": ARCHETYPE_SPECS[arch]["hold_style"],
            "bar_mode": ARCHETYPE_SPECS[arch]["bar_mode"],
        }
        for arch, eq_mode in handheld_combos
    ]
    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _NODE_MOTION_HARNESS],
        env={
            **os.environ,
            "TA_MOTION_JS": str(motion_js_path),
            "TA_COMBOS_JSON": json.dumps(payload),
        },
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        errors.append(f"Node motion.js harness failed: {proc.stderr.strip()}")
        return
    parsed = json.loads(proc.stdout)
    errors.extend(f"Node motion.js: {msg}" for msg in parsed.get("failures", []))


def verify_motion_js_safe_grip(
    motion_js_path: Path,
    combos: list[tuple[str, str]],
) -> list[str]:
    """Verify motion.js safe-grip invariants via static source check, math, and Node.

    Args:
        motion_js_path: Path to `motion.js`.
        combos: Sequence of `(archetype, eq_mode)` pairs to verify.

    Returns:
        List of diagnostic error strings (empty if all checks pass).
    """
    errors: list[str] = []
    if not _check_motion_js_source(motion_js_path, errors):
        return errors

    handheld_combos = [
        (arch, eq_mode) for arch, eq_mode in combos if eq_mode in HANDHELD_WEIGHT_MODES
    ]
    for arch, eq_mode in handheld_combos:
        spec = ARCHETYPE_SPECS[arch]
        bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
        bar_mode = str(spec["bar_mode"])
        for phase in HOLD_SAMPLE_PHASES:
            if spec["hold_style"] == "pulse":
                t_hold = 0.5 - 0.5 * math.cos(phase * math.pi)
            else:
                settle = min(1.0, phase / 0.45)
                breath = 0.92 + 0.08 * (0.5 - 0.5 * math.cos(phase * math.pi))
                t_hold = settle * breath
            pts = solve_fk(bones, lerp_pose(pa, pb, t_hold))
            _check_kinematic_weight_props(
                f"motion.js hold {arch}:{eq_mode} p={phase}",
                eq_mode,
                bar_mode,
                pts,
                errors,
            )
        for wave in BREATH_WAVES:
            breath_pose = {
                **pa,
                "lumbar": pa["lumbar"] - 0.7 * wave,
                "thoracic": pa["thoracic"] - 1.7 * wave,
                "neck": pa["neck"] + 1.0 * wave,
                "uarm_f": pa["uarm_f"] + 1.2 * wave,
                "uarm_b": pa["uarm_b"] + 1.2 * wave,
            }
            pts = solve_fk(bones, breath_pose)
            if bar_mode == "shoulder":
                errors.append(f"motion.js breath {arch}:{eq_mode}: shoulder bar_mode")
            elif (
                eq_mode == "kettlebells"
                and _dist(
                    pts["hand_f"],
                    (pts["hand_f"][0], pts["hand_f"][1] + KETTLEBELL_HANDLE_DY),
                )
                > MAX_KB_HANDLE_DIST
            ):
                errors.append(f"motion.js breath {arch}:kettlebells handle detached")

    node_bin = find_node_binary()
    if node_bin is not None and handheld_combos:
        _run_node_motion_harness(node_bin, motion_js_path, handheld_combos, errors)
    return errors


def _check_single_archetype_rig(
    arch: str,
    spec: dict[str, Any],
    svgs_dir: Path,
    errors: list[str],
) -> None:
    if spec.get("bar_mode") == "shoulder":
        errors.append(f"ARCHETYPE_SPECS[{arch}] has bar_mode='shoulder'")
    static_svg_path = svgs_dir / f"{arch}.svg"
    if not static_svg_path.is_file():
        errors.append(f"Missing pregenerated static SVG: {static_svg_path}")
    else:
        static_root = _parse_svg(static_svg_path.read_text(encoding="utf-8"))
        if static_root.attrib.get("data-bar-mode") == "shoulder":
            errors.append(f"{arch}.svg static file has data-bar-mode='shoulder'")

    bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
    for swap in (False, True):
        for t in SAMPLE_TS:
            pts = solve_fk(bones, lerp_pose(pa, pb, t), swap_sides=swap)
            _check_joint_and_bone_bounds(
                f"{arch} swap={swap} t={t}", bones, pts, errors
            )
            if arch in RACK_ARCHETYPES and not swap:
                if pts["hand_f"][1] >= pts["mid_spine"][1]:
                    errors.append(
                        f"{arch} t={t}: hand_f y={pts['hand_f'][1]:.2f} "
                        "below rack height"
                    )
                if _dist(pts["hand_f"], pts["shoulder"]) > MAX_RACK_HAND_SHOULDER_DIST:
                    errors.append(
                        f"{arch} t={t}: hand_f too far from shoulder for rack grip"
                    )


def _audit_archetype_rig_invariants(cfg: AuditConfig, dist_dir: Path) -> list[str]:
    errors: list[str] = []
    if cfg.animations_path.is_file():
        raw_anim = json.loads(cfg.animations_path.read_text(encoding="utf-8")).get(
            "animations", {}
        )
        errors.extend(
            f"animations.json[{arch}] uses bar_mode='shoulder'"
            for arch, arch_cfg in raw_anim.items()
            if arch_cfg.get("bar_mode") == "shoulder"
        )
    else:
        errors.append(f"Missing animations.json: {cfg.animations_path}")

    dist_static_svgs = dist_dir / "static" / "svgs"
    svgs_dir = dist_static_svgs if dist_static_svgs.is_dir() else cfg.svgs_dir
    for arch, spec in ARCHETYPE_SPECS.items():
        _check_single_archetype_rig(arch, spec, svgs_dir, errors)
    return errors


def _check_combo_kinematic_sweep(
    combos: list[tuple[str, str]],
    errors: list[str],
) -> None:
    for arch, eq_mode in combos:
        if eq_mode not in HANDHELD_WEIGHT_MODES:
            continue
        spec = ARCHETYPE_SPECS[arch]
        bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
        bar_mode = str(spec["bar_mode"])
        for swap in (False, True):
            for t in SAMPLE_TS:
                pts = solve_fk(bones, lerp_pose(pa, pb, t), swap_sides=swap)
                _check_kinematic_weight_props(
                    f"{arch}:{eq_mode} swap={swap} t={t}",
                    eq_mode,
                    bar_mode,
                    pts,
                    errors,
                )


def _audit_all_126_bundle_svgs(
    dist_dir: Path,
    catalog: dict[str, Any],
    all_combos: list[tuple[str, str]],
    errors: list[str],
) -> None:
    svgs = catalog.get("svgs", {})
    for arch, eq_mode in all_combos:
        svg_key = f"{arch}:{eq_mode}"
        inline_markup = svgs.get(svg_key, "")
        if not inline_markup:
            errors.append(f"Missing inline SVG for {svg_key}")
        else:
            try:
                inline_root = _parse_svg(str(inline_markup))
                _check_rendered_svg_safe_grip_and_props(
                    f"catalog.svgs[{svg_key}]", inline_root, arch, eq_mode, errors
                )
            except ET.ParseError as exc:
                errors.append(f"Invalid XML in catalog.svgs[{svg_key}]: {exc}")

        thumb_path = dist_dir / "svgs" / "thumbs" / f"{arch}__{eq_mode}.svg"
        if not thumb_path.is_file():
            errors.append(f"Missing thumbnail SVG on disk: {thumb_path.name}")
        else:
            try:
                thumb_root = _parse_svg(thumb_path.read_text(encoding="utf-8"))
                _check_rendered_svg_safe_grip_and_props(
                    f"thumb[{thumb_path.name}]", thumb_root, arch, eq_mode, errors
                )
            except ET.ParseError as exc:
                errors.append(f"Invalid XML in {thumb_path.name}: {exc}")


def _audit_animations_and_safe_grip(
    cfg: AuditConfig,
    exercises: list[CatalogExercise],
    guidances: dict[str, dict[str, Any]],
    dist_dir: Path,
    catalog: dict[str, Any],
) -> AuditSectionResult:
    errors = _audit_archetype_rig_invariants(cfg, dist_dir)
    all_combos = [
        (arch, eq_mode)
        for arch in sorted(ARCHETYPE_SPECS)
        for eq_mode in CANONICAL_EQUIPMENT_MODES
    ]
    _audit_all_126_bundle_svgs(dist_dir, catalog, all_combos, errors)

    for ex in exercises:
        guide = guidances.get(ex.id) or build_exercise_guidance(ex)
        arch = str(guide.get("archetype") or "squat")
        if arch not in ARCHETYPE_SPECS:
            errors.append(f"{ex.id}: unknown archetype '{arch}'")
            continue
        eq_mode = normalize_equipment(ex.equipment, arch)
        if (arch, eq_mode) not in all_combos:
            errors.append(f"{ex.id}: unexpected combo ({arch}, {eq_mode})")

    _check_combo_kinematic_sweep(all_combos, errors)
    errors.extend(verify_motion_js_safe_grip(cfg.motion_js_path, all_combos))
    return AuditSectionResult("animations_and_safe_grip", len(exercises), tuple(errors))


def _check_program_spec_entry(
    tier: str,
    spec_entry: list[Any] | tuple[Any, ...],
    by_id: dict[str, CatalogExercise],
    covered_archetypes: set[str],
    errors: list[str],
) -> None:
    ex_id = str(spec_entry[0])
    reps = int(spec_entry[1])
    weight = float(spec_entry[2]) if spec_entry[2] is not None else None
    ex = by_id.get(ex_id)
    if ex is None:
        errors.append(f"programs.json[{tier}]: missing exercise '{ex_id}'")
        return

    covered_archetypes.add(classify_archetype(ex))
    allowed_eq = TIER_ALLOWED_EQUIPMENT.get(tier)
    if allowed_eq is not None and ex.equipment not in allowed_eq:
        errors.append(
            f"programs.json[{tier}][{ex_id}]: equipment '{ex.equipment}' "
            f"incompatible with tier '{tier}'"
        )
    if is_hold_exercise(ex) and reps < MIN_HOLD_REPS:
        errors.append(
            f"programs.json[{tier}][{ex_id}]: hold reps {reps} < {MIN_HOLD_REPS}"
        )
    if tier == "body_only" and weight is not None:
        errors.append(f"programs.json[body_only][{ex_id}]: unexpected weight {weight}")
    elif weight is not None and not (MIN_WEIGHT_KG <= weight <= MAX_WEIGHT_KG):
        errors.append(f"programs.json[{tier}][{ex_id}]: implausible weight {weight}")
    elif (
        tier != "body_only"
        and ex.equipment in WEIGHTED_EQUIPMENT
        and not is_hold_exercise(ex)
        and weight is None
    ):
        errors.append(f"programs.json[{tier}][{ex_id}]: weighted exercise missing load")


def _audit_programs_config(
    cfg: AuditConfig,
    by_id: dict[str, CatalogExercise],
) -> list[str]:
    if not cfg.programs_path.is_file():
        return [f"Missing programs.json: {cfg.programs_path}"]

    errors: list[str] = []
    programs_cfg = load_programs_config(cfg.programs_path)
    covered_archetypes: set[str] = set()

    for tier, prog in programs_cfg["equipment_programs"].items():
        for _routine_name, specs in prog["routines"]:
            for spec_entry in specs:
                _check_program_spec_entry(
                    tier, spec_entry, by_id, covered_archetypes, errors
                )

    missing_archs = sorted(set(ARCHETYPE_SPECS.keys()) - covered_archetypes)
    if missing_archs:
        errors.append(
            f"programs.json missing archetypes ({len(missing_archs)}): {missing_archs}"
        )
    return errors


def _run_node_pwa_e2e_harness(dist_dir: Path, errors: list[str]) -> None:
    node_bin = find_node_binary()
    if node_bin is None:
        errors.append("Node.js binary not found for static PWA E2E harness")
        return

    proc = subprocess.run(  # noqa: S603
        [node_bin, "-e", _NODE_PWA_E2E_HARNESS],
        env={
            **os.environ,
            "TA_DIST_DIR": str(dist_dir),
        },
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        errors.append(f"Node PWA E2E harness crashed: {proc.stderr.strip()}")
        return
    parsed = json.loads(proc.stdout)
    errors.extend(f"Node PWA E2E: {msg}" for msg in parsed.get("failures", []))


def _audit_pwa_programs_and_node_e2e(
    cfg: AuditConfig,
    exercises: list[CatalogExercise],
    dist_dir: Path,
) -> AuditSectionResult:
    by_id = {ex.id: ex for ex in exercises}
    errors = _audit_programs_config(cfg, by_id)
    _run_node_pwa_e2e_harness(dist_dir, errors)
    return AuditSectionResult(
        "pwa_programs_and_node_e2e",
        len(exercises),
        tuple(errors),
    )


def run_catalog_audit(config: AuditConfig | None = None) -> AuditReport:
    """Run exhaustive end-to-end checks across all 876 exercises and the static PWA.

    Args:
        config: Optional `AuditConfig` overriding file paths or fallback allowlist.

    Returns:
        Structured `AuditReport` with per-section results and flattened errors.
    """
    cfg = config or AuditConfig()
    with tempfile.TemporaryDirectory(prefix="training_aid_audit_") as tmp_str:
        dist_dir = Path(tmp_str) / "dist"
        sec_bundle, exercises, raw_ids, catalog = _audit_catalog_and_pwa_bundle(
            cfg, dist_dir
        )
        sec_coaching, guidances = _audit_coaching_integration(
            cfg, exercises, raw_ids, catalog
        )
        sec_rig = _audit_animations_and_safe_grip(
            cfg, exercises, guidances, dist_dir, catalog
        )
        sec_pwa = _audit_pwa_programs_and_node_e2e(cfg, exercises, dist_dir)

    return AuditReport(
        exercise_count=len(exercises),
        archetype_count=len(svg_assets.ARCHETYPE_SPECS),
        sections=(sec_bundle, sec_coaching, sec_rig, sec_pwa),
    )


def main() -> None:
    """Execute `run_catalog_audit()` as a CLI check and exit non-zero on any failure."""
    report = run_catalog_audit()

    sys.stdout.write(
        f"Training Aid E2E Catalog & PWA Audit — {report.exercise_count} exercises, "
        f"{report.archetype_count} archetypes\n"
    )
    for section in report.sections:
        status = "PASS" if section.passed else f"FAIL ({len(section.errors)} errors)"
        sys.stdout.write(f"  [{status}] {section.name} (checked={section.checked})\n")

    if not report.passed:
        sys.stderr.write(f"\nAudit FAILED with {len(report.errors)} error(s):\n")
        for err in report.errors:
            sys.stderr.write(f"  - {err}\n")
        raise SystemExit(1)

    sys.stdout.write(
        "\nAll E2E catalog, coaching, rig, and static PWA checks PASSED.\n"
    )
    raise SystemExit(0)


if __name__ == "__main__":
    main()
