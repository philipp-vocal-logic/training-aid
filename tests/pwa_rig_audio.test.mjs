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

test("rig/motion.js exports, FK parity & safe-grip bounds across all catalog.svgs", () => {
  assert.ok(Array.isArray(motionMod.RIG_SELECTORS));
  assert.ok(Object.isFrozen(motionMod.RIG_SELECTORS));
  for (const sel of [
    ".js-clavicle",
    ".js-pelvis",
    ".js-j-shoulder-b",
    ".js-j-hip-b",
    ".js-j-knee-b",
    ".js-j-elbow-b",
  ]) {
    assert.ok(motionMod.RIG_SELECTORS.includes(sel), `Missing selector ${sel}`);
  }

  const entries = Object.entries(catalog.svgs);
  const expectedCount = new Set(entries.map(([k]) => k.split(":")[0])).size * 7;
  assert.ok(expectedCount >= 126);
  assert.equal(entries.length, expectedCount);

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

test("rig/motion.js coronal view='front' bilateral FK, isometric swapSides, props, shadow, and rest breath", () => {
  const motionSrc = fs.readFileSync(path.join(distDir, "rig", "motion.js"), "utf8");
  const renderStart = motionSrc.indexOf("function renderPoseState");
  const renderEnd = motionSrc.indexOf("function applyPose");
  assert.ok(renderStart > 0 && renderEnd > renderStart);
  assert.equal(motionSrc.slice(renderStart, renderEnd).includes("querySelector"), false);

  const baseBones = {
    lumbar: 22.0,
    thoracic: 22.0,
    neck: 19.0,
    uarm: 25.0,
    farm: 24.0,
    thigh: 36.0,
    shin: 36.0,
    back_dx: -5.0,
    back_dy: -2.0,
  };
  const asymPose = {
    hip_x: 108.0,
    hip_y: 96.0,
    lumbar: -82.0,
    thoracic: -85.0,
    neck: -88.0,
    uarm_f: 25.0,
    farm_f: -10.0,
    uarm_b: 140.0,
    farm_b: 165.0,
    thigh_f: 78.0,
    shin_f: 92.0,
    thigh_b: 108.0,
    shin_b: 98.0,
  };

  function bindTestRig(extraDataset = {}, bones = baseBones) {
    const els = makeRigElementMap(motionMod.RIG_SELECTORS);
    const rig = motionMod.bindSvg({
      dataset: {
        bones: JSON.stringify(bones),
        poseA: JSON.stringify(asymPose),
        poseB: JSON.stringify(asymPose),
        tempoMode: "standard",
        holdStyle: "settle",
        equipment: "body_only",
        ...extraDataset,
      },
      querySelector: (sel) => els[sel] || null,
    });
    return { els, rig };
  }

  // Bilateral sockets (default pelvis_r=9.5, clavicle_r=14.5) & isometric swapSides reflection across x=120
  const frontDefault = bindTestRig({ view: "front" });
  frontDefault.rig.applyPose(0, { swapSides: false });
  const shF0 = [Number(frontDefault.els[".js-j-shoulder"].attrs.cx), Number(frontDefault.els[".js-j-shoulder"].attrs.cy)];
  const shB0 = [Number(frontDefault.els[".js-j-shoulder-b"].attrs.cx), Number(frontDefault.els[".js-j-shoulder-b"].attrs.cy)];
  const hpF0 = [Number(frontDefault.els[".js-j-hip"].attrs.cx), Number(frontDefault.els[".js-j-hip"].attrs.cy)];
  const hpB0 = [Number(frontDefault.els[".js-j-hip-b"].attrs.cx), Number(frontDefault.els[".js-j-hip-b"].attrs.cy)];
  assert.ok(Math.abs(Math.hypot(shF0[0] - shB0[0], shF0[1] - shB0[1]) - 29.0) < 0.05);
  assert.ok(Math.abs(Math.hypot(hpF0[0] - hpB0[0], hpF0[1] - hpB0[1]) - 19.0) < 0.05);
  assert.equal(frontDefault.els[".js-clavicle"].attrs.x1, frontDefault.els[".js-j-shoulder-b"].attrs.cx);
  assert.equal(frontDefault.els[".js-clavicle"].attrs.x2, frontDefault.els[".js-j-shoulder"].attrs.cx);
  assert.equal(frontDefault.els[".js-pelvis"].attrs.x1, frontDefault.els[".js-j-hip-b"].attrs.cx);
  assert.equal(frontDefault.els[".js-pelvis"].attrs.x2, frontDefault.els[".js-j-hip"].attrs.cx);

  const handF0 = [Number(frontDefault.els[".js-farm-f"].attrs.x2), Number(frontDefault.els[".js-farm-f"].attrs.y2)];
  const handB0 = [Number(frontDefault.els[".js-farm-b"].attrs.x2), Number(frontDefault.els[".js-farm-b"].attrs.y2)];
  const head0 = [Number(frontDefault.els[".js-head"].attrs.cx), Number(frontDefault.els[".js-head"].attrs.cy)];
  const footF0 = [Number(frontDefault.els[".js-shin-f"].attrs.x2), Number(frontDefault.els[".js-shin-f"].attrs.y2)];
  const footB0 = [Number(frontDefault.els[".js-shin-b"].attrs.x2), Number(frontDefault.els[".js-shin-b"].attrs.y2)];

  frontDefault.rig.applyPose(0, { swapSides: true });
  const head1 = [Number(frontDefault.els[".js-head"].attrs.cx), Number(frontDefault.els[".js-head"].attrs.cy)];
  const shF1 = [Number(frontDefault.els[".js-j-shoulder"].attrs.cx), Number(frontDefault.els[".js-j-shoulder"].attrs.cy)];
  const shB1 = [Number(frontDefault.els[".js-j-shoulder-b"].attrs.cx), Number(frontDefault.els[".js-j-shoulder-b"].attrs.cy)];
  const handF1 = [Number(frontDefault.els[".js-farm-f"].attrs.x2), Number(frontDefault.els[".js-farm-f"].attrs.y2)];
  const handB1 = [Number(frontDefault.els[".js-farm-b"].attrs.x2), Number(frontDefault.els[".js-farm-b"].attrs.y2)];
  const footF1 = [Number(frontDefault.els[".js-shin-f"].attrs.x2), Number(frontDefault.els[".js-shin-f"].attrs.y2)];
  const footB1 = [Number(frontDefault.els[".js-shin-b"].attrs.x2), Number(frontDefault.els[".js-shin-b"].attrs.y2)];
  assert.ok(Math.abs(head1[0] - (240 - head0[0])) < 0.03 && Math.abs(head1[1] - head0[1]) < 0.03);
  assert.ok(Math.abs(shF1[0] - (240 - shB0[0])) < 0.03 && Math.abs(shF1[1] - shB0[1]) < 0.03);
  assert.ok(Math.abs(shB1[0] - (240 - shF0[0])) < 0.03 && Math.abs(shB1[1] - shF0[1]) < 0.03);
  assert.ok(Math.abs(handF1[0] - (240 - handB0[0])) < 0.03 && Math.abs(handF1[1] - handB0[1]) < 0.03);
  assert.ok(Math.abs(handB1[0] - (240 - handF0[0])) < 0.03 && Math.abs(handB1[1] - handF0[1]) < 0.03);
  assert.ok(Math.abs(footF1[0] - (240 - footB0[0])) < 0.03 && Math.abs(footF1[1] - footB0[1]) < 0.03);
  assert.ok(Math.abs(footB1[0] - (240 - footF0[0])) < 0.03 && Math.abs(footB1[1] - footF0[1]) < 0.03);

  // Explicit clavicle_r / pelvis_r override
  const customSockets = bindTestRig({ view: "front" }, { ...baseBones, clavicle_r: 20.0, pelvis_r: 12.0 });
  customSockets.rig.applyPose(0, { swapSides: false });
  assert.ok(
    Math.abs(
      Math.hypot(
        Number(customSockets.els[".js-clavicle"].attrs.x2) - Number(customSockets.els[".js-clavicle"].attrs.x1),
        Number(customSockets.els[".js-clavicle"].attrs.y2) - Number(customSockets.els[".js-clavicle"].attrs.y1),
      ) - 40.0,
    ) < 0.05,
  );

  // Level front barbell shaft (dy=0, 8.0 overhang) regardless of left/right hand order
  const frontBar = bindTestRig({ view: "front", equipment: "barbell" });
  frontBar.rig.applyPose(0, { swapSides: false });
  const barLeft = Number(frontBar.els[".js-farm-b"].attrs.x2) <= Number(frontBar.els[".js-farm-f"].attrs.x2)
    ? frontBar.els[".js-farm-b"].attrs
    : frontBar.els[".js-farm-f"].attrs;
  const barRight = Number(frontBar.els[".js-farm-b"].attrs.x2) <= Number(frontBar.els[".js-farm-f"].attrs.x2)
    ? frontBar.els[".js-farm-f"].attrs
    : frontBar.els[".js-farm-b"].attrs;
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.x1) - (Number(barLeft.x2) - 8.0)) < 0.02);
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.y1) - Number(barLeft.y2)) < 0.02);
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.x2) - (Number(barRight.x2) + 8.0)) < 0.02);
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.y2) - Number(barRight.y2)) < 0.02);

  frontBar.rig.applyPose(0, { swapSides: true });
  const barLeftSwapped = Number(frontBar.els[".js-farm-b"].attrs.x2) <= Number(frontBar.els[".js-farm-f"].attrs.x2)
    ? frontBar.els[".js-farm-b"].attrs
    : frontBar.els[".js-farm-f"].attrs;
  const barRightSwapped = Number(frontBar.els[".js-farm-b"].attrs.x2) <= Number(frontBar.els[".js-farm-f"].attrs.x2)
    ? frontBar.els[".js-farm-f"].attrs
    : frontBar.els[".js-farm-b"].attrs;
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.x1) - (Number(barLeftSwapped.x2) - 8.0)) < 0.02);
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.y1) - Number(barLeftSwapped.y2)) < 0.02);
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.x2) - (Number(barRightSwapped.x2) + 8.0)) < 0.02);
  assert.ok(Math.abs(Number(frontBar.els[".js-bar-shaft"].attrs.y2) - Number(barRightSwapped.y2)) < 0.02);

  // Band target="span" and mirrored anchor under swapSides
  const spanBand = bindTestRig({ view: "front", equipment: "bands", bandTarget: "span", anchorX: "120", anchorY: "74" });
  spanBand.rig.applyPose(0, { swapSides: false });
  assert.equal(spanBand.els[".js-band-b"].attrs.x1, spanBand.els[".js-farm-b"].attrs.x2);
  assert.equal(spanBand.els[".js-band-b"].attrs.x2, spanBand.els[".js-farm-f"].attrs.x2);
  assert.equal(spanBand.els[".js-band-f"].attrs.x1, spanBand.els[".js-farm-b"].attrs.x2);
  assert.equal(spanBand.els[".js-band-f"].attrs.x2, spanBand.els[".js-farm-f"].attrs.x2);

  const shoulderBand = bindTestRig({ view: "front", equipment: "bands", bandTarget: "shoulder", anchorX: "146", anchorY: "173" });
  shoulderBand.rig.applyPose(0, { swapSides: true });
  assert.equal(shoulderBand.els[".js-band-b"].attrs.x1, "94.00");
  assert.equal(shoulderBand.els[".js-band-b"].attrs.x2, shoulderBand.els[".js-j-shoulder-b"].attrs.cx);
  assert.equal(shoulderBand.els[".js-band-f"].attrs.x2, shoulderBand.els[".js-j-shoulder"].attrs.cx);

  const frontCable = bindTestRig({ view: "front", equipment: "cable", cableTarget: "hand", anchorX: "182", anchorY: "48" });
  frontCable.rig.applyPose(0, { swapSides: false });
  assert.equal(frontCable.els[".js-cable"].attrs.x1, "182.00");
  frontCable.rig.applyPose(0, { swapSides: true });
  assert.equal(frontCable.els[".js-cable"].attrs.x1, "58.00");

  // Shadow bounds include handB[0]
  const shadowEls = makeRigElementMap(motionMod.RIG_SELECTORS);
  const shadowPose = {
    hip_x: 120.0, hip_y: 96.0, lumbar: -90.0, thoracic: -90.0, neck: -90.0,
    uarm_f: 90.0, farm_f: 90.0, uarm_b: 180.0, farm_b: 180.0,
    thigh_f: 90.0, shin_f: 90.0, thigh_b: 90.0, shin_b: 90.0,
  };
  const shadowRig = motionMod.bindSvg({
    dataset: {
      view: "front",
      bones: JSON.stringify(baseBones),
      poseA: JSON.stringify(shadowPose),
      poseB: JSON.stringify(shadowPose),
      equipment: "body_only",
    },
    querySelector: (sel) => shadowEls[sel] || null,
  });
  shadowRig.applyPose(0, { swapSides: false });
  const shMinX = Number(shadowEls[".js-farm-b"].attrs.x2);
  const shMaxX = Math.max(
    Number(shadowEls[".js-head"].attrs.cx),
    Number(shadowEls[".js-j-shoulder"].attrs.cx),
    Number(shadowEls[".js-j-hip"].attrs.cx),
    Number(shadowEls[".js-shin-f"].attrs.x2),
    Number(shadowEls[".js-shin-b"].attrs.x2),
    Number(shadowEls[".js-farm-f"].attrs.x2),
  );
  assert.ok(shMinX < 70.0);
  assert.ok(Math.abs(Number(shadowEls[".js-shadow"].attrs.cx) - (shMinX + shMaxX) * 0.5) < 0.03);

  // Front-view applyRestBreath keeps spine centered (no sway), lowers hip_y by 0.4*wave, abducts arms symmetrically
  const symPose = {
    hip_x: 120.0, hip_y: 96.0, lumbar: -90.0, thoracic: -90.0, neck: -90.0,
    uarm_f: 75.0, farm_f: 85.0, uarm_b: 105.0, farm_b: 95.0,
    thigh_f: 84.0, shin_f: 90.0, thigh_b: 96.0, shin_b: 90.0,
  };
  const breathEls = makeRigElementMap(motionMod.RIG_SELECTORS);
  const breathRig = motionMod.bindSvg({
    dataset: {
      view: "front",
      bones: JSON.stringify(baseBones),
      poseA: JSON.stringify(symPose),
      poseB: JSON.stringify(symPose),
      equipment: "body_only",
    },
    querySelector: (sel) => breathEls[sel] || null,
  });
  breathRig.applyRestBreath(0);
  const headRest0 = [Number(breathEls[".js-head"].attrs.cx), Number(breathEls[".js-head"].attrs.cy)];
  const handFRest0 = Number(breathEls[".js-farm-f"].attrs.x2);
  const handBRest0 = Number(breathEls[".js-farm-b"].attrs.x2);
  breathRig.applyRestBreath(Math.PI / (2 * 1.9));
  const headRestPeak = [Number(breathEls[".js-head"].attrs.cx), Number(breathEls[".js-head"].attrs.cy)];
  assert.equal(headRestPeak[0], headRest0[0]);
  assert.ok(Math.abs(headRestPeak[1] - (headRest0[1] - 0.4)) < 0.03);
  assert.ok(Number(breathEls[".js-farm-f"].attrs.x2) > handFRest0);
  assert.ok(Number(breathEls[".js-farm-b"].attrs.x2) < handBRest0);
});
