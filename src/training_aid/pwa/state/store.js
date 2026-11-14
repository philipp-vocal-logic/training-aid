import {
  DEFAULT_INTENSITY_LABELS,
  DEFAULT_REST_SECONDS,
  VALID_INTENSITY,
  VALID_SOUND_THEMES,
  clampInt,
  clampRestSeconds,
  formatEquipmentSummary,
  normalizeEquipmentList,
  normalizeSpeedMode,
  sanitizeString,
} from "../core/constants.js";
import { searchCompatibleCatalog } from "../core/catalog.js";
import {
  adaptRoutineForEquipment,
  buildProgramRoutines,
  generateBalancedSession,
  pickRandomExercise,
} from "../core/generator.js";
import {
  applyIntensityFeedback,
  normalizeFeedbackChoice,
  stepToIntensityPercent,
} from "../core/prescription.js";
import { projectPlaylist, projectRoutineCard } from "../core/projections.js";
import {
  buildProgressSeries,
  computePlanStats,
  localDateKey,
  parseUtcDate,
  sortLogsDesc,
} from "../core/stats.js";
import { SCHEMA_VERSION, validateAndNormalizeState } from "./codec.js";
import {
  addItemToTarget,
  buildCatalogIndex,
  nextId,
  removeItemFromTarget,
  swapItemInTarget,
  updateItemInTarget,
} from "./items.js";

export { SCHEMA_VERSION };
export const STORAGE_KEY = "training_aid_state_v2";

let idCounter = 0;

function requestPersistentStorage() {
  return Promise.resolve()
    .then(() => (typeof navigator !== "undefined" ? navigator : null)?.storage?.persist?.() || false)
    .then(Boolean)
    .catch(() => false);
}

