(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingSound = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const LOOKAHEAD_SEC = 0.14, FLAM_GUARD_SEC = 0.055, REST_PULSE_INTERVAL_SEC = 2.0;
  const THEMES = Object.freeze([
    Object.freeze({ id: "off", label: "Off" }),
    Object.freeze({ id: "minimal", label: "Minimal Cues" }),
    Object.freeze({ id: "techno", label: "Techno Pulse" }),
    Object.freeze({ id: "trance", label: "Trance Arp" }),
    Object.freeze({ id: "studio", label: "Studio Kit" }),
  ]);
  const VALID_THEMES = Object.freeze({ off: true, minimal: true, techno: true, trance: true, studio: true });

  // Cohesive A minor / C major relative harmonic palette (Hz)
  const SCALE = Object.freeze({
    A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, G3: 196, A3: 220,
    C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25,
  });
  const FALLBACK_TURNAROUNDS = Object.freeze({ standard: 0.43, explosive: 0.31, alternating: 0.5, hold: 1.0 });

  const TECHNO_BASS_STEPS = [SCALE.A2, SCALE.A2, SCALE.C3, SCALE.E3, SCALE.D3, SCALE.E3, SCALE.G3, SCALE.A3];
  const TECHNO_BASS_FINAL = [SCALE.C3, SCALE.E3, SCALE.G3, SCALE.A3, SCALE.E3, SCALE.G3, SCALE.A3, SCALE.C4];
  const TRANCE_ROOTS = [SCALE.A3, SCALE.G3, SCALE.E3, SCALE.G3];
  const TRANCE_FINAL_ROOTS = [SCALE.C4, SCALE.D4, SCALE.E4, SCALE.A4];
  const TRANCE_ARP_STEPS = [SCALE.A3, SCALE.C4, SCALE.E4, SCALE.G4, SCALE.A4, SCALE.G4, SCALE.E4, SCALE.D4];
  const TRANCE_ARP_FINAL = [SCALE.C4, SCALE.E4, SCALE.G4, SCALE.A4, SCALE.C5, SCALE.E5, SCALE.C5, SCALE.A4];

  const THEME_PATTERNS = Object.freeze({
    techno: {
      downbeat(isHold, repIdx, isFinal) {
        const acc = isHold && repIdx % 4 === 0;
        return isHold
          ? ["kick_bass", isFinal ? SCALE.D3 : acc ? SCALE.C3 : SCALE.A2, 45, 0.18, isFinal ? 0.19 : acc ? 0.15 : 0.1, isFinal ? 520 : acc ? 380 : 280]
          : ["kick_bass", isFinal ? SCALE.C3 : SCALE.A2, 42, 0.22, isFinal ? 0.26 : 0.22, isFinal ? 640 : 420];
      },
      turnaround: (isFinal) => ["clap", isFinal ? SCALE.C4 : SCALE.A3, SCALE.E3, 0.13, isFinal ? 0.22 : 0.18, isFinal ? 2200 : 1700],
      subdivision(stepIdx, subdivs, isHold, isFinal) {
        if (isHold) return ["hat", SCALE.E4, SCALE.A3, 0.045, isFinal ? 0.08 : 0.05, isFinal ? 6800 : 5400];
        if (subdivs === 4 ? stepIdx === 1 : stepIdx % 2 === 0) {
          const f = (isFinal ? TECHNO_BASS_FINAL : TECHNO_BASS_STEPS)[stepIdx % 8];
          return ["bass", f, f, 0.13, isFinal ? 0.16 : 0.13, isFinal ? 820 : 540];
        }
        return ["hat", isFinal ? SCALE.A4 : SCALE.E4, SCALE.A3, 0.055, isFinal ? 0.11 : 0.085, isFinal ? 7600 : 6200];
      },
      restChords: [[SCALE.A2, SCALE.E3], [SCALE.C3, SCALE.G3]],
    },
    trance: {
      downbeat(isHold, repIdx, isFinal) {
        const acc = isHold && repIdx % 4 === 0;
        if (isHold) return ["kick_arp", isFinal ? SCALE.E4 : acc ? SCALE.C4 : SCALE.A3, 45, 0.22, isFinal ? 0.18 : acc ? 0.14 : 0.1, isFinal ? 1600 : acc ? 1150 : 850];
        const rootNote = (isFinal ? TRANCE_FINAL_ROOTS : TRANCE_ROOTS)[repIdx % 4];
        return ["kick_arp", rootNote, 42, 0.24, isFinal ? 0.25 : 0.21, isFinal ? 1850 : 1250];
      },
      turnaround: (isFinal) => ["pluck", isFinal ? SCALE.E5 : SCALE.C5, isFinal ? SCALE.C5 : SCALE.A4, 0.18, isFinal ? 0.23 : 0.19, isFinal ? 3200 : 2400],
      subdivision(stepIdx, _subdivs, isHold, isFinal) {
        const f = isHold ? (isFinal ? SCALE.A4 : SCALE.E4) : (isFinal ? TRANCE_ARP_FINAL : TRANCE_ARP_STEPS)[stepIdx % 8];
        return isHold ? ["arp", f, f, 0.16, isFinal ? 0.11 : 0.07, isFinal ? 1350 : 920] : ["arp", f, f, 0.14, isFinal ? 0.15 : 0.12, isFinal ? 2150 : 1500];
      },
      restChords: [[SCALE.A3, SCALE.E4], [SCALE.C4, SCALE.G4]],
    },
    studio: {
      downbeat(isHold, repIdx, isFinal) {
        const acc = isHold && repIdx % 4 === 0;
        return isHold
          ? ["kick", isFinal ? SCALE.D3 : SCALE.C3, 48, 0.15, isFinal ? 0.18 : acc ? 0.14 : 0.09, isFinal ? 950 : acc ? 720 : 560]
          : ["kick", isFinal ? SCALE.D3 : SCALE.C3, 48, 0.19, isFinal ? 0.26 : 0.22, isFinal ? 1150 : 820];
      },
      turnaround: (isFinal) => ["snare", isFinal ? SCALE.A3 : SCALE.G3, SCALE.C3, 0.14, isFinal ? 0.23 : 0.19, isFinal ? 2600 : 2000],
      subdivision(stepIdx, subdivs, isHold, isFinal) {
        if (isHold) return ["shaker", SCALE.G4, SCALE.C4, 0.045, isFinal ? 0.08 : 0.045, isFinal ? 5800 : 4800];
        return (subdivs === 4 ? stepIdx === 3 : stepIdx % 2 === 0)
          ? ["rim", isFinal ? SCALE.C5 : SCALE.A4, SCALE.E4, 0.05, isFinal ? 0.13 : 0.1, isFinal ? 3200 : 2500]
          : ["shaker", isFinal ? SCALE.A4 : SCALE.G4, SCALE.C4, 0.05, isFinal ? 0.1 : 0.075, isFinal ? 6800 : 5400];
      },
      restChords: [[SCALE.C3, SCALE.G3], [SCALE.G3, SCALE.D4]],
    },
  });

  const VOICE_SPECS = Object.freeze({
    kick_bass: { kind: "kick_bass" }, kick_arp: { kind: "kick_arp" }, kick: { kind: "kick" },
    bass: { kind: "bass" }, arp: { kind: "arp" }, pluck: { kind: "arp" },
    hat: { kind: "noise", filterType: "highpass", q: 0.9 },
    shaker: { kind: "noise", filterType: "bandpass", q: 1.6 },
    clap: { kind: "hit", q: 1.8 }, snare: { kind: "hit", q: 1.2 }, rim: { kind: "hit", q: 3.2 },
  });

  const resolveTurnaroundDefault = (tempoMode) =>
    typeof root?.TrainingMotion?.turnaroundForMode === "function"
      ? root.TrainingMotion.turnaroundForMode(tempoMode) : FALLBACK_TURNAROUNDS[tempoMode] ?? 0.43;
  const round4 = (val) => Number(val.toFixed(4));
  const subdivisionsForRep = (repSeconds, isHold) => (isHold ? 2 : Number(repSeconds) >= 2.4 ? 8 : 4);
  const toEvent = (offsetSec, role, [voice, freq, endFreq, durSec, gain, filterFreq], isFinalStretch) => ({
    offsetSec, role, voice, freq, endFreq, durSec, gain, filterFreq, isFinalStretch,
  });

  function buildRepPattern(opts) {
    const cfg = opts || {}, spec = THEME_PATTERNS[cfg.theme || "minimal"];
    if (!spec) return [];
    const isHold = Boolean(cfg.isHold), repSeconds = cfg.repSeconds > 0 ? Number(cfg.repSeconds) : isHold ? 1.0 : 2.6;
    const tempoMode = cfg.tempoMode || (isHold ? "hold" : "standard");
    let turnaround = cfg.turnaround !== undefined && cfg.turnaround !== null ? Number(cfg.turnaround) : resolveTurnaroundDefault(tempoMode);
    if (!Number.isFinite(turnaround)) turnaround = 0.43;
    const repIndex = Math.max(0, Math.floor(Number(cfg.repIndex) || 0)), totalReps = Math.max(0, Math.floor(Number(cfg.totalReps) || 0));
    const isFinalStretch = Boolean(totalReps && totalReps - repIndex <= (isHold ? 3 : 2));
    const subdivs = subdivisionsForRep(repSeconds, isHold);
    const turnaroundOffset = !isHold ? round4(turnaround * repSeconds) : -1;
    const hasTurnaround = !isHold && turnaroundOffset > 0 && turnaroundOffset < repSeconds;

    const events = [toEvent(0, "downbeat", spec.downbeat(isHold, repIndex, isFinalStretch), isFinalStretch)];
    for (let i = 1; i < subdivs; i++) {
      const subOffset = round4((i * repSeconds) / subdivs);
      if (subOffset <= 0 || subOffset >= repSeconds) continue;
      if (hasTurnaround && Math.abs(subOffset - turnaroundOffset) < FLAM_GUARD_SEC) continue;
      events.push(toEvent(subOffset, "subdivision", spec.subdivision(i, subdivs, isHold, isFinalStretch), isFinalStretch));
    }
    if (hasTurnaround) events.push(toEvent(turnaroundOffset, "turnaround", spec.turnaround(isFinalStretch), isFinalStretch));
    return events.sort((a, b) => a.offsetSec - b.offsetSec);
  }

  const setParamAt = (param, val, time) => {
    if (!param) return;
    if (typeof param.setValueAtTime === "function") param.setValueAtTime(val, time); else param.value = val;
  };
  const linearRampParam = (param, val, time) => {
    if (!param) return;
    if (typeof param.linearRampToValueAtTime === "function") param.linearRampToValueAtTime(val, time); else setParamAt(param, val, time);
  };
  const expRampParam = (param, val, time) => {
    const safeVal = Math.max(0.0001, val);
    if (!param) return;
    if (typeof param.exponentialRampToValueAtTime === "function") param.exponentialRampToValueAtTime(safeVal, time); else linearRampParam(param, safeVal, time);
  };
  const envGain = (ctx, start, peak, attack, dur) => {
    const g = ctx.createGain();
    setParamAt(g.gain, 0.0001, start); linearRampParam(g.gain, peak, start + attack); expRampParam(g.gain, 0.0001, start + dur);
    return g;
  };

  function createFilterNode(ctx, type, freq, qVal, start) {
    if (typeof ctx.createBiquadFilter !== "function") return null;
    const filter = ctx.createBiquadFilter();
    filter.type = type; setParamAt(filter.frequency, freq, start);
    if (qVal !== undefined && filter.Q !== undefined) {
      if (typeof filter.Q === "object") setParamAt(filter.Q, qVal, start); else filter.Q = qVal;
    }
    return filter;
  }

  function buildWhiteNoiseBuffer(ctx) {
    if (typeof ctx.createBuffer !== "function") return null;
    const sampleRate = ctx.sampleRate || 44100, length = Math.max(1, Math.floor(sampleRate * 0.4));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    if (typeof buffer.getChannelData === "function") {
      const data = buffer.getChannelData(0);
      let seed = 0x5f3759df;
      for (let i = 0; i < length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1.0; }
    }
    return buffer;
  }

  function createController(options) {
    const opts = options || {}, win = opts.windowObj || root;
    const turnaroundFn = typeof opts.turnaroundForMode === "function" ? opts.turnaroundForMode : resolveTurnaroundDefault;
    const initialTheme = opts.theme || opts.initialTheme;
    let currentTheme = VALID_THEMES[initialTheme] ? initialTheme : "minimal";
    let lastActiveTheme = currentTheme !== "off" ? currentTheme : "minimal";
    let audioCtx = null, noiseBuffer = null, noiseBufferCtx = null;
    const scheduledEntries = new Set(), cueEntries = new Set();
    let phaseName = "IDLE", phaseOpts = {}, phaseElapsed = 0, paused = false;
    let audioAnchorTime = null, scheduledUntilSec = -0.0001;

    function registerVoice(sources, nodes, bucket) {
      const entry = { sources, nodes, bucket };
      bucket.add(entry);
      let remaining = sources.length;
      if (remaining === 0) { bucket.delete(entry); return; }
      const handleEnded = () => {
        remaining -= 1;
        if (remaining <= 0 && bucket.has(entry)) {
          bucket.delete(entry);
          for (const node of nodes) { try { if (typeof node?.disconnect === "function") node.disconnect(); } catch { /* ignore */ } }
        }
      };
      for (const src of sources) src.onended = handleEnded;
    }

    function stopBucket(bucket) {
      const list = Array.from(bucket);
      bucket.clear();
      for (const entry of list) {
        for (const src of entry.sources) {
          if (!src) continue;
          src.onended = null;
          try { if (typeof src.stop === "function") src.stop(); } catch { /* ignore */ }
        }
        for (const node of entry.nodes) { try { if (typeof node?.disconnect === "function") node.disconnect(); } catch { /* ignore */ } }
      }
    }

    const stopScheduledNodes = () => { stopBucket(scheduledEntries); };
    const stopAllNodes = () => { stopBucket(scheduledEntries); stopBucket(cueEntries); };
    const connectChain = (source, filter, gain, dest) => {
      if (filter) { source.connect(filter); filter.connect(gain); } else source.connect(gain);
      gain.connect(dest);
    };

    function createNoiseSource(ctx, start, stopAt) {
      if (!noiseBuffer || noiseBufferCtx !== ctx) { noiseBuffer = buildWhiteNoiseBuffer(ctx); noiseBufferCtx = ctx; }
      if (noiseBuffer && typeof ctx.createBufferSource === "function") {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer; src.start(start); src.stop(stopAt);
        return src;
      }
      const fallbackOsc = ctx.createOscillator();
      fallbackOsc.type = "triangle"; setParamAt(fallbackOsc.frequency, 1760, start);
      fallbackOsc.start(start); fallbackOsc.stop(stopAt);
      return fallbackOsc;
    }

    function synthMono(ctx, start, type, freq, endFreq, durSec, peakGain, attack, cutoffHz, qVal, filterEndHz) {
      const osc = ctx.createOscillator(), gain = envGain(ctx, start, peakGain, attack, durSec);
      const filter = cutoffHz ? createFilterNode(ctx, "lowpass", cutoffHz, qVal, start) : null;
      osc.type = type; setParamAt(osc.frequency, freq, start);
      if (endFreq) expRampParam(osc.frequency, endFreq, start + durSec * 0.78);
      if (filter && filterEndHz) expRampParam(filter.frequency, filterEndHz, start + durSec);
      connectChain(osc, filter, gain, ctx.destination);
      osc.start(start); osc.stop(start + durSec + 0.015);
      return { sources: [osc], nodes: filter ? [osc, filter, gain] : [osc, gain] };
    }

    function synthDual(ctx, start, t1, f1, ef1, t2, f2, ef2, durSec, peakGain, attack, cutoffHz, qVal, filterEndHz) {
      const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = envGain(ctx, start, peakGain, attack, durSec);
      const filter = createFilterNode(ctx, "lowpass", cutoffHz, qVal, start);
      osc1.type = t1; osc2.type = t2;
      setParamAt(osc1.frequency, f1, start); setParamAt(osc2.frequency, f2, start);
      if (ef1 && Math.abs(ef1 - f1) > 1) {
        expRampParam(osc1.frequency, ef1, start + durSec * 0.7);
        expRampParam(osc2.frequency, ef2, start + durSec * 0.7);
      }
      if (filter) {
        if (filterEndHz) expRampParam(filter.frequency, filterEndHz, start + durSec);
        osc1.connect(filter); osc2.connect(filter); filter.connect(gain);
      } else { osc1.connect(gain); osc2.connect(gain); }
      gain.connect(ctx.destination);
      osc1.start(start); osc2.start(start); osc1.stop(start + durSec + 0.015); osc2.stop(start + durSec + 0.015);
      return { sources: [osc1, osc2], nodes: filter ? [osc1, osc2, filter, gain] : [osc1, osc2, gain] };
    }

    const synthKick = (ctx, s, sHz, eHz, d, g) => synthMono(ctx, s, "sine", sHz, eHz, d, g, 0.005, 0, 0, 0);
    const synthBass = (ctx, s, f, d, g, cut) => synthMono(ctx, s, "sawtooth", f, 0, d, g, 0.008, cut, 5.5, Math.max(90, cut * 0.32));
    const synthArp = (ctx, s, f, ef, d, g, cut) =>
      synthDual(ctx, s, "sawtooth", f * 0.995, (ef || f) * 0.995, "triangle", f * 1.005, (ef || f) * 1.005, d, g, 0.007, cut, 2.8, Math.max(220, cut * 0.28));

    function synthNoise(ctx, start, durSec, peakGain, filterType, cutoffHz, qVal) {
      const src = createNoiseSource(ctx, start, start + durSec + 0.015);
      const gain = envGain(ctx, start, peakGain, 0.004, durSec);
      const filter = createFilterNode(ctx, filterType, cutoffHz, qVal, start);
      connectChain(src, filter, gain, ctx.destination);
      return { sources: [src], nodes: filter ? [src, filter, gain] : [src, gain] };
    }

    function triggerPatternEvent(ctx, start, ev, bucket) {
      const spec = VOICE_SPECS[ev.voice];
      if (!spec) return;
      let part;
      if (spec.kind === "kick_bass") {
        const a = synthKick(ctx, start, 150, ev.endFreq || 42, ev.durSec, ev.gain);
        const b = synthBass(ctx, start, ev.freq, ev.durSec * 0.9, ev.gain * 0.55, ev.filterFreq);
        part = { sources: a.sources.concat(b.sources), nodes: a.nodes.concat(b.nodes) };
      } else if (spec.kind === "kick_arp") {
        const a = synthKick(ctx, start, 150, ev.endFreq || 42, ev.durSec, ev.gain);
        const b = synthArp(ctx, start, ev.freq, ev.freq, ev.durSec * 0.88, ev.gain * 0.52, ev.filterFreq);
        part = { sources: a.sources.concat(b.sources), nodes: a.nodes.concat(b.nodes) };
      } else if (spec.kind === "kick") part = synthKick(ctx, start, ev.freq || 130.81, ev.endFreq || 48, ev.durSec, ev.gain);
      else if (spec.kind === "bass") part = synthBass(ctx, start, ev.freq, ev.durSec, ev.gain, ev.filterFreq);
      else if (spec.kind === "arp") part = synthArp(ctx, start, ev.freq, ev.endFreq, ev.durSec, ev.gain, ev.filterFreq);
      else if (spec.kind === "noise") part = synthNoise(ctx, start, ev.durSec, ev.gain, spec.filterType, ev.filterFreq, spec.q);
      else if (spec.kind === "hit") {
        const np = synthNoise(ctx, start, ev.durSec, ev.gain, "bandpass", ev.filterFreq, spec.q);
        const bp = synthMono(ctx, start, "triangle", ev.freq, ev.endFreq, Math.min(0.065, ev.durSec * 0.7), ev.gain * 0.65, 0.003, 0, 0, 0);
        part = { sources: np.sources.concat(bp.sources), nodes: np.nodes.concat(bp.nodes) };
      }
      if (part) registerVoice(part.sources, part.nodes, bucket);
    }

    function triggerRestPad(ctx, start, pulseIndex, theme) {
      const [rootHz, fifthHz] = (THEME_PATTERNS[theme]?.restChords || THEME_PATTERNS.techno.restChords)[pulseIndex % 2];
      const part = synthDual(ctx, start, "sine", rootHz, 0, "triangle", fifthHz, 0, 1.55, 0.05, 0.35, 520, 0.8, 0);
      registerVoice(part.sources, part.nodes, scheduledEntries);
    }

    function playMinimalTone(freq, durSec, type, peakGain, delaySec) {
      const ctx = ensureAudio();
      if (!ctx) return;
      const part = synthMono(ctx, ctx.currentTime + (delaySec || 0), type || "sine", freq, 0, durSec, peakGain || 0.18, 0.01, 0, 0, 0);
      registerVoice(part.sources, part.nodes, cueEntries);
    }

    function playThemedNote(theme, freq, durSec, peakGain, delaySec) {
      const ctx = ensureAudio();
      if (!ctx) return;
      const start = ctx.currentTime + (delaySec || 0);
      const part =
        theme === "trance" ? synthArp(ctx, start, freq, freq, durSec, peakGain, 2400) :
        theme === "techno" ? synthBass(ctx, start, freq, durSec, peakGain, 1400) :
        synthMono(ctx, start, "triangle", freq, 0, durSec, peakGain, 0.008, 1900, 1.0, 0);
      registerVoice(part.sources, part.nodes, cueEntries);
    }

    function scheduleLookahead() {
      if (paused || !THEME_PATTERNS[currentTheme] || !audioCtx || audioCtx.state !== "running") return;
      const horizon = phaseElapsed + LOOKAHEAD_SEC;
      if (horizon <= scheduledUntilSec) return;
      const windowStart = Math.max(scheduledUntilSec, phaseElapsed - 0.06), nowAudio = audioCtx.currentTime;

      if (phaseName === "ACTIVE") {
        const isHold = Boolean(phaseOpts.isHold), repSec = phaseOpts.repSeconds > 0 ? Number(phaseOpts.repSeconds) : isHold ? 1.0 : 2.6;
        const totalReps = Math.max(0, Math.floor(Number(phaseOpts.reps) || 0)), tempoMode = phaseOpts.tempoMode || (isHold ? "hold" : "standard");
        const turnaround = phaseOpts.turnaround !== undefined && phaseOpts.turnaround !== null ? Number(phaseOpts.turnaround) : turnaroundFn(tempoMode);
        const startRep = Math.max(0, Math.floor(windowStart / repSec));
        let endRep = Math.floor(horizon / repSec);
        if (totalReps > 0 && endRep >= totalReps) endRep = totalReps - 1;

        for (let r = startRep; r <= endRep; r++) {
          const pattern = buildRepPattern({ theme: currentTheme, repSeconds: repSec, tempoMode, turnaround, isHold, repIndex: r, totalReps });
          for (const ev of pattern) {
            const absSec = r * repSec + ev.offsetSec;
            if (absSec > windowStart && absSec <= horizon) {
              const startAt = audioAnchorTime !== null ? Math.max(nowAudio, audioAnchorTime + absSec) : nowAudio + Math.max(0, absSec - phaseElapsed);
              triggerPatternEvent(audioCtx, startAt, ev, scheduledEntries);
            }
          }
        }
      } else if (phaseName === "REST") {
        const restSec = phaseOpts.restSeconds > 0 ? Number(phaseOpts.restSeconds) : 20;
        const firstPulse = Math.max(0, Math.floor(windowStart / REST_PULSE_INTERVAL_SEC));
        const lastPulse = Math.floor(horizon / REST_PULSE_INTERVAL_SEC);
        for (let p = firstPulse; p <= lastPulse; p++) {
          const pulseSec = p * REST_PULSE_INTERVAL_SEC;
          if (pulseSec >= restSec) break;
          if (pulseSec > windowStart && pulseSec <= horizon) {
            const padStart = audioAnchorTime !== null ? Math.max(nowAudio, audioAnchorTime + pulseSec) : nowAudio + Math.max(0, pulseSec - phaseElapsed);
            triggerRestPad(audioCtx, padStart, p, currentTheme);
          }
        }
      }
      scheduledUntilSec = horizon;
    }

    function ensureAudio() {
      if (currentTheme === "off") return null;
      if (!audioCtx) {
        try {
          if (typeof opts.audioContextFactory === "function") audioCtx = opts.audioContextFactory();
          else {
            const Ctx = win && (win.AudioContext || win.webkitAudioContext);
            if (!Ctx) return null;
            audioCtx = new Ctx();
          }
        } catch { audioCtx = null; return null; }
      }
      if (!audioCtx) return null;
      if (audioCtx.state === "suspended" && typeof audioCtx.resume === "function") {
        try { Promise.resolve(audioCtx.resume()).catch(() => {}); } catch { /* ignore */ }
      }
      if (!paused && audioCtx.state === "running" && audioAnchorTime === null) {
        audioAnchorTime = audioCtx.currentTime - phaseElapsed;
        if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
      }
      return audioCtx;
    }

    const getTheme = () => currentTheme;
    const isMuted = () => currentTheme === "off";

    function setTheme(themeId) {
      if (!themeId || !VALID_THEMES[themeId]) return currentTheme;
      if (themeId !== "off") lastActiveTheme = themeId;
      if (themeId === currentTheme) return currentTheme;
      if (!paused && currentTheme !== "off" && audioAnchorTime !== null && audioCtx?.state === "running") {
        phaseElapsed = Math.max(phaseElapsed, audioCtx.currentTime - audioAnchorTime);
      }
      stopAllNodes();
      currentTheme = themeId;
      scheduledUntilSec = phaseElapsed - 0.0001;
      if (currentTheme === "off") audioAnchorTime = null;
      else if (!paused) {
        if (audioCtx?.state === "running") {
          audioAnchorTime = audioCtx.currentTime - phaseElapsed;
          if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
        } else audioAnchorTime = null;
      }
      return currentTheme;
    }

    const toggleMute = () => (currentTheme === "off" ? setTheme(lastActiveTheme || "minimal") : setTheme("off"));

    function beginPhase(nextPhase, nextOpts) {
      stopScheduledNodes();
      phaseName = nextPhase || "IDLE";
      phaseOpts = nextOpts ? Object.assign({}, nextOpts) : {};
      paused = false; phaseElapsed = 0; scheduledUntilSec = -0.0001;
      if (currentTheme !== "off" && audioCtx?.state === "suspended" && typeof audioCtx.resume === "function") {
        try { Promise.resolve(audioCtx.resume()).catch(() => {}); } catch { /* ignore */ }
      }
      if (currentTheme !== "off" && audioCtx?.state === "running") {
        audioAnchorTime = audioCtx.currentTime;
        if (phaseName === "ACTIVE" || phaseName === "REST") scheduleLookahead();
      } else audioAnchorTime = null;
    }

    function advancePhase(dtFallbackSec) {
      const dt = Math.max(0, Number(dtFallbackSec) || 0);
      if (paused) return phaseElapsed;
      if (currentTheme !== "off" && audioCtx?.state === "running") {
        if (audioAnchorTime === null) {
          phaseElapsed += dt;
          audioAnchorTime = audioCtx.currentTime - phaseElapsed;
        } else phaseElapsed = Math.max(phaseElapsed, audioCtx.currentTime - audioAnchorTime);
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
        paused = true; audioAnchorTime = null;
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

    const stopAll = () => { audioAnchorTime = null; stopAllNodes(); };
    function playCueSeq(minSteps, themeSteps) {
      if (currentTheme === "off") return;
      if (currentTheme === "minimal") {
        for (const [f, d, t, g, del] of minSteps) playMinimalTone(f, d, t, g, del);
      } else {
        for (const [f, d, g, del] of themeSteps) playThemedNote(currentTheme, f, d, g, del);
      }
    }
    const countdown = (rem) => {
      const s = Number(rem), f = s === 1 ? SCALE.E4 : s === 2 ? SCALE.C4 : SCALE.A3;
      playCueSeq([[440, 0.09, "sine", 0.16, 0]], [[f, 0.09, 0.14, 0]]);
    };
    const startSignal = () => playCueSeq([[784, 0.1, "triangle", 0.22, 0], [1046.5, 0.18, "triangle", 0.25, 0.13]], [[SCALE.E4, 0.1, 0.16, 0], [SCALE.A4, 0.18, 0.18, 0.12]]);
    const midRep = () => { if (currentTheme === "minimal") playMinimalTone(330, 0.045, "triangle", 0.09, 0); };
    const repDone = (rep, total) => {
      if (currentTheme !== "minimal") return;
      const left = Number(total) - Number(rep);
      playMinimalTone(left <= 1 ? 830 : left === 2 ? 740 : 660, 0.085, "sine", 0.2, 0);
    };
    const holdTick = (remaining) => {
      if (currentTheme !== "minimal") return;
      const r = Number(remaining);
      playMinimalTone(r <= 3 && r > 0 ? 660 : 480, r <= 3 && r > 0 ? 0.08 : 0.035, "sine", r <= 3 && r > 0 ? 0.18 : 0.07, 0);
    };
    const stopSet = () => playCueSeq(
      [[880, 0.09, "triangle", 0.22, 0], [880, 0.09, "triangle", 0.22, 0.12], [587.3, 0.22, "triangle", 0.24, 0.25]],
      [[SCALE.E4, 0.09, 0.16, 0], [SCALE.C4, 0.09, 0.16, 0.12], [SCALE.A3, 0.22, 0.18, 0.24]]
    );
    const workoutComplete = () => playCueSeq(
      [[523.25, 0.12, "triangle", 0.22, 0], [659.25, 0.12, "triangle", 0.22, 0.13], [783.99, 0.12, "triangle", 0.22, 0.26], [1046.5, 0.3, "triangle", 0.26, 0.39]],
      [[SCALE.C4, 0.12, 0.17, 0], [SCALE.E4, 0.12, 0.17, 0.13], [SCALE.G4, 0.12, 0.17, 0.26], [SCALE.C5, 0.3, 0.2, 0.39]]
    );

    return {
      getTheme, setTheme, toggleMute, isMuted, ensureAudio, beginPhase, advancePhase, pause, resume, stopAll,
      countdown, startSignal, midRep, repDone, holdTick, stopSet, workoutComplete,
    };
  }

  return Object.freeze({ THEMES, subdivisionsForRep, buildRepPattern, createController });
});
