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

test("schema v2 clean reset, multiselect equipment onboarding, and hold durations >= 24s", () => {
  assert.equal(storeMod.STORAGE_KEY, "training_aid_state_v2");
  assert.equal(storeMod.SCHEMA_VERSION, 2);
  assert.equal(codecMod.SCHEMA_VERSION, 2);
  assert.deepEqual([...domainMod.VALID_INTENSITY], ["light", "moderate", "intense"]);
  assert.deepEqual([...domainMod.VALID_SPEED_MODES], ["slow", "normal", "fast"]);
  assert.deepEqual([...domainMod.VALID_SOUND_THEMES], ["off", "minimal", "techno", "trance", "studio"]);

  // Old v1 or malformed state is ignored cleanly without migration shims
  const dirtyStorage = makeMemoryStorage({
    training_aid_state_v1: JSON.stringify({ schema_version: 1, profile: { name: "Old" } }),
    training_aid_state_v2: JSON.stringify({ schema_version: 1, profile: { name: "WrongVer" } }),
  });
  const store = storeMod.createStore({ storage: dirtyStorage, catalog });
  assert.equal(store.hasActivePlan(), false);
  assert.equal(store.getState(), null);

  const built = store.setupPlan({
    name: "Philipp",
    equipment_list: ["bands", "dumbbell"],
    starting_intensity: "light",
    days_per_week: 4,
    rest_seconds: 45,
    speed_mode: "slow",
  });
  assert.equal(store.hasActivePlan(), true);
  assert.deepEqual(built.profile.equipment_list, ["dumbbell", "bands"]);
  assert.equal(built.profile.weekly_goal, 4);
  assert.equal(built.profile.rest_seconds, 45);
  assert.equal(built.profile.speed_mode, "slow");
  assert.equal(built.plan.routines.length, 4);

  // Saved storage overwrote v2 cleanly
  const reloaded = storeMod.createStore({ storage: dirtyStorage, catalog });
  assert.equal(reloaded.hasActivePlan(), true);
  assert.deepEqual(reloaded.getState().profile.equipment_list, ["dumbbell", "bands"]);
  assert.deepEqual(reloaded.getWorkoutTiming(), { rest_seconds: 45, speed_mode: "slow" });

  const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));
  const plank = byId.get("Plank");
  for (const [intensity, expSec] of Object.entries({ light: 24, moderate: 30, intense: 36 })) {
    const presc = storeMod.defaultPrescriptionForExercise(
      { equipment_list: domainMod.VALID_EQUIPMENT_IDS, starting_intensity: intensity },
      plank
    );
    assert.equal(presc.reps, expSec);
    assert.ok(presc.reps >= 24);
  }
});

