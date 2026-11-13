"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
let distDir = process.env.TA_DIST_DIR || "";
let ownedTempDir = "";
let presets, pattern, synth, sound, domain;

before(() => {
  if (!distDir || !fs.existsSync(path.join(distDir, "data", "catalog.json"))) {
    ownedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-sound-layers-"));
    distDir = path.join(ownedTempDir, "dist");
    execFileSync("uv", ["run", "training-aid", "--build-only", "--out-dir", distDir], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  }
  presets = require(path.join(distDir, "static", "sound-presets.js"));
  pattern = require(path.join(distDir, "static", "sound-pattern.js"));
  synth = require(path.join(distDir, "static", "sound-synth.js"));
  sound = require(path.join(distDir, "static", "sound.js"));
  domain = require(path.join(distDir, "domain.js"));
});

after(() => {
  if (ownedTempDir) fs.rmSync(ownedTempDir, { recursive: true, force: true });
});

test("Layer 1 (sound-presets.js): frozen data, unified theme registry, and zero dead fields", () => {
  assert.ok(Object.isFrozen(presets));
  assert.ok(Object.isFrozen(presets.THEMES));
  assert.ok(Object.isFrozen(presets.VOICES));
  assert.ok(Object.isFrozen(presets.THEME_PRESETS));
  assert.ok(Object.isFrozen(presets.CUES));
  assert.equal(domain.VALID_SOUND_THEMES, presets.VALID_SOUND_THEMES);

  for (const [themeId, spec] of Object.entries(presets.THEME_PRESETS)) {
    assert.ok(presets.VOICES[spec.cueVoice], `${themeId} missing cueVoice ${spec.cueVoice}`);
    assert.equal(spec.restChords.length, 2);
    for (const mode of ["hold", "rep"]) {
      const db = spec.downbeat[mode];
      assert.ok(presets.VOICES[db.voice], `${themeId} downbeat.${mode} unknown voice`);
    }
    assert.ok(presets.VOICES[spec.turnaround.voice]);
    assert.ok(presets.VOICES[spec.subdivision.hold.voice]);
    assert.ok(presets.VOICES[spec.subdivision.rep.accent.voice]);
    if (!spec.subdivision.rep.accentAll) {
      assert.ok(presets.VOICES[spec.subdivision.rep.offbeat.voice]);
    }
  }

  // Verify noise voices carry no dead pitch fields and studio sine kick carries no dead filterFreq
  assert.equal("freq" in presets.THEME_PRESETS.techno.subdivision.hold.base, false);
  assert.equal("freq" in presets.THEME_PRESETS.studio.subdivision.hold.base, false);
  assert.equal("filterFreq" in presets.THEME_PRESETS.studio.downbeat.rep.base, false);
});

test("Layer 2 (sound-pattern.js): pure pattern, rest-pad, and cue planning without AudioContext", () => {
  assert.deepEqual(pattern.buildRepPattern({ theme: "off", repSeconds: 2.8 }), []);
  assert.deepEqual(pattern.buildRepPattern({ theme: "minimal", repSeconds: 2.8 }), []);

  const technoHold = pattern.buildRepPattern({
    theme: "techno", repSeconds: 1.0, isHold: true, repIndex: 0, totalReps: 10,
  });
  assert.equal(technoHold.length, 2);
  assert.equal(technoHold[0].freq, presets.SCALE.C3); // 4-tick accent at repIndex=0
  assert.equal("freq" in technoHold[1], false); // hat has no dead freq

  assert.equal(pattern.buildRestPadEvent("minimal", 0), null);
  const pad0 = pattern.buildRestPadEvent("trance", 0);
  const pad1 = pattern.buildRestPadEvent("trance", 1);
  assert.deepEqual([pad0.freq, pad0.freq2], [presets.SCALE.A3, presets.SCALE.E4]);
  assert.deepEqual([pad1.freq, pad1.freq2], [presets.SCALE.C4, presets.SCALE.G4]);

  assert.deepEqual(pattern.resolveCueEvents("off", "startSignal"), []);
  assert.deepEqual(pattern.resolveCueEvents("techno", "midRep"), []);
  assert.equal(pattern.resolveCueEvents("minimal", "midRep")[0].freq, 330);
  assert.equal(pattern.resolveCueEvents("trance", "countdown", { remaining: 1 })[0].freq, presets.SCALE.E4);
  assert.equal(pattern.resolveCueEvents("trance", "countdown", { remaining: 1 })[0].voice, "cue_trance");
  assert.equal(pattern.resolveCueEvents("minimal", "repDone", { rep: 9, total: 10 })[0].freq, 830);
  assert.equal(pattern.resolveCueEvents("minimal", "repDone", { rep: 8, total: 10 })[0].freq, 740);
  assert.equal(pattern.resolveCueEvents("minimal", "repDone", { rep: 3, total: 10 })[0].freq, 660);
  assert.equal(pattern.resolveCueEvents("minimal", "holdTick", { remaining: 2 })[0].freq, 660);
  assert.equal(pattern.resolveCueEvents("minimal", "holdTick", { remaining: 6 })[0].freq, 480);
  assert.equal(pattern.resolveCueEvents("studio", "workoutComplete").length, 4);
});

test("Layer 3 & 4 (sound-synth.js & sound.js): envelope ramp clamping, master bus, and async resume", async () => {
  const rampTimes = [];
  const makeTrackedParam = (init) => ({
    value: init,
    setValueAtTime(v, t) { this.value = v; rampTimes.push(["set", t]); },
    linearRampToValueAtTime(v, t) { this.value = v; rampTimes.push(["lin", t]); },
    exponentialRampToValueAtTime(v, t) { this.value = v; rampTimes.push(["exp", t]); },
  });

  let resumeResolver = null;
  const ctx = {
    currentTime: 5.0,
    state: "suspended",
    sampleRate: 22050,
    destination: { kind: "dest" },
    sources: [],
    gains: [],
    resume() {
      return new Promise((resolve) => {
        resumeResolver = () => {
          this.state = "running";
          resolve();
        };
      });
    },
    createGain() {
      const g = { gain: makeTrackedParam(1), connectedTo: null, connect(d) { this.connectedTo = d; }, disconnect() {} };
      this.gains.push(g);
      return g;
    },
    createOscillator() {
      const o = { type: "sine", frequency: makeTrackedParam(440), connect() {}, disconnect() {}, start() {}, stop() {} };
      this.sources.push(o);
      return o;
    },
    createBiquadFilter() {
      return { type: "lowpass", frequency: makeTrackedParam(1000), Q: makeTrackedParam(1), connect() {}, disconnect() {} };
    },
    createBuffer(_ch, len, sr) {
      const data = new Float32Array(len);
      return { sampleRate: sr, length: len, getChannelData: () => data };
    },
    createBufferSource() {
      const b = { buffer: null, connect() {}, disconnect() {}, start() {}, stop() {} };
      this.sources.push(b);
      return b;
    },
  };

  // Ultra-short duration (0.004s < 0.01s attack) still schedules monotonically ordered ramps
  synth.envGain(ctx, 10.0, 0.2, 0.01, 0.004);
  assert.equal(rampTimes[0][1], 10.0);
  assert.ok(rampTimes[1][1] > rampTimes[0][1] && rampTimes[1][1] < rampTimes[2][1]);

  // White-noise buffer is cached per AudioContext via WeakMap
  assert.equal(synth.buildWhiteNoiseBuffer(ctx), synth.buildWhiteNoiseBuffer(ctx));

  // Suspended AudioContext schedules lookahead immediately once async resume() resolves
  const ctrl = sound.createController({ theme: "techno", audioContextFactory: () => ctx });
  ctrl.ensureAudio();
  ctrl.beginPhase("ACTIVE", { repSeconds: 2.6, reps: 4, tempoMode: "standard", isHold: false });
  assert.equal(ctx.sources.length, 0);
  resumeResolver();
  await Promise.resolve();
  assert.ok(ctx.sources.length >= 2);
  assert.equal(ctx.gains[1].connectedTo, ctx.destination); // master bus connected to destination
});
