"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
let distDir = process.env.TA_DIST_DIR || "";
let ownedTempDir = "";
let catalog, domainMod, codecMod, storeMod, qrMod;

function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [String(k), String(v)]));
  const writes = [];
  return {
    writes,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { writes.push(String(k)); map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
  };
}

function applyBackupImport(store, jsonText, keepExistingLogs) {
  const res = store.importBackupJson(jsonText, { mergeLogs: keepExistingLogs, keepExistingLogs });
  return res && typeof res.apply === "function"
    ? res.apply({ keepExistingLogs, mergeLogs: keepExistingLogs })
    : res;
}

before(() => {
  if (!distDir || !fs.existsSync(path.join(distDir, "data", "catalog.json"))) {
    ownedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-store-qr-"));
    distDir = path.join(ownedTempDir, "dist");
    execFileSync("uv", ["run", "training-aid", "--build-only", "--out-dir", distDir], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  }
  catalog = JSON.parse(fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8"));
  domainMod = require(path.join(distDir, "domain.js"));
  codecMod = require(path.join(distDir, "codec.js"));
  storeMod = require(path.join(distDir, "store.js"));
  qrMod = require(path.join(distDir, "qr.js"));
});

after(() => {
  if (ownedTempDir) fs.rmSync(ownedTempDir, { recursive: true, force: true });
});

test("domain & store exports, onboarding presets, and hold durations >= 24s", () => {
  assert.equal(storeMod.STORAGE_KEY, "training_aid_state_v1");
  assert.deepEqual([...domainMod.VALID_EQUIPMENT], ["body_only", "dumbbells", "kettlebell_bands", "full_gym"]);
  assert.deepEqual([...domainMod.VALID_INTENSITY], ["light", "moderate", "intense"]);
  assert.deepEqual([...domainMod.VALID_SOUND_THEMES], ["off", "minimal", "techno", "trance", "studio"]);
  assert.equal(codecMod.MAX_DECOMPRESSED_BYTES, 65536);

  const bwStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  assert.equal(bwStore.hasActivePlan(), false);
  assert.equal(bwStore.getState(), null);

  const bwState = bwStore.setupPlan({
    name: "Philipp",
    equipment: "body_only",
    starting_intensity: "light",
    days_per_week: 2,
  });
  assert.equal(bwStore.hasActivePlan(), true);
  assert.equal(bwState.profile.equipment, "body_only");
  assert.equal(bwState.profile.starting_intensity, "light");
  assert.equal(bwState.profile.weekly_goal, 2);
  assert.equal(bwState.plan.name, "Body Only Plan (2x/Week)");
  assert.equal(bwState.plan.routines.length, 2);
  for (const ex of bwState.plan.routines[0].exercises) {
    assert.equal(ex.sets, 2);
    assert.equal(ex.base_weight_kg, null);
  }

  const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));
  const plank = byId.get("Plank");
  for (const [intensity, expSec] of Object.entries({ light: 24, moderate: 30, intense: 36 })) {
    const presc = storeMod.defaultPrescriptionForExercise(
      { equipment: "full_gym", starting_intensity: intensity },
      plank,
    );
    assert.equal(presc.reps, expSec);
    assert.ok(presc.reps >= 24);
    assert.equal(presc.weight_kg, null);
    const scaled = storeMod.computeScaledTarget(
      { id: "rx1", exercise_id: plank.id, sets: presc.sets, base_reps: presc.reps, base_weight_kg: presc.weight_kg },
      0,
      plank,
    );
    assert.equal(scaled.formatted, `${presc.sets} \u00d7 ${expSec} sec`);
  }

  const weightedPlank = storeMod.computeScaledTarget(
    { id: "rx2", exercise_id: plank.id, sets: 3, base_reps: 30, base_weight_kg: 10 },
    0,
    plank,
  );
  assert.ok(weightedPlank.formatted.includes("sec") && weightedPlank.formatted.includes("10 kg"));
});

