import { normalizeCatalogExercise } from "./catalog.js";
import { adaptRoutineForEquipment } from "./generator.js";
import {
  computeScaledTarget,
  formatWeight,
  resolveEffectiveRepSeconds,
  stepToIntensityPercent,
} from "./prescription.js";

export function projectRoutineCard(
  rawRt,
  exerciseList,
  exerciseMap,
  profile,
  availEq,
  adaptSession,
  baselineEq,
) {
  const rt = adaptSession && !rawRt.is_adhoc && exerciseList.length > 0
    ? adaptRoutineForEquipment(rawRt, availEq, profile, exerciseList, exerciseMap, baselineEq)
    : rawRt;
  const lvl = Math.trunc(Number(rt.intensity_level) || 0);
  const intensityPct = stepToIntensityPercent(lvl);
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
    lead_unilateral_mode: rows.length > 0 ? rows[0].exercise.unilateral_mode || "none" : "none",
    lead_is_alternating: rows.length > 0 ? Boolean(rows[0].exercise.is_alternating) : false,
  };
}

export function projectPlaylist(card, svgsMap, speedMode, isAdHoc) {
  const svgs = svgsMap || {};
  return card.exercises.map(({
    item,
    exercise: ex,
    scaled,
    archetype,
    svg_key,
    thumb_url,
    is_substituted,
    replaced_name,
  }) => ({
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
    unilateral_mode: ex.unilateral_mode || "none",
    is_substituted: Boolean(is_substituted),
    replaced_name: replaced_name || null,
    was_routine_substituted: Boolean(card.was_substituted),
    is_adhoc: Boolean(isAdHoc),
  }));
}
