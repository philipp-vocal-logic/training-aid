import { normalizeEquipmentList } from "./constants.js";

export const ARCHETYPE_FAMILY = Object.freeze({
  squat: "lower",
  lunge: "lower",
  leg_extension_curl: "lower",
  calf_raise: "lower",
  glute_bridge: "lower",
  pushup: "push",
  bench_press: "push",
  dip: "push",
  overhead_press: "push",
  triceps_extension: "push",
  vertical_pull: "pull",
  row_pull: "pull",
  hinge: "pull",
  curl: "pull",
  plank: "core",
  crunch_core: "core",
  bicycle_crunch: "core",
  mountain_climber: "core",
});

export const BALANCED_SLOT_FAMILIES = Object.freeze(["lower", "push", "pull", "core"]);
export const SAFE_GENERATOR_CATEGORIES = new Set(["strength", "cardio", "stretching"]);

export function familyForArchetype(archetype) {
  return ARCHETYPE_FAMILY[String(archetype || "").toLowerCase()] || "lower";
}

export function toAvailableSet(availableEquip) {
  if (availableEquip instanceof Set) return availableEquip;
  return new Set(normalizeEquipmentList(availableEquip));
}

export function normalizeCatalogExercise(rawEx) {
  const archetype = rawEx.archetype || "squat";
  const eqMode = rawEx.eq_mode || "body_only";
  const hold = Boolean(rawEx.is_hold);
  return {
    id: String(rawEx.id),
    name: String(rawEx.name || rawEx.id),
    category: rawEx.category || "strength",
    equipment: rawEx.equipment || "body only",
    primary_muscle: rawEx.primary_muscle || "other",
    archetype,
    eq_mode: eqMode,
    svg_key: rawEx.svg_key || `${archetype}:${eqMode}`,
    thumb_url: rawEx.thumb_url || `./svgs/thumbs/${archetype}__${eqMode}.svg`,
    rep_seconds: rawEx.rep_seconds > 0 ? Number(rawEx.rep_seconds) : (hold ? 1.0 : 2.8),
    is_hold: hold,
    unit: rawEx.unit || (hold ? "sec" : "reps"),
    how_to: rawEx.how_to || "Move with steady control",
    cue_work: rawEx.cue_work || (hold ? "Hold" : "\u2193 Work"),
    cue_return: rawEx.cue_return || (hold ? "Breathe" : "\u2191 Return"),
    tempo_mode: rawEx.tempo_mode || (hold ? "hold" : "standard"),
    is_alternating: Boolean(rawEx.is_alternating),
    required_equipment: Array.isArray(rawEx.required_equipment) ? [...rawEx.required_equipment] : [],
  };
}

export function getRequiredEquipment(exercise) {
  return Array.isArray(exercise?.required_equipment) ? exercise.required_equipment : [];
}

export function isExerciseCompatible(exercise, availableEquip) {
  const availSet = toAvailableSet(availableEquip);
  for (const req of getRequiredEquipment(exercise)) {
    if (!availSet.has(req)) return false;
  }
  return true;
}

export function filterCompatibleCatalog(exerciseList, availableEquip, options) {
  const availSet = toAvailableSet(availableEquip);
  const safeOnly = Boolean(options?.safeCategoriesOnly);
  const out = [];
  for (const ex of Array.isArray(exerciseList) ? exerciseList : []) {
    if (!ex || !isExerciseCompatible(ex, availSet)) continue;
    const cat = String(ex.category || "strength").toLowerCase();
    if (safeOnly && !SAFE_GENERATOR_CATEGORIES.has(cat)) continue;
    out.push(ex);
  }
  return out;
}

export function searchCompatibleCatalog(exerciseList, query, limit, equipFilter, enforceCompat) {
  const maxItems = limit !== undefined && limit !== null
    ? Math.max(1, Math.trunc(Number(limit)) || 16)
    : 16;
  const cleanQ = String(query ?? "").trim();
  if (cleanQ) {
    const lowerQ = cleanQ.toLowerCase();
    const matches = [];
    for (const ex of exerciseList) {
      if (enforceCompat && !isExerciseCompatible(ex, equipFilter)) continue;
      const nLow = ex.name.toLowerCase();
      const idLow = ex.id.toLowerCase();
      if (nLow.includes(lowerQ) || idLow.includes(lowerQ)) {
        matches.push({ ex, exactName: nLow === lowerQ ? 0 : 1, exactId: idLow === lowerQ ? 0 : 1 });
      }
    }
    matches.sort((a, b) => (
      a.exactName !== b.exactName ? a.exactName - b.exactName :
      a.exactId !== b.exactId ? a.exactId - b.exactId :
      a.ex.name < b.ex.name ? -1 : a.ex.name > b.ex.name ? 1 : 0
    ));
    return matches.slice(0, maxItems).map((m) => structuredClone(m.ex));
  }
  return filterCompatibleCatalog(exerciseList, equipFilter)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, maxItems)
    .map((ex) => structuredClone(ex));
}
