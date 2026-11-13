import { SOUND_THEMES, VALID_SOUND_THEMES } from "../core/constants.js";

function deepFreeze(val) {
  if (!val || typeof val !== "object" || Object.isFrozen(val)) return val;
  Object.freeze(val);
  for (const key of Object.keys(val)) deepFreeze(val[key]);
  return val;
}

export const THEMES = SOUND_THEMES;
export { VALID_SOUND_THEMES };

export const TIMING = Object.freeze({
  LOOKAHEAD_SEC: 0.14,
  FLAM_GUARD_SEC: 0.055,
  REST_PULSE_INTERVAL_SEC: 2.0,
  MASTER_GAIN: 0.85,
});

// Cohesive A minor / C major relative harmonic palette (Hz)
export const SCALE = Object.freeze({
  A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, G3: 196, A3: 220,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25,
});

const ARP_PATCH = {
  kind: "dual", osc1Type: "sawtooth", osc2Type: "triangle",
  detuneRatio1: 0.995, detuneRatio2: 1.005, attackSec: 0.007,
  filterType: "lowpass", q: 2.8, filterEndRatio: 0.28, minFilterEndHz: 220,
};

const BASS_PATCH = {
  kind: "mono", oscType: "sawtooth", attackSec: 0.008,
  filterType: "lowpass", q: 5.5, filterEndRatio: 0.32, minFilterEndHz: 90,
};

const HIT_BODY_LAYER = {
  kind: "mono", oscType: "triangle", attackSec: 0.003,
  durScale: 0.7, maxDurSec: 0.065, gainScale: 0.65, useFilter: false,
};

export const VOICES = deepFreeze({
  kick: { kind: "mono", oscType: "sine", attackSec: 0.005, defaultFreq: 130.81, defaultEndFreq: 48 },
  bass: BASS_PATCH,
  arp: ARP_PATCH,
  pluck: ARP_PATCH,
  hat: { kind: "noise", attackSec: 0.004, filterType: "highpass", q: 0.9 },
  shaker: { kind: "noise", attackSec: 0.004, filterType: "bandpass", q: 1.6 },
  kick_bass: {
    kind: "layered",
    layers: [
      { kind: "mono", oscType: "sine", attackSec: 0.005, fixedFreq: 150, defaultEndFreq: 42, useFilter: false },
      { ...BASS_PATCH, useEndFreq: false, durScale: 0.9, gainScale: 0.55 },
    ],
  },
  kick_arp: {
    kind: "layered",
    layers: [
      { kind: "mono", oscType: "sine", attackSec: 0.005, fixedFreq: 150, defaultEndFreq: 42, useFilter: false },
      { ...ARP_PATCH, useEndFreq: false, durScale: 0.88, gainScale: 0.52 },
    ],
  },
  clap: {
    kind: "layered",
    layers: [{ kind: "noise", attackSec: 0.004, filterType: "bandpass", q: 1.8 }, HIT_BODY_LAYER],
  },
  snare: {
    kind: "layered",
    layers: [{ kind: "noise", attackSec: 0.004, filterType: "bandpass", q: 1.2 }, HIT_BODY_LAYER],
  },
  rim: {
    kind: "layered",
    layers: [{ kind: "noise", attackSec: 0.004, filterType: "bandpass", q: 3.2 }, HIT_BODY_LAYER],
  },
  rest_pad: {
    kind: "dual", osc1Type: "sine", osc2Type: "triangle",
    detuneRatio1: 1, detuneRatio2: 1, attackSec: 0.35,
    filterType: "lowpass", cutoffHz: 520, q: 0.8,
  },
  cue_sine: { kind: "mono", oscType: "sine", attackSec: 0.01 },
  cue_tri: { kind: "mono", oscType: "triangle", attackSec: 0.01 },
  cue_techno: { ...BASS_PATCH, cutoffHz: 1400 },
  cue_trance: { ...ARP_PATCH, cutoffHz: 2400 },
  cue_studio: { kind: "mono", oscType: "triangle", attackSec: 0.008, filterType: "lowpass", cutoffHz: 1900, q: 1.0 },
});

const S = SCALE;

