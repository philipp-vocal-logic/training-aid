import { DEFAULT_REST_SECONDS, clampRestSeconds, normalizeSpeedMode } from "./constants.js";
import { resolveEffectiveRepSeconds } from "./prescription.js";

export const COUNTDOWN_SECONDS = 3.0;

const DEFAULT_TURNAROUNDS = Object.freeze({
  standard: 0.43,
  explosive: 0.31,
  alternating: 0.5,
  hold: 1.0,
});

function defaultTurnaround(mode) {
  return DEFAULT_TURNAROUNDS[mode] ?? 0.43;
}

function formatReadout(done, ex) {
  if (!ex) return "0/0";
  return `${done}/${ex.reps}${ex.is_hold ? "s" : ""}`;
}

export function createWorkoutSession(options = {}) {
  const turnaroundFn = typeof options.turnaroundForMode === "function"
    ? options.turnaroundForMode
    : defaultTurnaround;
  let currentSpeedMode = normalizeSpeedMode(options.speedMode);
  let configuredRestSeconds = clampRestSeconds(options.restSeconds, DEFAULT_REST_SECONDS);

  const items = Array.isArray(options.playlist)
    ? options.playlist.map((raw) => {
        const cloned = structuredClone(raw);
        const baseRepSec = cloned.base_rep_seconds || cloned.rep_seconds;
        cloned.base_rep_seconds = baseRepSec;
        cloned.rep_seconds = resolveEffectiveRepSeconds(
          { rep_seconds: baseRepSec, is_hold: cloned.is_hold },
          currentSpeedMode,
        );
        return cloned;
      })
    : [];

  let state = items.length === 0 ? "FINISHED" : "IDLE";
  let paused = false;
  let exIdx = 0;
  let setNum = 1;
  let phaseElapsed = 0;
  let idleElapsed = 0;
  let activeRestTarget = configuredRestSeconds;
  let lastCountdownInt = null;
  let lastCompletedRep = 0;
  let midRepFiredForRep = -1;

  const currentEx = () => items[exIdx] || null;

  function computePose(ex) {
    if (state === "FINISHED" || !ex) return { kind: "none" };
    if (state === "IDLE") return { kind: "breath", phaseSec: idleElapsed };
    if (state === "COUNTDOWN" || state === "REST") return { kind: "breath", phaseSec: phaseElapsed };
    if (ex.is_hold) return { kind: "hold", phaseSec: phaseElapsed };

    const repFloat = phaseElapsed / ex.rep_seconds;
    const repIndex = Math.floor(repFloat);
    const frac = repFloat - repIndex;
    const mode = ex.tempo_mode || "standard";
    return {
      kind: "rep",
      frac,
      mode,
      swapSides: Boolean(ex.is_alternating && repIndex % 2 === 1),
      repIndex,
      isWorkPhase: frac < turnaroundFn(mode),
    };
  }

  function computeProgressPct(ex) {
    if (state === "FINISHED") return 100;
    if (state === "IDLE" || state === "COUNTDOWN" || !ex) return 0;
    if (state === "REST") {
      return activeRestTarget > 0
        ? Math.max(0, ((activeRestTarget - phaseElapsed) / activeRestTarget) * 100)
        : 0;
    }
    const totalSec = ex.reps * ex.rep_seconds;
    return totalSec > 0 ? Math.min(100, (phaseElapsed / totalSec) * 100) : 0;
  }

  function computeCueText(ex, pose) {
    if (paused) return "Paused";
    if (!ex || state === "FINISHED") return "";
    if (state === "IDLE") return ex.cue_work;
    if (state === "COUNTDOWN") return String(Math.max(1, Math.ceil(COUNTDOWN_SECONDS - phaseElapsed)));
    if (state === "REST") {
      const rem = Math.max(0, Math.ceil(activeRestTarget - phaseElapsed));
      return rem <= 3 && rem > 0 ? String(rem) : `Rest \u00b7 ${ex.name}`;
    }
    if (ex.is_hold) return Math.floor(phaseElapsed / 2) % 2 === 0 ? ex.cue_work : ex.cue_return;
    return pose.isWorkPhase ? ex.cue_work : ex.cue_return;
  }

  function computeReadoutText(ex) {
    if (!ex) return "0/0";
    if (state === "IDLE" || state === "COUNTDOWN") return formatReadout(0, ex);
    if (state === "REST") return `${Math.max(0, Math.ceil(activeRestTarget - phaseElapsed))}s`;
    if (state === "FINISHED") return formatReadout(ex.reps, ex);
    const done = Math.min(ex.reps, Math.floor(phaseElapsed / ex.rep_seconds));
    return formatReadout(done, ex);
  }

  function getSnapshot() {
    const ex = currentEx();
    const pose = computePose(ex);
    return {
      state,
      paused,
      exIdx,
      setNum,
      totalExercises: items.length,
      currentExercise: ex ? structuredClone(ex) : null,
      phaseElapsed,
      activeRestTarget,
      configuredRestSeconds,
      speedMode: currentSpeedMode,
      progressPct: computeProgressPct(ex),
      cueText: computeCueText(ex, pose),
      readoutText: computeReadoutText(ex),
      stepLabel: ex ? `${exIdx + 1}/${items.length} \u00b7 S${setNum}/${ex.sets}` : "0/0",
      canSkipWait: state === "COUNTDOWN" || state === "REST",
      canExtendRest: state === "REST",
      pose,
    };
  }

  function enterCountdown(events) {
    const ex = currentEx();
    state = "COUNTDOWN";
    paused = false;
    phaseElapsed = 0;
    lastCountdownInt = 3;
    events.push({ type: "exerciseChanged", exIdx, setNum, exercise: structuredClone(ex) });
    events.push({ type: "resumeAudio" });
    events.push({
      type: "beginPhase",
      phase: "COUNTDOWN",
      opts: { countdownSeconds: COUNTDOWN_SECONDS, repSeconds: ex.rep_seconds },
    });
    events.push({ type: "countdown", remaining: 3 });
  }

  function enterActiveSet(events) {
    const ex = currentEx();
    const mode = ex.tempo_mode || "standard";
    state = "ACTIVE";
    paused = false;
    phaseElapsed = 0;
    lastCompletedRep = 0;
    midRepFiredForRep = -1;
    events.push({
      type: "beginPhase",
      phase: "ACTIVE",
      opts: {
        repSeconds: ex.rep_seconds,
        reps: ex.reps,
        tempoMode: mode,
        turnaround: turnaroundFn(mode),
        isHold: Boolean(ex.is_hold),
      },
    });
    events.push({ type: "startSignal" });
  }

  function finishCurrentSet(events) {
    const completedEx = currentEx();
    events.push({ type: "popCounter" });
    if (setNum < completedEx.sets) setNum += 1;
    else if (exIdx + 1 < items.length) {
      exIdx += 1;
      setNum = 1;
    } else {
      state = "FINISHED";
      phaseElapsed = 0;
      events.push({ type: "beginPhase", phase: "FINISHED", opts: {} });
      events.push({ type: "workoutComplete" });
      return;
    }

    activeRestTarget = configuredRestSeconds;
    state = "REST";
    phaseElapsed = 0;
    lastCountdownInt = null;
    events.push({ type: "exerciseChanged", exIdx, setNum, exercise: structuredClone(currentEx()) });
    events.push({ type: "beginPhase", phase: "REST", opts: { restSeconds: activeRestTarget } });
    events.push({ type: "stopSet" });
  }

  function togglePlayPause() {
    const events = [];
    if (state === "IDLE") {
      enterCountdown(events);
      return { snapshot: getSnapshot(), events };
    }
    if (state === "FINISHED") return { snapshot: getSnapshot(), events };
    paused = !paused;
    events.push({ type: paused ? "pauseAudio" : "resumeAudio" });
    return { snapshot: getSnapshot(), events };
  }

  function skipWait() {
    const events = [];
    if (state !== "COUNTDOWN" && state !== "REST") return { snapshot: getSnapshot(), events };
    if (paused) {
      events.push({ type: "stopAllAudio" });
      paused = false;
      events.push({ type: "resumeAudio" });
    }
    enterActiveSet(events);
    return { snapshot: getSnapshot(), events };
  }

  function extendRest(deltaSec = 15) {
    const events = [];
    if (state !== "REST") return { snapshot: getSnapshot(), events };
    activeRestTarget = Math.min(300, activeRestTarget + Math.max(0, Number(deltaSec) || 0));
    lastCountdownInt = null;
    events.push({ type: "retimePhase", opts: { restSeconds: activeRestTarget } });
    return { snapshot: getSnapshot(), events };
  }

  function setSpeedMode(nextMode) {
    const events = [];
    currentSpeedMode = normalizeSpeedMode(nextMode, currentSpeedMode);
    const activeEx = currentEx();
    const oldRepSec = activeEx ? activeEx.rep_seconds : 0;
    for (const item of items) {
      item.rep_seconds = resolveEffectiveRepSeconds(
        { rep_seconds: item.base_rep_seconds || item.rep_seconds, is_hold: item.is_hold },
        currentSpeedMode,
      );
    }
    if (state === "ACTIVE" && activeEx && !activeEx.is_hold && oldRepSec > 0) {
      phaseElapsed = (phaseElapsed / oldRepSec) * activeEx.rep_seconds;
      events.push({ type: "retimePhase", opts: { repSeconds: activeEx.rep_seconds }, nextElapsed: phaseElapsed });
    }
    return { snapshot: getSnapshot(), events };
  }

  function setRestSeconds(nextSec) {
    const events = [];
    configuredRestSeconds = clampRestSeconds(nextSec, configuredRestSeconds);
    if (state === "REST") {
      activeRestTarget = Math.max(Math.ceil(phaseElapsed) + 1, configuredRestSeconds);
      events.push({ type: "retimePhase", opts: { restSeconds: activeRestTarget } });
    }
    return { snapshot: getSnapshot(), events };
  }

  function advance(value, { absolute = false } = {}) {
    const events = [];
    if (paused || state === "FINISHED") return { snapshot: getSnapshot(), events };
    const num = Math.max(0, Number(value) || 0);
    if (state === "IDLE") {
      idleElapsed = absolute ? num : idleElapsed + num;
      return { snapshot: getSnapshot(), events };
    }

    phaseElapsed = Math.max(0, absolute ? num : phaseElapsed + num);
    if (state === "COUNTDOWN") {
      const rem = Math.ceil(COUNTDOWN_SECONDS - phaseElapsed);
      if (rem >= 1 && rem !== lastCountdownInt) {
        lastCountdownInt = rem;
        events.push({ type: "countdown", remaining: rem });
      }
      if (phaseElapsed >= COUNTDOWN_SECONDS) enterActiveSet(events);
      return { snapshot: getSnapshot(), events };
    }

    if (state === "ACTIVE") {
      const ex = currentEx();
      const totalSec = ex.reps * ex.rep_seconds;
      if (phaseElapsed >= totalSec) {
        finishCurrentSet(events);
        return { snapshot: getSnapshot(), events };
      }

      const repFloat = phaseElapsed / ex.rep_seconds;
      const completed = Math.min(ex.reps, Math.floor(repFloat));
      const repIndex = Math.floor(repFloat);
      if (!ex.is_hold) {
        const frac = repFloat - repIndex;
        const mode = ex.tempo_mode || "standard";
        const isWorkPhase = frac < turnaroundFn(mode);
        if (!isWorkPhase && midRepFiredForRep < repIndex && repIndex < ex.reps) {
          midRepFiredForRep = repIndex;
          events.push({ type: "midRep", repIndex });
        }
      }
      if (completed > lastCompletedRep) {
        lastCompletedRep = completed;
        events.push({ type: "popCounter" });
        if (completed < ex.reps) {
          if (ex.is_hold) events.push({ type: "holdTick", remaining: ex.reps - completed });
          else events.push({ type: "repDone", completed, total: ex.reps });
        }
      }
      return { snapshot: getSnapshot(), events };
    }

    if (state === "REST") {
      const restRem = Math.max(0, Math.ceil(activeRestTarget - phaseElapsed));
      if (restRem <= 3 && restRem >= 1 && restRem !== lastCountdownInt) {
        lastCountdownInt = restRem;
        events.push({ type: "countdown", remaining: restRem });
      }
      if (phaseElapsed >= activeRestTarget) enterActiveSet(events);
    }
    return { snapshot: getSnapshot(), events };
  }

  return {
    getPlaylist: () => structuredClone(items),
    getSnapshot,
    togglePlayPause,
    skipWait,
    extendRest,
    setSpeedMode,
    setRestSeconds,
    advance,
  };
}
