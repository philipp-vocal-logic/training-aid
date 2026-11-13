import {
  SPEED_MULTIPLIERS,
  VALID_INTENSITY,
  clampInt,
  isWeightedCatalogEquipment,
  normalizeSpeedMode,
} from "./constants.js";

export function roundHalfKg(val) {
  return Math.max(0.5, Math.round(Number(val) * 2) / 2);
}

export function formatWeight(kg) {
  const num = Number(kg);
  if (!Number.isFinite(num)) return "0 kg";
  return `${Number.isInteger(num) ? String(num) : num.toFixed(1)} kg`;
}

export function stepToIntensityPercent(step) {
  return Math.max(50, 100 + clampInt(step, -5, 20, 0) * 10);
}

export function normalizeFeedbackChoice(rawChoice) {
  const norm = String(rawChoice || "keep").trim().toLowerCase();
  if (norm === "more" || norm === "harder" || norm === "+10%") return "more";
  if (norm === "less" || norm === "easier" || norm === "-10%") return "less";
  return "keep";
}

export function applyIntensityFeedback(currentStep, choice) {
  const step = clampInt(currentStep, -5, 20, 0);
  const norm = normalizeFeedbackChoice(choice);
  if (norm === "more") return Math.min(20, step + 1);
  if (norm === "less") return Math.max(-5, step - 1);
  return step;
}

export function resolveEffectiveRepSeconds(exercise, speedMode) {
  if (exercise?.is_hold) return 1.0;
  const base = Number(exercise?.rep_seconds) > 0 ? Number(exercise.rep_seconds) : 2.8;
  const mult = SPEED_MULTIPLIERS[normalizeSpeedMode(speedMode)] || 1.0;
  const scaled = Math.min(6.0, Math.max(1.2, base / mult));
  return Math.round(scaled * 100) / 100;
}

export function scaleInitialPrescription(baseReps, baseWeightKg, intensity, isHold) {
  const hold = Boolean(isHold);
  const minFloor = hold ? 20 : 1;
  const repsNum = Math.max(minFloor, Math.round(Number(baseReps) || (hold ? 30 : 10)));
  const hasWeight = !hold && baseWeightKg !== null && baseWeightKg !== undefined && Number(baseWeightKg) > 0;
  const weightNum = hasWeight ? Number(baseWeightKg) : null;

  let sets = 3;
  let reps = repsNum;
  let weight = weightNum;
  if (intensity === "light") {
    sets = 2;
    reps = Math.max(hold ? 20 : 6, Math.round(repsNum * 0.8));
    weight = weightNum ? roundHalfKg(weightNum * 0.75) : null;
  } else if (intensity === "intense") {
    sets = 4;
    reps = Math.max(minFloor, Math.round(repsNum * 1.2));
    weight = weightNum ? roundHalfKg(weightNum * 1.2) : null;
  }
  return { sets, reps, weight_kg: weight };
}

export function defaultPrescriptionForExercise(profile, exercise) {
  const intensity = VALID_INTENSITY.includes(profile?.starting_intensity)
    ? profile.starting_intensity
    : "moderate";
  if (exercise?.is_hold) return scaleInitialPrescription(30, null, intensity, true);

  const exEquip = exercise?.equipment ? String(exercise.equipment).toLowerCase() : "body only";
  const baseWeight = isWeightedCatalogEquipment(exEquip)
    ? (exEquip === "barbell" ? 20.0 : 10.0)
    : null;
  return scaleInitialPrescription(10, baseWeight, intensity, false);
}

export function computeScaledTarget(rxItem, scaleStep, exercise) {
  const item = rxItem || {};
  const step = clampInt(scaleStep, -5, 20, 0);
  const intensityPct = stepToIntensityPercent(step);
  const factor = step >= 0 ? Math.pow(1.1, step) : 1 + step * 0.1;
  const isHold = Boolean(exercise?.is_hold || item.is_hold);

  const sets = clampInt(item.sets, 1, 20, 3);
  const baseReps = clampInt(
    item.base_reps !== undefined ? item.base_reps : item.reps,
    1,
    600,
    isHold ? 30 : 10,
  );
  const rawWeight = item.base_weight_kg !== undefined ? item.base_weight_kg : item.weight_kg;
  const baseWeight = rawWeight !== null && rawWeight !== undefined && Number(rawWeight) > 0
    ? Number(rawWeight)
    : null;

  if (baseWeight !== null) {
    const roundedWeight = roundHalfKg(baseWeight * factor);
    let targetWeight = baseWeight;
    if (step > 0) targetWeight = Math.max(roundedWeight, baseWeight + 0.5 * step);
    else if (step < 0) targetWeight = Math.min(roundedWeight, baseWeight + 0.5 * step);
    const minW = baseWeight >= 2 ? 2 : 0.5;
    targetWeight = Math.min(250, Math.max(minW, roundHalfKg(targetWeight)));
    const formatted = isHold
      ? `${sets} \u00d7 ${baseReps} sec @ ${formatWeight(targetWeight)}`
      : `${sets} \u00d7 ${baseReps} @ ${formatWeight(targetWeight)}`;
    return { sets, reps: baseReps, weight_kg: targetWeight, intensity_percent: intensityPct, formatted };
  }

  const roundedReps = Math.round(baseReps * factor);
  let targetReps = baseReps;
  if (step > 0) targetReps = Math.max(roundedReps, baseReps + step);
  else if (step < 0) targetReps = Math.max(isHold ? 20 : 1, Math.min(roundedReps, baseReps + step));
  const unit = isHold ? "sec" : "reps";
  return {
    sets,
    reps: targetReps,
    weight_kg: null,
    intensity_percent: intensityPct,
    formatted: `${sets} \u00d7 ${targetReps} ${unit}`,
  };
}

export function sanitizePrescriptionPatch(item, patch, isHold) {
  const next = { ...item };
  if (patch && patch.sets !== undefined) next.sets = clampInt(patch.sets, 1, 20, next.sets);
  if (patch && (patch.base_reps !== undefined || patch.reps !== undefined)) {
    const rawR = patch.base_reps !== undefined ? patch.base_reps : patch.reps;
    next.base_reps = clampInt(rawR, 1, 600, isHold ? 30 : 10);
  }
  if (patch && ("base_weight_kg" in patch || "weight_kg" in patch)) {
    const rawW = "base_weight_kg" in patch ? patch.base_weight_kg : patch.weight_kg;
    if (rawW === null || rawW === undefined || rawW === "" || Number(rawW) <= 0) {
      next.base_weight_kg = null;
    } else if (Number.isFinite(Number(rawW))) {
      next.base_weight_kg = Math.min(500, roundHalfKg(Number(rawW)));
    }
  }
  return next;
}