test("workout +10%/-10%/keep progression scaling and ISO week streaks", () => {
  const gymStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  gymStore.setupPlan({ name: "Sam", equipment: "full_gym", starting_intensity: "moderate", days_per_week: 3 });

  const r1Playlist = gymStore.buildPlaylist("r1");
  assert.equal(r1Playlist.length, 4);
  assert.equal(r1Playlist[0].sets, 3);
  assert.ok(Boolean(r1Playlist[0].how_to));

  gymStore.completeWorkout("r1", {
    next_intensity_choice: "more",
    duration_minutes: 28,
    completed_ids: ["rx1", "rx2", "rx3", "rx4"],
  });
  assert.equal(gymStore.getNextRoutineCard().routine.id, "r2");
  const r1Adapted = gymStore.buildRoutineCards(["r1"])[0];
  assert.equal(r1Adapted.intensity_percent, 110);
  assert.equal(r1Adapted.exercises[0].scaled.formatted, "3 \u00d7 8 @ 44 kg");

  gymStore.completeWorkout("r2", { next_intensity_choice: "less", duration_minutes: 24 });
  const r2Adapted = gymStore.buildRoutineCards(["r2"])[0];
  assert.equal(r2Adapted.intensity_percent, 90);
  assert.equal(r2Adapted.exercises[0].scaled.formatted, "3 \u00d7 8 @ 36 kg");

  gymStore.completeWorkout("r3", { next_intensity_choice: "keep", duration_minutes: 25 });
  assert.equal(gymStore.buildRoutineCards(["r3"])[0].intensity_percent, 100);

  const pushupItem = { id: "rx1", exercise_id: "Pushups", sets: 3, base_reps: 10, base_weight_kg: null };
  assert.equal(storeMod.computeScaledTarget(pushupItem, 0).formatted, "3 \u00d7 10 reps");
  assert.equal(storeMod.computeScaledTarget(pushupItem, 1).formatted, "3 \u00d7 11 reps");
  assert.equal(storeMod.computeScaledTarget(pushupItem, -1).formatted, "3 \u00d7 9 reps");
  assert.equal(storeMod.applyIntensityFeedback(-5, "less"), -5);
  assert.equal(storeMod.applyIntensityFeedback(0, "keep"), 0);

  const streakLogs = [
    { completed_at: "2026-11-12T12:00:00Z" },
    { completed_at: "2026-11-05T12:00:00Z" },
    { completed_at: "2026-10-29T12:00:00Z" },
  ];
  const s3 = storeMod.computeWeekStreak(streakLogs, "2026-11-13T12:00:00Z") === 3
    ? 3
    : storeMod.computeWeekStreak(streakLogs, 3, "2026-11-13T12:00:00Z");
  assert.equal(s3, 3);

  const crossYearLogs = [
    { completed_at: "2026-01-02T10:00:00Z" },
    { completed_at: "2025-12-24T10:00:00Z" },
  ];
  const s2 = storeMod.computeWeekStreak(crossYearLogs, "2026-01-03T10:00:00Z") === 2
    ? 2
    : storeMod.computeWeekStreak(crossYearLogs, 2, "2026-01-03T10:00:00Z");
  assert.equal(s2, 2);
});

test("#import=z. roundtrips, 64KB zip-bomb cap, non-z. rejection, JSON Merge vs Replace, and XSS safety", async () => {
  const srcStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  srcStore.setupPlan({ name: "Sam", equipment: "full_gym", starting_intensity: "moderate", days_per_week: 3 });
  srcStore.completeWorkout("r1", { next_intensity_choice: "more", completed_at: "2026-11-10T10:00:00Z" });
  srcStore.completeWorkout("r2", { next_intensity_choice: "less", completed_at: "2026-11-11T10:00:00Z" });

  const frag = await srcStore.encodeShareFragment();
  assert.ok(frag.startsWith("#import=z.") && frag.length < 700);

  const phoneStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  phoneStore.setupPlan({ name: "PhoneUser", equipment: "body_only", starting_intensity: "light", days_per_week: 2 });
  phoneStore.completeWorkout("r1", { next_intensity_choice: "keep", completed_at: "2026-11-12T10:00:00Z" });
  const preview = await phoneStore.decodeShareFragment(frag);
  assert.equal(preview.routineCount, 3);
  assert.equal(preview.exerciseCount, 12);
  if (typeof preview.apply === "function") preview.apply({ keepExistingLogs: true });
  assert.equal(phoneStore.getLogsDesc().length, 1);
  assert.equal(phoneStore.getNextRoutineCard().routine.id, "r2");

  const freshPhone = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  const freshPreview = await freshPhone.decodeShareFragment(frag);
  if (typeof freshPreview.apply === "function") freshPreview.apply();
  assert.equal(freshPhone.getNextRoutineCard().routine.id, "r3");

  const bombPlain = new TextEncoder().encode(JSON.stringify({ v: 1, pad: "A".repeat(80000) }));
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bombPlain);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(Buffer.from(step.value));
  }
  const bombToken = "#import=z." + Buffer.concat(chunks).toString("base64url");
  await assert.rejects(() => phoneStore.decodeShareFragment(bombToken));
  await assert.rejects(() => phoneStore.decodeShareFragment("#import=z.!!!bad_b64!!!"));
  await assert.rejects(() => phoneStore.decodeShareFragment("#import=j.eyJ2IjoxfQ"));

  const backupJson = srcStore.exportBackupJson({ includeLogs: true });
  applyBackupImport(phoneStore, backupJson, true);
  assert.equal(phoneStore.getLogsDesc().length, 3);
  applyBackupImport(phoneStore, backupJson, false);
  assert.equal(phoneStore.getLogsDesc().length, 2);
  assert.equal(phoneStore.getState().profile.name, "Sam");

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
      routines: [{
        id: "r1",
        name: "Day 1",
        intensity_level: -99,
        exercises: [
          { id: "x1", exercise_id: "Unknown_Fake_Ex", sets: 3, base_reps: 10 },
          { id: "x2", exercise_id: "Pushups", sets: 999, base_reps: -5, base_weight_kg: 99999 },
        ],
      }],
    },
    logs: [],
  });
  applyBackupImport(phoneStore, untrustedJson, true);
  const sanitized = phoneStore.getState();
  assert.equal(sanitized.profile.name, "<img src=x onerror=alert(1)>");
  assert.equal(sanitized.profile.equipment, "body_only");
  assert.equal(sanitized.plan.routines[0].intensity_level, -5);
  assert.equal(sanitized.plan.routines[0].exercises.length, 1);
  assert.ok(sanitized.plan.routines[0].exercises[0].sets <= 20);
  assert.equal(sanitized.plan.routines[0].exercises[0].base_reps, 1);
  assert.equal(sanitized.plan.routines[0].exercises[0].base_weight_kg, 500);
});

