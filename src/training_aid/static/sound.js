(function () {
  var root =
    typeof window !== "undefined"
      ? window
      : typeof globalThis !== "undefined"
        ? globalThis
        : this;

  var STORAGE_KEY = "training_aid_sound_theme";
  var LOOKAHEAD_SEC = 0.14;
  var FLAM_GUARD_SEC = 0.04505;
  var REST_PULSE_INTERVAL_SEC = 2.0;

  var THEMES = Object.freeze([
    Object.freeze({ id: "off", label: "Off" }),
    Object.freeze({ id: "minimal", label: "Minimal Cues" }),
    Object.freeze({ id: "techno", label: "Techno Pulse" }),
    Object.freeze({ id: "trance", label: "Trance Arp" }),
    Object.freeze({ id: "studio", label: "Studio Kit" }),
  ]);

  var VALID_THEMES = {
    off: true,
    minimal: true,
    techno: true,
    trance: true,
    studio: true,
  };

  var RHYTHMIC_THEMES = {
    techno: true,
    trance: true,
    studio: true,
  };

  // Cohesive A minor / C major relative harmonic palette (Hz)
  var SCALE = Object.freeze({
    A2: 110,
    C3: 130.81,
    D3: 146.83,
    E3: 164.81,
    G3: 196,
    A3: 220,
    C4: 261.63,
    D4: 293.66,
    E4: 329.63,
    G4: 392,
    A4: 440,
    C5: 523.25,
    E5: 659.25,
  });

  var FALLBACK_TURNAROUNDS = {
    standard: 0.43,
    explosive: 0.31,
    alternating: 0.5,
    hold: 1.0,
  };

  var TECHNO_BASS_STEPS = [
    SCALE.A2,
    SCALE.A2,
    SCALE.C3,
    SCALE.E3,
    SCALE.D3,
    SCALE.E3,
    SCALE.G3,
    SCALE.A3,
  ];

  var TECHNO_BASS_FINAL_STEPS = [
    SCALE.C3,
    SCALE.E3,
    SCALE.G3,
    SCALE.A3,
    SCALE.E3,
    SCALE.G3,
    SCALE.A3,
    SCALE.C4,
  ];

  var TRANCE_ROOT_PROGRESSION = [SCALE.A3, SCALE.G3, SCALE.E3, SCALE.G3];
  var TRANCE_FINAL_ROOTS = [SCALE.C4, SCALE.D4, SCALE.E4, SCALE.A4];

  var TRANCE_ARP_STEPS = [
    SCALE.A3,
    SCALE.C4,
    SCALE.E4,
    SCALE.G4,
    SCALE.A4,
    SCALE.G4,
    SCALE.E4,
    SCALE.D4,
  ];

  var TRANCE_ARP_FINAL_STEPS = [
    SCALE.C4,
    SCALE.E4,
    SCALE.G4,
    SCALE.A4,
    SCALE.C5,
    SCALE.E5,
    SCALE.C5,
    SCALE.A4,
  ];

  function resolveTurnaroundDefault(tempoMode) {
    if (
      root &&
      root.TrainingMotion &&
      typeof root.TrainingMotion.turnaroundForMode === "function"
    ) {
      return root.TrainingMotion.turnaroundForMode(tempoMode);
    }
    return FALLBACK_TURNAROUNDS[tempoMode] !== undefined
      ? FALLBACK_TURNAROUNDS[tempoMode]
      : 0.43;
  }

  function round4(val) {
    return Number(val.toFixed(4));
  }

  function subdivisionsForRep(repSeconds, isHold) {
    if (isHold) {
      return 2;
    }
    if (Number(repSeconds) >= 2.4) {
      return 8;
    }
    return 4;
  }

  function makeEvent(
    offsetSec,
    role,
    voice,
    freq,
    endFreq,
    durSec,
    gain,
    filterFreq,
    isFinalStretch
  ) {
    return {
      offsetSec: offsetSec,
      role: role,
      voice: voice,
      freq: freq,
      endFreq: endFreq,
      durSec: durSec,
      gain: gain,
      filterFreq: filterFreq,
      isFinalStretch: isFinalStretch,
    };
  }

  function buildDownbeatEvent(theme, isHold, repIndex, isFinalStretch) {
    var holdBarAccent = isHold && repIndex % 4 === 0;
    if (theme === "techno") {
      if (isHold) {
        return makeEvent(
          0,
          "downbeat",
          "kick_bass",
          isFinalStretch ? SCALE.D3 : holdBarAccent ? SCALE.C3 : SCALE.A2,
          45,
          0.18,
          isFinalStretch ? 0.19 : holdBarAccent ? 0.15 : 0.1,
          isFinalStretch ? 520 : holdBarAccent ? 380 : 280,
          isFinalStretch
        );
      }
      return makeEvent(
        0,
        "downbeat",
        "kick_bass",
        isFinalStretch ? SCALE.C3 : SCALE.A2,
        42,
        0.22,
        isFinalStretch ? 0.26 : 0.22,
        isFinalStretch ? 640 : 420,
        isFinalStretch
      );
    }

    if (theme === "trance") {
      if (isHold) {
        return makeEvent(
          0,
          "downbeat",
          "kick_arp",
          isFinalStretch ? SCALE.E4 : holdBarAccent ? SCALE.C4 : SCALE.A3,
          45,
          0.22,
          isFinalStretch ? 0.18 : holdBarAccent ? 0.14 : 0.1,
          isFinalStretch ? 1600 : holdBarAccent ? 1150 : 850,
          isFinalStretch
        );
      }
      var rootNote = isFinalStretch
        ? TRANCE_FINAL_ROOTS[repIndex % TRANCE_FINAL_ROOTS.length]
        : TRANCE_ROOT_PROGRESSION[repIndex % TRANCE_ROOT_PROGRESSION.length];
      return makeEvent(
        0,
        "downbeat",
        "kick_arp",
        rootNote,
        42,
        0.24,
        isFinalStretch ? 0.25 : 0.21,
        isFinalStretch ? 1850 : 1250,
        isFinalStretch
      );
    }

    // "studio"
    if (isHold) {
      return makeEvent(
        0,
        "downbeat",
        "kick",
        isFinalStretch ? SCALE.D3 : SCALE.C3,
        48,
        0.15,
        isFinalStretch ? 0.18 : holdBarAccent ? 0.14 : 0.09,
        isFinalStretch ? 950 : holdBarAccent ? 720 : 560,
        isFinalStretch
      );
    }
    return makeEvent(
      0,
      "downbeat",
      "kick",
      isFinalStretch ? SCALE.D3 : SCALE.C3,
      48,
      0.19,
      isFinalStretch ? 0.26 : 0.22,
      isFinalStretch ? 1150 : 820,
      isFinalStretch
    );
  }

  function buildTurnaroundEvent(theme, offsetSec, isFinalStretch) {
    if (theme === "techno") {
      return makeEvent(
        offsetSec,
        "turnaround",
        "clap",
        isFinalStretch ? SCALE.C4 : SCALE.A3,
        SCALE.E3,
        0.13,
        isFinalStretch ? 0.22 : 0.18,
        isFinalStretch ? 2200 : 1700,
        isFinalStretch
      );
    }
    if (theme === "trance") {
      return makeEvent(
        offsetSec,
        "turnaround",
        "pluck",
        isFinalStretch ? SCALE.E5 : SCALE.C5,
        isFinalStretch ? SCALE.C5 : SCALE.A4,
        0.18,
        isFinalStretch ? 0.23 : 0.19,
        isFinalStretch ? 3200 : 2400,
        isFinalStretch
      );
    }
    return makeEvent(
      offsetSec,
      "turnaround",
      "snare",
      isFinalStretch ? SCALE.A3 : SCALE.G3,
      SCALE.C3,
      0.14,
      isFinalStretch ? 0.23 : 0.19,
      isFinalStretch ? 2600 : 2000,
      isFinalStretch
    );
  }

  function buildSubdivisionEvent(
    theme,
    offsetSec,
    stepIdx,
    subdivs,
    isHold,
    isFinalStretch
  ) {
    if (theme === "techno") {
      if (isHold) {
        return makeEvent(
          offsetSec,
          "subdivision",
          "hat",
          SCALE.E4,
          SCALE.A3,
          0.045,
          isFinalStretch ? 0.08 : 0.05,
          isFinalStretch ? 6800 : 5400,
          isFinalStretch
        );
      }
      var useBass = subdivs === 4 ? stepIdx === 1 : stepIdx % 2 === 0;
      if (useBass) {
        var bassTable = isFinalStretch
          ? TECHNO_BASS_FINAL_STEPS
          : TECHNO_BASS_STEPS;
        var bassFreq = bassTable[stepIdx % bassTable.length];
        return makeEvent(
          offsetSec,
          "subdivision",
          "bass",
          bassFreq,
          bassFreq,
          0.13,
          isFinalStretch ? 0.16 : 0.13,
          isFinalStretch ? 820 : 540,
          isFinalStretch
        );
      }
      return makeEvent(
        offsetSec,
        "subdivision",
        "hat",
        isFinalStretch ? SCALE.A4 : SCALE.E4,
        SCALE.A3,
        0.055,
        isFinalStretch ? 0.11 : 0.085,
        isFinalStretch ? 7600 : 6200,
        isFinalStretch
      );
    }

    if (theme === "trance") {
      if (isHold) {
        return makeEvent(
          offsetSec,
          "subdivision",
          "arp",
          isFinalStretch ? SCALE.A4 : SCALE.E4,
          isFinalStretch ? SCALE.A4 : SCALE.E4,
          0.16,
          isFinalStretch ? 0.11 : 0.07,
          isFinalStretch ? 1350 : 920,
          isFinalStretch
        );
      }
      var arpTable = isFinalStretch ? TRANCE_ARP_FINAL_STEPS : TRANCE_ARP_STEPS;
      var arpFreq = arpTable[stepIdx % arpTable.length];
      return makeEvent(
        offsetSec,
        "subdivision",
        "arp",
        arpFreq,
        arpFreq,
        0.14,
        isFinalStretch ? 0.15 : 0.12,
        isFinalStretch ? 2150 : 1500,
        isFinalStretch
      );
    }

    // "studio"
    if (isHold) {
      return makeEvent(
        offsetSec,
        "subdivision",
        "shaker",
        SCALE.G4,
        SCALE.C4,
        0.045,
        isFinalStretch ? 0.08 : 0.045,
        isFinalStretch ? 5800 : 4800,
        isFinalStretch
      );
    }
    var useRim = subdivs === 4 ? stepIdx === 3 : stepIdx % 2 === 0;
    if (useRim) {
      return makeEvent(
        offsetSec,
        "subdivision",
        "rim",
        isFinalStretch ? SCALE.C5 : SCALE.A4,
        SCALE.E4,
        0.05,
        isFinalStretch ? 0.13 : 0.1,
        isFinalStretch ? 3200 : 2500,
        isFinalStretch
      );
    }
    return makeEvent(
      offsetSec,
      "subdivision",
      "shaker",
      isFinalStretch ? SCALE.A4 : SCALE.G4,
      SCALE.C4,
      0.05,
      isFinalStretch ? 0.1 : 0.075,
      isFinalStretch ? 6800 : 5400,
      isFinalStretch
    );
  }

  function buildRepPattern(opts) {
    var cfg = opts || {};
    var theme = cfg.theme || "minimal";
    if (!RHYTHMIC_THEMES[theme]) {
      return [];
    }

    var isHold = Boolean(cfg.isHold);
    var repSeconds =
      cfg.repSeconds > 0 ? Number(cfg.repSeconds) : isHold ? 1.0 : 2.6;
    var tempoMode = cfg.tempoMode || (isHold ? "hold" : "standard");
    var turnaround =
      cfg.turnaround !== undefined && cfg.turnaround !== null
        ? Number(cfg.turnaround)
        : resolveTurnaroundDefault(tempoMode);
    if (!Number.isFinite(turnaround)) {
      turnaround = 0.43;
    }

    var repIndex = Math.max(0, Math.floor(Number(cfg.repIndex) || 0));
    var totalReps = Math.max(0, Math.floor(Number(cfg.totalReps) || 0));
    var isFinalStretch = Boolean(
      totalReps && totalReps - repIndex <= (isHold ? 3 : 2)
    );

    var subdivs = subdivisionsForRep(repSeconds, isHold);
    var turnaroundOffset = !isHold ? round4(turnaround * repSeconds) : -1;
    var hasTurnaround =
      !isHold && turnaroundOffset > 0 && turnaroundOffset < repSeconds;

    var events = [buildDownbeatEvent(theme, isHold, repIndex, isFinalStretch)];

    for (var i = 1; i < subdivs; i++) {
      var subOffset = round4((i * repSeconds) / subdivs);
      if (subOffset <= 0 || subOffset >= repSeconds) {
        continue;
      }
      if (
        hasTurnaround &&
        Math.abs(subOffset - turnaroundOffset) < FLAM_GUARD_SEC
      ) {
        continue;
      }
      events.push(
        buildSubdivisionEvent(
          theme,
          subOffset,
          i,
          subdivs,
          isHold,
          isFinalStretch
        )
      );
    }

    if (hasTurnaround) {
      events.push(
        buildTurnaroundEvent(theme, turnaroundOffset, isFinalStretch)
      );
    }

    events.sort(function (a, b) {
      return a.offsetSec - b.offsetSec;
    });

    return events;
  }

  // --- Web Audio Synthesis Helpers ---

  function setParamAt(param, val, time) {
    if (!param) return;
    if (typeof param.setValueAtTime === "function") {
      param.setValueAtTime(val, time);
    } else {
      param.value = val;
    }
  }

  function linearRampParam(param, val, time) {
    if (!param) return;
    if (typeof param.linearRampToValueAtTime === "function") {
      param.linearRampToValueAtTime(val, time);
    } else {
      setParamAt(param, val, time);
    }
  }

  function expRampParam(param, val, time) {
    var safeVal = Math.max(0.0001, val);
    if (!param) return;
    if (typeof param.exponentialRampToValueAtTime === "function") {
      param.exponentialRampToValueAtTime(safeVal, time);
    } else {
      linearRampParam(param, safeVal, time);
    }
  }

  function createFilterNode(ctx, type, freq, qVal, start) {
    if (typeof ctx.createBiquadFilter !== "function") {
      return null;
    }
    var filter = ctx.createBiquadFilter();
    filter.type = type;
    setParamAt(filter.frequency, freq, start);
    if (qVal !== undefined && filter.Q !== undefined) {
      if (typeof filter.Q === "object") {
        setParamAt(filter.Q, qVal, start);
      } else {
        filter.Q = qVal;
      }
    }
    return filter;
  }

  function buildWhiteNoiseBuffer(ctx) {
    if (typeof ctx.createBuffer !== "function") {
      return null;
    }
    var sampleRate = ctx.sampleRate || 44100;
    var length = Math.max(1, Math.floor(sampleRate * 0.4));
    var buffer = ctx.createBuffer(1, length, sampleRate);
    if (typeof buffer.getChannelData === "function") {
      var data = buffer.getChannelData(0);
      var seed = 0x5f3759df;
      for (var i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 2147483648) - 1.0;
      }
    }
    return buffer;
  }

  function createController(options) {
    var opts = options || {};
    var turnaroundFn =
      typeof opts.turnaroundForMode === "function"
        ? opts.turnaroundForMode
        : resolveTurnaroundDefault;

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

    var currentTheme = "minimal";
    var lastActiveTheme = "minimal";

    if (storage && typeof storage.getItem === "function") {
      try {
        var saved = storage.getItem(STORAGE_KEY);
        if (saved && VALID_THEMES[saved]) {
          currentTheme = saved;
          if (saved !== "off") {
            lastActiveTheme = saved;
          }
        }
      } catch (e) {
        // Ignore storage read errors
      }
    }

    var audioCtx = null;
    var noiseBuffer = null;
    var noiseBufferCtx = null;

    var scheduledEntries = new Set();
    var cueEntries = new Set();

    var phaseName = "IDLE";
    var phaseOpts = {};
    var phaseElapsed = 0;
    var paused = false;
    var audioAnchorTime = null;
    var scheduledUntilSec = -0.0001;

    function persistTheme(themeId) {
      if (storage && typeof storage.setItem === "function") {
        try {
          storage.setItem(STORAGE_KEY, themeId);
        } catch (e) {
          // Ignore storage write errors
        }
      }
    }

    function registerVoice(sources, nodes, bucket) {
      var entry = { sources: sources, nodes: nodes, bucket: bucket };
      bucket.add(entry);
      var remaining = sources.length;
      if (remaining === 0) {
        bucket.delete(entry);
        return;
      }
      function handleEnded() {
        remaining -= 1;
        if (remaining <= 0 && bucket.has(entry)) {
          bucket.delete(entry);
          for (var i = 0; i < nodes.length; i++) {
            try {
              if (nodes[i] && typeof nodes[i].disconnect === "function") {
                nodes[i].disconnect();
              }
            } catch (e) {
              // Ignore already-disconnected errors
            }
          }
        }
      }
      for (var s = 0; s < sources.length; s++) {
        sources[s].onended = handleEnded;
      }
    }

    function stopBucket(bucket) {
      var list = Array.from(bucket);
      bucket.clear();
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        for (var s = 0; s < entry.sources.length; s++) {
          var src = entry.sources[s];
          if (!src) continue;
          src.onended = null;
          try {
            if (typeof src.stop === "function") {
              src.stop();
            }
          } catch (e) {
            // Ignore InvalidStateError if already stopped
          }
        }
        for (var n = 0; n < entry.nodes.length; n++) {
          var node = entry.nodes[n];
          if (!node) continue;
          try {
            if (typeof node.disconnect === "function") {
              node.disconnect();
            }
          } catch (e) {
            // Ignore disconnect errors
          }
        }
      }
    }

    function stopScheduledNodes() {
      stopBucket(scheduledEntries);
    }

    function stopAllNodes() {
      stopBucket(scheduledEntries);
      stopBucket(cueEntries);
    }

    function getNoiseBuffer(ctx) {
      if (noiseBuffer && noiseBufferCtx === ctx) {
        return noiseBuffer;
      }
      noiseBuffer = buildWhiteNoiseBuffer(ctx);
      noiseBufferCtx = ctx;
      return noiseBuffer;
    }

    function createNoiseSource(ctx, start, stopAt) {
      var buf = getNoiseBuffer(ctx);
      if (buf && typeof ctx.createBufferSource === "function") {
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.start(start);
        src.stop(stopAt);
        return src;
      }
      // Safe fallback for minimal mock AudioContext implementations
      var fallbackOsc = ctx.createOscillator();
      fallbackOsc.type = "triangle";
      setParamAt(fallbackOsc.frequency, 1760, start);
      fallbackOsc.start(start);
      fallbackOsc.stop(stopAt);
      return fallbackOsc;
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

    // --- Voice Synthesizers ---

    function synthKickLayer(ctx, start, startHz, endHz, durSec, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      setParamAt(osc.frequency, startHz, start);
      expRampParam(osc.frequency, endHz, start + durSec * 0.78);
      setParamAt(gain.gain, 0.0001, start);
      linearRampParam(gain.gain, peakGain, start + 0.005);
      expRampParam(gain.gain, 0.0001, start + durSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + durSec + 0.015);
      return { sources: [osc], nodes: [osc, gain] };
    }

    function synthTechnoBassLayer(
      ctx,
      start,
      freq,
      durSec,
      peakGain,
      cutoffHz
    ) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var filter = createFilterNode(ctx, "lowpass", cutoffHz, 5.5, start);
      osc.type = "sawtooth";
      setParamAt(osc.frequency, freq, start);
      if (filter) {
        expRampParam(filter.frequency, Math.max(90, cutoffHz * 0.32), start + durSec);
      }
      setParamAt(gain.gain, 0.0001, start);
      linearRampParam(gain.gain, peakGain, start + 0.008);
      expRampParam(gain.gain, 0.0001, start + durSec);
      connectChain(osc, filter, gain, ctx.destination);
      osc.start(start);
      osc.stop(start + durSec + 0.015);
      return {
        sources: [osc],
        nodes: filter ? [osc, filter, gain] : [osc, gain],
      };
    }

    function synthTranceArpLayer(
      ctx,
      start,
      freq,
      endFreq,
      durSec,
      peakGain,
      cutoffHz
    ) {
      var osc1 = ctx.createOscillator();
      var osc2 = ctx.createOscillator();
      var gain = ctx.createGain();
      var filter = createFilterNode(ctx, "lowpass", cutoffHz, 2.8, start);

      osc1.type = "sawtooth";
      osc2.type = "triangle";
      setParamAt(osc1.frequency, freq * 0.995, start);
      setParamAt(osc2.frequency, freq * 1.005, start);
      if (endFreq && Math.abs(endFreq - freq) > 1) {
        expRampParam(osc1.frequency, endFreq * 0.995, start + durSec * 0.7);
        expRampParam(osc2.frequency, endFreq * 1.005, start + durSec * 0.7);
      }
      if (filter) {
        expRampParam(
          filter.frequency,
          Math.max(220, cutoffHz * 0.28),
          start + durSec
        );
      }
      setParamAt(gain.gain, 0.0001, start);
      linearRampParam(gain.gain, peakGain, start + 0.007);
      expRampParam(gain.gain, 0.0001, start + durSec);

      if (filter) {
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
      } else {
        osc1.connect(gain);
        osc2.connect(gain);
      }
      gain.connect(ctx.destination);
      osc1.start(start);
      osc2.start(start);
      osc1.stop(start + durSec + 0.015);
      osc2.stop(start + durSec + 0.015);
      return {
        sources: [osc1, osc2],
        nodes: filter ? [osc1, osc2, filter, gain] : [osc1, osc2, gain],
      };
    }

    function synthNoiseBurst(
      ctx,
      start,
      durSec,
      peakGain,
      filterType,
      cutoffHz,
      qVal
    ) {
      var stopAt = start + durSec + 0.015;
      var src = createNoiseSource(ctx, start, stopAt);
      var gain = ctx.createGain();
      var filter = createFilterNode(ctx, filterType, cutoffHz, qVal, start);
      setParamAt(gain.gain, 0.0001, start);
      linearRampParam(gain.gain, peakGain, start + 0.004);
      expRampParam(gain.gain, 0.0001, start + durSec);
      connectChain(src, filter, gain, ctx.destination);
      return {
        sources: [src],
        nodes: filter ? [src, filter, gain] : [src, gain],
      };
    }

    function synthTransientNoiseHit(
      ctx,
      start,
      bodyFreq,
      endFreq,
      durSec,
      peakGain,
      cutoffHz,
      qVal
    ) {
      var noisePart = synthNoiseBurst(
        ctx,
        start,
        durSec,
        peakGain,
        "bandpass",
        cutoffHz,
        qVal
      );
      var bodyDur = Math.min(0.065, durSec * 0.7);
      var osc = ctx.createOscillator();
      var bodyGain = ctx.createGain();
      osc.type = "triangle";
      setParamAt(osc.frequency, bodyFreq, start);
      if (endFreq) {
        expRampParam(osc.frequency, endFreq, start + bodyDur);
      }
      setParamAt(bodyGain.gain, 0.0001, start);
      linearRampParam(bodyGain.gain, peakGain * 0.65, start + 0.003);
      expRampParam(bodyGain.gain, 0.0001, start + bodyDur);
      osc.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + bodyDur + 0.015);
      return {
        sources: noisePart.sources.concat([osc]),
        nodes: noisePart.nodes.concat([osc, bodyGain]),
      };
    }

    function triggerPatternEvent(ctx, start, ev, bucket) {
      var v = ev.voice;
      var partA;
      var partB;

      if (v === "kick_bass") {
        partA = synthKickLayer(ctx, start, 150, ev.endFreq || 42, ev.durSec, ev.gain);
        partB = synthTechnoBassLayer(
          ctx,
          start,
          ev.freq,
          ev.durSec * 0.9,
          ev.gain * 0.55,
          ev.filterFreq
        );
        registerVoice(
          partA.sources.concat(partB.sources),
          partA.nodes.concat(partB.nodes),
          bucket
        );
        return;
      }

      if (v === "kick_arp") {
        partA = synthKickLayer(ctx, start, 150, ev.endFreq || 42, ev.durSec, ev.gain);
        partB = synthTranceArpLayer(
          ctx,
          start,
          ev.freq,
          ev.freq,
          ev.durSec * 0.88,
          ev.gain * 0.52,
          ev.filterFreq
        );
        registerVoice(
          partA.sources.concat(partB.sources),
          partA.nodes.concat(partB.nodes),
          bucket
        );
        return;
      }

      if (v === "kick") {
        partA = synthKickLayer(
          ctx,
          start,
          ev.freq || 130.81,
          ev.endFreq || 48,
          ev.durSec,
          ev.gain
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "bass") {
        partA = synthTechnoBassLayer(
          ctx,
          start,
          ev.freq,
          ev.durSec,
          ev.gain,
          ev.filterFreq
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "arp" || v === "pluck") {
        partA = synthTranceArpLayer(
          ctx,
          start,
          ev.freq,
          ev.endFreq,
          ev.durSec,
          ev.gain,
          ev.filterFreq
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "hat") {
        partA = synthNoiseBurst(
          ctx,
          start,
          ev.durSec,
          ev.gain,
          "highpass",
          ev.filterFreq,
          0.9
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "shaker") {
        partA = synthNoiseBurst(
          ctx,
          start,
          ev.durSec,
          ev.gain,
          "bandpass",
          ev.filterFreq,
          1.6
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "clap") {
        partA = synthTransientNoiseHit(
          ctx,
          start,
          ev.freq,
          ev.endFreq,
          ev.durSec,
          ev.gain,
          ev.filterFreq,
          1.8
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "snare") {
        partA = synthTransientNoiseHit(
          ctx,
          start,
          ev.freq,
          ev.endFreq,
          ev.durSec,
          ev.gain,
          ev.filterFreq,
          1.2
        );
        registerVoice(partA.sources, partA.nodes, bucket);
        return;
      }

      if (v === "rim") {
        partA = synthTransientNoiseHit(
          ctx,
          start,
          ev.freq,
          ev.endFreq,
          ev.durSec,
          ev.gain,
          ev.filterFreq,
          3.2
        );
        registerVoice(partA.sources, partA.nodes, bucket);
      }
    }

    function triggerRestPad(ctx, start, pulseIndex, theme) {
      var useAlt = pulseIndex % 2 === 1;
      var rootHz = useAlt ? SCALE.C3 : SCALE.A2;
      var fifthHz = useAlt ? SCALE.G3 : SCALE.E3;
      if (theme === "trance") {
        rootHz = useAlt ? SCALE.C4 : SCALE.A3;
        fifthHz = useAlt ? SCALE.G4 : SCALE.E4;
      } else if (theme === "studio") {
        rootHz = useAlt ? SCALE.G3 : SCALE.C3;
        fifthHz = useAlt ? SCALE.D4 : SCALE.G3;
      }

      var durSec = 1.55;
      var peakGain = 0.05;
      var osc1 = ctx.createOscillator();
      var osc2 = ctx.createOscillator();
      var gain = ctx.createGain();
      var filter = createFilterNode(ctx, "lowpass", 520, 0.8, start);

      osc1.type = "sine";
      osc2.type = "triangle";
      setParamAt(osc1.frequency, rootHz, start);
      setParamAt(osc2.frequency, fifthHz, start);

      setParamAt(gain.gain, 0.0001, start);
      linearRampParam(gain.gain, peakGain, start + 0.35);
      expRampParam(gain.gain, 0.0001, start + durSec);

      if (filter) {
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
      } else {
        osc1.connect(gain);
        osc2.connect(gain);
      }
      gain.connect(ctx.destination);
      osc1.start(start);
      osc2.start(start);
      osc1.stop(start + durSec + 0.02);
      osc2.stop(start + durSec + 0.02);

      registerVoice(
        [osc1, osc2],
        filter ? [osc1, osc2, filter, gain] : [osc1, osc2, gain],
        scheduledEntries
      );
    }

    function playMinimalTone(freq, durSec, type, peakGain, delaySec) {
      var ctx = ensureAudio();
      if (!ctx) return;
      var start = ctx.currentTime + (delaySec || 0);
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || "sine";
      setParamAt(osc.frequency, freq, start);
      setParamAt(gain.gain, 0.0001, start);
      linearRampParam(gain.gain, peakGain || 0.18, start + 0.01);
      expRampParam(gain.gain, 0.0001, start + durSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + durSec + 0.015);
      registerVoice([osc], [osc, gain], cueEntries);
    }

    function playThemedNote(theme, freq, durSec, peakGain, delaySec) {
      var ctx = ensureAudio();
      if (!ctx) return;
      var start = ctx.currentTime + (delaySec || 0);
      var part;
      if (theme === "trance") {
        part = synthTranceArpLayer(
          ctx,
          start,
          freq,
          freq,
          durSec,
          peakGain,
          2400
        );
      } else if (theme === "techno") {
        part = synthTechnoBassLayer(
          ctx,
          start,
          freq,
          durSec,
          peakGain,
          1400
        );
      } else {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var filter = createFilterNode(ctx, "lowpass", 1900, 1.0, start);
        osc.type = "triangle";
        setParamAt(osc.frequency, freq, start);
        setParamAt(gain.gain, 0.0001, start);
        linearRampParam(gain.gain, peakGain, start + 0.008);
        expRampParam(gain.gain, 0.0001, start + durSec);
        connectChain(osc, filter, gain, ctx.destination);
        osc.start(start);
        osc.stop(start + durSec + 0.015);
        part = {
          sources: [osc],
          nodes: filter ? [osc, filter, gain] : [osc, gain],
        };
      }
      registerVoice(part.sources, part.nodes, cueEntries);
    }

    // --- Lookahead Scheduler ---

    function scheduleLookahead() {
      if (
        paused ||
        !RHYTHMIC_THEMES[currentTheme] ||
        !audioCtx ||
        audioCtx.state !== "running"
      ) {
        return;
      }
      var horizon = phaseElapsed + LOOKAHEAD_SEC;
      if (horizon <= scheduledUntilSec) {
        return;
      }
      var windowStart = Math.max(scheduledUntilSec, phaseElapsed - 0.06);
      var nowAudio = audioCtx.currentTime;

      if (phaseName === "ACTIVE") {
        var isHold = Boolean(phaseOpts.isHold);
        var repSec =
          phaseOpts.repSeconds > 0
            ? Number(phaseOpts.repSeconds)
            : isHold
              ? 1.0
              : 2.6;
        var totalReps = Math.max(0, Math.floor(Number(phaseOpts.reps) || 0));
        var tempoMode = phaseOpts.tempoMode || (isHold ? "hold" : "standard");
        var turnaround =
          phaseOpts.turnaround !== undefined && phaseOpts.turnaround !== null
            ? Number(phaseOpts.turnaround)
            : turnaroundFn(tempoMode);

        var startRep = Math.max(0, Math.floor(windowStart / repSec));
        var endRep = Math.floor(horizon / repSec);
        if (totalReps > 0 && endRep >= totalReps) {
          endRep = totalReps - 1;
        }

        for (var r = startRep; r <= endRep; r++) {
          var pattern = buildRepPattern({
            theme: currentTheme,
            repSeconds: repSec,
            tempoMode: tempoMode,
            turnaround: turnaround,
            isHold: isHold,
            repIndex: r,
            totalReps: totalReps,
          });
          var repBaseSec = r * repSec;
          for (var k = 0; k < pattern.length; k++) {
            var ev = pattern[k];
            var absSec = repBaseSec + ev.offsetSec;
            if (absSec > windowStart && absSec <= horizon) {
              var startAt =
                audioAnchorTime !== null
                  ? Math.max(nowAudio, audioAnchorTime + absSec)
                  : nowAudio + Math.max(0, absSec - phaseElapsed);
              triggerPatternEvent(audioCtx, startAt, ev, scheduledEntries);
            }
          }
        }
      } else if (phaseName === "REST") {
        var restSec =
          phaseOpts.restSeconds > 0 ? Number(phaseOpts.restSeconds) : 20;
        var firstPulse = Math.max(
          0,
          Math.floor(windowStart / REST_PULSE_INTERVAL_SEC)
        );
        var lastPulse = Math.floor(horizon / REST_PULSE_INTERVAL_SEC);
        for (var p = firstPulse; p <= lastPulse; p++) {
          var pulseSec = p * REST_PULSE_INTERVAL_SEC;
          if (pulseSec >= restSec) {
            break;
          }
          if (pulseSec > windowStart && pulseSec <= horizon) {
            var padStart =
              audioAnchorTime !== null
                ? Math.max(nowAudio, audioAnchorTime + pulseSec)
                : nowAudio + Math.max(0, pulseSec - phaseElapsed);
            triggerRestPad(audioCtx, padStart, p, currentTheme);
          }
        }
      }

      scheduledUntilSec = horizon;
    }

    // --- Public Controller API ---

    function ensureAudio() {
      if (currentTheme === "off") {
        return null;
      }
      var Ctx = root && (root.AudioContext || root.webkitAudioContext);
      if (!Ctx) {
        return null;
      }
      if (!audioCtx) {
        try {
          audioCtx = new Ctx();
        } catch (e) {
          audioCtx = null;
          return null;
        }
      }
      if (
        audioCtx.state === "suspended" &&
        typeof audioCtx.resume === "function"
      ) {
        try {
          var maybePromise = audioCtx.resume();
          if (maybePromise && typeof maybePromise.catch === "function") {
            maybePromise.catch(function () {});
          }
        } catch (e) {
          // Ignore resume errors prior to user gesture
        }
      }
      if (
        !paused &&
        audioCtx.state === "running" &&
        audioAnchorTime === null
      ) {
        audioAnchorTime = audioCtx.currentTime - phaseElapsed;
        if (phaseName === "ACTIVE" || phaseName === "REST") {
          scheduleLookahead();
        }
      }
      return audioCtx;
    }

    function getTheme() {
      return currentTheme;
    }

    function isMuted() {
      return currentTheme === "off";
    }

    function setTheme(themeId) {
      if (!themeId || !VALID_THEMES[themeId]) {
        return currentTheme;
      }
      if (themeId !== "off") {
        lastActiveTheme = themeId;
      }
      persistTheme(themeId);

      if (themeId === currentTheme) {
        return currentTheme;
      }

      if (
        !paused &&
        currentTheme !== "off" &&
        audioAnchorTime !== null &&
        audioCtx &&
        audioCtx.state === "running"
      ) {
        phaseElapsed = Math.max(
          phaseElapsed,
          audioCtx.currentTime - audioAnchorTime
        );
      }

      stopAllNodes();
      currentTheme = themeId;
      scheduledUntilSec = phaseElapsed - 0.0001;

      if (currentTheme === "off") {
        audioAnchorTime = null;
      } else if (!paused) {
        if (audioCtx && audioCtx.state === "running") {
          audioAnchorTime = audioCtx.currentTime - phaseElapsed;
          if (phaseName === "ACTIVE" || phaseName === "REST") {
            scheduleLookahead();
          }
        } else {
          audioAnchorTime = null;
        }
      }

      return currentTheme;
    }

    function toggleMute() {
      if (currentTheme === "off") {
        return setTheme(lastActiveTheme || "minimal");
      }
      return setTheme("off");
    }

    function beginPhase(nextPhase, nextOpts) {
      stopScheduledNodes();
      phaseName = nextPhase || "IDLE";
      phaseOpts = nextOpts ? Object.assign({}, nextOpts) : {};
      paused = false;
      phaseElapsed = 0;
      scheduledUntilSec = -0.0001;

      if (
        currentTheme !== "off" &&
        audioCtx &&
        audioCtx.state === "suspended" &&
        typeof audioCtx.resume === "function"
      ) {
        try {
          var p = audioCtx.resume();
          if (p && typeof p.catch === "function") {
            p.catch(function () {});
          }
        } catch (e) {
          // Ignore
        }
      }

      if (
        currentTheme !== "off" &&
        audioCtx &&
        audioCtx.state === "running"
      ) {
        audioAnchorTime = audioCtx.currentTime;
        if (phaseName === "ACTIVE" || phaseName === "REST") {
          scheduleLookahead();
        }
      } else {
        audioAnchorTime = null;
      }
    }

    function advancePhase(dtFallbackSec) {
      var dt = Math.max(0, Number(dtFallbackSec) || 0);
      if (paused) {
        return phaseElapsed;
      }

      if (
        currentTheme !== "off" &&
        audioCtx &&
        audioCtx.state === "running"
      ) {
        if (audioAnchorTime === null) {
          phaseElapsed += dt;
          audioAnchorTime = audioCtx.currentTime - phaseElapsed;
        } else {
          phaseElapsed = Math.max(
            phaseElapsed,
            audioCtx.currentTime - audioAnchorTime
          );
        }
        if (phaseName === "ACTIVE" || phaseName === "REST") {
          scheduleLookahead();
        }
        return phaseElapsed;
      }

      audioAnchorTime = null;
      phaseElapsed += dt;
      return phaseElapsed;
    }

    function pause() {
      if (!paused) {
        if (
          currentTheme !== "off" &&
          audioAnchorTime !== null &&
          audioCtx &&
          audioCtx.state === "running"
        ) {
          phaseElapsed = Math.max(
            phaseElapsed,
            audioCtx.currentTime - audioAnchorTime
          );
        }
        paused = true;
        audioAnchorTime = null;
      }
      stopAllNodes();
    }

    function resume() {
      if (!paused) {
        return;
      }
      paused = false;
      scheduledUntilSec = phaseElapsed - 0.0001;
      if (currentTheme !== "off") {
        ensureAudio();
        if (audioCtx && audioCtx.state === "running") {
          audioAnchorTime = audioCtx.currentTime - phaseElapsed;
          if (phaseName === "ACTIVE" || phaseName === "REST") {
            scheduleLookahead();
          }
        }
      }
    }

    function stopAll() {
      audioAnchorTime = null;
      stopAllNodes();
    }

    // --- Discrete Cues ---

    function countdown(rem) {
      if (currentTheme === "off") return;
      if (currentTheme === "minimal") {
        playMinimalTone(440, 0.09, "sine", 0.16, 0);
        return;
      }
      var step = Number(rem);
      var freq =
        step === 1 ? SCALE.E4 : step === 2 ? SCALE.C4 : SCALE.A3;
      playThemedNote(currentTheme, freq, 0.09, 0.14, 0);
    }

    function startSignal() {
      if (currentTheme === "off") return;
      if (currentTheme === "minimal") {
        playMinimalTone(784, 0.1, "triangle", 0.22, 0);
        playMinimalTone(1046.5, 0.18, "triangle", 0.25, 0.13);
        return;
      }
      playThemedNote(currentTheme, SCALE.E4, 0.1, 0.16, 0);
      playThemedNote(currentTheme, SCALE.A4, 0.18, 0.18, 0.12);
    }

    function midRep() {
      if (currentTheme === "minimal") {
        playMinimalTone(330, 0.045, "triangle", 0.09, 0);
      }
    }

    function repDone(rep, total) {
      if (currentTheme !== "minimal") return;
      var left = Number(total) - Number(rep);
      var freq = left <= 1 ? 830 : left === 2 ? 740 : 660;
      playMinimalTone(freq, 0.085, "sine", 0.2, 0);
    }

    function holdTick(remaining) {
      if (currentTheme !== "minimal") return;
      var rem = Number(remaining);
      if (rem <= 3 && rem > 0) {
        playMinimalTone(660, 0.08, "sine", 0.18, 0);
      } else {
        playMinimalTone(480, 0.035, "sine", 0.07, 0);
      }
    }

    function stopSet() {
      if (currentTheme === "off") return;
      if (currentTheme === "minimal") {
        playMinimalTone(880, 0.09, "triangle", 0.22, 0);
        playMinimalTone(880, 0.09, "triangle", 0.22, 0.12);
        playMinimalTone(587.3, 0.22, "triangle", 0.24, 0.25);
        return;
      }
      playThemedNote(currentTheme, SCALE.E4, 0.09, 0.16, 0);
      playThemedNote(currentTheme, SCALE.C4, 0.09, 0.16, 0.12);
      playThemedNote(currentTheme, SCALE.A3, 0.22, 0.18, 0.24);
    }

    function workoutComplete() {
      if (currentTheme === "off") return;
      if (currentTheme === "minimal") {
        playMinimalTone(523.25, 0.12, "triangle", 0.22, 0.0);
        playMinimalTone(659.25, 0.12, "triangle", 0.22, 0.13);
        playMinimalTone(783.99, 0.12, "triangle", 0.22, 0.26);
        playMinimalTone(1046.5, 0.3, "triangle", 0.26, 0.39);
        return;
      }
      playThemedNote(currentTheme, SCALE.C4, 0.12, 0.17, 0.0);
      playThemedNote(currentTheme, SCALE.E4, 0.12, 0.17, 0.13);
      playThemedNote(currentTheme, SCALE.G4, 0.12, 0.17, 0.26);
      playThemedNote(currentTheme, SCALE.C5, 0.3, 0.2, 0.39);
    }

    return {
      getTheme: getTheme,
      setTheme: setTheme,
      toggleMute: toggleMute,
      isMuted: isMuted,
      ensureAudio: ensureAudio,
      beginPhase: beginPhase,
      advancePhase: advancePhase,
      pause: pause,
      resume: resume,
      stopAll: stopAll,
      countdown: countdown,
      startSignal: startSignal,
      midRep: midRep,
      repDone: repDone,
      holdTick: holdTick,
      stopSet: stopSet,
      workoutComplete: workoutComplete,
    };
  }

  root.TrainingSound = Object.freeze({
    STORAGE_KEY: STORAGE_KEY,
    THEMES: THEMES,
    subdivisionsForRep: subdivisionsForRep,
    buildRepPattern: buildRepPattern,
    createController: createController,
  });
})();
