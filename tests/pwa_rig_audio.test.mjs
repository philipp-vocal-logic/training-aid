// Unit and integration tests for pwa/rig/motion.js and pwa/audio/{presets,pattern,synth,controller}.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveBuiltDist,
  importDistModule,
  parseSvgOpenAttrs,
  makeRigElementMap,
  toCamel,
  MockAudioContext,
} from "./helpers/dom_harness.mjs";

let distHandle;
let catalog;
let distDir;
let motionMod;
let presetsMod;
let patternMod;
let synthMod;
let controllerMod;
let constantsMod;

before(async () => {
  distHandle = resolveBuiltDist("ta-rig-audio-");
  catalog = distHandle.catalog;
  distDir = distHandle.distDir;
  globalThis.window = globalThis;
  globalThis.AudioContext = MockAudioContext;

  motionMod = await importDistModule(distDir, "rig", "motion.js");
  presetsMod = await importDistModule(distDir, "audio", "presets.js");
  patternMod = await importDistModule(distDir, "audio", "pattern.js");
  synthMod = await importDistModule(distDir, "audio", "synth.js");
  controllerMod = await importDistModule(distDir, "audio", "controller.js");
  constantsMod = await importDistModule(distDir, "core", "constants.js");
});

after(() => {
  if (distHandle) distHandle.cleanup();
});

test("rig/motion.js exports, FK parity & safe-grip bounds across all 126 catalog.svgs", () => {
  assert.ok(Array.isArray(motionMod.RIG_SELECTORS));
  assert.ok(Object.isFrozen(motionMod.RIG_SELECTORS));
  assert.ok(motionMod.RIG_SELECTORS.length >= 28);

  const entries = Object.entries(catalog.svgs);
  assert.equal(entries.length, 126);

  for (const [svgKey, markup] of entries) {
    assert.ok(svgKey.includes(":"));
    const dataset = {};
    for (const [k, v] of Object.entries(parseSvgOpenAttrs(markup))) {
      if (k.startsWith("data-")) dataset[toCamel(k.slice(5))] = v;
    }
    const els = makeRigElementMap(motionMod.RIG_SELECTORS);
    const rig = motionMod.bindSvg({
      dataset,
      querySelector: (sel) => els[sel] || null,
    });
    for (const t of [0, 0.5, 1]) rig.applyPose(t, { swapSides: t === 1 });
    rig.applyHold(0.25);
    rig.applyRestBreath(0.8);
    rig.applyPose(0.5);

    const hf = [
      Number(els[".js-farm-f"].attrs.x2),
      Number(els[".js-farm-f"].attrs.y2),
    ];
    if (dataset.equipment === "barbell" || dataset.equipment === "dumbbell") {
      const wf = [
        Number(els[".js-weight"].attrs.cx),
        Number(els[".js-weight"].attrs.cy),
      ];
      assert.ok(Math.hypot(wf[0] - hf[0], wf[1] - hf[1]) <= 0.03);
    } else if (dataset.equipment === "kettlebells") {
      const hdl = [
        Number(els[".js-kb-handle-f"].attrs.cx),
        Number(els[".js-kb-handle-f"].attrs.cy),
      ];
      assert.ok(Math.hypot(hdl[0] - hf[0], hdl[1] - hf[1]) <= 3.0);
    }
  }
});

test("Layer 1 & 2 (audio/presets.js & audio/pattern.js): frozen data, theme registry, and pure pattern planning", () => {
  assert.ok(Object.isFrozen(presetsMod.THEMES));
  assert.ok(Object.isFrozen(presetsMod.VOICES));
  assert.ok(Object.isFrozen(presetsMod.THEME_PRESETS));
  assert.ok(Object.isFrozen(presetsMod.CUES));
  assert.equal(constantsMod.VALID_SOUND_THEMES, presetsMod.VALID_SOUND_THEMES);

  for (const [themeId, spec] of Object.entries(presetsMod.THEME_PRESETS)) {
    assert.ok(presetsMod.VOICES[spec.cueVoice], `${themeId} missing cueVoice`);
    assert.equal(spec.restChords.length, 2);
    for (const mode of ["hold", "rep"]) {
      assert.ok(presetsMod.VOICES[spec.downbeat[mode].voice]);
    }
    assert.ok(presetsMod.VOICES[spec.turnaround.voice]);
    assert.ok(presetsMod.VOICES[spec.subdivision.hold.voice]);
    assert.ok(presetsMod.VOICES[spec.subdivision.rep.accent.voice]);
    if (!spec.subdivision.rep.accentAll) {
      assert.ok(presetsMod.VOICES[spec.subdivision.rep.offbeat.voice]);
    }
  }

  assert.equal("freq" in presetsMod.THEME_PRESETS.techno.subdivision.hold.base, false);
  assert.equal("freq" in presetsMod.THEME_PRESETS.studio.subdivision.hold.base, false);
  assert.equal("filterFreq" in presetsMod.THEME_PRESETS.studio.downbeat.rep.base, false);

  assert.equal(patternMod.subdivisionsForRep(1.0, true), 2);
  assert.equal(patternMod.subdivisionsForRep(2.2, false), 4);
  assert.equal(patternMod.subdivisionsForRep(2.8, false), 8);

  assert.deepEqual(patternMod.buildRepPattern({ theme: "off", repSeconds: 2.8 }), []);
  assert.deepEqual(patternMod.buildRepPattern({ theme: "minimal", repSeconds: 2.8 }), []);

  const technoHold = patternMod.buildRepPattern({
    theme: "techno",
    repSeconds: 1.0,
    isHold: true,
    repIndex: 0,
    totalReps: 10,
  });
  assert.equal(technoHold.length, 2);
  assert.equal(technoHold[0].freq, presetsMod.SCALE.C3);
  assert.equal("freq" in technoHold[1], false);

  assert.equal(patternMod.buildRestPadEvent("minimal", 0), null);
  const pad0 = patternMod.buildRestPadEvent("trance", 0);
  const pad1 = patternMod.buildRestPadEvent("trance", 1);
  assert.deepEqual([pad0.freq, pad0.freq2], [presetsMod.SCALE.A3, presetsMod.SCALE.E4]);
  assert.deepEqual([pad1.freq, pad1.freq2], [presetsMod.SCALE.C4, presetsMod.SCALE.G4]);

  assert.deepEqual(patternMod.resolveCueEvents("off", "startSignal"), []);
  assert.deepEqual(patternMod.resolveCueEvents("techno", "midRep"), []);
  assert.equal(patternMod.resolveCueEvents("minimal", "midRep")[0].freq, 330);
  assert.equal(
    patternMod.resolveCueEvents("trance", "countdown", { remaining: 1 })[0].freq,
    presetsMod.SCALE.E4
  );
  assert.equal(patternMod.resolveCueEvents("studio", "workoutComplete").length, 4);
});

