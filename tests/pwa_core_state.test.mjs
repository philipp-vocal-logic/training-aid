// Unit and integration tests for pwa/core/* and pwa/state/*.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  resolveBuiltDist,
  importDistModule,
  makeMemoryStorage,
} from "./helpers/dom_harness.mjs";

let distHandle;
let catalog;
let constantsMod;
let prescriptionMod;
let catalogMod;
let generatorMod;
let workoutEngineMod;
let codecMod;
let storeMod;

before(async () => {
  distHandle = resolveBuiltDist("ta-core-state-");
  catalog = distHandle.catalog;
  const { distDir } = distHandle;
  constantsMod = await importDistModule(distDir, "core", "constants.js");
  prescriptionMod = await importDistModule(distDir, "core", "prescription.js");
  catalogMod = await importDistModule(distDir, "core", "catalog.js");
  generatorMod = await importDistModule(distDir, "core", "generator.js");
  workoutEngineMod = await importDistModule(distDir, "core", "workout-engine.js");
  codecMod = await importDistModule(distDir, "state", "codec.js");
  storeMod = await importDistModule(distDir, "state", "store.js");
});

after(() => {
  if (distHandle) distHandle.cleanup();
});

test("catalog equipment hygiene: pre-baked required_equipment, 'other' isolation, and fixture rules", () => {
  assert.equal(catalog.schema_version, 2);
  assert.deepEqual(constantsMod.normalizeEquipmentList("dumbbells"), []);
  assert.deepEqual(constantsMod.normalizeEquipmentList(["bands", "dumbbell", "bands"]), [
    "dumbbell",
    "bands",
  ]);

  const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));

  assert.deepEqual(catalogMod.getRequiredEquipment(byId.get("Bodyweight_Squat")), []);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Bodyweight_Squat"), []), true);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Pushups"), []), true);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Plank"), []), true);

  assert.deepEqual(catalogMod.getRequiredEquipment(byId.get("Pullups")), ["pull_up_bar"]);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Pullups"), []), false);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Pullups"), ["pull_up_bar"]), true);

  assert.deepEqual(catalogMod.getRequiredEquipment(byId.get("Bench_Dips")), ["bench"]);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Bench_Dips"), []), false);
  assert.equal(catalogMod.isExerciseCompatible(byId.get("Bench_Dips"), ["bench"]), true);

  assert.deepEqual(
    catalogMod.getRequiredEquipment(byId.get("Dumbbell_Bench_Press")),
    ["dumbbell", "bench"]
  );
  assert.equal(
    catalogMod.isExerciseCompatible(byId.get("Dumbbell_Bench_Press"), ["dumbbell"]),
    false
  );
  assert.equal(
    catalogMod.isExerciseCompatible(byId.get("Dumbbell_Bench_Press"), [
      "dumbbell",
      "bench",
    ]),
    true
  );

  for (const ex of catalog.exercises) {
    if (ex.equipment.toLowerCase() === "other") {
      assert.deepEqual(catalogMod.getRequiredEquipment(ex), ["__other__"]);
      assert.equal(
        catalogMod.isExerciseCompatible(ex, constantsMod.VALID_EQUIPMENT_IDS),
        false
      );
    }
  }
});

test("non-destructive routine adaptation, balanced random generation, and tempo scaling", () => {
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

  const adaptedFloor = generatorMod.adaptRoutineForEquipment(
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
    assert.equal(catalogMod.isExerciseCompatible(ex, []), true);
    assert.equal(item.base_weight_kg, null);
  }
  assert.equal(adaptedFloor.exercises[3].exercise_id, "Plank");
  assert.equal(adaptedFloor.exercises[3].is_substituted, false);

  for (const equipSet of [
    [],
    ["dumbbell"],
    ["bands", "kettlebells"],
    constantsMod.VALID_EQUIPMENT_IDS,
  ]) {
    const session = generatorMod.generateBalancedSession(
      catalog.exercises,
      equipSet,
      { starting_intensity: "intense" },
      { count: 5 }
    );
    assert.equal(session.length, 5);
    assert.equal(new Set(session.map((s) => s.exercise_id)).size, 5);
    for (const item of session) {
      const ex = byId.get(item.exercise_id);
      assert.equal(catalogMod.isExerciseCompatible(ex, equipSet), true);
      assert.ok(["strength", "cardio"].includes(ex.category.toLowerCase()));
    }
  }

  const plank = { id: "Plank", rep_seconds: 1.0, is_hold: true };
  assert.equal(prescriptionMod.resolveEffectiveRepSeconds(plank, "slow"), 1.0);
  assert.equal(prescriptionMod.resolveEffectiveRepSeconds(plank, "normal"), 1.0);
  assert.equal(prescriptionMod.resolveEffectiveRepSeconds(plank, "fast"), 1.0);

  const squat = { id: "Bodyweight_Squat", rep_seconds: 2.8, is_hold: false };
  const slowSec = prescriptionMod.resolveEffectiveRepSeconds(squat, "slow");
  const normSec = prescriptionMod.resolveEffectiveRepSeconds(squat, "normal");
  const fastSec = prescriptionMod.resolveEffectiveRepSeconds(squat, "fast");
  assert.ok(slowSec > normSec && normSec > fastSec);
  assert.ok(fastSec >= 1.2 && slowSec <= 6.0);
});

