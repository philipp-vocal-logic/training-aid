import {
  VALID_INTENSITY,
  VALID_SOUND_THEMES,
  clampInt,
  clampRestSeconds,
  normalizeEquipmentList,
  normalizeSpeedMode,
  sanitizeString,
} from "../core/constants.js";
import { normalizeFeedbackChoice } from "../core/prescription.js";
import { parseUtcDate } from "../core/stats.js";

export const SCHEMA_VERSION = 2;
export const MAX_ROUTINES = 32;
export const MAX_EXERCISES_PER_ROUTINE = 64;
export const MAX_LOGS = 5000;

export function deduplicateAndSortLogs(logsList) {
  const seenIds = new Set();
  const seenComposite = new Set();
  const unique = [];
  for (const lg of logsList || []) {
    if (!lg) continue;
    const compKey = `${lg.completed_at}|${lg.routine_name}`;
    if ((lg.id && seenIds.has(lg.id)) || seenComposite.has(compKey)) continue;
    if (lg.id) seenIds.add(lg.id);
    seenComposite.add(compKey);
    unique.push(structuredClone(lg));
  }
  unique.sort((a, b) => (Date.parse(b.completed_at) || 0) - (Date.parse(a.completed_at) || 0));
  return unique.slice(0, MAX_LOGS);
}

function resolveKnownExerciseIds(catalog) {
  if (!catalog) return null;
  if (catalog.exerciseMap instanceof Map) return catalog.exerciseMap.size > 0 ? catalog.exerciseMap : null;
  if (catalog.exerciseIds instanceof Set) return catalog.exerciseIds.size > 0 ? catalog.exerciseIds : null;
  const list = Array.isArray(catalog) ? catalog : Array.isArray(catalog.exercises) ? catalog.exercises : null;
  if (!list || list.length === 0) return null;
  const set = new Set();
  for (const ex of list) if (ex?.id) set.add(String(ex.id));
  return set.size > 0 ? set : null;
}

function parseOptionalWeight(rawW) {
  if (rawW === null || rawW === undefined || rawW === "" || typeof rawW === "boolean") return null;
  const parsedW = Number(rawW);
  return Number.isFinite(parsedW) && parsedW > 0 ? Math.min(500, parsedW) : null;
}

export function normalizeLogExercises(rawExList) {
  if (!Array.isArray(rawExList)) return [];
  const out = [];
  for (const raw of rawExList.slice(0, MAX_EXERCISES_PER_ROUTINE)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const exId = sanitizeString(raw.exercise_id, 120, "");
    const name = sanitizeString(raw.name, 120, exId || "Exercise");
    if (!exId && !name) continue;
    out.push({
      exercise_id: exId || name,
      name,
      sets: clampInt(raw.sets, 1, 20, 3),
      reps: clampInt(raw.reps, 1, 600, 10),
      unit: raw.unit === "sec" ? "sec" : "reps",
      weight_kg: parseOptionalWeight(raw.weight_kg),
    });
  }
  return out;
}

