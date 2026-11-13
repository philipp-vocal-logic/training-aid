import {
  buildRepPattern,
  buildRestPadEvent,
  resolveCueEvents,
  resolveTurnaroundDefault,
  subdivisionsForRep,
} from "./pattern.js";
import { THEMES, THEME_PRESETS, TIMING, VALID_SOUND_THEMES, VOICES } from "./presets.js";
import { createMasterBus, triggerVoice } from "./synth.js";

export { THEMES, VALID_SOUND_THEMES, subdivisionsForRep, buildRepPattern };

const validThemeSet = new Set(VALID_SOUND_THEMES);

export function createController(options) {
  const opts = options || {};
  const win = opts.windowObj || (typeof window !== "undefined" ? window : globalThis);
  const getNav = () =>
    opts.navigatorObj !== undefined
      ? opts.navigatorObj
      : (typeof navigator !== "undefined" ? navigator : win?.navigator || null);
  const turnaroundFn = typeof opts.turnaroundForMode === "function"
    ? opts.turnaroundForMode
    : resolveTurnaroundDefault;
  const initialTheme = opts.theme || opts.initialTheme;

  function syncAudioSession(active) {
    const nav = getNav();
    if (!nav?.audioSession) return;
    try {
      nav.audioSession.type = active ? "playback" : "auto";
    } catch {
      /* ignore */
    }
  }

  let currentTheme = validThemeSet.has(initialTheme) ? initialTheme : "minimal";
  let lastActiveTheme = currentTheme !== "off" ? currentTheme : "minimal";
  let audioCtx = null;
  let masterBus = null;
  let masterBusCtx = null;

  const scheduledEntries = new Set();
  const cueEntries = new Set();
  let phaseName = "IDLE";
  let phaseOpts = {};
  let phaseElapsed = 0;
  let paused = false;
  let audioAnchorTime = null;
  let scheduledUntilSec = -0.0001;

  function registerVoice(part, bucket) {
    if (!part?.sources?.length) return;
    const entry = { sources: part.sources, nodes: part.nodes, bucket };
    bucket.add(entry);
    let remaining = entry.sources.length;
    const handleEnded = () => {
      remaining -= 1;
      if (remaining <= 0 && bucket.has(entry)) {
        bucket.delete(entry);
        for (const node of entry.nodes) {
          try { node?.disconnect?.(); } catch { /* ignore */ }
        }
      }
    };
    for (const src of entry.sources) src.onended = handleEnded;
  }

  function stopBucket(bucket) {
    const list = Array.from(bucket);
    bucket.clear();
    for (const entry of list) {
      for (const src of entry.sources) {
        if (!src) continue;
        src.onended = null;
        try { src.stop?.(); } catch { /* ignore */ }
      }
      for (const node of entry.nodes) {
        try { node?.disconnect?.(); } catch { /* ignore */ }
      }
    }
  }

  function stopScheduledNodes() {
    stopBucket(scheduledEntries);
  }

  function stopAllNodes() {
    stopBucket(scheduledEntries);
    stopBucket(cueEntries);
    if (masterBus) {
      try { masterBus.disconnect?.(); } catch { /* ignore */ }
      masterBus = null;
      masterBusCtx = null;
    }
  }

  function getOutputNode(ctx) {
    if (!masterBus || masterBusCtx !== ctx) {
      masterBus = createMasterBus(ctx, TIMING.MASTER_GAIN);
      masterBusCtx = ctx;
    }
    return masterBus || ctx.destination;
  }

  function scheduleVoiceEvent(ctx, startAt, ev, bucket) {
    const voiceSpec = VOICES[ev.voice];
    if (!voiceSpec) return;
    const part = triggerVoice(ctx, getOutputNode(ctx), startAt, voiceSpec, ev);
    registerVoice(part, bucket);
  }

  function scheduleLookahead() {
    if (paused || !THEME_PRESETS[currentTheme] || !audioCtx || audioCtx.state !== "running") return;
    const horizon = phaseElapsed + TIMING.LOOKAHEAD_SEC;
    if (horizon <= scheduledUntilSec) return;
    const windowStart = Math.max(scheduledUntilSec, phaseElapsed - 0.06);
    const nowAudio = audioCtx.currentTime;

    if (phaseName === "ACTIVE") {
      const isHold = Boolean(phaseOpts.isHold);
      const repSec = phaseOpts.repSeconds > 0 ? Number(phaseOpts.repSeconds) : (isHold ? 1.0 : 2.6);
      const totalReps = Math.max(0, Math.floor(Number(phaseOpts.reps) || 0));
      const tempoMode = phaseOpts.tempoMode || (isHold ? "hold" : "standard");
      const turnaround = phaseOpts.turnaround !== undefined && phaseOpts.turnaround !== null
        ? Number(phaseOpts.turnaround)
        : turnaroundFn(tempoMode);
      const startRep = Math.max(0, Math.floor(windowStart / repSec));
      let endRep = Math.floor(horizon / repSec);
      if (totalReps > 0 && endRep >= totalReps) endRep = totalReps - 1;

      for (let r = startRep; r <= endRep; r++) {
        const repEvents = buildRepPattern({
          theme: currentTheme,
          repSeconds: repSec,
          tempoMode,
          turnaround,
          isHold,
          repIndex: r,
          totalReps,
        });
        for (const ev of repEvents) {
          const absSec = r * repSec + ev.offsetSec;
          if (absSec > windowStart && absSec <= horizon) {
            const startAt = audioAnchorTime !== null
              ? Math.max(nowAudio, audioAnchorTime + absSec)
              : nowAudio + Math.max(0, absSec - phaseElapsed);
            scheduleVoiceEvent(audioCtx, startAt, ev, scheduledEntries);
          }
        }
      }
    } else if (phaseName === "REST") {
      const restSec = phaseOpts.restSeconds > 0 ? Number(phaseOpts.restSeconds) : 20;
      const interval = TIMING.REST_PULSE_INTERVAL_SEC;
      const firstPulse = Math.max(0, Math.floor(windowStart / interval));
      const lastPulse = Math.floor(horizon / interval);
      for (let p = firstPulse; p <= lastPulse; p++) {
        const pulseSec = p * interval;
        if (pulseSec >= restSec) break;
        if (pulseSec > windowStart && pulseSec <= horizon) {
          const padEv = buildRestPadEvent(currentTheme, p);
          if (padEv) {
            const padStart = audioAnchorTime !== null
              ? Math.max(nowAudio, audioAnchorTime + pulseSec)
              : nowAudio + Math.max(0, pulseSec - phaseElapsed);
            scheduleVoiceEvent(audioCtx, padStart, padEv, scheduledEntries);
          }
        }
      }
    }
    scheduledUntilSec = horizon;
  }

  function resumeAudioContext(ctx) {
    if (!ctx || ctx.state !== "suspended" || typeof ctx.resume !== "function") return;
    try {
      Promise.resolve(ctx.resume())
        .then(() => {
          if (!paused && currentTheme !== "off" && audioCtx === ctx && ctx.state === "running") {
            if (audioAnchorTime === null) audioAnchorTime = ctx.currentTime - phaseElapsed;
            if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
          }
        })
        .catch(() => {});
    } catch { /* ignore */ }
  }

  function ensureAudio() {
    if (currentTheme === "off") return null;
    syncAudioSession(true);
    if (!audioCtx) {
      try {
        if (typeof opts.audioContextFactory === "function") audioCtx = opts.audioContextFactory();
        else {
          const Ctx = win && (win.AudioContext || win.webkitAudioContext);
          if (!Ctx) return null;
          audioCtx = new Ctx();
        }
      } catch {
        audioCtx = null;
        return null;
      }
    }
    if (!audioCtx) return null;
    resumeAudioContext(audioCtx);
    if (!paused && audioCtx.state === "running" && audioAnchorTime === null) {
      audioAnchorTime = audioCtx.currentTime - phaseElapsed;
      if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
    }
    return audioCtx;
  }

  const getTheme = () => currentTheme;
  const isMuted = () => currentTheme === "off";

  function setTheme(themeId) {
    if (!themeId || !validThemeSet.has(themeId)) return currentTheme;
    if (themeId !== "off") lastActiveTheme = themeId;
    if (themeId === "off") syncAudioSession(false);
    if (themeId === currentTheme) return currentTheme;
    if (!paused && currentTheme !== "off" && audioAnchorTime !== null && audioCtx?.state === "running") {
      phaseElapsed = Math.max(phaseElapsed, audioCtx.currentTime - audioAnchorTime);
    }
    stopAllNodes();
    currentTheme = themeId;
    scheduledUntilSec = phaseElapsed - 0.0001;
    if (currentTheme === "off") audioAnchorTime = null;
    else {
      if (audioCtx) syncAudioSession(true);
      if (!paused && audioCtx?.state === "running") {
        audioAnchorTime = audioCtx.currentTime - phaseElapsed;
        if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
      } else {
        audioAnchorTime = null;
      }
    }
    return currentTheme;
  }

  const toggleMute = () => (currentTheme === "off" ? setTheme(lastActiveTheme || "minimal") : setTheme("off"));

  function beginPhase(nextPhase, nextOpts) {
    stopScheduledNodes();
    phaseName = nextPhase || "IDLE";
    phaseOpts = nextOpts ? { ...nextOpts } : {};
    paused = false;
    phaseElapsed = 0;
    scheduledUntilSec = -0.0001;
    if (currentTheme !== "off") resumeAudioContext(audioCtx);
    if (currentTheme !== "off" && audioCtx?.state === "running") {
      audioAnchorTime = audioCtx.currentTime;
      if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
    } else {
      audioAnchorTime = null;
    }
  }

  function retimePhase(nextOpts, nextElapsed) {
    stopScheduledNodes();
    if (nextOpts) phaseOpts = { ...phaseOpts, ...nextOpts };
    if (typeof nextElapsed === "number" && Number.isFinite(nextElapsed) && nextElapsed >= 0) {
      phaseElapsed = nextElapsed;
    } else if (!paused && currentTheme !== "off" && audioAnchorTime !== null && audioCtx?.state === "running") {
      phaseElapsed = Math.max(phaseElapsed, audioCtx.currentTime - audioAnchorTime);
    }
    scheduledUntilSec = phaseElapsed - 0.0001;
    if (!paused && currentTheme !== "off" && audioCtx?.state === "running") {
      audioAnchorTime = audioCtx.currentTime - phaseElapsed;
      if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
    } else {
      audioAnchorTime = null;
    }
  }

  function advancePhase(dtFallbackSec) {
    const dt = Math.max(0, Number(dtFallbackSec) || 0);
    if (paused) return phaseElapsed;
    if (currentTheme !== "off" && audioCtx?.state === "running") {
      if (audioAnchorTime === null) {
        phaseElapsed += dt;
        audioAnchorTime = audioCtx.currentTime - phaseElapsed;
      } else {
        phaseElapsed = Math.max(phaseElapsed, audioCtx.currentTime - audioAnchorTime);
      }
      if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
      return phaseElapsed;
    }
    audioAnchorTime = null;
    phaseElapsed += dt;
    return phaseElapsed;
  }

  function pause() {
    if (!paused) {
      if (currentTheme !== "off" && audioAnchorTime !== null && audioCtx?.state === "running") {
        phaseElapsed = Math.max(phaseElapsed, audioCtx.currentTime - audioAnchorTime);
      }
      paused = true;
      audioAnchorTime = null;
    }
    stopAllNodes();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    scheduledUntilSec = phaseElapsed - 0.0001;
    if (currentTheme !== "off") {
      ensureAudio();
      if (audioCtx?.state === "running") {
        audioAnchorTime = audioCtx.currentTime - phaseElapsed;
        if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
      }
    }
  }

  const stopAll = () => {
    audioAnchorTime = null;
    stopAllNodes();
    syncAudioSession(false);
  };

  function playCue(cueName, params) {
    const steps = resolveCueEvents(currentTheme, cueName, params);
    if (steps.length === 0) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    for (const step of steps) {
      scheduleVoiceEvent(ctx, ctx.currentTime + (step.delaySec || 0), step, cueEntries);
    }
  }

  return {
    getTheme,
    setTheme,
    toggleMute,
    isMuted,
    ensureAudio,
    beginPhase,
    retimePhase,
    advancePhase,
    pause,
    resume,
    stopAll,
    countdown: (rem) => playCue("countdown", { remaining: rem }),
    startSignal: () => playCue("startSignal"),
    midRep: () => playCue("midRep"),
    repDone: (rep, total) => playCue("repDone", { rep, total }),
    holdTick: (remaining) => playCue("holdTick", { remaining }),
    stopSet: () => playCue("stopSet"),
    workoutComplete: () => playCue("workoutComplete"),
  };
}