test("pure createWorkoutSession state machine transitions, skip-wait guard, and live retiming", () => {
  const playlist = [
    {
      name: "Squat",
      sets: 2,
      reps: 2,
      rep_seconds: 2.0,
      base_rep_seconds: 2.0,
      is_hold: false,
      tempo_mode: "standard",
      is_alternating: false,
      cue_work: "Down",
      cue_return: "Up",
    },
    {
      name: "Plank",
      sets: 1,
      reps: 10,
      rep_seconds: 1.0,
      base_rep_seconds: 1.0,
      is_hold: true,
      tempo_mode: "hold",
      is_alternating: false,
      cue_work: "Hold",
      cue_return: "Breathe",
    },
  ];

  const session = workoutEngineMod.createWorkoutSession({
    playlist,
    speedMode: "normal",
    restSeconds: 30,
  });

  assert.equal(session.getSnapshot().state, "IDLE");
  assert.equal(session.getSnapshot().canSkipWait, false);
  assert.equal(session.skipWait().snapshot.state, "IDLE");

  // Start -> COUNTDOWN -> skipWait -> ACTIVE
  const started = session.togglePlayPause();
  assert.equal(started.snapshot.state, "COUNTDOWN");
  assert.equal(started.snapshot.canSkipWait, true);

  const active1 = session.skipWait();
  assert.equal(active1.snapshot.state, "ACTIVE");
  assert.equal(active1.snapshot.canSkipWait, false);

  // skipWait during ACTIVE must be a strict no-op
  assert.equal(session.skipWait().snapshot.state, "ACTIVE");

  // Advance halfway through rep 1 (1.0s of 2.0s), then switch to fast speed
  session.advance(1.0);
  assert.equal(session.getSnapshot().pose.kind, "rep");
  const retimed = session.setSpeedMode("fast");
  const newRepSec = retimed.snapshot.currentExercise.rep_seconds;
  assert.ok(newRepSec < 2.0);
  assert.ok(Math.abs(retimed.snapshot.phaseElapsed / newRepSec - 0.5) < 1e-6);

  // Complete Set 1 -> enters REST
  const rest1 = session.advance(10.0);
  assert.equal(rest1.snapshot.state, "REST");
  assert.equal(rest1.snapshot.canSkipWait, true);
  assert.equal(rest1.snapshot.canExtendRest, true);

  // Extend rest by +15s
  assert.equal(session.extendRest(15).snapshot.activeRestTarget, 45);

  // Skip rest -> Set 2 ACTIVE -> finish Set 2 -> REST before Exercise 2 (Plank)
  assert.equal(session.skipWait().snapshot.state, "ACTIVE");
  assert.equal(session.getSnapshot().setNum, 2);
  assert.equal(session.advance(10.0).snapshot.state, "REST");
  assert.equal(session.getSnapshot().exIdx, 1);

  // Skip rest -> Plank (hold) ACTIVE -> speed mode never distorts hold rep_seconds (1.0)
  assert.equal(session.skipWait().snapshot.state, "ACTIVE");
  assert.equal(session.getSnapshot().currentExercise.rep_seconds, 1.0);
  assert.equal(session.getSnapshot().pose.kind, "hold");

  // Complete Plank -> FINISHED
  const done = session.advance(15.0);
  assert.equal(done.snapshot.state, "FINISHED");
  assert.equal(done.snapshot.pose.kind, "none");
});

