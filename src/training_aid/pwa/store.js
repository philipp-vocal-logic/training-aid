(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TrainingStore = api;
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
  function (root) {
    "use strict";

    var STORAGE_KEY = "training_aid_state_v1";
    var SOUND_STORAGE_KEY = "training_aid_sound_theme";

    var VALID_SOUND_THEMES = Object.freeze([
      "off",
      "minimal",
      "techno",
      "trance",
      "studio",
    ]);
    var VALID_EQUIPMENT = Object.freeze([
      "body_only",
      "dumbbells",
      "kettlebell_bands",
      "full_gym",
    ]);
    var VALID_INTENSITY = Object.freeze(["light", "moderate", "intense"]);
    var VALID_FEEDBACK_CHOICES = Object.freeze(["less", "keep", "more"]);

    var MAX_DECOMPRESSED_BYTES = 65536;
    var MAX_BACKUP_STRING_LENGTH = 5 * 1024 * 1024;
    var MAX_ROUTINES = 32;
    var MAX_EXERCISES_PER_ROUTINE = 64;
    var MAX_LOGS = 5000;

    var BODYWEIGHT_AUX_EQUIPMENT = Object.freeze([
      "body only",
      "foam roll",
      "exercise ball",
      "other",
    ]);

    var WEIGHTED_EXERCISE_EQUIPMENT = Object.freeze({
      barbell: true,
      dumbbell: true,
      kettlebells: true,
      cable: true,
      machine: true,
      "e-z curl bar": true,
    });

    var HOLD_KEYWORDS = Object.freeze([
      "plank",
      "wall sit",
      "side bridge",
      "isometric",
      "l-sit",
      "l sit",
      "dead hang",
    ]);

    var DEFAULT_INTENSITY_LABELS = Object.freeze({
      light: "Easy Start",
      moderate: "Moderate",
      intense: "Intense",
    });

    var B64URL_ALPHABET =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    var B64URL_LOOKUP = (function () {
      var table = new Int16Array(128);
      for (var i = 0; i < 128; i++) {
        table[i] = -1;
      }
      for (var j = 0; j < B64URL_ALPHABET.length; j++) {
        table[B64URL_ALPHABET.charCodeAt(j)] = j;
      }
      table[43] = 62; // '+' tolerance
      table[47] = 63; // '/' tolerance
      return table;
    })();

    var DAY_MS = 86400000;
    var idCounter = 0;

    // -----------------------------------------------------------------------
    // Utility & Sanitization Helpers
    // -----------------------------------------------------------------------

    function hasItem(list, val) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] === val) return true;
      }
      return false;
    }

    function sanitizeString(val, maxLen, fallback) {
      if (typeof val !== "string") {
        return fallback !== undefined ? fallback : "";
      }
      var cleaned = val
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .trim()
        .slice(0, maxLen);
      if (!cleaned) {
        return fallback !== undefined ? fallback : "";
      }
      return cleaned;
    }

    function clampInt(val, minVal, maxVal, fallback) {
      var num = Number(val);
      if (!Number.isFinite(num)) {
        return fallback;
      }
      var intVal = Math.round(num);
      if (intVal < minVal) return minVal;
      if (intVal > maxVal) return maxVal;
      return intVal;
    }

    function normalizeEqMode(rawEquipment) {
      var eq = String(rawEquipment || "body only")
        .trim()
        .toLowerCase();
      if (eq === "barbell" || eq === "e-z curl bar") return "barbell";
      if (eq === "dumbbell" || eq === "medicine ball") return "dumbbell";
      if (eq === "kettlebells") return "kettlebells";
      if (eq === "bands") return "bands";
      if (eq === "cable") return "cable";
      if (eq === "machine") return "machine";
      return "body_only";
    }

    function isHoldExercise(exerciseOrId) {
      if (!exerciseOrId) return false;
      if (typeof exerciseOrId === "object") {
        if (typeof exerciseOrId.is_hold === "boolean") {
          return exerciseOrId.is_hold;
        }
        if (
          String(exerciseOrId.category || "").toLowerCase() === "stretching"
        ) {
          return true;
        }
        var combined = (
          String(exerciseOrId.id || "") +
          " " +
          String(exerciseOrId.name || "")
        )
          .trim()
          .toLowerCase();
        var expanded = combined + " " + combined.replace(/_/g, " ");
        if (expanded.indexOf("stretch") !== -1) return true;
        for (var i = 0; i < HOLD_KEYWORDS.length; i++) {
          if (expanded.indexOf(HOLD_KEYWORDS[i]) !== -1) return true;
        }
        return false;
      }
      var idText = String(exerciseOrId).trim().toLowerCase();
      var norm = idText + " " + idText.replace(/_/g, " ");
      if (norm.indexOf("stretch") !== -1) return true;
      for (var j = 0; j < HOLD_KEYWORDS.length; j++) {
        if (norm.indexOf(HOLD_KEYWORDS[j]) !== -1) return true;
      }
      return false;
    }

    function parseUtcDate(input) {
      if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? null : new Date(input.getTime());
      }
      if (typeof input === "number") {
        if (!Number.isFinite(input)) return null;
        var fromNum = new Date(input);
        return Number.isNaN(fromNum.getTime()) ? null : fromNum;
      }
      if (typeof input === "string") {
        var s = input.trim();
        if (!s) return null;
        if (
          /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
        ) {
          s = s.replace(" ", "T") + "Z";
        }
        var parsed = new Date(s);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      return null;
    }

    function isoYearWeekUtc(utcMidnightMs) {
      var d = new Date(utcMidnightMs);
      var jsDay = d.getUTCDay();
      var isoDow = jsDay === 0 ? 7 : jsDay;
      var thursdayMs = utcMidnightMs + (4 - isoDow) * DAY_MS;
      var thursday = new Date(thursdayMs);
      var isoYear = thursday.getUTCFullYear();
      var jan1Ms = Date.UTC(isoYear, 0, 1);
      var dayOfYear = Math.round((thursdayMs - jan1Ms) / DAY_MS);
      var isoWeek = Math.floor(dayOfYear / 7) + 1;
      return isoYear + "-W" + (isoWeek < 10 ? "0" + isoWeek : String(isoWeek));
    }

    // -----------------------------------------------------------------------
    // Persistent Storage Helper
    // -----------------------------------------------------------------------

    function requestPersistentStorage() {
      return Promise.resolve()
        .then(function () {
          var nav =
            (root && root.navigator) ||
            (typeof navigator !== "undefined" ? navigator : null);
          if (
            nav &&
            nav.storage &&
            typeof nav.storage.persist === "function"
          ) {
            return nav.storage.persist();
          }
          return false;
        })
        .then(function (granted) {
          return Boolean(granted);
        })
        .catch(function () {
          return false;
        });
    }

    // -----------------------------------------------------------------------
    // Exact Domain Math (services.py & main.py parity)
    // -----------------------------------------------------------------------

    function formatWeight(weight) {
      var num = Number(weight);
      if (!Number.isFinite(num)) {
        return "0 kg";
      }
      if (Number.isInteger(num)) {
        return String(num) + " kg";
      }
      return num.toFixed(1) + " kg";
    }

    function roundHalfKg(val) {
      return Math.max(0.5, Math.round(Number(val) * 2) / 2);
    }

    function scaleInitialPrescription(baseReps, baseWeight, startingIntensity) {
      var repsNum = Math.max(1, Math.round(Number(baseReps) || 10));
      var hasWeight =
        baseWeight !== null &&
        baseWeight !== undefined &&
        Number(baseWeight) > 0;
      var weightNum = hasWeight ? Number(baseWeight) : null;

      var sets;
      var reps;
      var weight;
      if (startingIntensity === "light") {
        sets = 2;
        reps = Math.max(6, Math.round(repsNum * 0.8));
        weight = weightNum ? roundHalfKg(weightNum * 0.75) : null;
      } else if (startingIntensity === "intense") {
        sets = 4;
        reps = Math.round(repsNum * 1.2);
        weight = weightNum ? roundHalfKg(weightNum * 1.2) : null;
      } else {
        sets = 3;
        reps = repsNum;
        weight = weightNum;
      }
      return {
        sets: sets,
        reps: reps,
        weight_kg: weight,
        weight: weight,
      };
    }

    function defaultPrescriptionForExercise(profile, exercise) {
      var prof = profile || {};
      var intensity = hasItem(VALID_INTENSITY, prof.starting_intensity)
        ? prof.starting_intensity
        : "moderate";
      var userEquip = prof.equipment || "body_only";

      if (isHoldExercise(exercise)) {
        return scaleInitialPrescription(30, null, intensity);
      }

      var exEquip =
        exercise && exercise.equipment
          ? String(exercise.equipment).toLowerCase()
          : "body only";
      var baseWeight = null;
      if (WEIGHTED_EXERCISE_EQUIPMENT[exEquip] && userEquip !== "body_only") {
        baseWeight = exEquip === "barbell" ? 20.0 : 10.0;
      }
      return scaleInitialPrescription(10, baseWeight, intensity);
    }

    function computeScaledTarget(item, intensityLevel, exercise) {
      var lvl = Math.trunc(Number(intensityLevel) || 0);
      var clamped = Math.max(-5, lvl);
      var intensityPct = 100 + clamped * 10;
      var multiplier = intensityPct / 100.0;
      var isHold = isHoldExercise(exercise || (item && item.exercise_id));

      var sets = item && item.sets ? Number(item.sets) : 3;
      var baseReps = item && item.base_reps ? Number(item.base_reps) : 10;
      var baseWeight =
        item &&
        item.base_weight_kg !== null &&
        item.base_weight_kg !== undefined
          ? Number(item.base_weight_kg)
          : null;

      if (baseWeight !== null && baseWeight > 0) {
        var roundedWeight = roundHalfKg(baseWeight * multiplier);
        var targetWeight;
        if (clamped > 0) {
          targetWeight = Math.max(roundedWeight, baseWeight + 0.5 * clamped);
        } else if (clamped < 0) {
          targetWeight = Math.max(
            0.5,
            Math.min(roundedWeight, baseWeight + 0.5 * clamped)
          );
        } else {
          targetWeight = baseWeight;
        }

        var wFormatted = isHold
          ? sets + " \u00d7 " + baseReps + " sec @ " + formatWeight(targetWeight)
          : sets + " \u00d7 " + baseReps + " @ " + formatWeight(targetWeight);

        return {
          sets: sets,
          reps: baseReps,
          weight_kg: targetWeight,
          intensity_percent: intensityPct,
          formatted: wFormatted,
        };
      }

      var roundedReps = Math.round(baseReps * multiplier);
      var targetReps;
      if (clamped > 0) {
        targetReps = Math.max(roundedReps, baseReps + clamped);
      } else if (clamped < 0) {
        targetReps = Math.max(1, Math.min(roundedReps, baseReps + clamped));
      } else {
        targetReps = baseReps;
      }

      var unit = isHold ? "sec" : "reps";
      var rFormatted = sets + " \u00d7 " + targetReps + " " + unit;
      return {
        sets: sets,
        reps: targetReps,
        weight_kg: null,
        intensity_percent: intensityPct,
        formatted: rFormatted,
      };
    }

    function applyIntensityFeedback(currentLevel, choice) {
      var lvl = Math.trunc(Number(currentLevel) || 0);
      var normalized = String(choice || "")
        .trim()
        .toLowerCase();
      if (normalized === "more") {
        return lvl + 1;
      }
      if (normalized === "less") {
        return Math.max(-5, lvl - 1);
      }
      return lvl;
    }

    function computeWeekStreak(logs, nowDate) {
      if (!Array.isArray(logs) || logs.length === 0) {
        return 0;
      }
      var ref = parseUtcDate(nowDate) || new Date();
      var activeWeeks = new Set();

      for (var i = 0; i < logs.length; i++) {
        var entry = logs[i];
        if (!entry) continue;
        var dt = parseUtcDate(entry.completed_at);
        if (!dt) continue;
        var logUtcMidnight = Date.UTC(
          dt.getUTCFullYear(),
          dt.getUTCMonth(),
          dt.getUTCDate()
        );
        activeWeeks.add(isoYearWeekUtc(logUtcMidnight));
      }

      if (activeWeeks.size === 0) {
        return 0;
      }

      var cursorMs = Date.UTC(
        ref.getUTCFullYear(),
        ref.getUTCMonth(),
        ref.getUTCDate()
      );
      if (!activeWeeks.has(isoYearWeekUtc(cursorMs))) {
        var prevMs = cursorMs - 7 * DAY_MS;
        if (!activeWeeks.has(isoYearWeekUtc(prevMs))) {
          return 0;
        }
        cursorMs = prevMs;
      }

      var streak = 0;
      while (activeWeeks.has(isoYearWeekUtc(cursorMs))) {
        streak += 1;
        cursorMs -= 7 * DAY_MS;
      }
      return streak;
    }

    // -----------------------------------------------------------------------
    // UTF-8, Base64URL & Deflate-Raw Helpers
    // -----------------------------------------------------------------------

    function utf8Encode(str) {
      if (typeof TextEncoder === "function") {
        return new TextEncoder().encode(str);
      }
      var bytes = [];
      for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          var next = str.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            var cp = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
            bytes.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f)
            );
            i += 1;
          }
        } else {
          bytes.push(
            0xe0 | (code >> 12),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        }
      }
      return new Uint8Array(bytes);
    }

    function utf8Decode(bytes) {
      if (typeof TextDecoder === "function") {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      var out = "";
      for (var i = 0; i < bytes.length; i++) {
        out += String.fromCharCode(bytes[i]);
      }
      return decodeURIComponent(escape(out));
    }

    function bytesToBase64Url(bytes) {
      var len = bytes.length;
      var chars = [];
      for (var i = 0; i < len; i += 3) {
        var b0 = bytes[i];
        var hasB1 = i + 1 < len;
        var hasB2 = i + 2 < len;
        var b1 = hasB1 ? bytes[i + 1] : 0;
        var b2 = hasB2 ? bytes[i + 2] : 0;

        chars.push(B64URL_ALPHABET[b0 >> 2]);
        chars.push(B64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]);
        if (hasB1) {
          chars.push(B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]);
        }
        if (hasB2) {
          chars.push(B64URL_ALPHABET[b2 & 0x3f]);
        }
      }
      return chars.join("");
    }

    function base64UrlToBytes(b64) {
      var clean = String(b64 || "").replace(/=+$/, "");
      if (clean.length % 4 === 1) {
        throw new Error("Invalid base64url token length.");
      }
      var outLen = Math.floor((clean.length * 3) / 4);
      var out = new Uint8Array(outLen);
      var outIdx = 0;
      var buffer = 0;
      var bits = 0;

      for (var i = 0; i < clean.length; i++) {
        var code = clean.charCodeAt(i);
        var val = code < 128 ? B64URL_LOOKUP[code] : -1;
        if (val < 0) {
          throw new Error("Invalid character in base64url token.");
        }
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          out[outIdx++] = (buffer >> bits) & 0xff;
        }
      }
      return out;
    }

    async function deflateRawBytes(inputBytes) {
      var cs = new CompressionStream("deflate-raw");
      var writer = cs.writable.getWriter();
      var writeErr = null;
      var writePromise = writer
        .write(inputBytes)
        .then(function () {
          return writer.close();
        })
        .catch(function (err) {
          writeErr = err;
        });

      var reader = cs.readable.getReader();
      var chunks = [];
      var totalLen = 0;
      try {
        while (true) {
          var step = await reader.read();
          if (step.done) break;
          chunks.push(step.value);
          totalLen += step.value.byteLength;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
          // Ignore lock release errors
        }
      }

      await writePromise;
      if (writeErr) {
        throw writeErr;
      }

      var result = new Uint8Array(totalLen);
      var offset = 0;
      for (var i = 0; i < chunks.length; i++) {
        result.set(chunks[i], offset);
        offset += chunks[i].byteLength;
      }
      return result;
    }

    async function inflateRawBytesBounded(compressedBytes, maxBytes) {
      if (typeof DecompressionStream !== "function") {
        throw new Error(
          "DecompressionStream is not supported in this environment."
        );
      }
      var ds = new DecompressionStream("deflate-raw");
      var writer = ds.writable.getWriter();
      var writeErr = null;
      var writePromise = writer
        .write(compressedBytes)
        .then(function () {
          return writer.close();
        })
        .catch(function (err) {
          writeErr = err;
        });

      var reader = ds.readable.getReader();
      var chunks = [];
      var totalLen = 0;
      var exceeded = false;

      try {
        while (true) {
          var step = await reader.read();
          if (step.done) break;
          var chunk = step.value;
          totalLen += chunk.byteLength;
          if (totalLen > maxBytes) {
            exceeded = true;
            await reader
              .cancel("Decompressed size limit exceeded")
              .catch(function () {});
            await writer
              .abort("Decompressed size limit exceeded")
              .catch(function () {});
            break;
          }
          chunks.push(chunk);
        }
      } catch (readErr) {
        await writer.abort("Malformed deflate stream").catch(function () {});
        await writePromise;
        throw new Error("Malformed compressed share token.");
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
          // Ignore lock release errors
        }
      }

      await writePromise;
      if (exceeded) {
        throw new Error(
          "Share payload exceeds maximum decompressed size of " +
            maxBytes +
            " bytes."
        );
      }
      if (writeErr) {
        throw new Error("Malformed compressed share token.");
      }

      var result = new Uint8Array(totalLen);
      var offset = 0;
      for (var i = 0; i < chunks.length; i++) {
        result.set(chunks[i], offset);
        offset += chunks[i].byteLength;
      }
      return result;
    }

    // -----------------------------------------------------------------------
    // Cloning & Validation Helpers
    // -----------------------------------------------------------------------

    function cloneProfile(p) {
      return {
        name: p.name,
        equipment: p.equipment,
        starting_intensity: p.starting_intensity,
        weekly_goal: p.weekly_goal,
        sound_theme: p.sound_theme,
      };
    }

    function cloneExerciseItem(ex) {
      return {
        id: ex.id,
        exercise_id: ex.exercise_id,
        sets: ex.sets,
        base_reps: ex.base_reps,
        base_weight_kg: ex.base_weight_kg,
      };
    }

    function cloneRoutine(rt) {
      return {
        id: rt.id,
        name: rt.name,
        intensity_level: rt.intensity_level,
        exercises: rt.exercises.map(cloneExerciseItem),
      };
    }

    function clonePlan(plan) {
      return {
        name: plan.name,
        description: plan.description,
        days_per_week: plan.days_per_week,
        last_routine_id:
          plan.last_routine_id !== undefined ? plan.last_routine_id : null,
        routines: plan.routines.map(cloneRoutine),
      };
    }

    function cloneLog(log) {
      return {
        id: log.id,
        routine_id: log.routine_id,
        routine_name: log.routine_name,
        completed_at: log.completed_at,
        duration_minutes: log.duration_minutes,
        completed_exercises: log.completed_exercises,
        total_exercises: log.total_exercises,
        intensity_at_session: log.intensity_at_session,
        next_intensity_choice: log.next_intensity_choice,
      };
    }

    function cloneState(s) {
      if (!s) return null;
      return {
        schema_version: 1,
        profile: cloneProfile(s.profile),
        plan: clonePlan(s.plan),
        logs: s.logs.map(cloneLog),
      };
    }

    function deduplicateAndSortLogs(logsList) {
      var seenIds = new Set();
      var seenComposite = new Set();
      var unique = [];

      for (var i = 0; i < logsList.length; i++) {
        var lg = logsList[i];
        if (!lg) continue;
        var compKey = String(lg.completed_at) + "|" + String(lg.routine_name);
        if (lg.id && seenIds.has(lg.id)) {
          continue;
        }
        if (seenComposite.has(compKey)) {
          continue;
        }
        if (lg.id) {
          seenIds.add(lg.id);
        }
        seenComposite.add(compKey);
        unique.push(cloneLog(lg));
      }

      unique.sort(function (a, b) {
        var ta = Date.parse(a.completed_at) || 0;
        var tb = Date.parse(b.completed_at) || 0;
        return tb - ta;
      });
      return unique.slice(0, MAX_LOGS);
    }

    function validateAndNormalizeImport(raw, options) {
      var opts = options || {};
      var exerciseMap = opts.exerciseMap || null;
      var hasCatalog = Boolean(exerciseMap && exerciseMap.size > 0);
      var fallbackSound = hasItem(VALID_SOUND_THEMES, opts.fallbackSoundTheme)
        ? opts.fallbackSoundTheme
        : "minimal";

      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Invalid backup: payload must be a JSON object.");
      }
      if (raw.schema_version !== 1) {
        throw new Error(
          "Unsupported backup schema_version; expected schema_version 1."
        );
      }
      if (
        !raw.profile ||
        typeof raw.profile !== "object" ||
        Array.isArray(raw.profile)
      ) {
        throw new Error("Invalid backup: profile must be an object.");
      }
      if (
        !raw.plan ||
        typeof raw.plan !== "object" ||
        Array.isArray(raw.plan)
      ) {
        throw new Error("Invalid backup: plan must be an object.");
      }
      if (!Array.isArray(raw.plan.routines)) {
        throw new Error("Invalid backup: plan.routines must be an array.");
      }
      if (raw.plan.routines.length > MAX_ROUTINES) {
        throw new Error("Invalid backup: too many routines.");
      }
      if (raw.logs !== undefined && !Array.isArray(raw.logs)) {
        throw new Error("Invalid backup: logs must be an array when provided.");
      }

      var rawProfile = raw.profile;
      var equipment = hasItem(VALID_EQUIPMENT, rawProfile.equipment)
        ? rawProfile.equipment
        : "body_only";
      var startingIntensity = hasItem(
        VALID_INTENSITY,
        rawProfile.starting_intensity
      )
        ? rawProfile.starting_intensity
        : "moderate";
      var soundTheme = hasItem(VALID_SOUND_THEMES, rawProfile.sound_theme)
        ? rawProfile.sound_theme
        : fallbackSound;
      var daysPerWeek = clampInt(raw.plan.days_per_week, 1, 7, 3);
      var weeklyGoal = clampInt(rawProfile.weekly_goal, 1, 7, daysPerWeek);

      var profile = {
        name: sanitizeString(rawProfile.name, 50, "Athlete"),
        equipment: equipment,
        starting_intensity: startingIntensity,
        weekly_goal: weeklyGoal,
        sound_theme: soundTheme,
      };

      var usedRoutineIds = new Set();
      var usedItemIds = new Set();
      var normalizedRoutines = [];

      for (var rIdx = 0; rIdx < raw.plan.routines.length; rIdx++) {
        var rawRt = raw.plan.routines[rIdx];
        if (!rawRt || typeof rawRt !== "object" || Array.isArray(rawRt)) {
          throw new Error("Invalid backup: routine entry must be an object.");
        }
        var baseRtId =
          rawRt.id !== null && rawRt.id !== undefined
            ? sanitizeString(String(rawRt.id), 64, "")
            : "";
        if (!baseRtId || usedRoutineIds.has(baseRtId)) {
          var suffix = rIdx + 1;
          while (usedRoutineIds.has("r" + suffix)) {
            suffix += 1;
          }
          baseRtId = "r" + suffix;
        }
        usedRoutineIds.add(baseRtId);

        var rtName = sanitizeString(rawRt.name, 60, "Day " + (rIdx + 1));
        var rtIntensity = clampInt(rawRt.intensity_level, -5, 50, 0);

        var rawExercises = Array.isArray(rawRt.exercises)
          ? rawRt.exercises.slice(0, MAX_EXERCISES_PER_ROUTINE)
          : [];
        var normalizedExercises = [];

        for (var eIdx = 0; eIdx < rawExercises.length; eIdx++) {
          var rawEx = rawExercises[eIdx];
          if (!rawEx || typeof rawEx !== "object" || Array.isArray(rawEx)) {
            continue;
          }
          var exId = sanitizeString(rawEx.exercise_id, 120, "");
          if (!exId) continue;
          if (hasCatalog && !exerciseMap.has(exId)) {
            continue;
          }

          var itemId =
            rawEx.id !== null && rawEx.id !== undefined
              ? sanitizeString(String(rawEx.id), 64, "")
              : "";
          if (!itemId || usedItemIds.has(itemId)) {
            var itemSeq = usedItemIds.size + 1;
            while (usedItemIds.has("rx" + itemSeq)) {
              itemSeq += 1;
            }
            itemId = "rx" + itemSeq;
          }
          usedItemIds.add(itemId);

          var sets = clampInt(rawEx.sets, 1, 20, 3);
          var baseReps = clampInt(rawEx.base_reps, 1, 200, 10);
          var baseWeightKg = null;
          if (
            rawEx.base_weight_kg !== null &&
            rawEx.base_weight_kg !== undefined &&
            rawEx.base_weight_kg !== "" &&
            typeof rawEx.base_weight_kg !== "boolean"
          ) {
            var parsedW = Number(rawEx.base_weight_kg);
            if (Number.isFinite(parsedW)) {
              baseWeightKg = Math.max(0.5, Math.min(500, parsedW));
            }
          }

          normalizedExercises.push({
            id: itemId,
            exercise_id: exId,
            sets: sets,
            base_reps: baseReps,
            base_weight_kg: baseWeightKg,
          });
        }

        normalizedRoutines.push({
          id: baseRtId,
          name: rtName,
          intensity_level: rtIntensity,
          exercises: normalizedExercises,
        });
      }

      var rawLastRtId =
        raw.plan.last_routine_id !== null &&
        raw.plan.last_routine_id !== undefined
          ? sanitizeString(String(raw.plan.last_routine_id), 64, "")
          : "";
      var lastRoutineId =
        rawLastRtId && usedRoutineIds.has(rawLastRtId) ? rawLastRtId : null;

      var plan = {
        name: sanitizeString(raw.plan.name, 80, "Training Plan"),
        description: sanitizeString(raw.plan.description, 160, ""),
        days_per_week: daysPerWeek,
        last_routine_id: lastRoutineId,
        routines: normalizedRoutines,
      };

      var rawLogs = Array.isArray(raw.logs)
        ? raw.logs.slice(0, MAX_LOGS)
        : [];
      var normalizedLogs = [];
      for (var lIdx = 0; lIdx < rawLogs.length; lIdx++) {
        var rawLg = rawLogs[lIdx];
        if (!rawLg || typeof rawLg !== "object" || Array.isArray(rawLg)) {
          continue;
        }
        var completedDt = parseUtcDate(rawLg.completed_at);
        if (!completedDt) continue;

        var lgId =
          rawLg.id !== null && rawLg.id !== undefined
            ? sanitizeString(String(rawLg.id), 64, "")
            : "";
        if (!lgId) {
          lgId = "log_imp_" + (lIdx + 1) + "_" + completedDt.getTime();
        }
        var lgRoutineId =
          rawLg.routine_id !== null && rawLg.routine_id !== undefined
            ? sanitizeString(String(rawLg.routine_id), 64, "") || null
            : null;
        var lgRoutineName = sanitizeString(rawLg.routine_name, 60, "Workout");
        var totalEx = clampInt(rawLg.total_exercises, 0, 200, 0);
        var completedEx = clampInt(rawLg.completed_exercises, 0, totalEx, 0);
        var durMins = clampInt(rawLg.duration_minutes, 1, 360, 25);
        var sessIntensity = clampInt(rawLg.intensity_at_session, -5, 50, 0);
        var choiceNorm = String(rawLg.next_intensity_choice || "keep")
          .trim()
          .toLowerCase();
        var nextChoice = hasItem(VALID_FEEDBACK_CHOICES, choiceNorm)
          ? choiceNorm
          : "keep";

        normalizedLogs.push({
          id: lgId,
          routine_id: lgRoutineId,
          routine_name: lgRoutineName,
          completed_at: completedDt.toISOString(),
          duration_minutes: durMins,
          completed_exercises: completedEx,
          total_exercises: totalEx,
          intensity_at_session: sessIntensity,
          next_intensity_choice: nextChoice,
        });
      }

      return {
        schema_version: 1,
        profile: profile,
        plan: plan,
        logs: deduplicateAndSortLogs(normalizedLogs),
      };
    }

    function expandCompactShareObject(parsed) {
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("Invalid share payload.");
      }
      if (parsed.schema_version === 1) {
        return parsed;
      }
      if (
        parsed.v !== 1 ||
        !Array.isArray(parsed.p) ||
        !Array.isArray(parsed.n) ||
        !Array.isArray(parsed.r)
      ) {
        throw new Error("Unsupported share payload format.");
      }

      var routines = [];
      for (var rIdx = 0; rIdx < parsed.r.length; rIdx++) {
        var rtTuple = parsed.r[rIdx];
        if (!Array.isArray(rtTuple)) {
          throw new Error("Invalid routine tuple in share payload.");
        }
        var rawExList = Array.isArray(rtTuple[3]) ? rtTuple[3] : [];
        var exItems = [];
        for (var eIdx = 0; eIdx < rawExList.length; eIdx++) {
          var exTuple = rawExList[eIdx];
          if (!Array.isArray(exTuple)) {
            throw new Error("Invalid exercise tuple in share payload.");
          }
          exItems.push({
            id: "rx" + (rIdx + 1) + "_" + (eIdx + 1),
            exercise_id: exTuple[0],
            sets: exTuple[1],
            base_reps: exTuple[2],
            base_weight_kg: exTuple[3],
          });
        }
        routines.push({
          id: rtTuple[0] || "r" + (rIdx + 1),
          name: rtTuple[1],
          intensity_level: rtTuple[2],
          exercises: exItems,
        });
      }

      return {
        schema_version: 1,
        profile: {
          name: parsed.p[0],
          equipment: parsed.p[1],
          starting_intensity: parsed.p[2],
          weekly_goal: parsed.p[3],
          sound_theme: parsed.p[4],
        },
        plan: {
          name: parsed.n[0],
          description: parsed.n[1],
          days_per_week: parsed.n[2],
          last_routine_id: parsed.n[3] !== undefined ? parsed.n[3] : null,
          routines: routines,
        },
        logs: [],
      };
    }

    // -----------------------------------------------------------------------
    // Store Factory
    // -----------------------------------------------------------------------

    function normalizeCatalogExercise(rawEx) {
      var archetype = rawEx.archetype || "squat";
      var eqMode = rawEx.eq_mode || normalizeEqMode(rawEx.equipment);
      var svgKey = rawEx.svg_key || archetype + ":" + eqMode;
      var thumbUrl =
        rawEx.thumb_url ||
        "./svgs/thumbs/" + archetype + "__" + eqMode + ".svg";
      var hold = isHoldExercise(rawEx);
      var howTo = rawEx.how_to || "Move with steady control";
      var instructions =
        Array.isArray(rawEx.instructions) && rawEx.instructions.length > 0
          ? rawEx.instructions.slice()
          : [howTo];

      return {
        id: String(rawEx.id),
        name: String(rawEx.name || rawEx.id),
        category: rawEx.category || "strength",
        level: rawEx.level || "beginner",
        equipment: rawEx.equipment || "body only",
        primary_muscle: rawEx.primary_muscle || "other",
        secondary_muscles: rawEx.secondary_muscles || "",
        archetype: archetype,
        eq_mode: eqMode,
        svg_key: svgKey,
        thumb_url: thumbUrl,
        rep_seconds:
          rawEx.rep_seconds > 0 ? Number(rawEx.rep_seconds) : hold ? 1.0 : 2.8,
        is_hold: hold,
        unit: rawEx.unit || (hold ? "sec" : "reps"),
        how_to: howTo,
        instructions: instructions,
        cue_work: rawEx.cue_work || (hold ? "Hold" : "\u2193 Work"),
        cue_return: rawEx.cue_return || (hold ? "Breathe" : "\u2191 Return"),
        tempo_mode: rawEx.tempo_mode || (hold ? "hold" : "standard"),
        is_alternating: Boolean(rawEx.is_alternating),
      };
    }

    function decorateSearchExercise(ex) {
      var copy = Object.assign({}, ex, {
        instructions: ex.instructions.slice(),
      });
      Object.defineProperty(copy, "exercise", {
        value: copy,
        enumerable: false,
        configurable: true,
      });
      Object.defineProperty(copy, "svg_url", {
        value: copy.thumb_url,
        enumerable: false,
        configurable: true,
      });
      return copy;
    }

    function createStore(options) {
      var opts = options || {};
      var catalog = opts.catalog || { exercises: [], programs: {}, svgs: {} };

      var storage = null;
      if (opts.storage !== undefined) {
        storage = opts.storage;
      } else {
        try {
          storage = root && root.localStorage ? root.localStorage : null;
        } catch (e) {
          storage = null;
        }
      }

      var exerciseList = [];
      var exerciseMap = new Map();
      var rawExercises = Array.isArray(catalog.exercises)
        ? catalog.exercises
        : [];
      for (var i = 0; i < rawExercises.length; i++) {
        if (!rawExercises[i] || !rawExercises[i].id) continue;
        var normEx = normalizeCatalogExercise(rawExercises[i]);
        exerciseList.push(normEx);
        exerciseMap.set(normEx.id, normEx);
      }

      function readStorageItem(key) {
        if (!storage || typeof storage.getItem !== "function") return null;
        try {
          return storage.getItem(key);
        } catch (e) {
          return null;
        }
      }

      function writeStorageItem(key, val) {
        if (!storage || typeof storage.setItem !== "function") return;
        try {
          storage.setItem(key, val);
        } catch (e) {
          // Ignore quota or private-browsing errors
        }
      }

      function readSavedSoundKey() {
        var rawTheme = readStorageItem(SOUND_STORAGE_KEY);
        return hasItem(VALID_SOUND_THEMES, rawTheme) ? rawTheme : null;
      }

      var currentSoundTheme = readSavedSoundKey() || "minimal";
      var state = null;

      function persistState(nextState) {
        state = nextState;
        if (state && state.profile) {
          var validTheme = hasItem(
            VALID_SOUND_THEMES,
            state.profile.sound_theme
          )
            ? state.profile.sound_theme
            : currentSoundTheme;
          state.profile.sound_theme = validTheme;
          currentSoundTheme = validTheme;
          writeStorageItem(SOUND_STORAGE_KEY, currentSoundTheme);
        }
        if (state) {
          writeStorageItem(STORAGE_KEY, JSON.stringify(state));
        }
      }

      // Hydrate initial state and migrate/sync legacy sound key
      (function hydrate() {
        var legacySound = readSavedSoundKey();
        var rawStateJson = readStorageItem(STORAGE_KEY);
        if (!rawStateJson) {
          if (legacySound) {
            currentSoundTheme = legacySound;
          }
          return;
        }
        try {
          var parsed = JSON.parse(rawStateJson);
          var hadExplicitSound = Boolean(
            parsed &&
              parsed.profile &&
              hasItem(VALID_SOUND_THEMES, parsed.profile.sound_theme)
          );
          var normalized = validateAndNormalizeImport(parsed, {
            exerciseMap: exerciseMap,
            fallbackSoundTheme: legacySound || "minimal",
          });
          state = normalized;
          currentSoundTheme = state.profile.sound_theme;
          if (!legacySound || legacySound !== currentSoundTheme) {
            writeStorageItem(SOUND_STORAGE_KEY, currentSoundTheme);
          }
          if (!hadExplicitSound && legacySound) {
            writeStorageItem(STORAGE_KEY, JSON.stringify(state));
          }
        } catch (e) {
          state = null;
        }
      })();

      function hasActivePlan() {
        return Boolean(
          state && state.plan && Array.isArray(state.plan.routines)
        );
      }

      function getState() {
        if (!hasActivePlan()) return null;
        return cloneState(state);
      }

      function getSoundTheme() {
        var storedKey = readSavedSoundKey();
        if (storedKey) {
          currentSoundTheme = storedKey;
          if (state && state.profile && state.profile.sound_theme !== storedKey) {
            state.profile.sound_theme = storedKey;
            writeStorageItem(STORAGE_KEY, JSON.stringify(state));
          }
          return currentSoundTheme;
        }
        if (
          state &&
          state.profile &&
          hasItem(VALID_SOUND_THEMES, state.profile.sound_theme)
        ) {
          currentSoundTheme = state.profile.sound_theme;
          return currentSoundTheme;
        }
        return hasItem(VALID_SOUND_THEMES, currentSoundTheme)
          ? currentSoundTheme
          : "minimal";
      }

      function setSoundTheme(themeId) {
        if (!hasItem(VALID_SOUND_THEMES, themeId)) {
          return getSoundTheme();
        }
        currentSoundTheme = themeId;
        writeStorageItem(SOUND_STORAGE_KEY, themeId);
        if (state && state.profile) {
          state.profile.sound_theme = themeId;
          writeStorageItem(STORAGE_KEY, JSON.stringify(state));
        }
        return currentSoundTheme;
      }

      function nextUniqueRoutineId(routines) {
        var existing = new Set();
        for (var i = 0; i < routines.length; i++) {
          existing.add(String(routines[i].id));
        }
        var n = routines.length + 1;
        while (existing.has("r" + n)) {
          n += 1;
        }
        return "r" + n;
      }

      function nextUniqueItemId(routines) {
        var existing = new Set();
        var count = 0;
        for (var r = 0; r < routines.length; r++) {
          var exs = routines[r].exercises || [];
          for (var e = 0; e < exs.length; e++) {
            existing.add(String(exs[e].id));
            count += 1;
          }
        }
        var n = count + 1;
        while (existing.has("rx" + n)) {
          n += 1;
        }
        return "rx" + n;
      }

      function setupPlan(setupOpts) {
        var cfg = setupOpts || {};
        var cleanName = sanitizeString(cfg.name, 50, "Athlete");
        var eqKey = hasItem(VALID_EQUIPMENT, cfg.equipment)
          ? cfg.equipment
          : "body_only";
        var intKey = hasItem(VALID_INTENSITY, cfg.starting_intensity)
          ? cfg.starting_intensity
          : "moderate";
        var rawDays =
          cfg.days_per_week !== undefined && cfg.days_per_week !== null
            ? Number(cfg.days_per_week)
            : 3;
        var days = Number.isFinite(rawDays)
          ? Math.max(2, Math.min(4, Math.round(rawDays)))
          : 3;
        var soundTheme = hasItem(VALID_SOUND_THEMES, cfg.sound_theme)
          ? cfg.sound_theme
          : getSoundTheme();

        var programs = (catalog && catalog.programs) || {};
        var eqPrograms = programs.equipment_programs || {};
        var intLabels = programs.intensity_labels || DEFAULT_INTENSITY_LABELS;
        var program = eqPrograms[eqKey] ||
          eqPrograms.body_only || { label: "Body Only", routines: [] };
        var programLabel = program.label || "Body Only";
        var intensityLabel =
          intLabels[intKey] || DEFAULT_INTENSITY_LABELS[intKey] || "Moderate";

        var planName = programLabel + " Plan (" + days + "x/Week)";
        var planDesc = intensityLabel + " start \u2022 " + programLabel;

        var rawRoutines = Array.isArray(program.routines)
          ? program.routines.slice(0, days)
          : [];
        var builtRoutines = [];
        var rxSeq = 1;

        for (var dIdx = 0; dIdx < rawRoutines.length; dIdx++) {
          var rtDef = rawRoutines[dIdx];
          var rtName = Array.isArray(rtDef)
            ? String(rtDef[0] || "Day " + (dIdx + 1))
            : String((rtDef && rtDef.name) || "Day " + (dIdx + 1));
          var specs = Array.isArray(rtDef)
            ? rtDef[1] || []
            : (rtDef && rtDef.exercises) || [];

          var items = [];
          for (var sIdx = 0; sIdx < specs.length; sIdx++) {
            var spec = specs[sIdx];
            var exId = Array.isArray(spec) ? String(spec[0]) : String(spec.exercise_id);
            var modReps = Array.isArray(spec) ? spec[1] : spec.base_reps;
            var modWeight = Array.isArray(spec) ? spec[2] : spec.base_weight_kg;

            if (exerciseMap.size > 0 && !exerciseMap.has(exId)) {
              continue;
            }
            var scaledPresc = scaleInitialPrescription(
              modReps,
              modWeight,
              intKey
            );
            items.push({
              id: "rx" + rxSeq++,
              exercise_id: exId,
              sets: scaledPresc.sets,
              base_reps: scaledPresc.reps,
              base_weight_kg: scaledPresc.weight_kg,
            });
          }

          builtRoutines.push({
            id: "r" + (dIdx + 1),
            name: sanitizeString(rtName, 60, "Day " + (dIdx + 1)),
            intensity_level: 0,
            exercises: items,
          });
        }

        var preservedLogs =
          state && Array.isArray(state.logs) ? state.logs.map(cloneLog) : [];

        var nextState = {
          schema_version: 1,
          profile: {
            name: cleanName,
            equipment: eqKey,
            starting_intensity: intKey,
            weekly_goal: days,
            sound_theme: soundTheme,
          },
          plan: {
            name: planName,
            description: planDesc,
            days_per_week: days,
            last_routine_id: null,
            routines: builtRoutines,
          },
          logs: preservedLogs,
        };

        persistState(nextState);
        requestPersistentStorage();
        return cloneState(state);
      }

      function addWorkoutDay() {
        if (!hasActivePlan()) return null;
        var routines = state.plan.routines;
        var newRoutine = {
          id: nextUniqueRoutineId(routines),
          name: "Day " + (routines.length + 1),
          intensity_level: 0,
          exercises: [],
        };
        routines.push(newRoutine);
        persistState(state);
        return cloneRoutine(newRoutine);
      }

      function findRoutineInternal(routineId) {
        if (!hasActivePlan()) return null;
        var target = String(routineId);
        var routines = state.plan.routines;
        for (var i = 0; i < routines.length; i++) {
          if (String(routines[i].id) === target) {
            return routines[i];
          }
        }
        return null;
      }

      function getRoutine(routineId) {
        var found = findRoutineInternal(routineId);
        return found ? cloneRoutine(found) : null;
      }

      function addExerciseToRoutine(routineId, exerciseId) {
        var routine = findRoutineInternal(routineId);
        if (!routine) return null;

        var targetExId = String(exerciseId || "").trim();
        if (!targetExId) return null;

        var exObj = exerciseMap.get(targetExId);
        if (exerciseMap.size > 0 && !exObj) {
          return null;
        }
        if (!exObj) {
          exObj = normalizeCatalogExercise({ id: targetExId, name: targetExId });
        }

        var presc = defaultPrescriptionForExercise(state.profile, exObj);
        var item = {
          id: nextUniqueItemId(state.plan.routines),
          exercise_id: exObj.id,
          sets: presc.sets,
          base_reps: presc.reps,
          base_weight_kg: presc.weight_kg,
        };
        routine.exercises.push(item);
        persistState(state);
        return cloneExerciseItem(item);
      }

      function removeExerciseFromRoutine(routineId, itemId) {
        var routine = findRoutineInternal(routineId);
        if (!routine) return false;
        var targetItem = String(itemId);
        for (var i = 0; i < routine.exercises.length; i++) {
          if (String(routine.exercises[i].id) === targetItem) {
            routine.exercises.splice(i, 1);
            persistState(state);
            return true;
          }
        }
        return false;
      }

      function completeWorkout(routineId, completeOpts) {
        var routine = findRoutineInternal(routineId);
        if (!routine) return null;

        var cfg = completeOpts || {};
        var rawChoice = String(
          cfg.next_intensity_choice !== undefined
            ? cfg.next_intensity_choice
            : "keep"
        )
          .trim()
          .toLowerCase();
        var choice = hasItem(VALID_FEEDBACK_CHOICES, rawChoice)
          ? rawChoice
          : "keep";

        var dur = clampInt(
          cfg.duration_minutes !== undefined ? cfg.duration_minutes : 25,
          1,
          360,
          25
        );
        var totalExercises = routine.exercises.length;
        var rawCompletedCount = Array.isArray(cfg.completed_ids)
          ? cfg.completed_ids.length
          : typeof cfg.completed_exercises === "number"
            ? Math.trunc(cfg.completed_exercises)
            : 0;
        var completedCount = Math.max(
          0,
          Math.min(totalExercises, rawCompletedCount)
        );

        var sessionIntensity = routine.intensity_level;
        var completedDt =
          (cfg.completed_at ? parseUtcDate(cfg.completed_at) : null) ||
          new Date();
        idCounter += 1;
        var logId =
          "log_" + Date.now().toString(36) + "_" + idCounter.toString(36);

        var logEntry = {
          id: logId,
          routine_id: routine.id,
          routine_name: routine.name,
          completed_at: completedDt.toISOString(),
          duration_minutes: dur,
          completed_exercises: completedCount,
          total_exercises: totalExercises,
          intensity_at_session: sessionIntensity,
          next_intensity_choice: choice,
        };

        state.logs.unshift(logEntry);
        routine.intensity_level = applyIntensityFeedback(
          routine.intensity_level,
          choice
        );
        state.plan.last_routine_id = routine.id;
        persistState(state);

        return Object.assign(cloneLog(logEntry), {
          intensity_percent: Math.max(50, 100 + sessionIntensity * 10),
        });
      }

      function buildRoutineCards(routinesSubset) {
        var sourceRoutines;
        if (Array.isArray(routinesSubset)) {
          sourceRoutines = [];
          for (var s = 0; s < routinesSubset.length; s++) {
            var cand = routinesSubset[s];
            if (typeof cand === "string") {
              var resolved = findRoutineInternal(cand);
              if (resolved) sourceRoutines.push(resolved);
            } else if (cand && typeof cand === "object") {
              sourceRoutines.push(cand);
            }
          }
        } else {
          sourceRoutines = hasActivePlan() ? state.plan.routines : [];
        }

        var cards = [];
        for (var r = 0; r < sourceRoutines.length; r++) {
          var rt = sourceRoutines[r];
          var intensityPct = Math.max(
            50,
            100 + Math.trunc(Number(rt.intensity_level) || 0) * 10
          );
          var rows = [];
          var items = Array.isArray(rt.exercises) ? rt.exercises : [];

          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var ex = exerciseMap.get(item.exercise_id);
            if (exerciseMap.size > 0 && !ex) {
              continue;
            }
            if (!ex) {
              ex = normalizeCatalogExercise({
                id: item.exercise_id,
                name: item.exercise_id,
              });
            }
            var scaled = computeScaledTarget(item, rt.intensity_level || 0, ex);
            var rowObj = {
              item: cloneExerciseItem(item),
              exercise: Object.assign({}, ex, {
                instructions: ex.instructions.slice(),
              }),
              archetype: ex.archetype,
              svg_key: ex.svg_key,
              thumb_url: ex.thumb_url,
              scaled: scaled,
            };
            Object.defineProperty(rowObj, "svg_url", {
              value: ex.thumb_url,
              enumerable: false,
              configurable: true,
            });
            rows.push(rowObj);
          }

          var rtCopy = cloneRoutine(rt);
          rtCopy.intensity_percent = intensityPct;

          cards.push({
            routine: rtCopy,
            intensity_percent: intensityPct,
            exercises: rows,
            lead_archetype: rows.length > 0 ? rows[0].archetype : "squat",
            lead_svg_key:
              rows.length > 0 ? rows[0].svg_key : "squat:body_only",
          });
        }
        return cards;
      }

      function getLogsDesc() {
        if (!state || !Array.isArray(state.logs) || state.logs.length === 0) {
          return [];
        }
        var copy = state.logs.map(function (lg, idx) {
          return {
            log: lg,
            idx: idx,
            ts: Date.parse(lg.completed_at) || 0,
          };
        });
        copy.sort(function (a, b) {
          if (b.ts !== a.ts) return b.ts - a.ts;
          return a.idx - b.idx;
        });
        return copy.map(function (entry) {
          var lg = entry.log;
          var pct = Math.max(
            50,
            100 + Math.trunc(Number(lg.intensity_at_session) || 0) * 10
          );
          return Object.assign(cloneLog(lg), {
            intensity_percent: pct,
          });
        });
      }

      function getNextRoutineCard() {
        var cards = buildRoutineCards();
        if (cards.length === 0) return null;

        var idToIndex = new Map();
        for (var i = 0; i < cards.length; i++) {
          idToIndex.set(String(cards[i].routine.id), i);
        }

        var logsDesc = getLogsDesc();
        for (var j = 0; j < logsDesc.length; j++) {
          var rId = logsDesc[j].routine_id;
          if (rId !== null && rId !== undefined && idToIndex.has(String(rId))) {
            var matchedIdx = idToIndex.get(String(rId));
            return cards[(matchedIdx + 1) % cards.length];
          }
        }

        if (
          state &&
          state.plan &&
          state.plan.last_routine_id !== null &&
          state.plan.last_routine_id !== undefined &&
          idToIndex.has(String(state.plan.last_routine_id))
        ) {
          var fallbackIdx = idToIndex.get(String(state.plan.last_routine_id));
          return cards[(fallbackIdx + 1) % cards.length];
        }

        return cards[0];
      }

      function buildPlaylist(routineId) {
        var routine = findRoutineInternal(routineId);
        if (!routine) return [];

        var cards = buildRoutineCards([routine]);
        var rows = cards.length > 0 ? cards[0].exercises : [];
        var svgs = (catalog && catalog.svgs) || {};
        var playlist = [];

        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var ex = row.exercise;
          var scaled = row.scaled;
          var svgMarkup =
            svgs[row.svg_key] || svgs[row.archetype] || svgs.squat || "";

          playlist.push({
            item_id: row.item.id,
            exercise_id: ex.id,
            name: ex.name,
            sets: scaled.sets,
            reps: scaled.reps,
            weight_kg: scaled.weight_kg,
            weight_label:
              scaled.weight_kg !== null ? formatWeight(scaled.weight_kg) : null,
            formatted: scaled.formatted,
            archetype: row.archetype,
            svg_key: row.svg_key,
            thumb_url: row.thumb_url,
            svg_markup: svgMarkup,
            rep_seconds: ex.rep_seconds,
            is_hold: ex.is_hold,
            unit: ex.unit,
            how_to: ex.how_to,
            instructions: ex.instructions.slice(),
            cue_work: ex.cue_work,
            cue_return: ex.cue_return,
            tempo_mode: ex.tempo_mode,
            is_alternating: ex.is_alternating,
          });
        }
        return playlist;
      }

      function getStats(nowDate) {
        var now = parseUtcDate(nowDate) || new Date();
        var mondayOffset = (now.getUTCDay() + 6) % 7;
        var startOfWeekMs =
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
          ) -
          mondayOffset * DAY_MS;

        var logsDesc = getLogsDesc();
        var workoutsThisWeek = 0;
        for (var i = 0; i < logsDesc.length; i++) {
          var dt = parseUtcDate(logsDesc[i].completed_at);
          if (dt && dt.getTime() >= startOfWeekMs) {
            workoutsThisWeek += 1;
          }
        }

        var totalWorkouts = logsDesc.length;
        var weekStreak = computeWeekStreak(logsDesc, now);

        var routines = hasActivePlan() ? state.plan.routines : [];
        var avgPlanIntensity;
        if (routines.length > 0) {
          var sumPct = 0;
          for (var r = 0; r < routines.length; r++) {
            sumPct += Math.max(
              50,
              100 + Math.trunc(Number(routines[r].intensity_level) || 0) * 10
            );
          }
          avgPlanIntensity = Math.round(sumPct / routines.length);
        } else if (logsDesc.length > 0) {
          avgPlanIntensity = logsDesc[0].intensity_percent;
        } else {
          avgPlanIntensity = 100;
        }

        var profName =
          state && state.profile && state.profile.name
            ? state.profile.name
            : "Athlete";
        var weeklyGoal = Math.max(
          1,
          state && state.profile
            ? Math.trunc(Number(state.profile.weekly_goal) || 3)
            : 3
        );

        var message;
        if (totalWorkouts === 0) {
          message = profName + " \u00b7 0/" + weeklyGoal;
        } else if (workoutsThisWeek >= weeklyGoal) {
          message =
            profName + " \u00b7 " + workoutsThisWeek + "/" + weeklyGoal + " \u2713";
        } else {
          message = profName + " \u00b7 " + workoutsThisWeek + "/" + weeklyGoal;
        }

        return {
          workouts_this_week: workoutsThisWeek,
          weekly_goal: weeklyGoal,
          total_workouts: totalWorkouts,
          week_streak: weekStreak,
          avg_plan_intensity: avgPlanIntensity,
          message: message,
        };
      }

      function getProgressSeries() {
        var logsDesc = getLogsDesc();
        if (logsDesc.length === 0) {
          return { labels: [], values: [] };
        }
        var chrono = logsDesc.slice().reverse();
        var labels = ["0"];
        var values = [100];
        for (var i = 0; i < chrono.length; i++) {
          labels.push("#" + (i + 1));
          values.push(chrono[i].intensity_percent);
        }
        return { labels: labels, values: values };
      }

      function searchCatalog(query, limit) {
        var maxItems =
          limit !== undefined && limit !== null
            ? Math.max(1, Math.trunc(Number(limit)) || 16)
            : 16;
        var cleanQ = String(query !== undefined && query !== null ? query : "")
          .trim();

        if (cleanQ) {
          var lowerQ = cleanQ.toLowerCase();
          var matches = [];
          for (var i = 0; i < exerciseList.length; i++) {
            var ex = exerciseList[i];
            var nLow = ex.name.toLowerCase();
            var idLow = ex.id.toLowerCase();
            if (nLow.indexOf(lowerQ) !== -1 || idLow.indexOf(lowerQ) !== -1) {
              matches.push({
                ex: ex,
                exactName: nLow === lowerQ ? 0 : 1,
                exactId: idLow === lowerQ ? 0 : 1,
              });
            }
          }
          matches.sort(function (a, b) {
            if (a.exactName !== b.exactName) return a.exactName - b.exactName;
            if (a.exactId !== b.exactId) return a.exactId - b.exactId;
            if (a.ex.name < b.ex.name) return -1;
            if (a.ex.name > b.ex.name) return 1;
            return 0;
          });
          return matches.slice(0, maxItems).map(function (m) {
            return decorateSearchExercise(m.ex);
          });
        }

        var eqTier =
          state && state.profile && state.profile.equipment
            ? state.profile.equipment
            : "body_only";
        var allowedSet = null;
        if (eqTier === "body_only") {
          allowedSet = new Set(BODYWEIGHT_AUX_EQUIPMENT);
        } else if (eqTier === "dumbbells") {
          allowedSet = new Set(
            ["dumbbell", "medicine ball"].concat(BODYWEIGHT_AUX_EQUIPMENT)
          );
        } else if (eqTier === "kettlebell_bands") {
          allowedSet = new Set(
            ["kettlebells", "bands"].concat(BODYWEIGHT_AUX_EQUIPMENT)
          );
        }

        var filtered = [];
        for (var j = 0; j < exerciseList.length; j++) {
          var cand = exerciseList[j];
          if (
            !allowedSet ||
            allowedSet.has(String(cand.equipment || "").toLowerCase())
          ) {
            filtered.push(cand);
          }
        }
        filtered.sort(function (a, b) {
          if (a.name < b.name) return -1;
          if (a.name > b.name) return 1;
          return 0;
        });
        return filtered.slice(0, maxItems).map(decorateSearchExercise);
      }

      function exportBackupJson(exportOpts) {
        if (!hasActivePlan()) {
          throw new Error("No active plan available to export.");
        }
        var cfg = exportOpts || {};
        var includeLogs = cfg.includeLogs !== false;
        var payload = {
          schema_version: 1,
          exported_at: new Date().toISOString(),
          profile: cloneProfile(state.profile),
          plan: clonePlan(state.plan),
          logs: includeLogs ? state.logs.map(cloneLog) : [],
        };
        return JSON.stringify(payload, null, 2);
      }

      function importBackupJson(jsonText, importOpts) {
        var cfg = importOpts || {};
        var mergeLogs = Boolean(cfg.mergeLogs);
        var parsed;

        if (typeof jsonText === "string") {
          if (jsonText.length > MAX_BACKUP_STRING_LENGTH) {
            throw new Error("Backup file exceeds maximum allowed size.");
          }
          parsed = JSON.parse(jsonText);
        } else if (
          jsonText &&
          typeof jsonText === "object" &&
          !Array.isArray(jsonText)
        ) {
          parsed = jsonText;
        } else {
          throw new Error("Invalid backup: expected JSON object string.");
        }

        var normalized = validateAndNormalizeImport(parsed, {
          exerciseMap: exerciseMap,
          fallbackSoundTheme: getSoundTheme(),
        });

        if (mergeLogs && state && Array.isArray(state.logs)) {
          normalized.logs = deduplicateAndSortLogs(
            normalized.logs.concat(state.logs)
          );
        }

        persistState(normalized);
        requestPersistentStorage();
        return cloneState(state);
      }

      async function encodeShareFragment() {
        if (!hasActivePlan()) {
          throw new Error("No active plan available to share.");
        }
        var p = state.profile;
        var pl = state.plan;
        var compact = {
          v: 1,
          p: [
            p.name,
            p.equipment,
            p.starting_intensity,
            p.weekly_goal,
            p.sound_theme,
          ],
          n: [pl.name, pl.description, pl.days_per_week, pl.last_routine_id],
          r: pl.routines.map(function (rt) {
            return [
              rt.id,
              rt.name,
              rt.intensity_level,
              rt.exercises.map(function (ex) {
                return [
                  ex.exercise_id,
                  ex.sets,
                  ex.base_reps,
                  ex.base_weight_kg,
                ];
              }),
            ];
          }),
        };

        var utf8Bytes = utf8Encode(JSON.stringify(compact));
        if (typeof CompressionStream === "function") {
          var compressed = await deflateRawBytes(utf8Bytes);
          return "#import=z." + bytesToBase64Url(compressed);
        }
        return "#import=j." + bytesToBase64Url(utf8Bytes);
      }

      async function decodeShareFragment(hashOrToken) {
        var raw = String(hashOrToken || "").trim();
        var hashIdx = raw.indexOf("#import=");
        if (hashIdx !== -1) {
          raw = raw.slice(hashIdx + 8);
        } else {
          if (raw.charAt(0) === "#") {
            raw = raw.slice(1);
          }
          if (raw.slice(0, 7) === "import=") {
            raw = raw.slice(7);
          }
        }
        raw = raw.trim();

        if (!raw || raw.length > MAX_DECOMPRESSED_BYTES * 2) {
          throw new Error("Invalid or oversized share token.");
        }

        var decodedBytes;
        if (raw.slice(0, 2) === "z.") {
          var compressed = base64UrlToBytes(raw.slice(2));
          if (compressed.byteLength === 0) {
            throw new Error("Empty compressed share token.");
          }
          decodedBytes = await inflateRawBytesBounded(
            compressed,
            MAX_DECOMPRESSED_BYTES
          );
        } else if (raw.slice(0, 2) === "j.") {
          decodedBytes = base64UrlToBytes(raw.slice(2));
          if (
            decodedBytes.byteLength === 0 ||
            decodedBytes.byteLength > MAX_DECOMPRESSED_BYTES
          ) {
            throw new Error("Invalid uncompressed share token size.");
          }
        } else {
          throw new Error("Unrecognized share token prefix.");
        }

        var jsonStr = utf8Decode(decodedBytes);
        var parsed = JSON.parse(jsonStr);
        var expanded = expandCompactShareObject(parsed);
        var normalized = validateAndNormalizeImport(expanded, {
          exerciseMap: exerciseMap,
          fallbackSoundTheme: getSoundTheme(),
        });

        var routineCount = normalized.plan.routines.length;
        var exerciseCount = 0;
        for (var i = 0; i < routineCount; i++) {
          exerciseCount += normalized.plan.routines[i].exercises.length;
        }

        return {
          state: cloneState(normalized),
          routineCount: routineCount,
          exerciseCount: exerciseCount,
          apply: function (applyOpts) {
            var keepExisting =
              !applyOpts || applyOpts.keepExistingLogs !== false;
            var nextState = cloneState(normalized);
            if (keepExisting && state && Array.isArray(state.logs)) {
              if (nextState.logs.length > 0) {
                nextState.logs = deduplicateAndSortLogs(
                  nextState.logs.concat(state.logs)
                );
              } else {
                nextState.logs = state.logs.map(cloneLog);
              }
            }
            persistState(nextState);
            requestPersistentStorage();
            return cloneState(state);
          },
        };
      }

      return {
        getState: getState,
        hasActivePlan: hasActivePlan,
        setupPlan: setupPlan,
        setSoundTheme: setSoundTheme,
        getSoundTheme: getSoundTheme,
        addWorkoutDay: addWorkoutDay,
        getRoutine: getRoutine,
        addExerciseToRoutine: addExerciseToRoutine,
        removeExerciseFromRoutine: removeExerciseFromRoutine,
        completeWorkout: completeWorkout,
        buildRoutineCards: buildRoutineCards,
        getNextRoutineCard: getNextRoutineCard,
        buildPlaylist: buildPlaylist,
        getStats: getStats,
        getLogsDesc: getLogsDesc,
        getProgressSeries: getProgressSeries,
        searchCatalog: searchCatalog,
        exportBackupJson: exportBackupJson,
        importBackupJson: importBackupJson,
        encodeShareFragment: encodeShareFragment,
        decodeShareFragment: decodeShareFragment,
      };
    }

    return Object.freeze({
      STORAGE_KEY: STORAGE_KEY,
      SOUND_STORAGE_KEY: SOUND_STORAGE_KEY,
      VALID_SOUND_THEMES: VALID_SOUND_THEMES,
      VALID_EQUIPMENT: VALID_EQUIPMENT,
      VALID_INTENSITY: VALID_INTENSITY,
      MAX_DECOMPRESSED_BYTES: MAX_DECOMPRESSED_BYTES,
      requestPersistentStorage: requestPersistentStorage,
      formatWeight: formatWeight,
      roundHalfKg: roundHalfKg,
      scaleInitialPrescription: scaleInitialPrescription,
      defaultPrescriptionForExercise: defaultPrescriptionForExercise,
      computeScaledTarget: computeScaledTarget,
      applyIntensityFeedback: applyIntensityFeedback,
      computeWeekStreak: computeWeekStreak,
      validateAndNormalizeImport: validateAndNormalizeImport,
      createStore: createStore,
    });
  }
);
