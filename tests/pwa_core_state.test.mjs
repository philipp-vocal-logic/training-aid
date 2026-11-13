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
  assert.deepEqual(constantsMod.EQUIPMENT_OPTIONS, [
    { id: "dumbbell", label: "Dumbbells", arch: "curl", prop: "dumbbell" },
    { id: "kettlebells", label: "Kettlebells", arch: "hinge", prop: "kettlebells" },
    { id: "bands", label: "Bands", arch: "row_pull", prop: "bands" },
    { id: "barbell", label: "Barbell", arch: "bench_press", prop: "barbell" },
    { id: "pull_up_bar", label: "Pull-Up Bar", arch: "vertical_pull", prop: "body_only" },
    { id: "bench", label: "Bench", arch: "dip", prop: "body_only" },
    { id: "machine", label: "Machines", arch: "leg_extension_curl", prop: "machine" },
  ]);
  assert.deepEqual(constantsMod.normalizeEquipmentList("dumbbells"), []);
  assert.deepEqual(constantsMod.normalizeEquipmentList(["bands", "dumbbell", "bands"]), [
    "dumbbell",
    "bands",
  ]);
  assert.deepEqual(
    constantsMod.normalizeEquipmentList([
      "cable",
      "cables",
      "machines",
      "medicine_ball",
      "exercise_ball",
      "foam_roll",
      "dumbbell",
      "unknown_gear",
    ]),
    ["dumbbell", "machine"]
  );
  assert.equal(constantsMod.isWeightedCatalogEquipment("cable"), true);
  assert.equal(generatorMod.selectProgramKeyForEquipment(["barbell", "cable"]), "full_gym");
  assert.equal(generatorMod.selectProgramKeyForEquipment(["barbell", "machine"]), "full_gym");

  const legacyState = codecMod.validateAndNormalizeState(
    {
      schema_version: 2,
      profile: {
        name: "Legacy",
        equipment_list: ["cable", "medicine_ball", "foam_roll", "dumbbell", "exercise_ball"],
      },
      plan: {
        days_per_week: 3,
        routines: [{ id: "r1", name: "Day 1", intensity_level: 0, exercises: [] }],
      },
      adhoc_session: null,
      logs: [],
    },
    catalog
  );
  assert.deepEqual(legacyState.profile.equipment_list, ["dumbbell", "machine"]);

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

  assert.deepEqual(catalogMod.getRequiredEquipment(byId.get("Standing_Cable_Chest_Press")), [
    "machine",
  ]);
  assert.deepEqual(catalogMod.getRequiredEquipment(byId.get("Incline_Cable_Chest_Press")), [
    "machine",
    "bench",
  ]);

  const retiredOtherRaw = new Set(["other", "medicine ball", "exercise ball", "foam roll"]);
  for (const ex of catalog.exercises) {
    if (retiredOtherRaw.has(ex.equipment.toLowerCase())) {
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
      assert.ok(
        ["strength", "cardio", "plyometrics", "powerlifting"].includes(
          ex.category.toLowerCase()
        )
      );
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

test("soft-ranked multi-field catalog search across all 876 exercises (AC-1)", () => {
  assert.equal(catalog.exercises.length, 876);
  const store = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  store.setupPlan({ name: "SearchUser", equipment_list: ["dumbbell"], starting_intensity: "moderate", days_per_week: 3 });

  const allResults = store.searchCatalog("", 1000, { compatibleOnly: false });
  assert.equal(allResults.length, 876);
  const compatFlags = allResults.map((ex) => catalogMod.isExerciseCompatible(ex, ["dumbbell"]));
  const firstIncompatIdx = compatFlags.indexOf(false);
  assert.ok(firstIncompatIdx > 0 && firstIncompatIdx < 876);
  assert.ok(compatFlags.slice(firstIncompatIdx).every((flag) => !flag));
  for (let i = 1; i < firstIncompatIdx; i++) assert.ok(allResults[i - 1].name <= allResults[i].name);
  for (let i = firstIncompatIdx + 1; i < allResults.length; i++) assert.ok(allResults[i - 1].name <= allResults[i].name);
  assert.equal(store.searchCatalog("", 1000, { compatibleOnly: true }).length, firstIncompatIdx);

  assert.ok(store.searchCatalog("shoulders", 50, { compatibleOnly: false }).some((ex) => ex.primary_muscle.toLowerCase() === "shoulders"));
  const stretches = store.searchCatalog("stretching", 50, { compatibleOnly: false });
  assert.ok(stretches.length > 0 && stretches.every((ex) => ex.category.toLowerCase() === "stretching" || ex.name.toLowerCase().includes("stretching")));
  assert.ok(store.searchCatalog("dumbbell chest", 50, { compatibleOnly: false }).some((ex) => ex.id === "Dumbbell_Bench_Press"));
  assert.equal(store.searchCatalog("rope jumping", 50, { compatibleOnly: false })[0].id, "Rope_Jumping");
  assert.ok(store.searchCatalog("bodyweight abs", 50, { compatibleOnly: false }).some((ex) => ex.equipment.toLowerCase() === "body only" && ex.primary_muscle.toLowerCase() === "abdominals"));
  assert.ok(store.searchCatalog("quads", 25, { compatibleOnly: false }).some((ex) => ex.primary_muscle.toLowerCase() === "quadriceps"));
  assert.ok(store.searchCatalog("back", 25, { compatibleOnly: false }).some((ex) => ["middle back", "lower back", "lats"].includes(ex.primary_muscle.toLowerCase())));
});

test("generator categories unlock plyometrics/powerlifting and stretch-to-stretch swap (AC-2)", () => {
  assert.deepEqual([...catalogMod.SAFE_GENERATOR_CATEGORIES].sort(), ["cardio", "plyometrics", "powerlifting", "strength", "stretching"]);
  const store = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  store.setupPlan({ name: "SwapUser", equipment_list: constantsMod.VALID_EQUIPMENT_IDS, starting_intensity: "moderate", days_per_week: 3 });

  const stretchEx = catalog.exercises.find((ex) => ex.category.toLowerCase() === "stretching" && catalogMod.isExerciseCompatible(ex, []));
  assert.ok(stretchEx);
  const addedStretch = store.addExerciseItem("r1", stretchEx.id);
  const swapped = store.swapExerciseItem("r1", addedStretch.id, { rng: () => 0.1 });
  assert.ok(swapped && swapped.exercise_id !== stretchEx.id);
  assert.equal(store.getExercise(swapped.exercise_id).category.toLowerCase(), "stretching");

  for (let i = 0; i < 15; i++) {
    const randItem = store.addRandomExerciseItem("r1", { rng: () => (i + 0.5) / 15 });
    assert.ok(randItem && store.getExercise(randItem.exercise_id).category.toLowerCase() !== "stretching");
    store.removeExerciseItem("r1", randItem.id);
  }
});

test("manual out-of-profile and 'other' exercises stay preserved across plan, quick, and workout (AC-3)", () => {
  const store = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  store.setupPlan({ name: "ManualUser", equipment_list: ["barbell", "dumbbell"], starting_intensity: "moderate", days_per_week: 3 });

  const kbEx = catalog.exercises.find((ex) => ex.required_equipment.includes("kettlebells") && !catalogMod.isExerciseCompatible(ex, ["barbell", "dumbbell"]));
  assert.ok(kbEx);
  assert.ok(store.addExerciseItem("r1", "Rope_Jumping") && store.addExerciseItem("r1", kbEx.id));

  assert.equal(store.hasSessionEquipmentOverride(), false);
  const cardNoOverride = store.getRecommendedToday().card;
  assert.equal(cardNoOverride.was_substituted, false);
  assert.ok(cardNoOverride.exercises.some((row) => row.exercise.id === "Rope_Jumping"));
  assert.ok(cardNoOverride.exercises.some((row) => row.exercise.id === kbEx.id));
  const plNoOverride = store.buildPlaylist("r1");
  assert.ok(plNoOverride.some((pl) => pl.exercise_id === "Rope_Jumping") && plNoOverride.some((pl) => pl.exercise_id === kbEx.id));

  store.setSessionEquipment([]);
  assert.equal(store.hasSessionEquipmentOverride(), true);
  const cardOverride = store.getRecommendedToday().card;
  assert.equal(cardOverride.was_substituted, true);
  assert.equal(cardOverride.exercises.find((row) => row.exercise.id === "Rope_Jumping")?.is_substituted, false);
  assert.equal(cardOverride.exercises.find((row) => row.exercise.id === kbEx.id)?.is_substituted, false);
  const plOverride = store.buildPlaylist("r1");
  assert.ok(plOverride.some((pl) => pl.exercise_id === "Rope_Jumping" && !pl.is_substituted));
  assert.ok(plOverride.some((pl) => pl.exercise_id === kbEx.id && !pl.is_substituted));

  store.resetSessionEquipment();
  const adhocBefore = store.generateAdHocSession({ count: 3, rng: () => 0.25 });
  assert.equal(adhocBefore.exercises.some((it) => !catalogMod.isExerciseCompatible(store.getExercise(it.exercise_id), [])), true);
  store.addExerciseItem("adhoc", "Rope_Jumping");
  store.addExerciseItem("adhoc", kbEx.id);
  store.setSessionEquipment([]);
  const adhocAfter = store.adaptAdHocForCurrentEquipment();
  assert.ok(adhocAfter.exercises.some((it) => it.exercise_id === "Rope_Jumping") && adhocAfter.exercises.some((it) => it.exercise_id === kbEx.id));
  for (const it of adhocAfter.exercises) {
    if (it.exercise_id !== "Rope_Jumping" && it.exercise_id !== kbEx.id) {
      assert.equal(catalogMod.isExerciseCompatible(store.getExercise(it.exercise_id), []), true);
    }
  }
});

test("matchesCatalogFilters unit checks for equipment OR, __other__ exclusion, and facet ANDing", () => {
  const floorEx = {
    id: "Pushups",
    name: "Pushups",
    primary_muscle: "chest",
    category: "strength",
    archetype: "pushup",
    required_equipment: [],
  };
  const multiEx = {
    id: "Dumbbell_Bench_Press",
    name: "Dumbbell Bench Press",
    primary_muscle: "chest",
    category: "strength",
    archetype: "bench_press",
    required_equipment: ["dumbbell", "bench"],
  };
  const otherEx = {
    id: "Ab_Roller",
    name: "Ab Roller",
    primary_muscle: "abdominals",
    category: "strength",
    archetype: "plank",
    required_equipment: ["__other__"],
  };
  const kbEx = {
    id: "Kettlebell_Swing",
    name: "Kettlebell Swing",
    primary_muscle: "hamstrings",
    category: "strength",
    archetype: "hinge",
    required_equipment: ["kettlebells"],
  };

  assert.equal(catalogMod.matchesCatalogFilters(null, {}), false);
  assert.equal(catalogMod.matchesCatalogFilters(otherEx, undefined), true);
  assert.equal(catalogMod.matchesCatalogFilters(otherEx, null), true);
  assert.equal(
    catalogMod.matchesCatalogFilters(otherEx, { equipment: [], muscle: "", category: "", movement: "" }),
    true,
  );
  assert.equal(catalogMod.matchesCatalogFilters(otherEx, { equipment: ["  "] }), true);

  assert.equal(catalogMod.matchesCatalogFilters(floorEx, { equipment: ["body_only"] }), true);
  assert.equal(catalogMod.matchesCatalogFilters(floorEx, { equipment: [" BODY_ONLY "] }), true);
  assert.equal(catalogMod.matchesCatalogFilters(otherEx, { equipment: ["body_only"] }), false);
  assert.equal(catalogMod.matchesCatalogFilters(multiEx, { equipment: ["body_only"] }), false);

  assert.equal(catalogMod.matchesCatalogFilters(multiEx, { equipment: ["dumbbell"] }), true);
  assert.equal(catalogMod.matchesCatalogFilters(multiEx, { equipment: ["bench"] }), true);
  assert.equal(catalogMod.matchesCatalogFilters(multiEx, { equipment: ["kettlebells"] }), false);

  assert.equal(catalogMod.matchesCatalogFilters(floorEx, { equipment: ["body_only", "kettlebells"] }), true);
  assert.equal(catalogMod.matchesCatalogFilters(kbEx, { equipment: ["body_only", "kettlebells"] }), true);
  assert.equal(catalogMod.matchesCatalogFilters(multiEx, { equipment: ["body_only", "kettlebells"] }), false);

  assert.equal(
    catalogMod.matchesCatalogFilters(multiEx, {
      equipment: ["dumbbell"],
      muscle: " Chest ",
      category: "Strength",
      movement: " Push ",
    }),
    true,
  );
  assert.equal(
    catalogMod.matchesCatalogFilters(multiEx, {
      equipment: ["dumbbell"],
      muscle: "chest",
      category: "cardio",
      movement: "push",
    }),
    false,
  );
  assert.equal(
    catalogMod.matchesCatalogFilters(multiEx, {
      equipment: ["dumbbell"],
      muscle: "chest",
      category: "strength",
      movement: "pull",
    }),
    false,
  );
});

test("store.searchCatalog with filters enforces strict A-Z order and faceted filtering across all 876 exercises", () => {
  const store = storeMod.createStore({ storage: makeMemoryStorage(), catalog });
  store.setupPlan({ name: "FacetUser", equipment_list: ["dumbbell"], starting_intensity: "moderate", days_per_week: 3 });

  const allSorted = store.searchCatalog("", 1000, {
    filters: { equipment: [], muscle: "", category: "", movement: "" },
  });
  assert.equal(allSorted.length, 876);
  for (let i = 1; i < allSorted.length; i++) {
    const cmp = allSorted[i - 1].name.localeCompare(allSorted[i].name, "en", { sensitivity: "base" });
    assert.ok(cmp <= 0, `Expected '${allSorted[i - 1].name}' <= '${allSorted[i].name}'`);
  }
  const hasIncompatBeforeCompat = allSorted.some((ex, idx) => (
    !catalogMod.isExerciseCompatible(ex, ["dumbbell"])
    && idx < allSorted.findIndex((item) => item.id === "Dumbbell_Bench_Press")
  ));
  assert.equal(hasIncompatBeforeCompat, true);

  const bodyOnly = store.searchCatalog("", 1000, { filters: { equipment: ["body_only"] } });
  assert.equal(bodyOnly.length, 176);
  assert.ok(bodyOnly.every((ex) => ex.required_equipment.length === 0));
  assert.equal(bodyOnly.some((ex) => ex.required_equipment.includes("__other__")), false);

  const dumbbell = store.searchCatalog("", 1000, { filters: { equipment: ["dumbbell"] } });
  assert.ok(dumbbell.some((ex) => ex.id === "Dumbbell_Bench_Press"));
  assert.ok(dumbbell.every((ex) => ex.required_equipment.includes("dumbbell")));

  const kbOnly = store.searchCatalog("", 1000, { filters: { equipment: ["kettlebells"] } });
  const bodyOrKb = store.searchCatalog("", 1000, { filters: { equipment: ["body_only", "kettlebells"] } });
  assert.equal(bodyOrKb.length, bodyOnly.length + kbOnly.length);
  assert.ok(bodyOrKb.every((ex) => ex.required_equipment.length === 0 || ex.required_equipment.includes("kettlebells")));

  const combined = store.searchCatalog("", 1000, {
    filters: { equipment: ["dumbbell"], muscle: "chest", category: "strength", movement: "push" },
  });
  assert.ok(combined.length > 0);
  assert.ok(combined.some((ex) => ex.id === "Dumbbell_Bench_Press"));
  for (const ex of combined) {
    assert.equal(ex.required_equipment.includes("dumbbell"), true);
    assert.equal(ex.primary_muscle.toLowerCase(), "chest");
    assert.equal(ex.category.toLowerCase(), "strength");
    assert.equal(catalogMod.familyForArchetype(ex.archetype), "push");
  }

  const queryResults = store.searchCatalog("rope jumping", 50, {
    filters: { equipment: [], muscle: "", category: "", movement: "" },
  });
  assert.equal(queryResults[0].id, "Rope_Jumping");

  const pullQuery = store.searchCatalog("pull-up", 50, {
    filters: { equipment: [], muscle: "", category: "", movement: "pull" },
  });
  assert.ok(pullQuery.length > 0);
  assert.equal(pullQuery[0].id, "Band_Assisted_Pull-Up");
  assert.equal(catalogMod.isExerciseCompatible(pullQuery[0], ["dumbbell"]), false);
  for (let i = 1; i < pullQuery.length; i++) {
    assert.ok(pullQuery[i - 1].name.localeCompare(pullQuery[i].name, "en", { sensitivity: "base" }) <= 0);
  }

  const tierSynthetic = [
    { id: "Meta_Chest_Builder", name: "Chest Builder", primary_muscle: "chest", equipment: "dumbbell", category: "press", archetype: "bench_press", required_equipment: ["dumbbell"] },
    { id: "Z_Press_Tokens", name: "Zeta Press Move", primary_muscle: "chest", equipment: "dumbbell", category: "strength", archetype: "bench_press", required_equipment: ["dumbbell"] },
    { id: "A_Press_Tokens", name: "Alpha Press Move", primary_muscle: "chest", equipment: "barbell", category: "strength", archetype: "bench_press", required_equipment: ["barbell"] },
    { id: "Press_Prefix", name: "Press Away", primary_muscle: "chest", equipment: "barbell", category: "strength", archetype: "bench_press", required_equipment: ["barbell"] },
    { id: "Press_Exact", name: "Press", primary_muscle: "chest", equipment: "barbell", category: "strength", archetype: "bench_press", required_equipment: ["barbell"] },
  ];
  const tiered = catalogMod.searchCompatibleCatalog(
    tierSynthetic,
    "press",
    10,
    ["dumbbell"],
    false,
    { equipment: [], muscle: "", category: "", movement: "" },
  );
  assert.deepEqual(
    tiered.map((ex) => ex.id),
    ["Press_Exact", "Press_Prefix", "A_Press_Tokens", "Z_Press_Tokens", "Meta_Chest_Builder"],
  );
});