test("schema v2 store, non-destructive daily filter, and unified *ExerciseItem CRUD on 'r1' & 'adhoc'", () => {
  assert.equal(storeMod.STORAGE_KEY, "training_aid_state_v2");
  assert.equal(storeMod.SCHEMA_VERSION, 2);
  assert.equal(codecMod.SCHEMA_VERSION, 2);

  const dirtyStorage = makeMemoryStorage({
    training_aid_state_v1: JSON.stringify({ schema_version: 1, profile: { name: "Old" } }),
    training_aid_state_v2: JSON.stringify({ schema_version: 1, profile: { name: "WrongVer" } }),
  });
  const store = storeMod.createStore({ storage: dirtyStorage, catalog });
  assert.equal(store.hasActivePlan(), false);
  assert.equal(store.getState(), null);

  let fakeNow = new Date("2026-11-13T09:00:00Z");
  const gymStore = storeMod.createStore({
    storage: makeMemoryStorage(),
    catalog,
    nowFn: () => new Date(fakeNow.getTime()),
  });
  const built = gymStore.setupPlan({
    name: "Sam",
    equipment_list: constantsMod.VALID_EQUIPMENT_IDS,
    starting_intensity: "moderate",
    days_per_week: 3,
    rest_seconds: 60,
    speed_mode: "normal",
  });
  assert.equal(gymStore.hasActivePlan(), true);
  assert.equal(built.plan.routines.length, 3);

  const byId = new Map(catalog.exercises.map((ex) => [ex.id, ex]));
  const plank = byId.get("Plank");
  for (const [intensity, expSec] of Object.entries({ light: 24, moderate: 30, intense: 36 })) {
    const presc = prescriptionMod.defaultPrescriptionForExercise(
      { equipment_list: constantsMod.VALID_EQUIPMENT_IDS, starting_intensity: intensity },
      plank
    );
    assert.equal(presc.reps, expSec);
  }

  // Non-destructive daily equipment override
  gymStore.setSessionEquipment([]);
  assert.equal(gymStore.hasSessionEquipmentOverride(), true);
  assert.equal(gymStore.getRecommendedToday().card.was_substituted, true);
  assert.equal(gymStore.getRoutine("r1").exercises[0].exercise_id, "Barbell_Full_Squat");

  const subLog = gymStore.completeWorkout("r1", {
    next_intensity_choice: "more",
    duration_minutes: 22,
    completed_at: "2026-11-13T09:30:00Z",
  });
  assert.equal(subLog.was_substituted, true);
  assert.equal(gymStore.getRoutine("r1").intensity_level, 0);

  // Next calendar day auto-resets override
  fakeNow = new Date("2026-11-14T10:00:00Z");
  assert.equal(gymStore.hasSessionEquipmentOverride(), false);
  assert.equal(gymStore.getRecommendedToday().card.routine.id, "r2");

  // Unified *ExerciseItem CRUD on both "r1" and "adhoc"
  gymStore.generateAdHocSession({ count: 3 });
  for (const targetId of ["r1", "adhoc"]) {
    const beforeLen = gymStore.getRoutine(targetId).exercises.length;
    const added = gymStore.addExerciseItem(targetId, "Pushups");
    assert.ok(added && gymStore.getRoutine(targetId).exercises.length === beforeLen + 1);

    const randAdded = gymStore.addRandomExerciseItem(targetId);
    assert.ok(randAdded && gymStore.getRoutine(targetId).exercises.length === beforeLen + 2);

    const updated = gymStore.updateExerciseItem(targetId, added.id, {
      sets: 5,
      base_reps: 14,
      base_weight_kg: 12.5,
    });
    assert.equal(updated.sets, 5);
    assert.equal(updated.base_reps, 14);
    assert.equal(updated.base_weight_kg, 12.5);

    const swapped = gymStore.swapExerciseItem(targetId, added.id);
    assert.ok(swapped && swapped.exercise_id !== "Pushups");

    const removed = gymStore.removeExerciseItem(targetId, randAdded.id);
    assert.equal(removed, true);
    assert.equal(gymStore.getRoutine(targetId).exercises.length, beforeLen + 1);
  }

  const adhocLog = gymStore.completeWorkout("adhoc", {
    duration_minutes: 18,
    completed_at: "2026-11-14T10:30:00Z",
  });
  assert.equal(adhocLog.is_adhoc, true);
  assert.equal(gymStore.getRecommendedToday().card.routine.id, "r2");

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

test("ARCHETYPE_FAMILY maps all 6 coronal archetypes to expected families", () => {
  const expectedCoronal = {
    lateral_raise: "push",
    chest_fly: "push",
    rear_fly: "pull",
    upright_row: "pull",
    side_lunge: "lower",
    side_bend: "core",
  };
  for (const [arch, family] of Object.entries(expectedCoronal)) {
    assert.equal(catalogMod.ARCHETYPE_FAMILY[arch], family);
    assert.equal(catalogMod.familyForArchetype(arch), family);
    assert.equal(catalogMod.familyForArchetype(arch.toUpperCase()), family);
  }
  assert.equal(Object.keys(catalogMod.ARCHETYPE_FAMILY).length, 24);
});
