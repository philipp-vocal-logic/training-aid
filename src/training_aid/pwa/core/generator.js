import { clampInt, sanitizeString } from "./constants.js";
import { defaultPrescriptionForExercise, scaleInitialPrescription } from "./prescription.js";
import {
  BALANCED_SLOT_FAMILIES,
  SAFE_GENERATOR_CATEGORIES,
  familyForArchetype,
  filterCompatibleCatalog,
  getRequiredEquipment,
  isExerciseCompatible,
  toAvailableSet,
} from "./catalog.js";

function scoreSubstitute(cand, targetEx, availSet, usedIds) {
  const candCat = String(cand.category || "strength").toLowerCase();
  const targetCat = String(targetEx.category || "strength").toLowerCase();
  const wantStretch = targetCat === "stretching";
  if (!wantStretch && candCat === "stretching") return -1;
  if (!SAFE_GENERATOR_CATEGORIES.has(candCat) && candCat !== targetCat) return -1;

  let score = 0;
  if (cand.archetype === targetEx.archetype) score += 100;
  else if (familyForArchetype(cand.archetype) === familyForArchetype(targetEx.archetype)) score += 60;
  if (cand.primary_muscle && cand.primary_muscle === targetEx.primary_muscle) score += 30;
  if (candCat === (wantStretch ? "stretching" : "strength")) score += 25;
  if (Boolean(cand.is_hold) === Boolean(targetEx.is_hold)) score += 15;
  if (availSet.size > 0 && getRequiredEquipment(cand).length > 0) score += 14;
  if (!usedIds.has(cand.id)) score += 25;
  return score;
}

export function findSubstituteExercise(targetEx, availableEquip, exerciseList, usedIds) {
  const availSet = toAvailableSet(availableEquip);
  const used = usedIds instanceof Set ? usedIds : new Set();
  let best = null;
  let bestScore = -1;

  for (const cand of Array.isArray(exerciseList) ? exerciseList : []) {
    if (!cand || cand.id === targetEx.id || !isExerciseCompatible(cand, availSet)) continue;
    const sc = scoreSubstitute(cand, targetEx, availSet, used);
    if (sc > bestScore || (sc === bestScore && best && cand.id < best.id)) {
      best = cand;
      bestScore = sc;
    }
  }
  return best;
}

export function adaptRoutineForEquipment(
  routine,
  availableEquip,
  profile,
  exerciseList,
  exerciseMap,
  baselineEquip,
) {
  if (!routine || typeof routine !== "object") return null;
  const availSet = toAvailableSet(availableEquip);
  const baseSet = baselineEquip !== undefined && baselineEquip !== null
    ? toAvailableSet(baselineEquip)
    : null;
  const rawItems = Array.isArray(routine.exercises) ? routine.exercises : [];
  const usedIds = new Set();

  for (const item of rawItems) {
    const ex = exerciseMap instanceof Map ? exerciseMap.get(item.exercise_id) : null;
    if (ex && isExerciseCompatible(ex, availSet)) usedIds.add(ex.id);
  }

  let substitutedCount = 0;
  const adaptedItems = [];
  for (const item of rawItems) {
    const origEx = exerciseMap instanceof Map ? exerciseMap.get(item.exercise_id) : null;
    if (!origEx) continue;

    if (
      isExerciseCompatible(origEx, availSet)
      || (baseSet !== null && !isExerciseCompatible(origEx, baseSet))
    ) {
      usedIds.add(origEx.id);
      adaptedItems.push({ ...structuredClone(item), is_substituted: false, replaced_name: null });
      continue;
    }

    const subEx = findSubstituteExercise(origEx, availSet, exerciseList, usedIds);
    if (!subEx) {
      adaptedItems.push({ ...structuredClone(item), is_substituted: false, replaced_name: null });
      continue;
    }

    usedIds.add(subEx.id);
    substitutedCount += 1;
    const presc = defaultPrescriptionForExercise(profile, subEx);
    adaptedItems.push({
      id: item.id,
      exercise_id: subEx.id,
      sets: clampInt(item.sets, 1, 10, presc.sets),
      base_reps: presc.reps,
      base_weight_kg: presc.weight_kg,
      is_substituted: true,
      replaced_exercise_id: origEx.id,
      replaced_name: origEx.name,
    });
  }

  return {
    ...structuredClone(routine),
    was_substituted: substitutedCount > 0,
    substituted_count: substitutedCount,
    exercises: adaptedItems,
  };
}

export function pickRandomExercise(exerciseList, availableEquip, options) {
  const opts = options || {};
  const availSet = toAvailableSet(availableEquip);
  const excludeIds = opts.excludeIds instanceof Set ? opts.excludeIds : new Set(opts.excludeIds || []);
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const targetEx = opts.targetExercise || null;
  const targetFamily = opts.family || (targetEx ? familyForArchetype(targetEx.archetype) : null);

  const wantStretch = Boolean(targetEx && String(targetEx.category || "").toLowerCase() === "stretching");
  const compatible = filterCompatibleCatalog(exerciseList, availSet, { safeCategoriesOnly: true })
    .filter((ex) => (wantStretch
      ? String(ex.category || "").toLowerCase() === "stretching"
      : String(ex.category || "").toLowerCase() !== "stretching"));
  if (compatible.length === 0) return null;

  let pool = compatible.filter((ex) => !excludeIds.has(ex.id));
  if (pool.length === 0) pool = compatible;

  if (targetEx) {
    const exactArch = pool.filter((ex) => ex.archetype === targetEx.archetype);
    if (exactArch.length > 0) pool = exactArch;
    else if (targetFamily) {
      const famPool = pool.filter((ex) => familyForArchetype(ex.archetype) === targetFamily);
      if (famPool.length > 0) pool = famPool;
    }
  } else if (targetFamily) {
    const famPool = pool.filter((ex) => familyForArchetype(ex.archetype) === targetFamily);
    if (famPool.length > 0) pool = famPool;
  }

  if (availSet.size > 0 && targetFamily !== "core") {
    const geared = pool.filter((ex) => getRequiredEquipment(ex).length > 0);
    if (geared.length > 0 && rng() < 0.75) pool = geared;
  }

  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  return pool[idx] || pool[0];
}

