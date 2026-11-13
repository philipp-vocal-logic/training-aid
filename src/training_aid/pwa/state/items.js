import { normalizeCatalogExercise } from "../core/catalog.js";
import { pickRandomExercise } from "../core/generator.js";
import {
  defaultPrescriptionForExercise,
  sanitizePrescriptionPatch,
} from "../core/prescription.js";
import { MAX_EXERCISES_PER_ROUTINE } from "./codec.js";

export function buildCatalogIndex(catalog) {
  const exerciseList = [];
  const exerciseMap = new Map();
  for (const rawEx of Array.isArray(catalog?.exercises) ? catalog.exercises : []) {
    if (!rawEx?.id) continue;
    const normEx = normalizeCatalogExercise(rawEx);
    exerciseList.push(normEx);
    exerciseMap.set(normEx.id, normEx);
  }
  return { exerciseList, exerciseMap };
}

export function nextId(prefix, existingSet, startCount) {
  let n = startCount + 1;
  while (existingSet.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function collectRoutineItemIds(routines) {
  const existing = new Set();
  let count = 0;
  for (const rt of routines || []) {
    for (const ex of rt.exercises || []) {
      existing.add(String(ex.id));
      count += 1;
    }
  }
  return { existing, count };
}

export function addItemToTarget(resolved, exerciseId, ctx) {
  const items = resolved.target.exercises;
  const targetExId = String(exerciseId || "").trim();
  if (!Array.isArray(items) || !targetExId || items.length >= MAX_EXERCISES_PER_ROUTINE) return null;

  let exObj = ctx.exerciseMap.get(targetExId);
  if (ctx.exerciseMap.size > 0 && !exObj) return null;
  if (!exObj) exObj = normalizeCatalogExercise({ id: targetExId, name: targetExId });

  const presc = defaultPrescriptionForExercise(ctx.profile, exObj);
  let itemId;
  if (resolved.isAdHoc) {
    const existing = new Set(items.map((it) => String(it.id)));
    itemId = nextId("adhoc_", existing, items.length);
  } else {
    const { existing, count } = collectRoutineItemIds(ctx.routines);
    itemId = nextId("rx", existing, count);
  }

  const item = {
    id: itemId,
    exercise_id: exObj.id,
    sets: presc.sets,
    base_reps: presc.reps,
    base_weight_kg: presc.weight_kg,
  };
  items.push(item);
  return item;
}

export function updateItemInTarget(items, itemId, patch, exerciseMap) {
  if (!Array.isArray(items)) return null;
  const idx = items.findIndex((it) => String(it.id) === String(itemId));
  if (idx === -1) return null;
  const exObj = exerciseMap.get(items[idx].exercise_id);
  items[idx] = sanitizePrescriptionPatch(items[idx], patch, Boolean(exObj?.is_hold));
  return items[idx];
}

export function swapItemInTarget(items, itemId, ctx, rngOpts) {
  if (!Array.isArray(items)) return null;
  const idx = items.findIndex((it) => String(it.id) === String(itemId));
  if (idx === -1) return null;
  const cur = items[idx];
  const picked = pickRandomExercise(ctx.exerciseList, ctx.equipment, {
    targetExercise: ctx.exerciseMap.get(cur.exercise_id),
    excludeIds: new Set(items.map((it) => it.exercise_id)),
    rng: rngOpts?.rng,
  });
  if (!picked) return null;
  const presc = defaultPrescriptionForExercise(ctx.profile, picked);
  items[idx] = {
    id: cur.id,
    exercise_id: picked.id,
    sets: cur.sets,
    base_reps: presc.reps,
    base_weight_kg: presc.weight_kg,
  };
  return items[idx];
}

export function removeItemFromTarget(items, itemId) {
  if (!Array.isArray(items)) return false;
  const idx = items.findIndex((it) => String(it.id) === String(itemId));
  if (idx === -1) return false;
  items.splice(idx, 1);
  return true;
}
