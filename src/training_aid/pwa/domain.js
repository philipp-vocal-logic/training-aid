(function (root, factory) {
  function resolveSoundPresets() {
    if (root && root.TrainingSoundPresets) return root.TrainingSoundPresets;
    if (typeof require === "function") {
      try { return require("./static/sound-presets.js"); } catch { /* dist layout */ }
      try { return require("../static/sound-presets.js"); } catch { /* src layout */ }
    }
    return null;
  }
  const api = factory(resolveSoundPresets());
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingDomain = api;
})(typeof window !== "undefined" ? window : globalThis, function (soundPresets) {
  "use strict";

  const VALID_EQUIPMENT = Object.freeze([
    "body_only",
    "dumbbells",
    "kettlebell_bands",
    "full_gym",
  ]);
  const VALID_INTENSITY = Object.freeze(["light", "moderate", "intense"]);
  const VALID_SOUND_THEMES =
    soundPresets && Array.isArray(soundPresets.VALID_SOUND_THEMES)
      ? soundPresets.VALID_SOUND_THEMES
      : Object.freeze(["off", "minimal"]);
  const WEIGHTED_EQUIPMENT = new Set([
    "barbell",
    "dumbbell",
    "kettlebells",
    "cable",
    "machine",
    "e-z curl bar",
  ]);
  const DAY_MS = 86400000;

  function sanitizeString(val, maxLen, fallback = "") {
    if (typeof val !== "string") return fallback;
    const cleaned = val
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .trim()
      .slice(0, maxLen);
    return cleaned || fallback;
  }

  function clampInt(val, minVal, maxVal, fallback) {
    const num = Number(val);
    return Number.isFinite(num)
      ? Math.max(minVal, Math.min(maxVal, Math.round(num)))
      : fallback;
  }

  function parseUtcDate(input) {
    if (input instanceof Date) {
      return Number.isNaN(input.getTime()) ? null : new Date(input.getTime());
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) return null;
      const d = new Date(input);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof input === "string") {
      let s = input.trim();
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
        s = s.replace(" ", "T") + "Z";
      }
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function roundHalfKg(val) {
    return Math.max(0.5, Math.round(Number(val) * 2) / 2);
  }

  function formatWeight(kg) {
    const num = Number(kg);
    if (!Number.isFinite(num)) return "0 kg";
    return (Number.isInteger(num) ? String(num) : num.toFixed(1)) + " kg";
  }

  function scaleInitialPrescription(baseReps, baseWeightKg, intensity, isHold) {
    const hold = Boolean(isHold);
    const minFloor = hold ? 20 : 1;
    const repsNum = Math.max(minFloor, Math.round(Number(baseReps) || (hold ? 30 : 10)));
    const hasWeight =
      !hold && baseWeightKg !== null && baseWeightKg !== undefined && Number(baseWeightKg) > 0;
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
    return { sets, reps, weight_kg: weight, weight };
  }

  function defaultPrescriptionForExercise(profile, exercise) {
    const prof = profile || {};
    const intensity = VALID_INTENSITY.includes(prof.starting_intensity)
      ? prof.starting_intensity
      : "moderate";
    const isHold = Boolean(exercise && exercise.is_hold);
    if (isHold) return scaleInitialPrescription(30, null, intensity, true);

    const userEquip = prof.equipment || "body_only";
    const exEquip = exercise?.equipment ? String(exercise.equipment).toLowerCase() : "body only";
    let baseWeight = null;
    if (WEIGHTED_EQUIPMENT.has(exEquip) && userEquip !== "body_only") {
      baseWeight = exEquip === "barbell" ? 20.0 : 10.0;
    }
    return scaleInitialPrescription(10, baseWeight, intensity, false);
  }

  function computeScaledTarget(rxItem, scaleStep, exercise) {
    const item = rxItem || {};
    const step = clampInt(scaleStep, -5, 20, 0);
    const intensityPct = 100 + step * 10;
    const factor = step >= 0 ? Math.pow(1.1, step) : 1 + step * 0.1;
    const isHold = Boolean((exercise && exercise.is_hold) || item.is_hold);

    const sets = clampInt(item.sets, 1, 20, 3);
    const baseReps = clampInt(
      item.base_reps !== undefined ? item.base_reps : item.reps,
      1,
      600,
      isHold ? 30 : 10
    );
    const rawWeight = item.base_weight_kg !== undefined ? item.base_weight_kg : item.weight_kg;
    const baseWeight =
      rawWeight !== null && rawWeight !== undefined && Number(rawWeight) > 0
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
      return {
        sets,
        reps: baseReps,
        weight_kg: targetWeight,
        intensity_percent: intensityPct,
        formatted,
      };
    }

    const roundedReps = Math.round(baseReps * factor);
    let targetReps = baseReps;
    if (step > 0) targetReps = Math.max(roundedReps, baseReps + step);
    else if (step < 0) {
      targetReps = Math.max(isHold ? 20 : 1, Math.min(roundedReps, baseReps + step));
    }
    const unit = isHold ? "sec" : "reps";
    return {
      sets,
      reps: targetReps,
      weight_kg: null,
      intensity_percent: intensityPct,
      formatted: `${sets} \u00d7 ${targetReps} ${unit}`,
    };
  }

  function applyIntensityFeedback(currentStep, choice) {
    const step = clampInt(currentStep, -5, 20, 0);
    const norm = String(choice || "").trim().toLowerCase();
    if (norm === "more" || norm === "harder" || norm === "+10%") return Math.min(20, step + 1);
    if (norm === "less" || norm === "easier" || norm === "-10%") return Math.max(-5, step - 1);
    return step;
  }

  function isoYearWeekUtc(utcMidnightMs) {
    const d = new Date(utcMidnightMs);
    const isoDow = d.getUTCDay() || 7;
    const thursdayMs = utcMidnightMs + (4 - isoDow) * DAY_MS;
    const isoYear = new Date(thursdayMs).getUTCFullYear();
    const dayOfYear = Math.round((thursdayMs - Date.UTC(isoYear, 0, 1)) / DAY_MS);
    const isoWeek = Math.floor(dayOfYear / 7) + 1;
    return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
  }

  function computeWeekStreak(logs, daysPerWeekOrNow, maybeNowDate) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;
    const nowInput =
      maybeNowDate !== undefined
        ? maybeNowDate
        : typeof daysPerWeekOrNow === "number" && daysPerWeekOrNow <= 14
          ? undefined
          : daysPerWeekOrNow;
    const ref = parseUtcDate(nowInput) || new Date();
    const activeWeeks = new Set();

    for (const entry of logs) {
      const dt = entry ? parseUtcDate(entry.completed_at) : null;
      if (dt) {
        activeWeeks.add(
          isoYearWeekUtc(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
        );
      }
    }
    if (activeWeeks.size === 0) return 0;

    let cursorMs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
    if (!activeWeeks.has(isoYearWeekUtc(cursorMs))) {
      const prevMs = cursorMs - 7 * DAY_MS;
      if (!activeWeeks.has(isoYearWeekUtc(prevMs))) return 0;
      cursorMs = prevMs;
    }

    let streak = 0;
    while (activeWeeks.has(isoYearWeekUtc(cursorMs))) {
      streak += 1;
      cursorMs -= 7 * DAY_MS;
    }
    return streak;
  }

  return Object.freeze({
    VALID_EQUIPMENT,
    VALID_INTENSITY,
    VALID_SOUND_THEMES,
    sanitizeString,
    clampInt,
    parseUtcDate,
    roundHalfKg,
    formatWeight,
    scaleInitialPrescription,
    defaultPrescriptionForExercise,
    computeScaledTarget,
    applyIntensityFeedback,
    computeWeekStreak,
  });
});