export function generateBalancedSession(exerciseList, availableEquip, profile, options) {
  const opts = options || {};
  const count = clampInt(opts.count, 1, 16, 4);
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const availSet = toAvailableSet(availableEquip);
  const usedIds = new Set();
  const items = [];

  for (let i = 0; i < count; i++) {
    const family = BALANCED_SLOT_FAMILIES[i % BALANCED_SLOT_FAMILIES.length];
    const picked = pickRandomExercise(exerciseList, availSet, { family, excludeIds: usedIds, rng });
    if (!picked) continue;
    usedIds.add(picked.id);
    const presc = defaultPrescriptionForExercise(profile, picked);
    items.push({
      id: `adhoc_${i + 1}`,
      exercise_id: picked.id,
      sets: presc.sets,
      base_reps: presc.reps,
      base_weight_kg: presc.weight_kg,
    });
  }
  return items;
}

export function selectProgramKeyForEquipment(availableEquip) {
  const availSet = toAvailableSet(availableEquip);
  if (availSet.has("barbell") && (availSet.has("machine") || availSet.has("cable") || availSet.has("pull_up_bar"))) {
    return "full_gym";
  }
  if (availSet.has("dumbbell")) return "dumbbells";
  if (availSet.has("kettlebells") || availSet.has("bands")) return "kettlebell_bands";
  return "body_only";
}

export function buildProgramRoutines(catalog, profile, exerciseList, exerciseMap) {
  const eqPrograms = catalog?.programs?.equipment_programs || {};
  const programKey = selectProgramKeyForEquipment(profile.equipment_list);
  const injectPullUp = programKey === "body_only" && toAvailableSet(profile.equipment_list).has("pull_up_bar");
  const program = eqPrograms[programKey]
    || eqPrograms.body_only
    || { routines: [] };
  const templateRoutines = Array.isArray(program.routines) ? program.routines : [];
  const builtRoutines = [];
  let rxSeq = 1;

  for (let dIdx = 0; dIdx < profile.weekly_goal; dIdx++) {
    const rtDef = templateRoutines.length > 0 ? templateRoutines[dIdx % templateRoutines.length] : null;
    const baseRtName = Array.isArray(rtDef)
      ? String(rtDef[0] || `Day ${dIdx + 1}`)
      : String(rtDef?.name || `Day ${dIdx + 1}`);
    const rtName = dIdx >= templateRoutines.length
      ? `Day ${dIdx + 1}: ${baseRtName.replace(/^Day\s+\d+:\s*/i, "")}`
      : baseRtName;
    const rawSpecs = Array.isArray(rtDef) ? rtDef[1] || [] : rtDef?.exercises || [];
    const specs = rawSpecs.slice();
    if (injectPullUp && dIdx % 2 === 0 && specs.length > 2) {
      const pullSpec = dIdx % 4 === 0 ? ["Pullups", 8, null] : ["Chin-Up", 8, null];
      if (exerciseMap.size === 0 || exerciseMap.has(pullSpec[0])) specs[2] = pullSpec;
    }
    const items = [];

    for (const spec of specs) {
      const exId = Array.isArray(spec) ? String(spec[0]) : String(spec.exercise_id);
      const exObj = exerciseMap.get(exId);
      if (exerciseMap.size > 0 && !exObj) continue;
      const sc = scaleInitialPrescription(
        Array.isArray(spec) ? spec[1] : spec.base_reps,
        Array.isArray(spec) ? spec[2] : spec.base_weight_kg,
        profile.starting_intensity,
        Boolean(exObj?.is_hold),
      );
      items.push({ id: `rx${rxSeq++}`, exercise_id: exId, sets: sc.sets, base_reps: sc.reps, base_weight_kg: sc.weight_kg });
    }

    const rawRoutine = {
      id: `r${dIdx + 1}`,
      name: sanitizeString(rtName, 60, `Day ${dIdx + 1}`),
      intensity_level: 0,
      exercises: items,
    };
    const adapted = exerciseList.length > 0
      ? adaptRoutineForEquipment(rawRoutine, profile.equipment_list, profile, exerciseList, exerciseMap)
      : rawRoutine;
    builtRoutines.push({
      id: rawRoutine.id,
      name: rawRoutine.name,
      intensity_level: 0,
      exercises: adapted.exercises.map((it) => ({
        id: it.id,
        exercise_id: it.exercise_id,
        sets: it.sets,
        base_reps: it.base_reps,
        base_weight_kg: it.base_weight_kg,
      })),
    });
  }
  return builtRoutines;
}