export function createStore(options = {}) {
  const catalog = options.catalog || { exercises: [], programs: {}, svgs: {} };
  const nowFn = typeof options.nowFn === "function" ? options.nowFn : () => new Date();
  let storageError = false;
  let storage = options.storage !== undefined ? options.storage : null;
  if (options.storage === undefined) {
    try { storage = typeof localStorage !== "undefined" ? localStorage : null; } catch { storage = null; storageError = true; }
  }

  const { exerciseList, exerciseMap } = buildCatalogIndex(catalog);
  const readStorage = (k) => {
    if (typeof storage?.getItem !== "function") return null;
    try { return storage.getItem(k); } catch { storageError = true; return null; }
  };
  const writeStorage = (k, v) => {
    if (typeof storage?.setItem !== "function") return;
    try { storage.setItem(k, v); storageError = false; } catch { storageError = true; }
  };

  const defaultProfile = { sound_theme: "minimal", rest_seconds: DEFAULT_REST_SECONDS, speed_mode: "normal" };
  let state = null;
  let sessionEquipmentOverride = null;
  let sessionEquipmentDayKey = "";
  let adHocSession = null;
  let adHocEquipment = null;

  const activeProfile = () => state?.profile || defaultProfile;

  function persistState(nextState) {
    state = nextState;
    if (state?.profile) {
      state.profile.sound_theme = VALID_SOUND_THEMES.includes(state.profile.sound_theme)
        ? state.profile.sound_theme : defaultProfile.sound_theme;
      state.profile.rest_seconds = clampRestSeconds(state.profile.rest_seconds, defaultProfile.rest_seconds);
      state.profile.speed_mode = normalizeSpeedMode(state.profile.speed_mode, defaultProfile.speed_mode);
      defaultProfile.sound_theme = state.profile.sound_theme;
      defaultProfile.rest_seconds = state.profile.rest_seconds;
      defaultProfile.speed_mode = state.profile.speed_mode;
    }
    if (state) writeStorage(STORAGE_KEY, JSON.stringify(state));
  }

  const rawJson = readStorage(STORAGE_KEY);
  if (rawJson) {
    try { persistState(validateAndNormalizeState(JSON.parse(rawJson), { exerciseMap })); }
    catch { state = null; }
  }

  const hasActivePlan = () => Boolean(state?.plan && Array.isArray(state.plan.routines));
  const getState = () => (hasActivePlan() ? structuredClone(state) : null);
  const hasStorageError = () => storageError;
  const exportStateJson = () => (hasActivePlan() ? JSON.stringify(state, null, 2) : null);

  function importStateJson(rawText) {
    if (typeof rawText !== "string" || !rawText.trim()) {
      throw new Error("Invalid backup: expected a non-empty JSON string.");
    }
    let parsed;
    try { parsed = JSON.parse(rawText); } catch { throw new Error("Invalid backup: file is not valid JSON."); }
    const validated = validateAndNormalizeState(parsed, { exerciseMap });
    sessionEquipmentOverride = null;
    sessionEquipmentDayKey = "";
    adHocSession = null;
    adHocEquipment = null;
    persistState(validated);
    requestPersistentStorage();
    return structuredClone(state);
  }

  function getSoundTheme() {
    const theme = activeProfile().sound_theme;
    return VALID_SOUND_THEMES.includes(theme) ? theme : "minimal";
  }

  function setSoundTheme(themeId) {
    if (!VALID_SOUND_THEMES.includes(themeId)) return getSoundTheme();
    activeProfile().sound_theme = themeId;
    defaultProfile.sound_theme = themeId;
    if (state?.profile) persistState(state);
    return themeId;
  }

  function getWorkoutTiming() {
    const prof = activeProfile();
    return {
      rest_seconds: clampRestSeconds(prof.rest_seconds, DEFAULT_REST_SECONDS),
      speed_mode: normalizeSpeedMode(prof.speed_mode),
    };
  }

  function setWorkoutTiming(patch) {
    const p = patch || {};
    const prof = activeProfile();
    if (p.rest_seconds !== undefined) {
      prof.rest_seconds = clampRestSeconds(p.rest_seconds, prof.rest_seconds);
      defaultProfile.rest_seconds = prof.rest_seconds;
    }
    if (p.speed_mode !== undefined) {
      prof.speed_mode = normalizeSpeedMode(p.speed_mode, prof.speed_mode);
      defaultProfile.speed_mode = prof.speed_mode;
    }
    if (state?.profile) persistState(state);
    return getWorkoutTiming();
  }

  function getSessionEquipment(nowDate) {
    const todayKey = localDateKey(nowDate || nowFn());
    if (sessionEquipmentOverride !== null && sessionEquipmentDayKey === todayKey) {
      return sessionEquipmentOverride.slice();
    }
    sessionEquipmentOverride = null;
    sessionEquipmentDayKey = "";
    return hasActivePlan() ? state.profile.equipment_list.slice() : [];
  }

  function hasSessionEquipmentOverride(nowDate) {
    return hasActivePlan() && getSessionEquipment(nowDate).join(",") !== state.profile.equipment_list.join(",");
  }

  function setSessionEquipment(list, nowDate) {
    sessionEquipmentOverride = normalizeEquipmentList(list);
    sessionEquipmentDayKey = localDateKey(nowDate || nowFn());
    return sessionEquipmentOverride.slice();
  }

  function resetSessionEquipment() {
    sessionEquipmentOverride = null;
    sessionEquipmentDayKey = "";
    return getSessionEquipment();
  }

  function setupPlan(setupOpts) {
    const cfg = setupOpts || {};
    const eqList = normalizeEquipmentList(cfg.equipment_list);
    const intKey = VALID_INTENSITY.includes(cfg.starting_intensity) ? cfg.starting_intensity : "moderate";
    const days = clampInt(cfg.days_per_week, 1, 7, 3);
    const prof = activeProfile();
    const profile = {
      name: sanitizeString(cfg.name, 50, "Athlete"),
      equipment_list: eqList,
      starting_intensity: intKey,
      weekly_goal: days,
      sound_theme: VALID_SOUND_THEMES.includes(cfg.sound_theme) ? cfg.sound_theme : prof.sound_theme,
      rest_seconds: clampRestSeconds(cfg.rest_seconds, prof.rest_seconds),
      speed_mode: normalizeSpeedMode(cfg.speed_mode, prof.speed_mode),
    };

    const intLabels = catalog?.programs?.intensity_labels || DEFAULT_INTENSITY_LABELS;
    const eqSummary = formatEquipmentSummary(eqList);
    const intensityLabel = intLabels[intKey] || DEFAULT_INTENSITY_LABELS[intKey] || "Moderate";
    const builtRoutines = buildProgramRoutines(catalog, profile, exerciseList, exerciseMap);

    sessionEquipmentOverride = null;
    sessionEquipmentDayKey = "";
    adHocSession = null;
    adHocEquipment = null;
    persistState({
      schema_version: SCHEMA_VERSION,
      profile,
      plan: {
        name: `${eqSummary} Plan (${days}\u00d7/Week)`,
        description: `${intensityLabel} \u2022 ${eqSummary}`,
        days_per_week: days,
        last_routine_id: null,
        routines: builtRoutines,
      },
      logs: Array.isArray(state?.logs) ? structuredClone(state.logs) : [],
    });
    requestPersistentStorage();
    return structuredClone(state);
  }

  function addWorkoutDay() {
    if (!hasActivePlan()) return null;
    const routines = state.plan.routines;
    const existing = new Set(routines.map((rt) => String(rt.id)));
    const newRoutine = { id: nextId("r", existing, routines.length), name: `Day ${routines.length + 1}`, intensity_level: 0, exercises: [] };
    routines.push(newRoutine);
    persistState(state);
    return structuredClone(newRoutine);
  }

  const findRoutine = (routineId) => (
    hasActivePlan() ? state.plan.routines.find((rt) => String(rt.id) === String(routineId)) || null : null
  );

  const hasAdHocSession = () => Boolean(adHocSession?.exercises?.length);

  function generateAdHocSession(genOpts) {
    const eq = getSessionEquipment();
    adHocEquipment = eq.slice();
    adHocSession = {
      id: "adhoc",
      name: `Quick Workout \u00b7 ${formatEquipmentSummary(eq)}`,
      intensity_level: 0,
      is_adhoc: true,
      exercises: generateBalancedSession(exerciseList, eq, state?.profile || { starting_intensity: "moderate" }, genOpts),
    };
    return structuredClone(adHocSession);
  }

  function ensureAdHocSession(genOpts) {
    if (!adHocSession) return generateAdHocSession(genOpts);
    adHocSession.name = `Quick Workout \u00b7 ${formatEquipmentSummary(getSessionEquipment())}`;
    return structuredClone(adHocSession);
  }

  function adaptAdHocForCurrentEquipment() {
    if (!adHocSession) return null;
    const eq = getSessionEquipment();
    const baseline = adHocEquipment !== null ? adHocEquipment : eq;
    const adapted = adaptRoutineForEquipment(
      adHocSession,
      eq,
      state?.profile || { starting_intensity: "moderate" },
      exerciseList,
      exerciseMap,
      baseline,
    );
    adHocEquipment = eq.slice();
    adHocSession = {
      ...adHocSession,
      name: `Quick Workout \u00b7 ${formatEquipmentSummary(eq)}`,
      exercises: adapted.exercises.map(({ id, exercise_id, sets, base_reps, base_weight_kg }) => ({
        id, exercise_id, sets, base_reps, base_weight_kg,
      })),
    };
    return structuredClone(adHocSession);
  }

  function resolveTarget(targetId, { createAdHoc = false } = {}) {
    if (String(targetId) === "adhoc") {
      if (!adHocSession && createAdHoc) ensureAdHocSession({ count: 0 });
      return adHocSession ? { target: adHocSession, isAdHoc: true } : null;
    }
    const rt = findRoutine(targetId);
    return rt ? { target: rt, isAdHoc: false } : null;
  }

  const getRoutine = (targetId) => {
    const resolved = resolveTarget(targetId);
    return resolved ? structuredClone(resolved.target) : null;
  };

  function addExerciseItem(targetId, exerciseId) {
    const resolved = resolveTarget(targetId, { createAdHoc: true });
    if (!resolved) return null;
    const item = addItemToTarget(resolved, exerciseId, {
      exerciseMap,
      profile: state?.profile,
      routines: state?.plan?.routines,
    });
    if (item && !resolved.isAdHoc) persistState(state);
    return item ? structuredClone(item) : null;
  }

  function addRandomExerciseItem(targetId, rngOpts) {
    const resolved = resolveTarget(targetId, { createAdHoc: true });
    if (!resolved) return null;
    const picked = pickRandomExercise(exerciseList, getSessionEquipment(), {
      excludeIds: new Set(resolved.target.exercises.map((it) => it.exercise_id)),
      rng: rngOpts?.rng,
    });
    return picked ? addExerciseItem(targetId, picked.id) : null;
  }

  function updateExerciseItem(targetId, itemId, patch) {
    const resolved = resolveTarget(targetId);
    const updated = updateItemInTarget(resolved?.target?.exercises, itemId, patch, exerciseMap);
    if (updated && !resolved.isAdHoc) persistState(state);
    return updated ? structuredClone(updated) : null;
  }

  function swapExerciseItem(targetId, itemId, rngOpts) {
    const resolved = resolveTarget(targetId);
    const swapped = swapItemInTarget(resolved?.target?.exercises, itemId, {
      exerciseList, exerciseMap, equipment: getSessionEquipment(), profile: state?.profile,
    }, rngOpts);
    if (swapped && !resolved.isAdHoc) persistState(state);
    return swapped ? structuredClone(swapped) : null;
  }

  function removeExerciseItem(targetId, itemId) {
    const resolved = resolveTarget(targetId);
    const removed = removeItemFromTarget(resolved?.target?.exercises, itemId);
    if (removed && !resolved.isAdHoc) persistState(state);
    return removed;
  }

  function buildRoutineCards(routinesSubset, cardOpts) {
    const adaptSession = Boolean(cardOpts?.adaptForSession) && hasSessionEquipmentOverride(cardOpts?.nowDate);
    const availEq = adaptSession ? getSessionEquipment(cardOpts?.nowDate) : null;
    const baselineEq = adaptSession && hasActivePlan() ? state.profile.equipment_list : undefined;
    let sourceRoutines = hasActivePlan() ? state.plan.routines : [];
    if (Array.isArray(routinesSubset)) {
      sourceRoutines = [];
      for (const cand of routinesSubset) {
        if (cand === "adhoc" && adHocSession) sourceRoutines.push(adHocSession);
        else if (typeof cand === "string") {
          const resolved = findRoutine(cand);
          if (resolved) sourceRoutines.push(resolved);
        } else if (cand && typeof cand === "object") sourceRoutines.push(cand);
      }
    }
    return sourceRoutines.map((rawRt) => (
      projectRoutineCard(rawRt, exerciseList, exerciseMap, state?.profile, availEq, adaptSession, baselineEq)
    ));
  }

  const getLogsDesc = () => sortLogsDesc(state?.logs);
  const getStats = (nowDate) => computePlanStats(state, getLogsDesc(), nowDate || nowFn());
  const getProgressSeries = () => buildProgressSeries(getLogsDesc());

  function getNextRoutineCard(cardOpts) {
    const cards = buildRoutineCards(undefined, cardOpts);
    if (cards.length === 0) return null;
    const idToIndex = new Map(cards.map((c, idx) => [String(c.routine.id), idx]));
    for (const lg of getLogsDesc()) {
      if (!lg.is_adhoc && lg.routine_id !== null && idToIndex.has(String(lg.routine_id))) {
        return cards[(idToIndex.get(String(lg.routine_id)) + 1) % cards.length];
      }
    }
    const lastId = state?.plan?.last_routine_id;
    return lastId !== null && lastId !== undefined && idToIndex.has(String(lastId))
      ? cards[(idToIndex.get(String(lastId)) + 1) % cards.length]
      : cards[0];
  }

  function getRecommendedToday(nowDate) {
    const ref = nowDate || nowFn();
    const todayKey = localDateKey(ref);
    const workoutsToday = getLogsDesc().filter((lg) => localDateKey(lg.completed_at) === todayKey).length;
    return {
      card: getNextRoutineCard({ adaptForSession: true, nowDate: ref }),
      workouts_today: workoutsToday,
      trained_today: workoutsToday > 0,
      stats: getStats(ref),
      equipment: getSessionEquipment(ref),
      is_equipment_overridden: hasSessionEquipmentOverride(ref),
    };
  }

  function buildPlaylist(targetId, playlistOpts) {
    const isAdHoc = String(targetId) === "adhoc";
    const cards = isAdHoc
      ? (hasAdHocSession() ? buildRoutineCards([adHocSession], { adaptForSession: false }) : [])
      : (() => {
          const rt = findRoutine(targetId);
          return rt
            ? buildRoutineCards([rt], { adaptForSession: playlistOpts?.adaptForSession !== false, nowDate: playlistOpts?.nowDate })
            : [];
        })();
    return cards.length > 0 ? projectPlaylist(cards[0], catalog?.svgs, getWorkoutTiming().speed_mode, isAdHoc) : [];
  }

  function completeWorkout(targetId, completeOpts) {
    if (!hasActivePlan()) return null;
    const isAdHoc = String(targetId) === "adhoc";
    const routine = isAdHoc ? adHocSession : findRoutine(targetId);
    if (!routine) return null;

    const cfg = completeOpts || {};
    const playlist = Array.isArray(cfg.playlist) && cfg.playlist.length > 0
      ? cfg.playlist
      : buildPlaylist(targetId, { adaptForSession: !isAdHoc });
    if (playlist.length === 0) return null;

    const wasSubstituted = !isAdHoc && playlist.some((p) => p.is_substituted || p.was_routine_substituted);
    const effectiveChoice = isAdHoc || wasSubstituted ? "keep" : normalizeFeedbackChoice(cfg.next_intensity_choice);
    const sessionIntensity = isAdHoc || wasSubstituted ? 0 : (routine.intensity_level || 0);
    const completedDt = (cfg.completed_at ? parseUtcDate(cfg.completed_at) : null) || nowFn();
    const timing = getWorkoutTiming();

    idCounter += 1;
    const logEntry = {
      id: `log_${Date.now().toString(36)}_${idCounter.toString(36)}`,
      routine_id: isAdHoc ? null : routine.id,
      routine_name: sanitizeString(routine.name, 60, isAdHoc ? "Quick Workout" : "Workout"),
      completed_at: completedDt.toISOString(),
      duration_minutes: clampInt(cfg.duration_minutes ?? 25, 1, 300, 25),
      intensity_at_session: sessionIntensity,
      next_intensity_choice: effectiveChoice,
      is_adhoc: isAdHoc,
      was_substituted: wasSubstituted,
      speed_mode: normalizeSpeedMode(cfg.speed_mode ?? timing.speed_mode),
      rest_seconds: clampRestSeconds(cfg.rest_seconds ?? timing.rest_seconds),
      exercises: playlist.map((pl) => ({
        exercise_id: String(pl.exercise_id),
        name: sanitizeString(pl.name, 120, pl.exercise_id),
        sets: clampInt(pl.sets, 1, 20, 3),
        reps: clampInt(pl.reps, 1, 600, 10),
        unit: pl.unit === "sec" || pl.is_hold ? "sec" : "reps",
        weight_kg: Number(pl.weight_kg) > 0 ? Number(pl.weight_kg) : null,
      })),
    };

    state.logs.unshift(logEntry);
    if (isAdHoc) {
      adHocSession = null;
      adHocEquipment = null;
    } else {
      state.plan.last_routine_id = routine.id;
      if (!wasSubstituted) routine.intensity_level = applyIntensityFeedback(routine.intensity_level, effectiveChoice);
    }
    persistState(state);
    return Object.assign(structuredClone(logEntry), { intensity_percent: stepToIntensityPercent(sessionIntensity) });
  }

  function searchCatalog(query, limit, searchOpts) {
    const equipFilter = searchOpts?.equipment !== undefined ? searchOpts.equipment : getSessionEquipment();
    return searchCompatibleCatalog(
      exerciseList,
      query,
      limit,
      equipFilter,
      Boolean(searchOpts?.compatibleOnly),
      searchOpts?.filters,
    );
  }

  return {
    hasActivePlan, getState, hasStorageError, exportStateJson, importStateJson,
    getSoundTheme, setSoundTheme, getWorkoutTiming, setWorkoutTiming,
    getSessionEquipment, hasSessionEquipmentOverride, setSessionEquipment, resetSessionEquipment,
    setupPlan, addWorkoutDay, getRoutine,
    hasAdHocSession, ensureAdHocSession, generateAdHocSession, adaptAdHocForCurrentEquipment,
    addExerciseItem, addRandomExerciseItem, updateExerciseItem, swapExerciseItem, removeExerciseItem,
    buildRoutineCards, getLogsDesc, getNextRoutineCard, getRecommendedToday, buildPlaylist, completeWorkout,
    getStats, getProgressSeries, searchCatalog,
    getExercise: (id) => { const found = exerciseMap.get(String(id || "")); return found ? structuredClone(found) : null; },
  };
}