test("unified sound_theme in training_aid_state_v1 and one-time legacy migration", () => {
  const storage = makeMemoryStorage({ training_aid_sound_theme: "trance" });
  const st = storeMod.createStore({ storage, catalog });
  assert.equal(st.getSoundTheme(), "trance");

  st.setSoundTheme("techno");
  assert.equal(st.getSoundTheme(), "techno");
  assert.ok(!storage.writes.includes("training_aid_sound_theme"));

  st.setupPlan({ name: "AudioUser", equipment: "body_only", starting_intensity: "moderate", days_per_week: 2 });
  st.setSoundTheme("studio");
  assert.equal(st.getSoundTheme(), "studio");
  assert.equal(JSON.parse(storage.getItem(storeMod.STORAGE_KEY)).profile.sound_theme, "studio");
  assert.ok(!storage.writes.includes("training_aid_sound_theme"));
});

test("browse tiers, 876-exercise search & playlist coverage, and TrainingQR SVG", () => {
  const tierAllowed = {
    body_only: new Set(["body only", "foam roll", "exercise ball", "other"]),
    dumbbells: new Set(["dumbbell", "medicine ball", "body only", "foam roll", "exercise ball", "other"]),
    kettlebell_bands: new Set(["kettlebells", "bands", "body only", "foam roll", "exercise ball", "other"]),
    full_gym: null,
  };
  for (const [tier, allowed] of Object.entries(tierAllowed)) {
    const st = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
    st.setupPlan({ name: `Browse-${tier}`, equipment: tier, starting_intensity: "moderate", days_per_week: 2 });
    const gotIds = new Set(st.searchCatalog("", 1000).map((r) => r.id));
    const expIds = new Set(
      catalog.exercises.filter((ex) => !allowed || allowed.has(ex.equipment.toLowerCase())).map((ex) => ex.id),
    );
    assert.equal(gotIds.size, expIds.size);
    for (const id of expIds) assert.ok(gotIds.has(id));
  }

  const fullStore = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  fullStore.setupPlan({ name: "CatalogAudit", equipment: "full_gym", starting_intensity: "moderate", days_per_week: 2 });
  const rt = fullStore.addWorkoutDay();
  for (const ex of catalog.exercises) {
    const found = fullStore.searchCatalog(ex.name, 100).find((h) => h.id === ex.id);
    assert.ok(found && String(found.thumb_url).startsWith("./svgs/thumbs/"));
    assert.equal("instructions" in found, false);
  }
  for (const ex of catalog.exercises.slice(0, 40)) fullStore.addExerciseToRoutine(rt.id, ex.id);
  const playlist = fullStore.buildPlaylist(rt.id);
  assert.equal(playlist.length, 40);
  for (const pl of playlist) {
    assert.ok(String(pl.how_to).trim().length > 0);
    assert.ok(String(pl.svg_markup).startsWith("<svg") && !pl.svg_markup.includes('data-bar-mode="shoulder"'));
    if (pl.is_hold) assert.ok(pl.reps >= 20);
  }

  const qrMat = qrMod.encodeMatrix("https://trainer.local/#import=z.test");
  assert.equal(qrMat.size, qrMat.version * 4 + 17);
  assert.equal(qrMat.modules[0][0], true);
  const qrSvg = qrMod.renderSvg("https://trainer.local/#import=z.test", {
    margin: 2,
    fg: '#090d16" onload="alert(1)',
  });
  assert.ok(qrSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && qrSvg.includes('<path d="M'));
  assert.ok(!qrSvg.includes('onload="alert(1)"'));
});
