/* Layer 2: Pure deterministic rhythm, rest-pad, and cue event planner */
(function (root, factory) {
  const presets =
    (root && root.TrainingSoundPresets) ||
    (typeof require === "function" ? require("./sound-presets.js") : null);
  const api = factory(root, presets);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingSoundPattern = api;
})(typeof window !== "undefined" ? window : globalThis, function (root, presets) {
  "use strict";

  const { TIMING, THEME_PRESETS, CUES } = presets;
  const FALLBACK_TURNAROUNDS = Object.freeze({
    standard: 0.43,
    explosive: 0.31,
    alternating: 0.5,
    hold: 1.0,
  });

  function resolveTurnaroundDefault(tempoMode) {
    if (typeof root?.TrainingMotion?.turnaroundForMode === "function") {
      return root.TrainingMotion.turnaroundForMode(tempoMode);
    }
    return FALLBACK_TURNAROUNDS[tempoMode] ?? 0.43;
  }

  function round4(val) {
    return Number(val.toFixed(4));
  }

  function subdivisionsForRep(repSeconds, isHold) {
    if (isHold) return 2;
    return Number(repSeconds) >= 2.4 ? 8 : 4;
  }

  function makePatternEvent(offsetSec, role, base, variant, freqOverride, isFinalStretch) {
    const ev = {
      offsetSec,
      role,
      voice: base.voice,
      durSec: base.durSec,
      gain: variant.gain,
      isFinalStretch,
    };
    const freq = freqOverride !== undefined ? freqOverride : variant.freq;
    const endFreq = variant.endFreq !== undefined ? variant.endFreq : base.endFreq;
    if (freq !== undefined) ev.freq = freq;
    if (endFreq !== undefined) ev.endFreq = endFreq;
    if (variant.filterFreq !== undefined) ev.filterFreq = variant.filterFreq;
    return ev;
  }

  function resolveDownbeatEvent(spec, isHold, repIndex, isFinal) {
    if (isHold) {
      const holdSpec = spec.downbeat.hold;
      const variant = isFinal ? holdSpec.final : repIndex % 4 === 0 ? holdSpec.accent : holdSpec.base;
      return makePatternEvent(0, "downbeat", holdSpec, variant, undefined, isFinal);
    }
    const repSpec = spec.downbeat.rep;
    const variant = isFinal ? repSpec.final : repSpec.base;
    const note = variant.freqs[repIndex % variant.freqs.length];
    return makePatternEvent(0, "downbeat", repSpec, variant, note, isFinal);
  }

  function resolveTurnaroundEvent(spec, offsetSec, isFinal) {
    const turnSpec = spec.turnaround;
    const variant = isFinal ? turnSpec.final : turnSpec.base;
    return makePatternEvent(offsetSec, "turnaround", turnSpec, variant, undefined, isFinal);
  }

  function resolveSubdivisionEvent(spec, offsetSec, stepIdx, subdivs, isHold, isFinal) {
    if (isHold) {
      const holdSpec = spec.subdivision.hold;
      const variant = isFinal ? holdSpec.final : holdSpec.base;
      return makePatternEvent(offsetSec, "subdivision", holdSpec, variant, undefined, isFinal);
    }
    const repSpec = spec.subdivision.rep;
    const isAccent =
      repSpec.accentAll || (subdivs === 4 ? stepIdx === repSpec.accentStep4 : stepIdx % 2 === 0);
    if (isAccent) {
      const accSpec = repSpec.accent;
      const variant = isFinal ? accSpec.final : accSpec.base;
      const note = variant.freqs[stepIdx % variant.freqs.length];
      return makePatternEvent(offsetSec, "subdivision", accSpec, variant, note, isFinal);
    }
    const offSpec = repSpec.offbeat;
    const variant = isFinal ? offSpec.final : offSpec.base;
    return makePatternEvent(offsetSec, "subdivision", offSpec, variant, undefined, isFinal);
  }

  function buildRepPattern(opts) {
    const cfg = opts || {};
    const spec = THEME_PRESETS[cfg.theme || "minimal"];
    if (!spec) return [];

    const isHold = Boolean(cfg.isHold);
    const repSeconds = cfg.repSeconds > 0 ? Number(cfg.repSeconds) : isHold ? 1.0 : 2.6;
    const tempoMode = cfg.tempoMode || (isHold ? "hold" : "standard");
    const turnaroundFn =
      typeof cfg.turnaroundForMode === "function" ? cfg.turnaroundForMode : resolveTurnaroundDefault;
    let turnaround =
      cfg.turnaround !== undefined && cfg.turnaround !== null
        ? Number(cfg.turnaround)
        : turnaroundFn(tempoMode);
    if (!Number.isFinite(turnaround)) turnaround = 0.43;

    const repIndex = Math.max(0, Math.floor(Number(cfg.repIndex) || 0));
    const totalReps = Math.max(0, Math.floor(Number(cfg.totalReps) || 0));
    const isFinalStretch = Boolean(totalReps && totalReps - repIndex <= (isHold ? 3 : 2));
    const subdivs = subdivisionsForRep(repSeconds, isHold);
    const turnaroundOffset = !isHold ? round4(turnaround * repSeconds) : -1;
    const hasTurnaround = !isHold && turnaroundOffset > 0 && turnaroundOffset < repSeconds;

    const events = [resolveDownbeatEvent(spec, isHold, repIndex, isFinalStretch)];
    for (let i = 1; i < subdivs; i++) {
      const subOffset = round4((i * repSeconds) / subdivs);
      if (subOffset <= 0 || subOffset >= repSeconds) continue;
      if (hasTurnaround && Math.abs(subOffset - turnaroundOffset) < TIMING.FLAM_GUARD_SEC) continue;
      events.push(resolveSubdivisionEvent(spec, subOffset, i, subdivs, isHold, isFinalStretch));
    }
    if (hasTurnaround) {
      events.push(resolveTurnaroundEvent(spec, turnaroundOffset, isFinalStretch));
    }
    return events.sort((a, b) => a.offsetSec - b.offsetSec);
  }

  function buildRestPadEvent(theme, pulseIndex) {
    const spec = THEME_PRESETS[theme];
    if (!spec) return null;
    const chords = spec.restChords;
    const idx = Math.max(0, Math.floor(Number(pulseIndex) || 0)) % chords.length;
    const [freq, freq2] = chords[idx];
    return { voice: "rest_pad", freq, freq2, durSec: 1.55, gain: 0.05 };
  }

  function resolveCueEvents(theme, cueName, params) {
    if (!theme || theme === "off") return [];
    const cue = CUES[cueName];
    if (!cue) return [];
    if (cue.minimalOnly && theme !== "minimal") return [];

    const args = params || {};
    if (cueName === "countdown") {
      const rem = Number(args.remaining);
      if (theme === "minimal") {
        const m = cue.minimal;
        return [{ voice: m.voice, freq: m.freq, durSec: m.durSec, gain: m.gain, delaySec: 0 }];
      }
      const voice = THEME_PRESETS[theme]?.cueVoice || "cue_studio";
      const t = cue.themed;
      const freq = t.freqByRemaining[rem] || t.freqByRemaining.default;
      return [{ voice, freq, durSec: t.durSec, gain: t.gain, delaySec: 0 }];
    }

    if (cueName === "repDone") {
      const left = Math.max(0, Math.floor(Number(args.total) - Number(args.rep)));
      const m = cue.minimal;
      const freq = m.freqByLeft[left] || m.freqByLeft.default;
      return [{ voice: m.voice, freq, durSec: m.durSec, gain: m.gain, delaySec: 0 }];
    }

    if (cueName === "holdTick") {
      const rem = Number(args.remaining);
      const m = cue.minimal;
      const variant = rem <= 3 && rem > 0 ? m.final3 : m.normal;
      return [{ voice: m.voice, freq: variant.freq, durSec: variant.durSec, gain: variant.gain, delaySec: 0 }];
    }

    if (theme === "minimal") {
      return cue.minimal.map((step) => ({ ...step }));
    }
    const voice = THEME_PRESETS[theme]?.cueVoice || "cue_studio";
    return cue.themed.map((step) => ({ voice, ...step }));
  }

  return Object.freeze({
    resolveTurnaroundDefault,
    subdivisionsForRep,
    buildRepPattern,
    buildRestPadEvent,
    resolveCueEvents,
  });
});
