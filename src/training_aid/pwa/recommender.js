/* Pure equipment capability matching, non-destructive session adaptation, and random workout generation */
(function (root, factory) {
  const domain =
    (root && root.TrainingDomain) ||
    (typeof require === "function" ? require("./domain.js") : null);
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingRecommender = api;
})(typeof window !== "undefined" ? window : globalThis, function (domain) {
  "use strict";

  const {
    sanitizeString,
    clampInt,
    normalizeEquipmentList,
    scaleInitialPrescription,
    defaultPrescriptionForExercise,
    computeScaledTarget,
    formatWeight,
    resolveEffectiveRepSeconds,
  } = domain;

  const ARCHETYPE_FAMILY = Object.freeze({
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

  const BALANCED_SLOT_FAMILIES = Object.freeze(["lower", "push", "pull", "core"]);
  const SAFE_GENERATOR_CATEGORIES = new Set(["strength", "cardio", "stretching"]);
  const PULL_BAR_RE = /pull-?ups?|chin-?ups?|inverted row/i;
  const BENCH_FIXTURE_RE = /\bbench\b|\bdips?\b/i;
  const FLOOR_EXEMPT_RE = /\bfloor\b|no hyperextension bench/i;

  function familyForArchetype(archetype) {
    return ARCHETYPE_FAMILY[String(archetype || "").toLowerCase()] || "lower";
  }

  function toAvailableSet(availableEquip) {
    if (availableEquip instanceof Set) return availableEquip;
    return new Set(normalizeEquipmentList(availableEquip));
  }

  function getRequiredEquipment(exercise) {
    if (!exercise || typeof exercise !== "object") return [];
    const rawEq = String(exercise.equipment || "body only").trim().toLowerCase();
    if (rawEq === "other") return ["__other__"];

    const reqs = new Set();
    if (rawEq === "dumbbell") reqs.add("dumbbell");
    else if (rawEq === "kettlebells") reqs.add("kettlebells");
    else if (rawEq === "bands") reqs.add("bands");
    else if (rawEq === "barbell" || rawEq === "e-z curl bar") reqs.add("barbell");
    else if (rawEq === "cable") reqs.add("cable");
    else if (rawEq === "machine") reqs.add("machine");
    else if (rawEq === "medicine ball") reqs.add("medicine_ball");
    else if (rawEq === "exercise ball") reqs.add("exercise_ball");
    else if (rawEq === "foam roll") reqs.add("foam_roll");

    const arch = String(exercise.archetype || "squat").toLowerCase();
    const name = String(exercise.name || "");
    if (rawEq === "body only" && (arch === "vertical_pull" || PULL_BAR_RE.test(name))) {
      reqs.add("pull_up_bar");
    }
    if (
      (arch === "bench_press" || arch === "dip" || BENCH_FIXTURE_RE.test(name)) &&
      !FLOOR_EXEMPT_RE.test(name)
    ) {
      reqs.add("bench");
    }
    return [...reqs];
  }

  function isExerciseCompatible(exercise, availableEquip) {
    const availSet = toAvailableSet(availableEquip);
    const reqs = getRequiredEquipment(exercise);
    for (const req of reqs) {
      if (!availSet.has(req)) return false;
    }
    return true;
  }

  function filterCompatibleCatalog(exerciseList, availableEquip, options) {
    const availSet = toAvailableSet(availableEquip);
    const safeOnly = Boolean(options && options.safeCategoriesOnly);
    const out = [];
    for (const ex of Array.isArray(exerciseList) ? exerciseList : []) {
      if (!ex || !isExerciseCompatible(ex, availSet)) continue;
      const cat = String(ex.category || "strength").toLowerCase();
      if (safeOnly && !SAFE_GENERATOR_CATEGORIES.has(cat)) continue;
      out.push(ex);
    }
    return out;
  }

  function scoreSubstitute(cand, targetEx, availSet, usedIds) {
    const candCat = String(cand.category || "strength").toLowerCase();
    const targetCat = String(targetEx.category || "strength").toLowerCase();
    const wantStretch = targetCat === "stretching";
    if (!wantStretch && candCat === "stretching") return -1;
    if (!SAFE_GENERATOR_CATEGORIES.has(candCat) && candCat !== targetCat) return -1;

    let score = 0;
    if (cand.archetype === targetEx.archetype) score += 100;
    else if (familyForArchetype(cand.archetype) === familyForArchetype(targetEx.archetype)) {
      score += 60;
    }
    if (cand.primary_muscle && cand.primary_muscle === targetEx.primary_muscle) score += 30;
    if (candCat === (wantStretch ? "stretching" : "strength")) score += 25;
    if (Boolean(cand.is_hold) === Boolean(targetEx.is_hold)) score += 15;
    if (availSet.size > 0 && getRequiredEquipment(cand).length > 0) score += 14;
    if (!usedIds.has(cand.id)) score += 25;
    return score;
  }

  function findSubstituteExercise(targetEx, availableEquip, exerciseList, usedIds) {
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

  function adaptRoutineForEquipment(routine, availableEquip, profile, exerciseList, exerciseMap) {
    if (!routine || typeof routine !== "object") return null;
    const availSet = toAvailableSet(availableEquip);
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

      if (isExerciseCompatible(origEx, availSet)) {
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

  function pickRandomExercise(exerciseList, availableEquip, options) {
    const opts = options || {};
    const availSet = toAvailableSet(availableEquip);
    const excludeIds = opts.excludeIds instanceof Set ? opts.excludeIds : new Set(opts.excludeIds || []);
    const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    const targetEx = opts.targetExercise || null;
    const targetFamily = opts.family || (targetEx ? familyForArchetype(targetEx.archetype) : null);

    const compatible = filterCompatibleCatalog(exerciseList, availSet, { safeCategoriesOnly: true })
      .filter((ex) => String(ex.category || "").toLowerCase() !== "stretching");
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

  function generateBalancedSession(exerciseList, availableEquip, profile, options) {
    const opts = options || {};
    const count = clampInt(opts.count, 1, 16, 4);
    const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    const availSet = toAvailableSet(availableEquip);
    const usedIds = new Set();
    const items = [];

    for (let i = 0; i < count; i++) {
      const family = BALANCED_SLOT_FAMILIES[i % BALANCED_SLOT_FAMILIES.length];
      const picked = pickRandomExercise(exerciseList, availSet, {
        family,
        excludeIds: usedIds,
        rng,
      });
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

  function selectProgramKeyForEquipment(availableEquip) {
    const availSet = toAvailableSet(availableEquip);
    if (availSet.has("barbell") && (availSet.has("cable") || availSet.has("machine") || availSet.has("pull_up_bar"))) {
      return "full_gym";
    }
    if (availSet.has("dumbbell")) return "dumbbells";
    if (availSet.has("kettlebells") || availSet.has("bands")) return "kettlebell_bands";
    return "body_only";
  }

  function normalizeCatalogExercise(rawEx) {
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
      rep_seconds: rawEx.rep_seconds > 0 ? Number(rawEx.rep_seconds) : hold ? 1.0 : 2.8,
      is_hold: hold,
      unit: rawEx.unit || (hold ? "sec" : "reps"),
      how_to: rawEx.how_to || "Move with steady control",
      cue_work: rawEx.cue_work || (hold ? "Hold" : "\u2193 Work"),
      cue_return: rawEx.cue_return || (hold ? "Breathe" : "\u2191 Return"),
      tempo_mode: rawEx.tempo_mode || (hold ? "hold" : "standard"),
      is_alternating: Boolean(rawEx.is_alternating),
    };
  }

  function searchCompatibleCatalog(exerciseList, query, limit, equipFilter, enforceCompat) {
    const maxItems = limit !== undefined && limit !== null ? Math.max(1, Math.trunc(Number(limit)) || 16) : 16;
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
      matches.sort((a, b) =>
        a.exactName !== b.exactName ? a.exactName - b.exactName :
        a.exactId !== b.exactId ? a.exactId - b.exactId :
        a.ex.name < b.ex.name ? -1 : a.ex.name > b.ex.name ? 1 : 0
      );
      return matches.slice(0, maxItems).map((m) => structuredClone(m.ex));
    }
    return filterCompatibleCatalog(exerciseList, equipFilter)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, maxItems)
      .map((ex) => structuredClone(ex));
  }

  function projectRoutineCard(rawRt, exerciseList, exerciseMap, profile, availEq, adaptSession) {
    const rt = adaptSession && !rawRt.is_adhoc && exerciseList.length > 0
      ? adaptRoutineForEquipment(rawRt, availEq, profile, exerciseList, exerciseMap)
      : rawRt;
    const lvl = Math.trunc(Number(rt.intensity_level) || 0);
    const intensityPct = Math.max(50, 100 + lvl * 10);
    const rows = [];
    for (const item of Array.isArray(rt.exercises) ? rt.exercises : []) {
      let ex = exerciseMap.get(item.exercise_id);
      if (exerciseMap.size > 0 && !ex) continue;
      if (!ex) ex = normalizeCatalogExercise({ id: item.exercise_id, name: item.exercise_id });
      rows.push({
        item: structuredClone(item),
        exercise: structuredClone(ex),
        archetype: ex.archetype,
        svg_key: ex.svg_key,
        thumb_url: ex.thumb_url,
        is_substituted: Boolean(item.is_substituted),
        replaced_name: item.replaced_name || null,
        scaled: computeScaledTarget(item, item.is_substituted ? 0 : lvl, ex),
      });
    }
    const rtCopy = structuredClone(rt);
    rtCopy.intensity_percent = intensityPct;
    return {
      routine: rtCopy,
      intensity_percent: intensityPct,
      was_substituted: Boolean(rt.was_substituted),
      substituted_count: Number(rt.substituted_count) || 0,
      exercises: rows,
      lead_archetype: rows.length > 0 ? rows[0].archetype : "squat",
      lead_svg_key: rows.length > 0 ? rows[0].svg_key : "squat:body_only",
    };
  }

  function projectPlaylist(card, svgsMap, speedMode, isAdHoc) {
    const svgs = svgsMap || {};
    return card.exercises.map(({ item, exercise: ex, scaled, archetype, svg_key, thumb_url, is_substituted, replaced_name }) => ({
      item_id: item.id,
      exercise_id: ex.id,
      name: ex.name,
      sets: scaled.sets,
      reps: scaled.reps,
      weight_kg: scaled.weight_kg,
      weight_label: scaled.weight_kg !== null ? formatWeight(scaled.weight_kg) : null,
      formatted: scaled.formatted,
      archetype,
      eq_mode: ex.eq_mode,
      svg_key,
      thumb_url,
      svg_markup: svgs[svg_key] || svgs[`${archetype}:body_only`] || svgs["squat:body_only"] || "",
      base_rep_seconds: ex.rep_seconds,
      rep_seconds: resolveEffectiveRepSeconds(ex, speedMode),
      is_hold: ex.is_hold,
      unit: ex.unit,
      how_to: ex.how_to,
      cue_work: ex.cue_work,
      cue_return: ex.cue_return,
      tempo_mode: ex.tempo_mode,
      is_alternating: ex.is_alternating,
      is_substituted: Boolean(is_substituted),
      replaced_name: replaced_name || null,
      was_routine_substituted: Boolean(card.was_substituted),
      is_adhoc: Boolean(isAdHoc),
    }));
  }

  function buildProgramRoutines(catalog, profile, exerciseList, exerciseMap) {
    const eqPrograms = catalog?.programs?.equipment_programs || {};
    const program = eqPrograms[selectProgramKeyForEquipment(profile.equipment_list)] || eqPrograms.body_only || { routines: [] };
    const templateRoutines = Array.isArray(program.routines) ? program.routines : [];
    const builtRoutines = [];
    let rxSeq = 1;
    for (let dIdx = 0; dIdx < profile.weekly_goal; dIdx++) {
      const rtDef = templateRoutines.length > 0 ? templateRoutines[dIdx % templateRoutines.length] : null;
      const baseRtName = Array.isArray(rtDef) ? String(rtDef[0] || `Day ${dIdx + 1}`) : String(rtDef?.name || `Day ${dIdx + 1}`);
      const rtName = dIdx >= templateRoutines.length ? `Day ${dIdx + 1}: ${baseRtName.replace(/^Day\s+\d+:\s*/i, "")}` : baseRtName;
      const specs = Array.isArray(rtDef) ? rtDef[1] || [] : rtDef?.exercises || [];
      const items = [];
      for (const spec of specs) {
        const exId = Array.isArray(spec) ? String(spec[0]) : String(spec.exercise_id);
        const exObj = exerciseMap.get(exId);
        if (exerciseMap.size > 0 && !exObj) continue;
        const sc = scaleInitialPrescription(
          Array.isArray(spec) ? spec[1] : spec.base_reps,
          Array.isArray(spec) ? spec[2] : spec.base_weight_kg,
          profile.starting_intensity,
          Boolean(exObj && exObj.is_hold)
        );
        items.push({ id: "rx" + rxSeq++, exercise_id: exId, sets: sc.sets, base_reps: sc.reps, base_weight_kg: sc.weight_kg });
      }
      const rawRoutine = { id: "r" + (dIdx + 1), name: sanitizeString(rtName, 60, "Day " + (dIdx + 1)), intensity_level: 0, exercises: items };
      const adapted = exerciseList.length > 0
        ? adaptRoutineForEquipment(rawRoutine, profile.equipment_list, profile, exerciseList, exerciseMap)
        : rawRoutine;
      builtRoutines.push({
        id: rawRoutine.id, name: rawRoutine.name, intensity_level: 0,
        exercises: adapted.exercises.map((it) => ({ id: it.id, exercise_id: it.exercise_id, sets: it.sets, base_reps: it.base_reps, base_weight_kg: it.base_weight_kg })),
      });
    }
    return builtRoutines;
  }

  return Object.freeze({
    ARCHETYPE_FAMILY,
    BALANCED_SLOT_FAMILIES,
    familyForArchetype,
    normalizeCatalogExercise,
    getRequiredEquipment,
    isExerciseCompatible,
    filterCompatibleCatalog,
    searchCompatibleCatalog,
    findSubstituteExercise,
    adaptRoutineForEquipment,
    pickRandomExercise,
    generateBalancedSession,
    selectProgramKeyForEquipment,
    buildProgramRoutines,
    projectRoutineCard,
    projectPlaylist,
  });
});