export function validateAndNormalizeState(rawPayload, catalog) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new Error("Invalid state: payload must be an object.");
  }
  if (rawPayload.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema_version; expected ${SCHEMA_VERSION}.`);
  }
  const { profile: rawProfile, plan: rawPlan } = rawPayload;
  if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
    throw new Error("Invalid state: profile must be an object.");
  }
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    throw new Error("Invalid state: plan must be an object.");
  }
  if (!Array.isArray(rawPlan.routines) || rawPlan.routines.length > MAX_ROUTINES) {
    throw new Error("Invalid state: plan.routines invalid.");
  }

  const knownIds = resolveKnownExerciseIds(catalog);
  const daysPerWeek = clampInt(rawPlan.days_per_week, 1, 7, 3);
  const profile = {
    name: sanitizeString(rawProfile.name, 50, "Athlete"),
    equipment_list: normalizeEquipmentList(rawProfile.equipment_list),
    starting_intensity: VALID_INTENSITY.includes(rawProfile.starting_intensity)
      ? rawProfile.starting_intensity
      : "moderate",
    weekly_goal: clampInt(rawProfile.weekly_goal, 1, 7, daysPerWeek),
    sound_theme: VALID_SOUND_THEMES.includes(rawProfile.sound_theme)
      ? rawProfile.sound_theme
      : "minimal",
    rest_seconds: clampRestSeconds(rawProfile.rest_seconds),
    speed_mode: normalizeSpeedMode(rawProfile.speed_mode),
  };

  const usedRoutineIds = new Set();
  const usedItemIds = new Set();
  const normalizedRoutines = [];

  for (let rIdx = 0; rIdx < rawPlan.routines.length; rIdx++) {
    const rawRt = rawPlan.routines[rIdx];
    if (!rawRt || typeof rawRt !== "object" || Array.isArray(rawRt)) continue;
    let baseRtId = rawRt.id !== null && rawRt.id !== undefined
      ? sanitizeString(String(rawRt.id), 64, "")
      : "";
    if (!baseRtId || usedRoutineIds.has(baseRtId)) {
      let suffix = rIdx + 1;
      while (usedRoutineIds.has(`r${suffix}`)) suffix += 1;
      baseRtId = `r${suffix}`;
    }
    usedRoutineIds.add(baseRtId);

    const rtIntensity = clampInt(rawRt.intensity_level, -5, 20, 0);
    const rawExercises = Array.isArray(rawRt.exercises)
      ? rawRt.exercises.slice(0, MAX_EXERCISES_PER_ROUTINE)
      : [];
    const normalizedExercises = [];

    for (const rawEx of rawExercises) {
      if (!rawEx || typeof rawEx !== "object" || Array.isArray(rawEx)) continue;
      const exId = sanitizeString(rawEx.exercise_id, 120, "");
      if (!exId || (knownIds && !knownIds.has(exId))) continue;

      let itemId = rawEx.id !== null && rawEx.id !== undefined
        ? sanitizeString(String(rawEx.id), 64, "")
        : "";
      if (!itemId || usedItemIds.has(itemId)) {
        let seq = usedItemIds.size + 1;
        while (usedItemIds.has(`rx${seq}`)) seq += 1;
        itemId = `rx${seq}`;
      }
      usedItemIds.add(itemId);

      normalizedExercises.push({
        id: itemId,
        exercise_id: exId,
        sets: clampInt(rawEx.sets, 1, 20, 3),
        base_reps: clampInt(rawEx.base_reps, 1, 600, 10),
        base_weight_kg: parseOptionalWeight(rawEx.base_weight_kg),
      });
    }

    normalizedRoutines.push({
      id: baseRtId,
      name: sanitizeString(rawRt.name, 60, `Day ${rIdx + 1}`),
      intensity_level: rtIntensity,
      exercises: normalizedExercises,
    });
  }

  const rawLastRtId = rawPlan.last_routine_id !== null && rawPlan.last_routine_id !== undefined
    ? sanitizeString(String(rawPlan.last_routine_id), 64, "")
    : "";
  const plan = {
    name: sanitizeString(rawPlan.name, 80, "Training Plan"),
    description: sanitizeString(rawPlan.description, 160, ""),
    days_per_week: daysPerWeek,
    last_routine_id: rawLastRtId && usedRoutineIds.has(rawLastRtId) ? rawLastRtId : null,
    routines: normalizedRoutines,
  };

  const rawLogs = Array.isArray(rawPayload.logs) ? rawPayload.logs.slice(0, MAX_LOGS) : [];
  const normalizedLogs = [];
  for (let lIdx = 0; lIdx < rawLogs.length; lIdx++) {
    const rawLg = rawLogs[lIdx];
    if (!rawLg || typeof rawLg !== "object" || Array.isArray(rawLg)) continue;
    const completedDt = parseUtcDate(rawLg.completed_at);
    if (!completedDt) continue;

    const lgId = (rawLg.id !== null && rawLg.id !== undefined && sanitizeString(String(rawLg.id), 64, ""))
      || `log_${lIdx + 1}_${completedDt.getTime()}`;
    const lgRoutineId = rawLg.routine_id !== null && rawLg.routine_id !== undefined
      ? sanitizeString(String(rawLg.routine_id), 64, "") || null
      : null;

    normalizedLogs.push({
      id: lgId,
      routine_id: lgRoutineId,
      routine_name: sanitizeString(rawLg.routine_name, 60, "Workout"),
      completed_at: completedDt.toISOString(),
      duration_minutes: clampInt(rawLg.duration_minutes, 1, 300, 25),
      intensity_at_session: clampInt(rawLg.intensity_at_session, -5, 20, 0),
      next_intensity_choice: normalizeFeedbackChoice(rawLg.next_intensity_choice),
      is_adhoc: Boolean(rawLg.is_adhoc),
      was_substituted: Boolean(rawLg.was_substituted),
      speed_mode: normalizeSpeedMode(rawLg.speed_mode),
      rest_seconds: clampRestSeconds(rawLg.rest_seconds),
      exercises: normalizeLogExercises(rawLg.exercises),
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    profile,
    plan,
    logs: deduplicateAndSortLogs(normalizedLogs),
  };
}