test("Layer 3 & 4 (audio/synth.js & audio/controller.js): zero localStorage, ramp clamping, WeakMap cache, async resume, retimePhase, and cleanup", async () => {
  for (const rel of ["presets.js", "pattern.js", "synth.js", "controller.js"]) {
    const src = fs.readFileSync(path.join(distDir, "audio", rel), "utf8");
    assert.ok(!src.includes("localStorage"), `audio/${rel} must not reference localStorage`);
  }

  const rampTimes = [];
  const makeTrackedParam = (init) => ({
    value: init,
    setValueAtTime(v, t) {
      this.value = v;
      rampTimes.push(["set", t]);
    },
    linearRampToValueAtTime(v, t) {
      this.value = v;
      rampTimes.push(["lin", t]);
    },
    exponentialRampToValueAtTime(v, t) {
      this.value = v;
      rampTimes.push(["exp", t]);
    },
  });

  let resumeResolver = null;
  const suspendedCtx = {
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
      const g = {
        gain: makeTrackedParam(1),
        connectedTo: null,
        connect(d) {
          this.connectedTo = d;
        },
        disconnect() {},
      };
      this.gains.push(g);
      return g;
    },
    createOscillator() {
      const o = {
        type: "sine",
        frequency: makeTrackedParam(440),
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
      this.sources.push(o);
      return o;
    },
    createBiquadFilter() {
      return {
        type: "lowpass",
        frequency: makeTrackedParam(1000),
        Q: makeTrackedParam(1),
        connect() {},
        disconnect() {},
      };
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

  synthMod.envGain(suspendedCtx, 10.0, 0.2, 0.01, 0.004);
  assert.equal(rampTimes[0][1], 10.0);
  assert.ok(rampTimes[1][1] > rampTimes[0][1] && rampTimes[1][1] < rampTimes[2][1]);
  assert.equal(
    synthMod.buildWhiteNoiseBuffer(suspendedCtx),
    synthMod.buildWhiteNoiseBuffer(suspendedCtx)
  );

  const suspendedCtrl = controllerMod.createController({
    theme: "techno",
    audioContextFactory: () => suspendedCtx,
  });
  suspendedCtrl.ensureAudio();
  suspendedCtrl.beginPhase("ACTIVE", {
    repSeconds: 2.6,
    reps: 4,
    tempoMode: "standard",
    isHold: false,
  });
  assert.equal(suspendedCtx.sources.length, 0);
  resumeResolver();
  await Promise.resolve();
  assert.ok(suspendedCtx.sources.length >= 2);
  assert.equal(suspendedCtx.gains[1].connectedTo, suspendedCtx.destination);

  const ctrl = controllerMod.createController({
    turnaroundForMode: motionMod.turnaroundForMode,
  });
  const ctx = ctrl.ensureAudio();
  ctrl.beginPhase("ACTIVE", {
    repSeconds: 2.8,
    reps: 4,
    tempoMode: "standard",
    isHold: false,
  });
  ctx.currentTime = 11.4;
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 1.4) < 1e-6);
  ctrl.retimePhase({ repSeconds: 2.0 }, 1.0);
  ctx.currentTime = 11.5;
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 1.1) < 1e-6);
  ctx.currentTime = 11.7;
  ctrl.retimePhase({ repSeconds: 1.8 });
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 1.3) < 1e-6);
  ctrl.stopAll();
  assert.ok(ctx.sources.every((s) => s.immediateStopped && s.disconnected));
});
