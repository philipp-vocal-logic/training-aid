(function (root, factory) {
  const domain = (root && root.TrainingDomain) || (typeof require === "function" ? require("./domain.js") : null);
  const api = factory(domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingCodec = api;
})(typeof window !== "undefined" ? window : globalThis, function (domain) {
  "use strict";

  const { VALID_EQUIPMENT, VALID_INTENSITY, VALID_SOUND_THEMES, sanitizeString, clampInt, parseUtcDate } = domain;
  const MAX_DECOMPRESSED_BYTES = 65536;
  const MAX_ROUTINES = 32;
  const MAX_EXERCISES_PER_ROUTINE = 64;
  const MAX_LOGS = 5000;
  const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const B64URL_LOOKUP = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < B64URL_ALPHABET.length; i++) table[B64URL_ALPHABET.charCodeAt(i)] = i;
    table[43] = 62;
    table[47] = 63;
    return table;
  })();

  function normalizeFeedbackChoice(rawChoice) {
    const norm = String(rawChoice || "keep").trim().toLowerCase();
    if (norm === "more" || norm === "harder" || norm === "+10%") return "more";
    if (norm === "less" || norm === "easier" || norm === "-10%") return "less";
    return "keep";
  }

  function deduplicateAndSortLogs(logsList) {
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
    for (const ex of list) if (ex && ex.id) set.add(String(ex.id));
    return set.size > 0 ? set : null;
  }

  function validateAndNormalizeImport(rawPayload, catalog) {
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      throw new Error("Invalid backup: payload must be a JSON object.");
    }
    if (rawPayload.schema_version !== 1) {
      throw new Error("Unsupported backup schema_version; expected schema_version 1.");
    }
    const { profile: rawProfile, plan: rawPlan } = rawPayload;
    if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
      throw new Error("Invalid backup: profile must be an object.");
    }
    if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
      throw new Error("Invalid backup: plan must be an object.");
    }
    if (!Array.isArray(rawPlan.routines)) throw new Error("Invalid backup: plan.routines must be an array.");
    if (rawPlan.routines.length > MAX_ROUTINES) throw new Error("Invalid backup: too many routines.");
    if (rawPayload.logs !== undefined && !Array.isArray(rawPayload.logs)) {
      throw new Error("Invalid backup: logs must be an array when provided.");
    }

    const knownIds = resolveKnownExerciseIds(catalog);
    const fallbackSound = VALID_SOUND_THEMES.includes(catalog?.fallbackSoundTheme)
      ? catalog.fallbackSoundTheme
      : "minimal";
    const daysPerWeek = clampInt(rawPlan.days_per_week, 2, 5, 3);
    const profile = {
      name: sanitizeString(rawProfile.name, 50, "Athlete"),
      equipment: VALID_EQUIPMENT.includes(rawProfile.equipment) ? rawProfile.equipment : "body_only",
      starting_intensity: VALID_INTENSITY.includes(rawProfile.starting_intensity)
        ? rawProfile.starting_intensity
        : "moderate",
      weekly_goal: clampInt(rawProfile.weekly_goal, 2, 5, daysPerWeek),
      sound_theme: VALID_SOUND_THEMES.includes(rawProfile.sound_theme) ? rawProfile.sound_theme : fallbackSound,
    };

    const usedRoutineIds = new Set();
    const usedItemIds = new Set();
    const normalizedRoutines = [];

    for (let rIdx = 0; rIdx < rawPlan.routines.length; rIdx++) {
      const rawRt = rawPlan.routines[rIdx];
      if (!rawRt || typeof rawRt !== "object" || Array.isArray(rawRt)) {
        throw new Error("Invalid backup: routine entry must be an object.");
      }
      let baseRtId = rawRt.id !== null && rawRt.id !== undefined ? sanitizeString(String(rawRt.id), 64, "") : "";
      if (!baseRtId || usedRoutineIds.has(baseRtId)) {
        let suffix = rIdx + 1;
        while (usedRoutineIds.has("r" + suffix)) suffix += 1;
        baseRtId = "r" + suffix;
      }
      usedRoutineIds.add(baseRtId);

      const rtIntensity = clampInt(rawRt.intensity_level ?? rawRt.scale_step, -5, 20, 0);
      const rawExercises = Array.isArray(rawRt.exercises)
        ? rawRt.exercises.slice(0, MAX_EXERCISES_PER_ROUTINE)
        : [];
      const normalizedExercises = [];

      for (const rawEx of rawExercises) {
        if (!rawEx || typeof rawEx !== "object" || Array.isArray(rawEx)) continue;
        const exId = sanitizeString(rawEx.exercise_id, 120, "");
        if (!exId || (knownIds && !knownIds.has(exId))) continue;

        let itemId = rawEx.id !== null && rawEx.id !== undefined ? sanitizeString(String(rawEx.id), 64, "") : "";
        if (!itemId || usedItemIds.has(itemId)) {
          let seq = usedItemIds.size + 1;
          while (usedItemIds.has("rx" + seq)) seq += 1;
          itemId = "rx" + seq;
        }
        usedItemIds.add(itemId);

        let baseWeightKg = null;
        const rawW = rawEx.base_weight_kg;
        if (rawW !== null && rawW !== undefined && rawW !== "" && typeof rawW !== "boolean") {
          const parsedW = Number(rawW);
          if (Number.isFinite(parsedW)) baseWeightKg = Math.max(0, Math.min(500, parsedW));
        }

        const exItem = {
          id: itemId, exercise_id: exId,
          sets: clampInt(rawEx.sets, 1, 10, 3),
          base_reps: clampInt(rawEx.base_reps, 1, 600, 10),
          base_weight_kg: baseWeightKg,
        };
        if (rawEx.scale_step !== undefined) exItem.scale_step = clampInt(rawEx.scale_step, -5, 20, 0);
        normalizedExercises.push(exItem);
      }

      const rtObj = {
        id: baseRtId,
        name: sanitizeString(rawRt.name, 60, "Day " + (rIdx + 1)),
        intensity_level: rtIntensity,
        exercises: normalizedExercises,
      };
      if (rawRt.scale_step !== undefined) rtObj.scale_step = rtIntensity;
      normalizedRoutines.push(rtObj);
    }

    const rawLastRtId =
      rawPlan.last_routine_id !== null && rawPlan.last_routine_id !== undefined
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

      const lgId =
        (rawLg.id !== null && rawLg.id !== undefined && sanitizeString(String(rawLg.id), 64, "")) ||
        `log_imp_${lIdx + 1}_${completedDt.getTime()}`;
      const lgRoutineId =
        rawLg.routine_id !== null && rawLg.routine_id !== undefined
          ? sanitizeString(String(rawLg.routine_id), 64, "") || null
          : null;
      const totalEx = clampInt(rawLg.total_exercises, 0, 200, 0);

      normalizedLogs.push({
        id: lgId, routine_id: lgRoutineId,
        routine_name: sanitizeString(rawLg.routine_name, 60, "Workout"),
        completed_at: completedDt.toISOString(),
        duration_minutes: clampInt(rawLg.duration_minutes, 1, 300, 25),
        completed_exercises: clampInt(rawLg.completed_exercises, 0, totalEx, 0),
        total_exercises: totalEx,
        intensity_at_session: clampInt(rawLg.intensity_at_session, -5, 20, 0),
        next_intensity_choice: normalizeFeedbackChoice(rawLg.next_intensity_choice),
      });
    }

    return { schema_version: 1, profile, plan, logs: deduplicateAndSortLogs(normalizedLogs) };
  }

  function bytesToBase64Url(bytes) {
    const chars = [];
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      chars.push(B64URL_ALPHABET[b0 >> 2], B64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]);
      if (i + 1 < bytes.length) chars.push(B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]);
      if (i + 2 < bytes.length) chars.push(B64URL_ALPHABET[b2 & 0x3f]);
    }
    return chars.join("");
  }

  function base64UrlToBytes(b64) {
    const clean = String(b64 || "").replace(/=+$/, "");
    if (!clean || clean.length % 4 === 1) throw new Error("Invalid base64url token.");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let outIdx = 0, buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      const val = code < 128 ? B64URL_LOOKUP[code] : -1;
      if (val < 0) throw new Error("Invalid character in base64url token.");
      buffer = (buffer << 6) | val;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[outIdx++] = (buffer >> bits) & 0xff;
      }
    }
    return out;
  }

  async function runByteStream(stream, inputBytes, maxBytes) {
    const writer = stream.writable.getWriter();
    let writeErr = null;
    const writePromise = writer.write(inputBytes).then(() => writer.close()).catch((err) => { writeErr = err; });
    const reader = stream.readable.getReader();
    const chunks = [];
    let totalLen = 0, exceeded = false;
    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        totalLen += step.value.byteLength;
        if (maxBytes && totalLen > maxBytes) {
          exceeded = true;
          await reader.cancel("Size limit exceeded").catch(() => {});
          await writer.abort("Size limit exceeded").catch(() => {});
          break;
        }
        chunks.push(step.value);
      }
    } catch {
      await writer.abort("Malformed deflate stream").catch(() => {});
      await writePromise;
      throw new Error("Malformed compressed share token.");
    }
    await writePromise;
    if (exceeded) throw new Error(`Share payload exceeds ${maxBytes} bytes.`);
    if (writeErr) throw new Error("Malformed compressed share token.");
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  async function encodeShareFragment(stateObj, options) {
    if (!stateObj?.profile || !Array.isArray(stateObj?.plan?.routines)) {
      throw new Error("No active plan available to share.");
    }
    const { profile: p, plan: pl } = stateObj;
    const compact = {
      v: 1,
      p: [p.name, p.equipment, p.starting_intensity, p.weekly_goal, p.sound_theme],
      n: [pl.name, pl.description, pl.days_per_week, pl.last_routine_id ?? null],
      r: pl.routines.map((rt) => [
        rt.id, rt.name, rt.intensity_level,
        (rt.exercises || []).map((ex) => [ex.exercise_id, ex.sets, ex.base_reps, ex.base_weight_kg]),
      ]),
    };
    if (options?.includeLogs && Array.isArray(stateObj.logs)) compact.l = stateObj.logs;
    const utf8Bytes = new TextEncoder().encode(JSON.stringify(compact));
    const compressed = await runByteStream(new CompressionStream("deflate-raw"), utf8Bytes, 0);
    return "#import=z." + bytesToBase64Url(compressed);
  }

  async function decodeShareFragment(hashOrToken, catalog) {
    let raw = String(hashOrToken || "").trim();
    if (raw.startsWith("#import=")) raw = raw.slice(8).trim();
    else if (raw.startsWith("import=")) raw = raw.slice(7).trim();
    if (!raw.startsWith("z.")) throw new Error("Unrecognized share token prefix; expected z.");
    const tokenBody = raw.slice(2).trim();
    if (!tokenBody || tokenBody.length > MAX_DECOMPRESSED_BYTES * 2) {
      throw new Error("Invalid or oversized share token.");
    }
    const compressed = base64UrlToBytes(tokenBody);
    if (compressed.byteLength === 0) throw new Error("Empty compressed share token.");
    const decodedBytes = await runByteStream(
      new DecompressionStream("deflate-raw"), compressed, MAX_DECOMPRESSED_BYTES
    );
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes));
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.p) || !Array.isArray(parsed.n) || !Array.isArray(parsed.r)) {
      throw new Error("Unsupported share payload format.");
    }

    const routines = parsed.r.map((rtTuple, rIdx) => {
      if (!Array.isArray(rtTuple)) throw new Error("Invalid routine tuple.");
      const rawExList = Array.isArray(rtTuple[3]) ? rtTuple[3] : [];
      return {
        id: rtTuple[0] || "r" + (rIdx + 1), name: rtTuple[1], intensity_level: rtTuple[2],
        exercises: rawExList.map((exTuple, eIdx) => {
          if (!Array.isArray(exTuple)) throw new Error("Invalid exercise tuple.");
          return {
            id: `rx${rIdx + 1}_${eIdx + 1}`, exercise_id: exTuple[0],
            sets: exTuple[1], base_reps: exTuple[2], base_weight_kg: exTuple[3],
          };
        }),
      };
    });

    const normalized = validateAndNormalizeImport(
      {
        schema_version: 1,
        profile: {
          name: parsed.p[0], equipment: parsed.p[1], starting_intensity: parsed.p[2],
          weekly_goal: parsed.p[3], sound_theme: parsed.p[4],
        },
        plan: {
          name: parsed.n[0], description: parsed.n[1], days_per_week: parsed.n[2],
          last_routine_id: parsed.n[3] ?? null, routines,
        },
        logs: Array.isArray(parsed.l) ? parsed.l : [],
      },
      catalog
    );

    let exerciseCount = 0;
    for (const rt of normalized.plan.routines) exerciseCount += rt.exercises.length;
    return { state: normalized, routineCount: normalized.plan.routines.length, exerciseCount };
  }

  return Object.freeze({
    MAX_DECOMPRESSED_BYTES, deduplicateAndSortLogs, validateAndNormalizeImport,
    encodeShareFragment, decodeShareFragment,
  });
});
