import { normalizeEquipmentList } from "./constants.js";

export const ARCHETYPE_FAMILY = Object.freeze({
  squat: "lower",
  lunge: "lower",
  leg_extension_curl: "lower",
  calf_raise: "lower",
  glute_bridge: "lower",
  side_lunge: "lower",
  pushup: "push",
  bench_press: "push",
  dip: "push",
  overhead_press: "push",
  triceps_extension: "push",
  lateral_raise: "push",
  chest_fly: "push",
  vertical_pull: "pull",
  row_pull: "pull",
  hinge: "pull",
  curl: "pull",
  rear_fly: "pull",
  upright_row: "pull",
  plank: "core",
  crunch_core: "core",
  bicycle_crunch: "core",
  mountain_climber: "core",
  side_bend: "core",
});

export const BALANCED_SLOT_FAMILIES = Object.freeze(["lower", "push", "pull", "core"]);
export const SAFE_GENERATOR_CATEGORIES = new Set([
  "strength",
  "cardio",
  "plyometrics",
  "powerlifting",
  "stretching",
]);

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

function buildCatalogSynonyms(equipNorm, muscleNorm) {
  const syns = [];
  if (equipNorm === "body only") syns.push("bodyweight");
  if (muscleNorm === "abdominals") syns.push("abs core");
  if (muscleNorm === "quadriceps") syns.push("quads legs");
  if (muscleNorm === "middle back" || muscleNorm === "lower back" || muscleNorm === "lats") {
    syns.push("back");
  }
  return syns.join(" ");
}

export function matchesCatalogFilters(exercise, filters) {
  if (!exercise || typeof exercise !== "object") return false;
  if (!filters || typeof filters !== "object") return true;

  if (Array.isArray(filters.equipment) && filters.equipment.length > 0) {
    const equipIds = filters.equipment
      .map((id) => String(id || "").trim().toLowerCase())
      .filter(Boolean);
    if (equipIds.length > 0) {
      const req = getRequiredEquipment(exercise);
      const matchesEquip = equipIds.some((id) =>
        id === "body_only" ? req.length === 0 : req.includes(id),
      );
      if (!matchesEquip) return false;
    }
  }

  const muscle = String(filters.muscle || "").trim().toLowerCase();
  if (muscle && String(exercise.primary_muscle || "").trim().toLowerCase() !== muscle) {
    return false;
  }

  const category = String(filters.category || "").trim().toLowerCase();
  if (category && String(exercise.category || "").trim().toLowerCase() !== category) {
    return false;
  }

  const movement = String(filters.movement || "").trim().toLowerCase();
  if (movement && familyForArchetype(exercise.archetype) !== movement) {
    return false;
  }

  return true;
}

export function searchCompatibleCatalog(exerciseList, query, limit, equipFilter, enforceCompat, filters) {
  const list = Array.isArray(exerciseList) ? exerciseList : [];
  const maxItems = limit !== undefined && limit !== null
    ? Math.max(1, Math.trunc(Number(limit)) || 16)
    : 16;
  const availSet = toAvailableSet(equipFilter);
  const strictFacetMode = Boolean(filters && typeof filters === "object");
  const cleanQ = String(query ?? "").trim().toLowerCase();
  const tokens = cleanQ ? cleanQ.split(/[\s_/,-]+/).filter(Boolean) : [];
  const matches = [];

  for (const ex of list) {
    if (!ex) continue;
    const compat = isExerciseCompatible(ex, availSet);
    if (enforceCompat && !compat) continue;
    if (strictFacetMode && !matchesCatalogFilters(ex, filters)) continue;
    const compatRank = compat ? 0 : 1;

    let matchTier = 0;
    if (tokens.length > 0) {
      const nameNorm = String(ex.name || "").toLowerCase();
      const idNorm = String(ex.id || "").toLowerCase();
      const idWords = idNorm.replace(/_/g, " ");
      const muscleNorm = String(ex.primary_muscle || "").toLowerCase();
      const equipNorm = String(ex.equipment || "").toLowerCase();
      const catNorm = String(ex.category || "").toLowerCase();
      const synonyms = buildCatalogSynonyms(equipNorm, muscleNorm);
      const nameHay = `${nameNorm} ${idNorm} ${idWords}`;
      const metaHay = `${muscleNorm} ${equipNorm} ${catNorm} ${synonyms}`;

      if (!tokens.every((t) => nameHay.includes(t) || metaHay.includes(t))) continue;

      if (nameNorm === cleanQ || idNorm === cleanQ || idWords === cleanQ) matchTier = 0;
      else if (nameNorm.startsWith(cleanQ)) matchTier = 1;
      else if (tokens.every((t) => nameHay.includes(t))) matchTier = 2;
      else matchTier = 3;
    }

    matches.push({ ex, compatRank, matchTier });
  }

  matches.sort((a, b) => {
    const aExact = tokens.length > 0 && a.matchTier === 0 ? 0 : 1;
    const bExact = tokens.length > 0 && b.matchTier === 0 ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (!strictFacetMode && a.compatRank !== b.compatRank) return a.compatRank - b.compatRank;
    if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
    if (strictFacetMode) {
      const cmp = String(a.ex.name || "").localeCompare(String(b.ex.name || ""), "en", { sensitivity: "base" });
      if (cmp !== 0) return cmp;
      return a.ex.id < b.ex.id ? -1 : a.ex.id > b.ex.id ? 1 : 0;
    }
    return a.ex.name < b.ex.name ? -1 : a.ex.name > b.ex.name ? 1 : 0;
  });

  return matches.slice(0, maxItems).map((m) => structuredClone(m.ex));
}