export const THEME_PRESETS = deepFreeze({
  techno: {
    cueVoice: "cue_techno",
    restChords: [[S.A2, S.E3], [S.C3, S.G3]],
    downbeat: {
      hold: {
        voice: "kick_bass", endFreq: 45, durSec: 0.18,
        base: { freq: S.A2, gain: 0.1, filterFreq: 280 },
        accent: { freq: S.C3, gain: 0.15, filterFreq: 380 },
        final: { freq: S.D3, gain: 0.19, filterFreq: 520 },
      },
      rep: {
        voice: "kick_bass", endFreq: 42, durSec: 0.22,
        base: { freqs: [S.A2], gain: 0.22, filterFreq: 420 },
        final: { freqs: [S.C3], gain: 0.26, filterFreq: 640 },
      },
    },
    turnaround: {
      voice: "clap", durSec: 0.13,
      base: { freq: S.A3, endFreq: S.E3, gain: 0.18, filterFreq: 1700 },
      final: { freq: S.C4, endFreq: S.E3, gain: 0.22, filterFreq: 2200 },
    },
    subdivision: {
      hold: {
        voice: "hat", durSec: 0.045,
        base: { gain: 0.05, filterFreq: 5400 },
        final: { gain: 0.08, filterFreq: 6800 },
      },
      rep: {
        accentStep4: 1,
        accent: {
          voice: "bass", durSec: 0.13,
          base: { freqs: [S.A2, S.A2, S.C3, S.E3, S.D3, S.E3, S.G3, S.A3], gain: 0.13, filterFreq: 540 },
          final: { freqs: [S.C3, S.E3, S.G3, S.A3, S.E3, S.G3, S.A3, S.C4], gain: 0.16, filterFreq: 820 },
        },
        offbeat: {
          voice: "hat", durSec: 0.055,
          base: { gain: 0.085, filterFreq: 6200 },
          final: { gain: 0.11, filterFreq: 7600 },
        },
      },
    },
  },
  trance: {
    cueVoice: "cue_trance",
    restChords: [[S.A3, S.E4], [S.C4, S.G4]],
    downbeat: {
      hold: {
        voice: "kick_arp", endFreq: 45, durSec: 0.22,
        base: { freq: S.A3, gain: 0.1, filterFreq: 850 },
        accent: { freq: S.C4, gain: 0.14, filterFreq: 1150 },
        final: { freq: S.E4, gain: 0.18, filterFreq: 1600 },
      },
      rep: {
        voice: "kick_arp", endFreq: 42, durSec: 0.24,
        base: { freqs: [S.A3, S.G3, S.E3, S.G3], gain: 0.21, filterFreq: 1250 },
        final: { freqs: [S.C4, S.D4, S.E4, S.A4], gain: 0.25, filterFreq: 1850 },
      },
    },
    turnaround: {
      voice: "pluck", durSec: 0.18,
      base: { freq: S.C5, endFreq: S.A4, gain: 0.19, filterFreq: 2400 },
      final: { freq: S.E5, endFreq: S.C5, gain: 0.23, filterFreq: 3200 },
    },
    subdivision: {
      hold: {
        voice: "arp", durSec: 0.16,
        base: { freq: S.E4, gain: 0.07, filterFreq: 920 },
        final: { freq: S.A4, gain: 0.11, filterFreq: 1350 },
      },
      rep: {
        accentAll: true,
        accent: {
          voice: "arp", durSec: 0.14,
          base: { freqs: [S.A3, S.C4, S.E4, S.G4, S.A4, S.G4, S.E4, S.D4], gain: 0.12, filterFreq: 1500 },
          final: { freqs: [S.C4, S.E4, S.G4, S.A4, S.C5, S.E5, S.C5, S.A4], gain: 0.15, filterFreq: 2150 },
        },
      },
    },
  },
  studio: {
    cueVoice: "cue_studio",
    restChords: [[S.C3, S.G3], [S.G3, S.D4]],
    downbeat: {
      hold: {
        voice: "kick", endFreq: 48, durSec: 0.15,
        base: { freq: S.C3, gain: 0.09 },
        accent: { freq: S.C3, gain: 0.14 },
        final: { freq: S.D3, gain: 0.18 },
      },
      rep: {
        voice: "kick", endFreq: 48, durSec: 0.19,
        base: { freqs: [S.C3], gain: 0.22 },
        final: { freqs: [S.D3], gain: 0.26 },
      },
    },
    turnaround: {
      voice: "snare", durSec: 0.14,
      base: { freq: S.G3, endFreq: S.C3, gain: 0.19, filterFreq: 2000 },
      final: { freq: S.A3, endFreq: S.C3, gain: 0.23, filterFreq: 2600 },
    },
    subdivision: {
      hold: {
        voice: "shaker", durSec: 0.045,
        base: { gain: 0.045, filterFreq: 4800 },
        final: { gain: 0.08, filterFreq: 5800 },
      },
      rep: {
        accentStep4: 3,
        accent: {
          voice: "rim", durSec: 0.05, endFreq: S.E4,
          base: { freqs: [S.A4], gain: 0.1, filterFreq: 2500 },
          final: { freqs: [S.C5], gain: 0.13, filterFreq: 3200 },
        },
        offbeat: {
          voice: "shaker", durSec: 0.05,
          base: { gain: 0.075, filterFreq: 5400 },
          final: { gain: 0.1, filterFreq: 6800 },
        },
      },
    },
  },
});

