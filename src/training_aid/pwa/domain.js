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

  const EQUIPMENT_OPTIONS = Object.freeze([
    Object.freeze({ id: "dumbbell", label: "Dumbbells", arch: "curl", prop: "dumbbell" }),
    Object.freeze({ id: "kettlebells", label: "Kettlebells", arch: "hinge", prop: "kettlebells" }),
    Object.freeze({ id: "bands", label: "Bands", arch: "row_pull", prop: "bands" }),
    Object.freeze({ id: "barbell", label: "Barbell", arch: "bench_press", prop: "barbell" }),
    Object.freeze({ id: "pull_up_bar", label: "Pull-Up Bar", arch: "vertical_pull", prop: "body_only" }),
    Object.freeze({ id: "bench", label: "Bench / Box", arch: "dip", prop: "body_only" }),
    Object.freeze({ id: "cable", label: "Cable", arch: "row_pull", prop: "cable" }),
    Object.freeze({ id: "machine", label: "Machine", arch: "leg_extension_curl", prop: "machine" }),
    Object.freeze({ id: "medicine_ball", label: "Med Ball", arch: "squat", prop: "dumbbell" }),
    Object.freeze({ id: "exercise_ball", label: "Swiss Ball", arch: "crunch_core", prop: "body_only" }),
    Object.freeze({ id: "foam_roll", label: "Foam Roll", arch: "plank", prop: "body_only" }),
  ]);
  const VALID_EQUIPMENT_IDS = Object.freeze(EQUIPMENT_OPTIONS.map((opt) => opt.id));
  const VALID_EQUIP_SET = new Set(VALID_EQUIPMENT_IDS);
  const EQUIP_LABEL_MAP = new Map(EQUIPMENT_OPTIONS.map((opt) => [opt.id, opt.label]));

  const VALID_INTENSITY = Object.freeze(["light", "moderate", "intense"]);
  const VALID_SOUND_THEMES =
    soundPresets && Array.isArray(soundPresets.VALID_SOUND_THEMES)
      ? soundPresets.VALID_SOUND_THEMES
      : Object.freeze(["off", "minimal"]);

  const VALID_SPEED_MODES = Object.freeze(["slow", "normal", "fast"]);
  const SPEED_MULTIPLIERS = Object.freeze({ slow: 0.75, normal: 1.0, fast: 1.25 });
  const SPEED_LABELS = Object.freeze({
    slow: "Slow (0.75\u00d7)",
    normal: "Normal (1\u00d7)",
    fast: "Fast (1.25\u00d7)",
  });
  const REST_PRESETS = Object.freeze([15, 30, 45, 60, 90]);
  const DEFAULT_REST_SECONDS = 30;

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

  function normalizeEquipmentList(input) {
    if (Array.isArray(input)) {
      const picked = new Set();
      for (const raw of input) {
        const key = String(raw || "").trim().toLowerCase();
        if (VALID_EQUIP_SET.has(key)) picked.add(key);
      }
      return VALID_EQUIPMENT_IDS.filter((id) => picked.has(id));
    }
    if (typeof input === "string") {
      const key = input.trim().toLowerCase();
      if (key === "full_gym") return VALID_EQUIPMENT_IDS.slice();
      if (key === "dumbbells") return ["dumbbell", "bench", "medicine_ball"];
      if (key === "kettlebell_bands") return ["kettlebells", "bands"];
      if (VALID_EQUIP_SET.has(key)) return [key];
    }
    return [];
  }

  function normalizeSpeedMode(val, fallback = "normal") {
    const norm = String(val || "").trim().toLowerCase();
    if (VALID_SPEED_MODES.includes(norm)) return norm;
    return VALID_SPEED_MODES.includes(fallback) ? fallback : "normal";
  }

  function clampRestSeconds(val, fallback = DEFAULT_REST_SECONDS) {
    return clampInt(val, 5, 300, fallback);
  }

  function resolveEffectiveRepSeconds(exercise, speedMode) {
    if (exercise && exercise.is_hold) return 1.0;
    const base = exercise && Number(exercise.rep_seconds) > 0 ? Number(exercise.rep_seconds) : 2.8;
    const mult = SPEED_MULTIPLIERS[normalizeSpeedMode(speedMode)] || 1.0;
    const scaled = Math.min(6.0, Math.max(1.2, base / mult));
    return Math.round(scaled * 100) / 100;
  }

  function isWeightedCatalogEquipment(rawEquip) {
    return WEIGHTED_EQUIPMENT.has(String(rawEquip || "").trim().toLowerCase());
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

  function localDateKey(input) {
    const d = input ? parseUtcDate(input) : new Date();
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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

    const exEquip = exercise?.equipment ? String(exercise.equipment).toLowerCase() : "body only";
    let baseWeight = null;
    if (WEIGHTED_EQUIPMENT.has(exEquip)) {
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

  function formatEquipmentSummary(eqList) {
    if (!Array.isArray(eqList) || eqList.length === 0) return "Bodyweight";
    if (eqList.length === EQUIPMENT_OPTIONS.length) return "Full Gym";
    const names = eqList.slice(0, 2).map((id) => EQUIP_LABEL_MAP.get(id) || id);
    return eqList.length > 2 ? `${names.join(", ")} +${eqList.length - 2}` : names.join(" & ");
  }

  function sanitizePrescriptionPatch(item, patch, isHold) {
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

  function sortLogsDesc(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return [];
    return logs
      .map((log, idx) => ({ log, idx, ts: Date.parse(log.completed_at) || 0 }))
      .sort((a, b) => (b.ts !== a.ts ? b.ts - a.ts : a.idx - b.idx))
      .map(({ log }) =>
        Object.assign(structuredClone(log), {
          intensity_percent: Math.max(50, 100 + Math.trunc(Number(log.intensity_at_session) || 0) * 10),
        })
      );
  }

  function computePlanStats(state, logsDesc, nowDate) {
    const now = parseUtcDate(nowDate) || new Date();
    const mondayOffset = (now.getUTCDay() + 6) % 7;
    const startOfWeekMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - mondayOffset * DAY_MS;
    let workoutsThisWeek = 0;
    for (const lg of logsDesc) {
      const dt = parseUtcDate(lg.completed_at);
      if (dt && dt.getTime() >= startOfWeekMs) workoutsThisWeek += 1;
    }
    const routines = Array.isArray(state?.plan?.routines) ? state.plan.routines : [];
    let avgPlanIntensity = 100;
    if (routines.length > 0) {
      const sumPct = routines.reduce(
        (acc, rt) => acc + Math.max(50, 100 + Math.trunc(Number(rt.intensity_level) || 0) * 10),
        0
      );
      avgPlanIntensity = Math.round(sumPct / routines.length);
    } else if (logsDesc.length > 0) avgPlanIntensity = logsDesc[0].intensity_percent;

    const profName = state?.profile?.name || "Athlete";
    const weeklyGoal = Math.max(1, Math.trunc(Number(state?.profile?.weekly_goal) || 3));
    const totalWorkouts = logsDesc.length;
    const suffix = totalWorkouts > 0 && workoutsThisWeek >= weeklyGoal ? " \u2713" : "";
    return {
      workouts_this_week: workoutsThisWeek,
      weekly_goal: weeklyGoal,
      total_workouts: totalWorkouts,
      week_streak: computeWeekStreak(logsDesc, weeklyGoal, now),
      avg_plan_intensity: avgPlanIntensity,
      message: `${profName} \u00b7 ${workoutsThisWeek}/${weeklyGoal}${suffix}`,
    };
  }

  function buildProgressSeries(logsDesc) {
    if (!Array.isArray(logsDesc) || logsDesc.length === 0) return { labels: [], values: [] };
    const chrono = logsDesc.slice().reverse();
    return {
      labels: ["0", ...chrono.map((_, i) => "#" + (i + 1))],
      values: [100, ...chrono.map((lg) => lg.intensity_percent)],
    };
  }

  return Object.freeze({
    EQUIPMENT_OPTIONS,
    VALID_EQUIPMENT_IDS,
    VALID_INTENSITY,
    VALID_SOUND_THEMES,
    VALID_SPEED_MODES,
    SPEED_MULTIPLIERS,
    SPEED_LABELS,
    REST_PRESETS,
    DEFAULT_REST_SECONDS,
    sanitizeString,
    clampInt,
    normalizeEquipmentList,
    normalizeSpeedMode,
    clampRestSeconds,
    resolveEffectiveRepSeconds,
    isWeightedCatalogEquipment,
    parseUtcDate,
    localDateKey,
    roundHalfKg,
    formatWeight,
    formatEquipmentSummary,
    sanitizePrescriptionPatch,
    scaleInitialPrescription,
    defaultPrescriptionForExercise,
    computeScaledTarget,
    applyIntensityFeedback,
    computeWeekStreak,
    sortLogsDesc,
    computePlanStats,
    buildProgressSeries,
  });
});
