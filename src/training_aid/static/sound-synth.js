/* Layer 3: Stateless Web Audio DSP synthesizer and master output bus */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingSoundSynth = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const noiseCache = typeof WeakMap === "function" ? new WeakMap() : null;

  function setParamAt(param, val, time) {
    if (!param) return;
    if (typeof param.setValueAtTime === "function") param.setValueAtTime(val, time);
    else param.value = val;
  }

  function linearRampParam(param, val, time) {
    if (!param) return;
    if (typeof param.linearRampToValueAtTime === "function") param.linearRampToValueAtTime(val, time);
    else setParamAt(param, val, time);
  }

  function expRampParam(param, val, time) {
    const safeVal = Math.max(0.0001, val);
    if (!param) return;
    if (typeof param.exponentialRampToValueAtTime === "function") {
      param.exponentialRampToValueAtTime(safeVal, time);
    } else {
      linearRampParam(param, safeVal, time);
    }
  }

  function envGain(ctx, start, peak, rawAttackSec, durSec) {
    const safeDur = Math.max(0.002, Number(durSec) || 0.05);
    const safeAttack = Math.max(0.001, Math.min(Number(rawAttackSec) || 0.005, safeDur * 0.45));
    const g = ctx.createGain();
    setParamAt(g.gain, 0.0001, start);
    linearRampParam(g.gain, Math.max(0.0001, Number(peak) || 0.0001), start + safeAttack);
    expRampParam(g.gain, 0.0001, start + safeDur);
    return g;
  }

  function createFilterNode(ctx, type, freq, qVal, start) {
    if (!type || !freq || typeof ctx.createBiquadFilter !== "function") return null;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    setParamAt(filter.frequency, freq, start);
    if (qVal !== undefined && filter.Q !== undefined) {
      if (typeof filter.Q === "object") setParamAt(filter.Q, qVal, start);
      else filter.Q = qVal;
    }
    return filter;
  }

  function connectChain(source, filter, gain, dest) {
    if (filter) {
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(dest);
  }

  function createMasterBus(ctx, masterGain) {
    if (!ctx || typeof ctx.createGain !== "function") return null;
    const bus = ctx.createGain();
    setParamAt(bus.gain, masterGain > 0 ? masterGain : 0.85, ctx.currentTime || 0);
    bus.connect(ctx.destination);
    return bus;
  }

  function buildWhiteNoiseBuffer(ctx) {
    if (!ctx || typeof ctx.createBuffer !== "function") return null;
    if (noiseCache && noiseCache.has(ctx)) return noiseCache.get(ctx);
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * 0.4));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    if (typeof buffer.getChannelData === "function") {
      const data = buffer.getChannelData(0);
      let seed = 0x5f3759df;
      for (let i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1.0;
      }
    }
    if (noiseCache) noiseCache.set(ctx, buffer);
    return buffer;
  }

  function createNoiseSource(ctx, start, stopAt) {
    const noiseBuffer = buildWhiteNoiseBuffer(ctx);
    if (noiseBuffer && typeof ctx.createBufferSource === "function") {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.start(start);
      src.stop(stopAt);
      return src;
    }
    const fallbackOsc = ctx.createOscillator();
    fallbackOsc.type = "triangle";
    setParamAt(fallbackOsc.frequency, 1760, start);
    fallbackOsc.start(start);
    fallbackOsc.stop(stopAt);
    return fallbackOsc;
  }

  function resolveCutoff(spec, ev) {
    const raw = ev.filterFreq !== undefined ? ev.filterFreq : spec.cutoffHz;
    return raw > 0 ? raw : 0;
  }

  function resolveFilterEnd(spec, cutoffHz) {
    if (!cutoffHz || !spec.filterEndRatio) return 0;
    return Math.max(spec.minFilterEndHz || 60, cutoffHz * spec.filterEndRatio);
  }

  function synthMono(ctx, dest, start, spec, ev) {
    const durSec = Math.max(0.002, Number(ev.durSec) || 0.05);
    const freq = ev.freq || spec.defaultFreq || 440;
    const endFreq = ev.endFreq !== undefined ? ev.endFreq : spec.defaultEndFreq || 0;
    const cutoffHz = resolveCutoff(spec, ev);
    const filterEndHz = resolveFilterEnd(spec, cutoffHz);

    const osc = ctx.createOscillator();
    const gain = envGain(ctx, start, ev.gain, spec.attackSec, durSec);
    const filter = cutoffHz ? createFilterNode(ctx, spec.filterType || "lowpass", cutoffHz, spec.q, start) : null;

    osc.type = spec.oscType || "sine";
    setParamAt(osc.frequency, freq, start);
    if (endFreq > 0) expRampParam(osc.frequency, endFreq, start + durSec * 0.78);
    if (filter && filterEndHz > 0) expRampParam(filter.frequency, filterEndHz, start + durSec);

    connectChain(osc, filter, gain, dest);
    osc.start(start);
    osc.stop(start + durSec + 0.015);
    return { sources: [osc], nodes: filter ? [osc, filter, gain] : [osc, gain] };
  }

  function synthDual(ctx, dest, start, spec, ev) {
    const durSec = Math.max(0.002, Number(ev.durSec) || 0.05);
    const r1 = spec.detuneRatio1 || 1;
    const r2 = spec.detuneRatio2 || 1;
    const baseFreq = ev.freq || 220;
    const f1 = baseFreq * r1;
    const f2 = ev.freq2 !== undefined ? ev.freq2 : baseFreq * r2;
    const efBase = ev.endFreq || 0;
    const ef1 = efBase > 0 ? efBase * r1 : 0;
    const ef2 = efBase > 0 ? efBase * r2 : 0;
    const cutoffHz = resolveCutoff(spec, ev);
    const filterEndHz = resolveFilterEnd(spec, cutoffHz);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = envGain(ctx, start, ev.gain, spec.attackSec, durSec);
    const filter = cutoffHz ? createFilterNode(ctx, spec.filterType || "lowpass", cutoffHz, spec.q, start) : null;

    osc1.type = spec.osc1Type || "sawtooth";
    osc2.type = spec.osc2Type || "triangle";
    setParamAt(osc1.frequency, f1, start);
    setParamAt(osc2.frequency, f2, start);
    if (ef1 > 0 && Math.abs(ef1 - f1) > 1) {
      expRampParam(osc1.frequency, ef1, start + durSec * 0.7);
      expRampParam(osc2.frequency, ef2, start + durSec * 0.7);
    }
    if (filter) {
      if (filterEndHz > 0) expRampParam(filter.frequency, filterEndHz, start + durSec);
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
    } else {
      osc1.connect(gain);
      osc2.connect(gain);
    }
    gain.connect(dest);

    const stopAt = start + durSec + 0.015;
    osc1.start(start);
    osc2.start(start);
    osc1.stop(stopAt);
    osc2.stop(stopAt);
    return { sources: [osc1, osc2], nodes: filter ? [osc1, osc2, filter, gain] : [osc1, osc2, gain] };
  }

  function synthNoise(ctx, dest, start, spec, ev) {
    const durSec = Math.max(0.002, Number(ev.durSec) || 0.05);
    const cutoffHz = resolveCutoff(spec, ev);
    const src = createNoiseSource(ctx, start, start + durSec + 0.015);
    const gain = envGain(ctx, start, ev.gain, spec.attackSec, durSec);
    const filter = cutoffHz ? createFilterNode(ctx, spec.filterType || "bandpass", cutoffHz, spec.q, start) : null;
    connectChain(src, filter, gain, dest);
    return { sources: [src], nodes: filter ? [src, filter, gain] : [src, gain] };
  }

  function triggerPrimitive(ctx, dest, start, spec, ev) {
    if (spec.kind === "mono") return synthMono(ctx, dest, start, spec, ev);
    if (spec.kind === "dual") return synthDual(ctx, dest, start, spec, ev);
    if (spec.kind === "noise") return synthNoise(ctx, dest, start, spec, ev);
    return null;
  }

  function triggerVoice(ctx, destNode, startTime, voiceSpec, event) {
    if (!ctx || !voiceSpec || !event) return null;
    const dest = destNode || ctx.destination;
    if (voiceSpec.kind !== "layered") {
      return triggerPrimitive(ctx, dest, startTime, voiceSpec, event);
    }
    const sources = [];
    const nodes = [];
    for (const layer of voiceSpec.layers) {
      const scaledDur = event.durSec * (layer.durScale || 1);
      const durSec = layer.maxDurSec ? Math.min(layer.maxDurSec, scaledDur) : scaledDur;
      const subEv = {
        freq: layer.fixedFreq || event.freq,
        endFreq: layer.useEndFreq === false ? 0 : event.endFreq !== undefined ? event.endFreq : layer.defaultEndFreq,
        durSec,
        gain: event.gain * (layer.gainScale || 1),
        filterFreq: layer.useFilter === false ? 0 : event.filterFreq,
      };
      const part = triggerPrimitive(ctx, dest, startTime, layer, subEv);
      if (part) {
        sources.push(...part.sources);
        nodes.push(...part.nodes);
      }
    }
    return sources.length > 0 ? { sources, nodes } : null;
  }

  return Object.freeze({
    envGain,
    createMasterBus,
    buildWhiteNoiseBuffer,
    triggerVoice,
  });
});
