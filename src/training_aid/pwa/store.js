(function (root, factory) {
  const domain = (root && root.TrainingDomain) || (typeof require === "function" ? require("./domain.js") : null);
  const codec = (root && root.TrainingCodec) || (typeof require === "function" ? require("./codec.js") : null);
  const recommender = (root && root.TrainingRecommender) || (typeof require === "function" ? require("./recommender.js") : null);
  const api = factory(root, domain, codec, recommender);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingStore = api;
})(typeof window !== "undefined" ? window : globalThis, function (root, domain, codec, recommender) {
  "use strict";

  const STORAGE_KEY = "training_aid_state_v2";
  const {
    VALID_INTENSITY, VALID_SOUND_THEMES, DEFAULT_REST_SECONDS,
    sanitizeString, clampInt, normalizeEquipmentList, normalizeSpeedMode, clampRestSeconds,
    parseUtcDate, localDateKey, formatEquipmentSummary, sanitizePrescriptionPatch,
    defaultPrescriptionForExercise, computeScaledTarget, applyIntensityFeedback,
    computeWeekStreak, sortLogsDesc, computePlanStats, buildProgressSeries,
  } = domain;
  const { SCHEMA_VERSION, MAX_EXERCISES_PER_ROUTINE, validateAndNormalizeState } = codec;
  const {
    normalizeCatalogExercise, searchCompatibleCatalog, adaptRoutineForEquipment,
    pickRandomExercise, generateBalancedSession, buildProgramRoutines,
    projectRoutineCard, projectPlaylist,
  } = recommender;

  const DEFAULT_INTENSITY_LABELS = Object.freeze({ light: "Easy Start", moderate: "Moderate", intense: "Intense" });
  let idCounter = 0;

  function requestPersistentStorage() {
    return Promise.resolve()
      .then(() => (root?.navigator || (typeof navigator !== "undefined" ? navigator : null))?.storage?.persist?.() || false)
      .then(Boolean)
      .catch(() => false);
  }

  function nextId(prefix, existingSet, startCount) {
    let n = startCount + 1;
    while (existingSet.has(prefix + n)) n += 1;
    return prefix + n;
  }

  function createStore(options) {
    const opts = options || {};
    const catalog = opts.catalog || { exercises: [], programs: {}, svgs: {} };
    const nowFn = typeof opts.nowFn === "function" ? opts.nowFn : () => new Date();
    let storage = null;
    if (opts.storage !== undefined) storage = opts.storage;
    else {
      try { storage = root?.localStorage || null; } catch { storage = null; }
    }

    const exerciseList = [];
    const exerciseMap = new Map();
    for (const rawEx of Array.isArray(catalog.exercises) ? catalog.exercises : []) {
      if (!rawEx || !rawEx.id) continue;
      const normEx = normalizeCatalogExercise(rawEx);
      exerciseList.push(normEx);
      exerciseMap.set(normEx.id, normEx);
    }

    const readStorage = (k) => {
      if (typeof storage?.getItem !== "function") return null;
      try { return storage.getItem(k); } catch { return null; }
    };
    const writeStorage = (k, v) => {
      if (typeof storage?.setItem !== "function") return;
      try { storage.setItem(k, v); } catch { /* ignore quota */ }
    };

    let fallbackSoundTheme = "minimal";
    let fallbackRestSeconds = DEFAULT_REST_SECONDS;
    let fallbackSpeedMode = "normal";
    let state = null;
    let sessionEquipmentOverride = null;
    let sessionEquipmentDayKey = "";
    let adHocSession = null;

    function persistState(nextState) {
      state = nextState;
      if (state?.profile) {
        state.profile.sound_theme = VALID_SOUND_THEMES.includes(state.profile.sound_theme)
          ? state.profile.sound_theme
          : fallbackSoundTheme;
        state.profile.rest_seconds = clampRestSeconds(state.profile.rest_seconds, fallbackRestSeconds);
        state.profile.speed_mode = normalizeSpeedMode(state.profile.speed_mode, fallbackSpeedMode);
        fallbackSoundTheme = state.profile.sound_theme;
        fallbackRestSeconds = state.profile.rest_seconds;
        fallbackSpeedMode = state.profile.speed_mode;
      }
      if (state) writeStorage(STORAGE_KEY, JSON.stringify(state));
    }

    (() => {
      const rawJson = readStorage(STORAGE_KEY);
      if (!rawJson) return;
      try {
        state = validateAndNormalizeState(JSON.parse(rawJson), { exerciseMap });
        fallbackSoundTheme = state.profile.sound_theme;
        fallbackRestSeconds = state.profile.rest_seconds;
        fallbackSpeedMode = state.profile.speed_mode;
      } catch {
        state = null;
      }
    })();

    const hasActivePlan = () => Boolean(state?.plan && Array.isArray(state.plan.routines));
    const getState = () => (hasActivePlan() ? structuredClone(state) : null);

    function getSoundTheme() {
      if (state?.profile && VALID_SOUND_THEMES.includes(state.profile.sound_theme)) {
        return (fallbackSoundTheme = state.profile.sound_theme);
      }
      return fallbackSoundTheme;
    }

    function setSoundTheme(themeId) {
      if (!VALID_SOUND_THEMES.includes(themeId)) return getSoundTheme();
      fallbackSoundTheme = themeId;
      if (state?.profile) persistState(state);
      return fallbackSoundTheme;
    }

    function getWorkoutTiming() {
      return {
        rest_seconds: state?.profile ? clampRestSeconds(state.profile.rest_seconds) : fallbackRestSeconds,
        speed_mode: state?.profile ? normalizeSpeedMode(state.profile.speed_mode) : fallbackSpeedMode,
      };
    }

    function setWorkoutTiming(patch) {
      const p = patch || {};
      if (p.rest_seconds !== undefined) fallbackRestSeconds = clampRestSeconds(p.rest_seconds, fallbackRestSeconds);
      if (p.speed_mode !== undefined) fallbackSpeedMode = normalizeSpeedMode(p.speed_mode, fallbackSpeedMode);
      if (state?.profile) {
        state.profile.rest_seconds = fallbackRestSeconds;
        state.profile.speed_mode = fallbackSpeedMode;
        persistState(state);
      }
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
      const eqList = normalizeEquipmentList(cfg.equipment_list ?? cfg.equipment);
      const intKey = VALID_INTENSITY.includes(cfg.starting_intensity) ? cfg.starting_intensity : "moderate";
      const days = clampInt(cfg.days_per_week, 1, 7, 3);
      const profile = {
        name: sanitizeString(cfg.name, 50, "Athlete"),
        equipment_list: eqList,
        starting_intensity: intKey,
        weekly_goal: days,
        sound_theme: VALID_SOUND_THEMES.includes(cfg.sound_theme) ? cfg.sound_theme : getSoundTheme(),
        rest_seconds: clampRestSeconds(cfg.rest_seconds, fallbackRestSeconds),
        speed_mode: normalizeSpeedMode(cfg.speed_mode, fallbackSpeedMode),
      };

      const intLabels = catalog?.programs?.intensity_labels || DEFAULT_INTENSITY_LABELS;
      const eqSummary = formatEquipmentSummary(eqList);
      const intensityLabel = intLabels[intKey] || DEFAULT_INTENSITY_LABELS[intKey] || "Moderate";
      const builtRoutines = buildProgramRoutines(catalog, profile, exerciseList, exerciseMap);

      sessionEquipmentOverride = null;
      sessionEquipmentDayKey = "";
      adHocSession = null;
      persistState({
        schema_version: SCHEMA_VERSION,
        profile,
        plan: { name: `${eqSummary} Plan (${days}\u00d7/Week)`, description: `${intensityLabel} \u2022 ${eqSummary}`, days_per_week: days, last_routine_id: null, routines: builtRoutines },
        logs: Array.isArray(state?.logs) ? structuredClone(state.logs) : [],
      });
      requestPersistentStorage();
      return structuredClone(state);
    }

    function addWorkoutDay() {
      if (!hasActivePlan()) return null;
      const routines = state.plan.routines;
      const existing = new Set(routines.map((rt) => String(rt.id)));
      const newRoutine = { id: nextId("r", existing, routines.length), name: "Day " + (routines.length + 1), intensity_level: 0, exercises: [] };
      routines.push(newRoutine);
      persistState(state);
      return structuredClone(newRoutine);
    }

    const findRoutine = (routineId) =>
      hasActivePlan() ? state.plan.routines.find((rt) => String(rt.id) === String(routineId)) || null : null;
    const getRoutine = (routineId) => {
      const found = findRoutine(routineId);
      return found ? structuredClone(found) : null;
    };

    function appendToItems(items, exerciseId, idPrefix, existingIds, idStart, shouldPersist) {
      const targetExId = String(exerciseId || "").trim();
      if (!Array.isArray(items) || !targetExId || items.length >= MAX_EXERCISES_PER_ROUTINE) return null;
      let exObj = exerciseMap.get(targetExId);
      if (exerciseMap.size > 0 && !exObj) return null;
      if (!exObj) exObj = normalizeCatalogExercise({ id: targetExId, name: targetExId });
      const presc = defaultPrescriptionForExercise(state?.profile, exObj);
      const item = { id: nextId(idPrefix, existingIds, idStart), exercise_id: exObj.id, sets: presc.sets, base_reps: presc.reps, base_weight_kg: presc.weight_kg };
      items.push(item);
      if (shouldPersist) persistState(state);
      return structuredClone(item);
    }

    function updateInItems(items, itemId, patch, shouldPersist) {
      if (!Array.isArray(items)) return null;
      const idx = items.findIndex((it) => String(it.id) === String(itemId));
      if (idx === -1) return null;
      const exObj = exerciseMap.get(items[idx].exercise_id);
      items[idx] = sanitizePrescriptionPatch(items[idx], patch, Boolean(exObj && exObj.is_hold));
      if (shouldPersist) persistState(state);
      return structuredClone(items[idx]);
    }

    function swapInItems(items, itemId, rngOpts, shouldPersist) {
      if (!Array.isArray(items)) return null;
      const idx = items.findIndex((it) => String(it.id) === String(itemId));
      if (idx === -1) return null;
      const cur = items[idx];
      const usedIds = new Set(items.map((it) => it.exercise_id));
      const picked = pickRandomExercise(exerciseList, getSessionEquipment(), {
        targetExercise: exerciseMap.get(cur.exercise_id),
        excludeIds: usedIds,
        rng: rngOpts?.rng,
      });
      if (!picked) return null;
      const presc = defaultPrescriptionForExercise(state?.profile, picked);
      items[idx] = { id: cur.id, exercise_id: picked.id, sets: cur.sets, base_reps: presc.reps, base_weight_kg: presc.weight_kg };
      if (shouldPersist) persistState(state);
      return structuredClone(items[idx]);
    }

    function removeFromItems(items, itemId, shouldPersist) {
      if (!Array.isArray(items)) return false;
      const idx = items.findIndex((it) => String(it.id) === String(itemId));
      if (idx === -1) return false;
      items.splice(idx, 1);
      if (shouldPersist) persistState(state);
      return true;
    }

    function allRoutineItemIds() {
      const existing = new Set();
      let count = 0;
      for (const rt of state?.plan?.routines || []) {
        for (const ex of rt.exercises || []) { existing.add(String(ex.id)); count += 1; }
      }
      return { existing, count };
    }

    function addExerciseToRoutine(routineId, exerciseId) {
      const routine = findRoutine(routineId);
      if (!routine) return null;
      const { existing, count } = allRoutineItemIds();
      return appendToItems(routine.exercises, exerciseId, "rx", existing, count, true);
    }

    function addRandomExerciseToRoutine(routineId, rngOpts) {
      const routine = findRoutine(routineId);
      if (!routine) return null;
      const picked = pickRandomExercise(exerciseList, getSessionEquipment(), {
        excludeIds: new Set(routine.exercises.map((it) => it.exercise_id)),
        rng: rngOpts?.rng,
      });
      return picked ? addExerciseToRoutine(routineId, picked.id) : null;
    }

    const updateRoutineExercise = (routineId, itemId, patch) => updateInItems(findRoutine(routineId)?.exercises, itemId, patch, true);
    const swapRoutineExercise = (routineId, itemId, rngOpts) => swapInItems(findRoutine(routineId)?.exercises, itemId, rngOpts, true);
    const removeExerciseFromRoutine = (routineId, itemId) => removeFromItems(findRoutine(routineId)?.exercises, itemId, true);

    /* Ephemeral On-the-Fly Session (#quick -> #workout/adhoc) */
    const hasAdHocSession = () => Boolean(adHocSession && Array.isArray(adHocSession.exercises) && adHocSession.exercises.length > 0);
    const getAdHocSession = () => (adHocSession ? structuredClone(adHocSession) : null);

    function generateAdHocSession(genOpts) {
      const eq = getSessionEquipment();
      adHocSession = {
        id: "adhoc",
        name: `On-the-Fly \u00b7 ${formatEquipmentSummary(eq)}`,
        intensity_level: 0,
        is_adhoc: true,
        exercises: generateBalancedSession(exerciseList, eq, state?.profile || { starting_intensity: "moderate" }, genOpts),
      };
      return structuredClone(adHocSession);
    }

    function ensureAdHocSession(genOpts) {
      if (!adHocSession) return generateAdHocSession(genOpts);
      adHocSession.name = `On-the-Fly \u00b7 ${formatEquipmentSummary(getSessionEquipment())}`;
      return structuredClone(adHocSession);
    }

    function addExerciseToAdHoc(exerciseId) {
      if (!adHocSession) ensureAdHocSession({ count: 0 });
      const existing = new Set(adHocSession.exercises.map((it) => String(it.id)));
      return appendToItems(adHocSession.exercises, exerciseId, "adhoc_", existing, adHocSession.exercises.length, false);
    }

    function addRandomExerciseToAdHoc(rngOpts) {
      if (!adHocSession) ensureAdHocSession({ count: 0 });
      const picked = pickRandomExercise(exerciseList, getSessionEquipment(), {
        excludeIds: new Set(adHocSession.exercises.map((it) => it.exercise_id)),
        rng: rngOpts?.rng,
      });
      return picked ? addExerciseToAdHoc(picked.id) : null;
    }

    const updateAdHocExercise = (itemId, patch) => updateInItems(adHocSession?.exercises, itemId, patch, false);
    const swapAdHocExercise = (itemId, rngOpts) => swapInItems(adHocSession?.exercises, itemId, rngOpts, false);
    const removeAdHocExercise = (itemId) => removeFromItems(adHocSession?.exercises, itemId, false);

    function adaptAdHocForCurrentEquipment() {
      if (!adHocSession) return null;
      const eq = getSessionEquipment();
      const adapted = adaptRoutineForEquipment(adHocSession, eq, state?.profile || { starting_intensity: "moderate" }, exerciseList, exerciseMap);
      adHocSession = {
        ...adHocSession,
        name: `On-the-Fly \u00b7 ${formatEquipmentSummary(eq)}`,
        exercises: adapted.exercises.map((it) => ({
          id: it.id, exercise_id: it.exercise_id, sets: it.sets, base_reps: it.base_reps, base_weight_kg: it.base_weight_kg,
        })),
      };
      return structuredClone(adHocSession);
    }

    function buildRoutineCards(routinesSubset, cardOpts) {
      const adaptSession = Boolean(cardOpts?.adaptForSession);
      const availEq = adaptSession ? getSessionEquipment(cardOpts?.nowDate) : null;
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
      return sourceRoutines.map((rawRt) =>
        projectRoutineCard(rawRt, exerciseList, exerciseMap, state?.profile, availEq, adaptSession)
      );
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

    function buildPlaylist(routineId, playlistOpts) {
      const isAdHoc = String(routineId) === "adhoc";
      let cards = [];
      if (isAdHoc) {
        if (!hasAdHocSession()) return [];
        cards = buildRoutineCards([adHocSession], { adaptForSession: false });
      } else {
        const routine = findRoutine(routineId);
        if (!routine) return [];
        cards = buildRoutineCards([routine], { adaptForSession: playlistOpts?.adaptForSession !== false, nowDate: playlistOpts?.nowDate });
      }
      return cards.length > 0 ? projectPlaylist(cards[0], catalog?.svgs, getWorkoutTiming().speed_mode, isAdHoc) : [];
    }

    function completeWorkout(routineId, completeOpts) {
      if (!hasActivePlan()) return null;
      const isAdHoc = String(routineId) === "adhoc";
      const routine = isAdHoc ? adHocSession : findRoutine(routineId);
      if (!routine) return null;

      const cfg = completeOpts || {};
      const playlist = Array.isArray(cfg.playlist) && cfg.playlist.length > 0
        ? cfg.playlist
        : buildPlaylist(routineId, { adaptForSession: !isAdHoc });
      if (playlist.length === 0) return null;

      const wasSubstituted = !isAdHoc && playlist.some((p) => p.is_substituted || p.was_routine_substituted);
      const rawChoice = String(cfg.next_intensity_choice ?? "keep").trim().toLowerCase();
      const parsedChoice =
        rawChoice === "more" || rawChoice === "harder" || rawChoice === "+10%" ? "more" :
        rawChoice === "less" || rawChoice === "easier" || rawChoice === "-10%" ? "less" : "keep";
      const effectiveChoice = isAdHoc || wasSubstituted ? "keep" : parsedChoice;
      const sessionIntensity = isAdHoc || wasSubstituted ? 0 : routine.intensity_level || 0;
      const completedDt = (cfg.completed_at ? parseUtcDate(cfg.completed_at) : null) || nowFn();
      const timing = getWorkoutTiming();

      idCounter += 1;
      const logEntry = {
        id: `log_${Date.now().toString(36)}_${idCounter.toString(36)}`,
        routine_id: isAdHoc ? null : routine.id,
        routine_name: sanitizeString(routine.name, 60, isAdHoc ? "On-the-Fly Workout" : "Workout"),
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
          weight_kg: pl.weight_kg !== null && pl.weight_kg !== undefined && Number(pl.weight_kg) > 0 ? Number(pl.weight_kg) : null,
        })),
      };

      state.logs.unshift(logEntry);
      if (isAdHoc) adHocSession = null;
      else {
        state.plan.last_routine_id = routine.id;
        if (!wasSubstituted) routine.intensity_level = applyIntensityFeedback(routine.intensity_level, effectiveChoice);
      }
      persistState(state);
      return Object.assign(structuredClone(logEntry), { intensity_percent: Math.max(50, 100 + sessionIntensity * 10) });
    }

    function searchCatalog(query, limit, searchOpts) {
      const equipFilter = searchOpts?.equipment !== undefined ? searchOpts.equipment : getSessionEquipment();
      return searchCompatibleCatalog(exerciseList, query, limit, equipFilter, Boolean(searchOpts?.compatibleOnly));
    }

    return {
      hasActivePlan, getState, getSoundTheme, setSoundTheme, getWorkoutTiming, setWorkoutTiming,
      getSessionEquipment, hasSessionEquipmentOverride, setSessionEquipment, resetSessionEquipment,
      setupPlan, addWorkoutDay, getRoutine,
      addExerciseToRoutine, addRandomExerciseToRoutine, updateRoutineExercise, swapRoutineExercise, removeExerciseFromRoutine,
      hasAdHocSession, generateAdHocSession, ensureAdHocSession, getAdHocSession,
      addExerciseToAdHoc, addRandomExerciseToAdHoc, updateAdHocExercise, swapAdHocExercise, removeAdHocExercise, adaptAdHocForCurrentEquipment,
      buildRoutineCards, getLogsDesc, getNextRoutineCard, getRecommendedToday, buildPlaylist, completeWorkout,
      getStats, getProgressSeries, searchCatalog,
      getExercise: (id) => { const found = exerciseMap.get(String(id || "")); return found ? structuredClone(found) : null; },
    };
  }

  return Object.freeze({
    STORAGE_KEY, SCHEMA_VERSION, createStore,
    defaultPrescriptionForExercise, computeScaledTarget, applyIntensityFeedback, computeWeekStreak,
  });
});