export const CUES = deepFreeze({
  countdown: {
    minimal: { voice: "cue_sine", freq: 440, durSec: 0.09, gain: 0.16 },
    themed: { durSec: 0.09, gain: 0.14, freqByRemaining: { 1: S.E4, 2: S.C4, default: S.A3 } },
  },
  startSignal: {
    minimal: [
      { voice: "cue_tri", freq: 784, durSec: 0.1, gain: 0.22, delaySec: 0 },
      { voice: "cue_tri", freq: 1046.5, durSec: 0.18, gain: 0.25, delaySec: 0.13 },
    ],
    themed: [
      { freq: S.E4, durSec: 0.1, gain: 0.16, delaySec: 0 },
      { freq: S.A4, durSec: 0.18, gain: 0.18, delaySec: 0.12 },
    ],
  },
  midRep: {
    minimalOnly: true,
    minimal: [{ voice: "cue_tri", freq: 330, durSec: 0.045, gain: 0.09, delaySec: 0 }],
  },
  repDone: {
    minimalOnly: true,
    minimal: { voice: "cue_sine", durSec: 0.085, gain: 0.2, freqByLeft: { 0: 830, 1: 830, 2: 740, default: 660 } },
  },
  holdTick: {
    minimalOnly: true,
    minimal: {
      voice: "cue_sine",
      normal: { freq: 480, durSec: 0.035, gain: 0.07 },
      final3: { freq: 660, durSec: 0.08, gain: 0.18 },
    },
  },
  stopSet: {
    minimal: [
      { voice: "cue_tri", freq: 880, durSec: 0.09, gain: 0.22, delaySec: 0 },
      { voice: "cue_tri", freq: 880, durSec: 0.09, gain: 0.22, delaySec: 0.12 },
      { voice: "cue_tri", freq: 587.3, durSec: 0.22, gain: 0.24, delaySec: 0.25 },
    ],
    themed: [
      { freq: S.E4, durSec: 0.09, gain: 0.16, delaySec: 0 },
      { freq: S.C4, durSec: 0.09, gain: 0.16, delaySec: 0.12 },
      { freq: S.A3, durSec: 0.22, gain: 0.18, delaySec: 0.24 },
    ],
  },
  workoutComplete: {
    minimal: [
      { voice: "cue_tri", freq: 523.25, durSec: 0.12, gain: 0.22, delaySec: 0 },
      { voice: "cue_tri", freq: 659.25, durSec: 0.12, gain: 0.22, delaySec: 0.13 },
      { voice: "cue_tri", freq: 783.99, durSec: 0.12, gain: 0.22, delaySec: 0.26 },
      { voice: "cue_tri", freq: 1046.5, durSec: 0.3, gain: 0.26, delaySec: 0.39 },
    ],
    themed: [
      { freq: S.C4, durSec: 0.12, gain: 0.17, delaySec: 0 },
      { freq: S.E4, durSec: 0.12, gain: 0.17, delaySec: 0.13 },
      { freq: S.G4, durSec: 0.12, gain: 0.17, delaySec: 0.26 },
      { freq: S.C5, durSec: 0.3, gain: 0.2, delaySec: 0.39 },
    ],
  },
});
