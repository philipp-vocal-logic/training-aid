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
let catalog, domainMod, recMod;

before(() => {
  if (!distDir || !fs.existsSync(path.join(distDir, "data", "catalog.json"))) {
    ownedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-recommender-"));
    distDir = path.join(ownedTempDir, "dist");
    execFileSync("uv", ["run", "training-aid", "--build-only", "--out-dir", distDir], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  }
  catalog = JSON.parse(fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8"));
  domainMod = require(path.join(distDir, "domain.js"));
  recMod = require(path.join(distDir, "recommender.js"));
});

after(() => {
  if (ownedTempDir) fs.rmSync(ownedTempDir, { recursive: true, force: true });
});

test("catalog equipment hygiene: isolates 'other' and enforces pull_up_bar / bench fixtures", () => {
  const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));

  assert.equal(recMod.isExerciseCompatible(byId.get("Bodyweight_Squat"), []), true);
  assert.equal(recMod.isExerciseCompatible(byId.get("Pushups"), []), true);
  assert.equal(recMod.isExerciseCompatible(byId.get("Plank"), []), true);

  assert.equal(recMod.isExerciseCompatible(byId.get("Pullups"), []), false);
  assert.equal(recMod.isExerciseCompatible(byId.get("Pullups"), ["pull_up_bar"]), true);

  assert.equal(recMod.isExerciseCompatible(byId.get("Bench_Dips"), []), false);
  assert.equal(recMod.isExerciseCompatible(byId.get("Bench_Dips"), ["bench"]), true);

  assert.equal(recMod.isExerciseCompatible(byId.get("Dumbbell_Bench_Press"), ["dumbbell"]), false);
  assert.equal(recMod.isExerciseCompatible(byId.get("Dumbbell_Bench_Press"), ["dumbbell", "bench"]), true);

  for (const ex of catalog.exercises) {
    if (ex.equipment.toLowerCase() === "other") {
      assert.equal(recMod.isExerciseCompatible(ex, domainMod.VALID_EQUIPMENT_IDS), false);
    }
  }
});

test("non-destructive routine adaptation and balanced random workout generation", () => {
  const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));
  const barbellRoutine = {
    id: "r1",
    name: "Heavy Gym Day",
    intensity_level: 3,
    exercises: [
      { id: "rx1", exercise_id: "Barbell_Full_Squat", sets: 4, base_reps: 8, base_weight_kg: 60 },
      { id: "rx2", exercise_id: "Barbell_Bench_Press_-_Medium_Grip", sets: 4, base_reps: 8, base_weight_kg: 50 },
      { id: "rx3", exercise_id: "Pullups", sets: 3, base_reps: 8, base_weight_kg: null },
      { id: "rx4", exercise_id: "Plank", sets: 3, base_reps: 40, base_weight_kg: null },
    ],
  };

  const adaptedFloor = recMod.adaptRoutineForEquipment(
    barbellRoutine,
    [],
    { starting_intensity: "moderate" },
    catalog.exercises,
    byId
  );
  assert.equal(adaptedFloor.was_substituted, true);
  assert.equal(adaptedFloor.substituted_count, 3);
  assert.equal(barbellRoutine.exercises[0].exercise_id, "Barbell_Full_Squat");
  assert.equal(barbellRoutine.exercises[0].base_weight_kg, 60);

  for (const item of adaptedFloor.exercises) {
    const ex = byId.get(item.exercise_id);
    assert.equal(recMod.isExerciseCompatible(ex, []), true, `${ex.id} must be floor-compatible`);
    assert.equal(item.base_weight_kg, null);
  }
  assert.equal(adaptedFloor.exercises[3].exercise_id, "Plank");
  assert.equal(adaptedFloor.exercises[3].is_substituted, false);

  for (const equipSet of [[], ["dumbbell"], ["bands", "kettlebells"], domainMod.VALID_EQUIPMENT_IDS]) {
    const session = recMod.generateBalancedSession(
      catalog.exercises,
      equipSet,
      { starting_intensity: "intense" },
      { count: 5 }
    );
    assert.equal(session.length, 5);
    const uniqueIds = new Set(session.map((s) => s.exercise_id));
    assert.equal(uniqueIds.size, 5);
    for (const item of session) {
      const ex = byId.get(item.exercise_id);
      assert.equal(recMod.isExerciseCompatible(ex, equipSet), true);
      assert.ok(["strength", "cardio"].includes(ex.category.toLowerCase()));
    }
  }
});

test("tempo speed presets scale dynamic exercises and never distort isometric hold seconds", () => {
  const plank = { id: "Plank", rep_seconds: 1.0, is_hold: true };
  assert.equal(domainMod.resolveEffectiveRepSeconds(plank, "slow"), 1.0);
  assert.equal(domainMod.resolveEffectiveRepSeconds(plank, "normal"), 1.0);
  assert.equal(domainMod.resolveEffectiveRepSeconds(plank, "fast"), 1.0);

  const squat = { id: "Bodyweight_Squat", rep_seconds: 2.8, is_hold: false };
  const slowSec = domainMod.resolveEffectiveRepSeconds(squat, "slow");
  const normSec = domainMod.resolveEffectiveRepSeconds(squat, "normal");
  const fastSec = domainMod.resolveEffectiveRepSeconds(squat, "fast");
  assert.ok(slowSec > normSec && normSec > fastSec);
  assert.ok(fastSec >= 1.2 && slowSec <= 6.0);
});
