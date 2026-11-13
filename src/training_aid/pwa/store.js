(function (root, factory) {
  const domain = (root && root.TrainingDomain) || (typeof require === "function" ? require("./domain.js") : null);
  const codec = (root && root.TrainingCodec) || (typeof require === "function" ? require("./codec.js") : null);
  const api = factory(root, domain, codec);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingStore = api;
})(typeof window !== "undefined" ? window : globalThis, function (root, domain, codec) {
  "use strict";

  const STORAGE_KEY = "training_aid_state_v1", LEGACY_SOUND_KEY = "training_aid_sound_theme";
  const MAX_BACKUP_STRING_LENGTH = 5 * 1024 * 1024, DAY_MS = 86400000;
  const {
    VALID_EQUIPMENT, VALID_INTENSITY, VALID_SOUND_THEMES, sanitizeString, clampInt, parseUtcDate,
    roundHalfKg, formatWeight, scaleInitialPrescription, defaultPrescriptionForExercise,
    computeScaledTarget, applyIntensityFeedback, computeWeekStreak,
  } = domain;
  const {
    MAX_DECOMPRESSED_BYTES, deduplicateAndSortLogs, validateAndNormalizeImport,
    encodeShareFragment: codecEncodeShare, decodeShareFragment: codecDecodeShare,
  } = codec;

  const BODYWEIGHT_AUX_EQUIPMENT = Object.freeze(["body only", "foam roll", "exercise ball", "other"]);
  const DEFAULT_INTENSITY_LABELS = Object.freeze({ light: "Easy Start", moderate: "Moderate", intense: "Intense" });
  let idCounter = 0;

  function requestPersistentStorage() {
    return Promise.resolve()
      .then(() => {
        const nav = root?.navigator || (typeof navigator !== "undefined" ? navigator : null);
        return typeof nav?.storage?.persist === "function" ? nav.storage.persist() : false;
      })
      .then((granted) => Boolean(granted))
      .catch(() => false);
  }

  function normalizeCatalogExercise(rawEx) {
    const archetype = rawEx.archetype || "squat", eqMode = rawEx.eq_mode || "body_only", hold = Boolean(rawEx.is_hold);
    return {
      id: String(rawEx.id), name: String(rawEx.name || rawEx.id),
      category: rawEx.category || "strength", equipment: rawEx.equipment || "body only",
      primary_muscle: rawEx.primary_muscle || "other", archetype, eq_mode: eqMode,
      svg_key: rawEx.svg_key || `${archetype}:${eqMode}`,
      thumb_url: rawEx.thumb_url || `./svgs/thumbs/${archetype}__${eqMode}.svg`,
      rep_seconds: rawEx.rep_seconds > 0 ? Number(rawEx.rep_seconds) : hold ? 1.0 : 2.8,
      is_hold: hold, unit: rawEx.unit || (hold ? "sec" : "reps"),
      how_to: rawEx.how_to || "Move with steady control",
      cue_work: rawEx.cue_work || (hold ? "Hold" : "\u2193 Work"),
      cue_return: rawEx.cue_return || (hold ? "Breathe" : "\u2191 Return"),
      tempo_mode: rawEx.tempo_mode || (hold ? "hold" : "standard"),
      is_alternating: Boolean(rawEx.is_alternating),
    };
  }

  function createStore(options) {
    const opts = options || {}, catalog = opts.catalog || { exercises: [], programs: {}, svgs: {} };
    let storage = null;
    if (opts.storage !== undefined) storage = opts.storage;
    else { try { storage = root?.localStorage || null; } catch { storage = null; } }

    const exerciseList = [], exerciseMap = new Map();
    for (const rawEx of Array.isArray(catalog.exercises) ? catalog.exercises : []) {
      if (!rawEx || !rawEx.id) continue;
      const normEx = normalizeCatalogExercise(rawEx);
      exerciseList.push(normEx);
      exerciseMap.set(normEx.id, normEx);
    }

    const readStorage = (key) => {
      if (typeof storage?.getItem !== "function") return null;
      try { return storage.getItem(key); } catch { return null; }
    };
    const writeStorage = (key, val) => {
      if (typeof storage?.setItem !== "function") return;
      try { storage.setItem(key, val); } catch { /* ignore quota */ }
    };

    let fallbackSoundTheme = "minimal", state = null;
    function persistState(nextState) {
      state = nextState;
      if (state?.profile) {
        const validTheme = VALID_SOUND_THEMES.includes(state.profile.sound_theme)
          ? state.profile.sound_theme : fallbackSoundTheme;
        state.profile.sound_theme = validTheme;
        fallbackSoundTheme = validTheme;
      }
      if (state) writeStorage(STORAGE_KEY, JSON.stringify(state));
    }

    (() => {
      const legacyRaw = readStorage(LEGACY_SOUND_KEY);
      const legacyTheme = VALID_SOUND_THEMES.includes(legacyRaw) ? legacyRaw : null;
      if (legacyTheme) fallbackSoundTheme = legacyTheme;
      const rawStateJson = readStorage(STORAGE_KEY);
      if (!rawStateJson) return;
      try {
        const parsed = JSON.parse(rawStateJson);
        const hadExplicit = VALID_SOUND_THEMES.includes(parsed?.profile?.sound_theme);
        state = validateAndNormalizeImport(parsed, { exerciseMap, fallbackSoundTheme });
        fallbackSoundTheme = state.profile.sound_theme;
        if (!hadExplicit && legacyTheme) writeStorage(STORAGE_KEY, JSON.stringify(state));
      } catch { state = null; }
    })();

    const hasActivePlan = () => Boolean(state?.plan && Array.isArray(state.plan.routines));
    const getState = () => (hasActivePlan() ? structuredClone(state) : null);

    function getSoundTheme() {
      if (state?.profile && VALID_SOUND_THEMES.includes(state.profile.sound_theme)) {
        return (fallbackSoundTheme = state.profile.sound_theme);
      }
      return VALID_SOUND_THEMES.includes(fallbackSoundTheme) ? fallbackSoundTheme : "minimal";
    }

    function setSoundTheme(themeId) {
      if (!VALID_SOUND_THEMES.includes(themeId)) return getSoundTheme();
      fallbackSoundTheme = themeId;
      if (state?.profile) {
        state.profile.sound_theme = themeId;
        writeStorage(STORAGE_KEY, JSON.stringify(state));
      }
      return fallbackSoundTheme;
    }

    function nextId(prefix, existingSet, startCount) {
      let n = startCount + 1;
      while (existingSet.has(prefix + n)) n += 1;
      return prefix + n;
    }

    function setupPlan(setupOpts) {
      const cfg = setupOpts || {}, cleanName = sanitizeString(cfg.name, 50, "Athlete");
      const eqKey = VALID_EQUIPMENT.includes(cfg.equipment) ? cfg.equipment : "body_only";
      const intKey = VALID_INTENSITY.includes(cfg.starting_intensity) ? cfg.starting_intensity : "moderate";
      const days = clampInt(cfg.days_per_week, 2, 5, 3);
      const soundTheme = VALID_SOUND_THEMES.includes(cfg.sound_theme) ? cfg.sound_theme : getSoundTheme();

      const programs = catalog?.programs || {}, eqPrograms = programs.equipment_programs || {};
      const intLabels = programs.intensity_labels || DEFAULT_INTENSITY_LABELS;
      const program = eqPrograms[eqKey] || eqPrograms.body_only || { label: "Body Only", routines: [] };
      const programLabel = program.label || "Body Only";
      const intensityLabel = intLabels[intKey] || DEFAULT_INTENSITY_LABELS[intKey] || "Moderate";

      const rawRoutines = Array.isArray(program.routines) ? program.routines.slice(0, days) : [], builtRoutines = [];
      let rxSeq = 1;
      for (let dIdx = 0; dIdx < rawRoutines.length; dIdx++) {
        const rtDef = rawRoutines[dIdx];
        const rtName = Array.isArray(rtDef)
          ? String(rtDef[0] || "Day " + (dIdx + 1)) : String(rtDef?.name || "Day " + (dIdx + 1));
        const specs = Array.isArray(rtDef) ? rtDef[1] || [] : rtDef?.exercises || [], items = [];
        for (const spec of specs) {
          const exId = Array.isArray(spec) ? String(spec[0]) : String(spec.exercise_id);
          const modReps = Array.isArray(spec) ? spec[1] : spec.base_reps;
          const modWeight = Array.isArray(spec) ? spec[2] : spec.base_weight_kg;
          const exObj = exerciseMap.get(exId);
          if (exerciseMap.size > 0 && !exObj) continue;
          const sc = scaleInitialPrescription(modReps, modWeight, intKey, Boolean(exObj && exObj.is_hold));
          items.push({ id: "rx" + rxSeq++, exercise_id: exId, sets: sc.sets, base_reps: sc.reps, base_weight_kg: sc.weight_kg });
        }
        builtRoutines.push({
          id: "r" + (dIdx + 1), name: sanitizeString(rtName, 60, "Day " + (dIdx + 1)), intensity_level: 0, exercises: items,
        });
      }

      persistState({
        schema_version: 1,
        profile: { name: cleanName, equipment: eqKey, starting_intensity: intKey, weekly_goal: days, sound_theme: soundTheme },
        plan: {
          name: `${programLabel} Plan (${days}x/Week)`, description: `${intensityLabel} start \u2022 ${programLabel}`,
          days_per_week: days, last_routine_id: null, routines: builtRoutines,
        },
        logs: Array.isArray(state?.logs) ? structuredClone(state.logs) : [],
      });
      requestPersistentStorage();
      return structuredClone(state);
    }

    function addWorkoutDay() {
      if (!hasActivePlan()) return null;
      const routines = state.plan.routines, existing = new Set(routines.map((rt) => String(rt.id)));
      const newRoutine = {
        id: nextId("r", existing, routines.length), name: "Day " + (routines.length + 1), intensity_level: 0, exercises: [],
      };
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

    function addExerciseToRoutine(routineId, exerciseId) {
      const routine = findRoutine(routineId), targetExId = String(exerciseId || "").trim();
      if (!routine || !targetExId) return null;
      let exObj = exerciseMap.get(targetExId);
      if (exerciseMap.size > 0 && !exObj) return null;
      if (!exObj) exObj = normalizeCatalogExercise({ id: targetExId, name: targetExId });

      const existing = new Set();
      let count = 0;
      for (const rt of state.plan.routines) {
        for (const ex of rt.exercises || []) { existing.add(String(ex.id)); count += 1; }
      }
      const presc = defaultPrescriptionForExercise(state.profile, exObj);
      const item = {
        id: nextId("rx", existing, count), exercise_id: exObj.id,
        sets: presc.sets, base_reps: presc.reps, base_weight_kg: presc.weight_kg,
      };
      routine.exercises.push(item);
      persistState(state);
      return structuredClone(item);
    }

    function removeExerciseFromRoutine(routineId, itemId) {
      const routine = findRoutine(routineId);
      if (!routine) return false;
      const idx = routine.exercises.findIndex((ex) => String(ex.id) === String(itemId));
      if (idx === -1) return false;
      routine.exercises.splice(idx, 1);
      persistState(state);
      return true;
    }

    function completeWorkout(routineId, completeOpts) {
      const routine = findRoutine(routineId);
      if (!routine) return null;
      const cfg = completeOpts || {}, rawChoice = String(cfg.next_intensity_choice ?? "keep").trim().toLowerCase();
      const choice =
        rawChoice === "more" || rawChoice === "harder" || rawChoice === "+10%"
          ? "more" : rawChoice === "less" || rawChoice === "easier" || rawChoice === "-10%" ? "less" : "keep";
      const dur = clampInt(cfg.duration_minutes ?? 25, 1, 300, 25), totalExercises = routine.exercises.length;
      const rawCount = Array.isArray(cfg.completed_ids)
        ? cfg.completed_ids.length : typeof cfg.completed_exercises === "number" ? Math.trunc(cfg.completed_exercises) : 0;
      const sessionIntensity = routine.intensity_level;
      const completedDt = (cfg.completed_at ? parseUtcDate(cfg.completed_at) : null) || new Date();
      idCounter += 1;
      const logEntry = {
        id: `log_${Date.now().toString(36)}_${idCounter.toString(36)}`,
        routine_id: routine.id, routine_name: routine.name,
        completed_at: completedDt.toISOString(), duration_minutes: dur,
        completed_exercises: Math.max(0, Math.min(totalExercises, rawCount)), total_exercises: totalExercises,
        intensity_at_session: sessionIntensity, next_intensity_choice: choice,
      };
      state.logs.unshift(logEntry);
      routine.intensity_level = applyIntensityFeedback(routine.intensity_level, choice);
      state.plan.last_routine_id = routine.id;
      persistState(state);
      return Object.assign(structuredClone(logEntry), { intensity_percent: Math.max(50, 100 + sessionIntensity * 10) });
    }

    function buildRoutineCards(routinesSubset) {
      let sourceRoutines = hasActivePlan() ? state.plan.routines : [];
      if (Array.isArray(routinesSubset)) {
        sourceRoutines = [];
        for (const cand of routinesSubset) {
          if (typeof cand === "string") {
            const resolved = findRoutine(cand);
            if (resolved) sourceRoutines.push(resolved);
          } else if (cand && typeof cand === "object") sourceRoutines.push(cand);
        }
      }
      return sourceRoutines.map((rt) => {
        const intensityPct = Math.max(50, 100 + Math.trunc(Number(rt.intensity_level) || 0) * 10), rows = [];
        for (const item of Array.isArray(rt.exercises) ? rt.exercises : []) {
          let ex = exerciseMap.get(item.exercise_id);
          if (exerciseMap.size > 0 && !ex) continue;
          if (!ex) ex = normalizeCatalogExercise({ id: item.exercise_id, name: item.exercise_id });
          rows.push({
            item: structuredClone(item), exercise: structuredClone(ex),
            archetype: ex.archetype, svg_key: ex.svg_key, thumb_url: ex.thumb_url,
            scaled: computeScaledTarget(item, rt.intensity_level || 0, ex),
          });
        }
        const rtCopy = structuredClone(rt);
        rtCopy.intensity_percent = intensityPct;
        return {
          routine: rtCopy, intensity_percent: intensityPct, exercises: rows,
          lead_archetype: rows.length > 0 ? rows[0].archetype : "squat",
          lead_svg_key: rows.length > 0 ? rows[0].svg_key : "squat:body_only",
        };
      });
    }

    function getLogsDesc() {
      if (!Array.isArray(state?.logs) || state.logs.length === 0) return [];
      return state.logs
        .map((log, idx) => ({ log, idx, ts: Date.parse(log.completed_at) || 0 }))
        .sort((a, b) => (b.ts !== a.ts ? b.ts - a.ts : a.idx - b.idx))
        .map(({ log }) =>
          Object.assign(structuredClone(log), {
            intensity_percent: Math.max(50, 100 + Math.trunc(Number(log.intensity_at_session) || 0) * 10),
          })
        );
    }

    function getNextRoutineCard() {
      const cards = buildRoutineCards();
      if (cards.length === 0) return null;
      const idToIndex = new Map(cards.map((c, idx) => [String(c.routine.id), idx]));
      for (const lg of getLogsDesc()) {
        if (lg.routine_id !== null && idToIndex.has(String(lg.routine_id))) {
          return cards[(idToIndex.get(String(lg.routine_id)) + 1) % cards.length];
        }
      }
      const lastId = state?.plan?.last_routine_id;
      if (lastId !== null && lastId !== undefined && idToIndex.has(String(lastId))) {
        return cards[(idToIndex.get(String(lastId)) + 1) % cards.length];
      }
      return cards[0];
    }

    function buildPlaylist(routineId) {
      const routine = findRoutine(routineId);
      if (!routine) return [];
      const cards = buildRoutineCards([routine]);
      const rows = cards.length > 0 ? cards[0].exercises : [], svgs = catalog?.svgs || {};
      return rows.map(({ item, exercise: ex, scaled, archetype, svg_key, thumb_url }) => ({
        item_id: item.id, exercise_id: ex.id, name: ex.name,
        sets: scaled.sets, reps: scaled.reps, weight_kg: scaled.weight_kg,
        weight_label: scaled.weight_kg !== null ? formatWeight(scaled.weight_kg) : null,
        formatted: scaled.formatted, archetype, eq_mode: ex.eq_mode, svg_key, thumb_url,
        svg_markup: svgs[svg_key] || svgs[`${archetype}:body_only`] || svgs["squat:body_only"] || "",
        rep_seconds: ex.rep_seconds, is_hold: ex.is_hold, unit: ex.unit, how_to: ex.how_to,
        cue_work: ex.cue_work, cue_return: ex.cue_return,
        tempo_mode: ex.tempo_mode, is_alternating: ex.is_alternating,
      }));
    }

    function getStats(nowDate) {
      const now = parseUtcDate(nowDate) || new Date(), mondayOffset = (now.getUTCDay() + 6) % 7;
      const startOfWeekMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - mondayOffset * DAY_MS;
      const logsDesc = getLogsDesc();
      let workoutsThisWeek = 0;
      for (const lg of logsDesc) {
        const dt = parseUtcDate(lg.completed_at);
        if (dt && dt.getTime() >= startOfWeekMs) workoutsThisWeek += 1;
      }
      const routines = hasActivePlan() ? state.plan.routines : [];
      let avgPlanIntensity = 100;
      if (routines.length > 0) {
        const sumPct = routines.reduce(
          (acc, rt) => acc + Math.max(50, 100 + Math.trunc(Number(rt.intensity_level) || 0) * 10), 0
        );
        avgPlanIntensity = Math.round(sumPct / routines.length);
      } else if (logsDesc.length > 0) avgPlanIntensity = logsDesc[0].intensity_percent;

      const profName = state?.profile?.name || "Athlete";
      const weeklyGoal = Math.max(1, Math.trunc(Number(state?.profile?.weekly_goal) || 3)), totalWorkouts = logsDesc.length;
      const message =
        totalWorkouts === 0 ? `${profName} \u00b7 0/${weeklyGoal}` :
        workoutsThisWeek >= weeklyGoal ? `${profName} \u00b7 ${workoutsThisWeek}/${weeklyGoal} \u2713` :
        `${profName} \u00b7 ${workoutsThisWeek}/${weeklyGoal}`;
      return {
        workouts_this_week: workoutsThisWeek, weekly_goal: weeklyGoal, total_workouts: totalWorkouts,
        week_streak: computeWeekStreak(logsDesc, weeklyGoal, now), avg_plan_intensity: avgPlanIntensity, message,
      };
    }

    function getProgressSeries() {
      const logsDesc = getLogsDesc();
      if (logsDesc.length === 0) return { labels: [], values: [] };
      const chrono = logsDesc.slice().reverse();
      return { labels: ["0", ...chrono.map((_, i) => "#" + (i + 1))], values: [100, ...chrono.map((lg) => lg.intensity_percent)] };
    }

    function searchCatalog(query, limit) {
      const maxItems = limit !== undefined && limit !== null ? Math.max(1, Math.trunc(Number(limit)) || 16) : 16;
      const cleanQ = String(query ?? "").trim();
      if (cleanQ) {
        const lowerQ = cleanQ.toLowerCase(), matches = [];
        for (const ex of exerciseList) {
          const nLow = ex.name.toLowerCase(), idLow = ex.id.toLowerCase();
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
      const eqTier = state?.profile?.equipment || "body_only";
      let allowedSet = null;
      if (eqTier === "body_only") allowedSet = new Set(BODYWEIGHT_AUX_EQUIPMENT);
      else if (eqTier === "dumbbells") allowedSet = new Set(["dumbbell", "medicine ball", ...BODYWEIGHT_AUX_EQUIPMENT]);
      else if (eqTier === "kettlebell_bands") allowedSet = new Set(["kettlebells", "bands", ...BODYWEIGHT_AUX_EQUIPMENT]);
      return exerciseList
        .filter((cand) => !allowedSet || allowedSet.has(String(cand.equipment || "").toLowerCase()))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, maxItems)
        .map((ex) => structuredClone(ex));
    }

    function exportBackupJson(exportOpts) {
      if (!hasActivePlan()) throw new Error("No active plan available to export.");
      return JSON.stringify({
        schema_version: 1, exported_at: new Date().toISOString(),
        profile: structuredClone(state.profile), plan: structuredClone(state.plan),
        logs: exportOpts?.includeLogs !== false ? structuredClone(state.logs) : [],
      }, null, 2);
    }

    function applyNormalizedState(normalized, baseLogs, keepExisting) {
      const nextState = structuredClone(normalized);
      if (keepExisting && Array.isArray(baseLogs) && baseLogs.length > 0) {
        nextState.logs = deduplicateAndSortLogs(nextState.logs.concat(baseLogs));
      }
      persistState(nextState);
      requestPersistentStorage();
      return structuredClone(state);
    }

    function importBackupJson(jsonText, importOpts) {
      let parsed;
      if (typeof jsonText === "string") {
        if (jsonText.length > MAX_BACKUP_STRING_LENGTH) throw new Error("Backup file exceeds maximum allowed size.");
        parsed = JSON.parse(jsonText);
      } else if (jsonText && typeof jsonText === "object" && !Array.isArray(jsonText)) parsed = jsonText;
      else throw new Error("Invalid backup: expected JSON object string.");

      const priorLogs = Array.isArray(state?.logs) ? structuredClone(state.logs) : [];
      const normalized = validateAndNormalizeImport(parsed, { exerciseMap, fallbackSoundTheme: getSoundTheme() });
      applyNormalizedState(normalized, priorLogs, Boolean(importOpts?.mergeLogs || importOpts?.keepExistingLogs));

      let exerciseCount = 0;
      for (const rt of normalized.plan.routines) exerciseCount += rt.exercises.length;
      return Object.assign(structuredClone(state), {
        state: structuredClone(state), routineCount: normalized.plan.routines.length, exerciseCount,
        apply(applyOpts) {
          const keep = applyOpts !== undefined ? applyOpts.keepExistingLogs !== false && applyOpts.mergeLogs !== false : true;
          return applyNormalizedState(normalized, priorLogs, keep);
        },
      });
    }

    async function encodeShareFragment(options) {
      if (!hasActivePlan()) throw new Error("No active plan available to share.");
      return codecEncodeShare(state, options);
    }

    async function decodeShareFragment(hashOrToken) {
      const res = await codecDecodeShare(hashOrToken, { exerciseMap, fallbackSoundTheme: getSoundTheme() });
      return {
        state: structuredClone(res.state), routineCount: res.routineCount, exerciseCount: res.exerciseCount,
        apply(applyOpts) {
          const keep = !applyOpts || (applyOpts.keepExistingLogs !== false && applyOpts.mergeLogs !== false);
          return applyNormalizedState(res.state, state?.logs, keep);
        },
      };
    }

    return {
      getState, hasActivePlan, setupPlan, setSoundTheme, getSoundTheme,
      addWorkoutDay, getRoutine, addExerciseToRoutine, removeExerciseFromRoutine,
      completeWorkout, buildRoutineCards, getNextRoutineCard, buildPlaylist,
      getStats, getLogsDesc, getProgressSeries, searchCatalog,
      exportBackupJson, importBackupJson, encodeShareFragment, decodeShareFragment,
    };
  }

  return Object.freeze({
    STORAGE_KEY, VALID_SOUND_THEMES, VALID_EQUIPMENT, VALID_INTENSITY, MAX_DECOMPRESSED_BYTES,
    requestPersistentStorage, formatWeight, roundHalfKg, scaleInitialPrescription,
    defaultPrescriptionForExercise, computeScaledTarget, applyIntensityFeedback,
    computeWeekStreak, validateAndNormalizeImport,
    encodeShareFragment: codecEncodeShare, decodeShareFragment: codecDecodeShare, createStore,
  });
});