test("non-destructive daily equipment filter, ad-hoc sessions, unlimited daily workouts & exercise logs", () => {
  let fakeNow = new Date("2026-11-13T09:00:00Z");
  const gymStore = storeMod.createStore({
    storage: makeMemoryStorage(),
    catalog,
    nowFn: () => new Date(fakeNow.getTime()),
  });
  gymStore.setupPlan({
    name: "Sam",
    equipment_list: domainMod.VALID_EQUIPMENT_IDS,
    starting_intensity: "moderate",
    days_per_week: 3,
    rest_seconds: 60,
    speed_mode: "normal",
  });

  const recMorning = gymStore.getRecommendedToday();
  assert.equal(recMorning.trained_today, false);
  assert.equal(recMorning.card.routine.id, "r1");
  assert.equal(recMorning.card.was_substituted, false);

  // Non-destructive filter to pure bodyweight for today
  gymStore.setSessionEquipment([]);
  assert.equal(gymStore.hasSessionEquipmentOverride(), true);
  const adaptedRec = gymStore.getRecommendedToday();
  assert.equal(adaptedRec.card.was_substituted, true);
  assert.equal(gymStore.getState().profile.equipment_list.length, domainMod.VALID_EQUIPMENT_IDS.length);
  assert.equal(gymStore.getRoutine("r1").exercises[0].exercise_id, "Barbell_Full_Squat");

  // Completing substituted r1 logs actual bodyweight exercises, advances split to r2, keeps r1 base load at 0
  const subLog = gymStore.completeWorkout("r1", {
    next_intensity_choice: "more",
    duration_minutes: 22,
    completed_at: "2026-11-13T09:30:00Z",
  });
  assert.equal(subLog.was_substituted, true);
  assert.equal(gymStore.getRoutine("r1").intensity_level, 0);
  assert.ok(subLog.exercises.length === 4 && subLog.exercises[0].exercise_id !== "Barbell_Full_Squat");

  // Next calendar day auto-resets session equipment back to profile gym equipment
  fakeNow = new Date("2026-11-14T10:00:00Z");
  assert.equal(gymStore.hasSessionEquipmentOverride(), false);
  assert.equal(gymStore.getRecommendedToday().card.routine.id, "r2");
  assert.equal(gymStore.getRecommendedToday().card.was_substituted, false);

  // On-the-fly workout counts toward weekly goal & history without advancing split cursor (stays r2)
  gymStore.generateAdHocSession({ count: 3 });
  gymStore.addRandomExerciseToAdHoc();
  assert.equal(gymStore.getAdHocSession().exercises.length, 4);
  const adhocLog = gymStore.completeWorkout("adhoc", {
    duration_minutes: 18,
    completed_at: "2026-11-14T10:30:00Z",
  });
  assert.equal(adhocLog.is_adhoc, true);
  assert.equal(adhocLog.exercises.length, 4);
  assert.equal(gymStore.getRecommendedToday().trained_today, true);
  assert.equal(gymStore.getRecommendedToday().workouts_today, 1);
  assert.equal(gymStore.getRecommendedToday().card.routine.id, "r2");

  // User can do another workout on the same day (unlimited daily workouts)
  const r2Log = gymStore.completeWorkout("r2", {
    next_intensity_choice: "more",
    duration_minutes: 30,
    completed_at: "2026-11-14T17:15:00Z",
  });
  assert.equal(r2Log.was_substituted, false);
  assert.equal(gymStore.getRoutine("r2").intensity_level, 1);
  assert.equal(gymStore.getRecommendedToday().workouts_today, 2);
  assert.equal(gymStore.getStats().workouts_this_week, 3);
});

test("routine prescription editing, random swap, speed/rest updates, and QR SVG XSS guard", () => {
  const st = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  st.setupPlan({
    name: "Alex",
    equipment_list: ["dumbbell", "bench"],
    starting_intensity: "moderate",
    days_per_week: 3,
  });

  const r1 = st.getRoutine("r1");
  const firstItem = r1.exercises[0];
  const edited = st.updateRoutineExercise("r1", firstItem.id, {
    sets: 5,
    base_reps: 12,
    base_weight_kg: 17.5,
  });
  assert.equal(edited.sets, 5);
  assert.equal(edited.base_reps, 12);
  assert.equal(edited.base_weight_kg, 17.5);

  const swapped = st.swapRoutineExercise("r1", firstItem.id);
  assert.ok(swapped && swapped.exercise_id !== firstItem.exercise_id);

  const addedRand = st.addRandomExerciseToRoutine("r1");
  assert.ok(addedRand && st.getRoutine("r1").exercises.length === r1.exercises.length + 1);

  st.setWorkoutTiming({ speed_mode: "fast", rest_seconds: 90 });
  const pl = st.buildPlaylist("r1");
  for (const item of pl) {
    if (item.is_hold) assert.equal(item.rep_seconds, 1.0);
    else assert.ok(item.rep_seconds < item.base_rep_seconds);
  }

  const qrSvg = qrMod.renderSvg("https://trainer.local/#plan", {
    margin: 2,
    fg: '#090d16" onload="alert(1)',
  });
  assert.ok(qrSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && !qrSvg.includes('onload="alert(1)"'));
});
