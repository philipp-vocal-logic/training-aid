"use strict";
const fs = require("node:fs");

const motionSrc = fs.readFileSync(process.env.TA_MOTION_JS, "utf8");
const combos = JSON.parse(process.env.TA_COMBOS_JSON || "[]");
globalThis.window = globalThis;
new Function(motionSrc)();
const TM = globalThis.TrainingMotion;
if (!TM || typeof TM.bindSvg !== "function") {
  throw new Error("TrainingMotion.bindSvg missing");
}

const SELECTORS = [
  ".js-head", ".js-neck", ".js-torso", ".js-thigh-f", ".js-shin-f",
  ".js-thigh-b", ".js-shin-b", ".js-forefoot-f", ".js-forefoot-b",
  ".js-uarm-f", ".js-farm-f", ".js-uarm-b", ".js-farm-b",
  ".js-j-shoulder", ".js-j-hip", ".js-j-knee", ".js-j-elbow",
  ".js-weight", ".js-weight-cap", ".js-weight-b", ".js-kb-handle-f",
  ".js-bar-shaft", ".js-bar-hub", ".js-band-f", ".js-band-b",
  ".js-cable", ".js-cable-grip", ".js-shadow", ".js-aura", ".js-ring", ".js-pulse",
];

const failures = [];
for (const item of combos) {
  const els = {};
  for (const sel of SELECTORS) {
    els[sel] = { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
  }
  const rig = TM.bindSvg({
    dataset: {
      bones: JSON.stringify(item.bones),
      poseA: JSON.stringify(item.pose_a),
      poseB: JSON.stringify(item.pose_b),
      tempoMode: item.tempo_mode,
      holdStyle: item.hold_style,
      equipment: item.eq_mode,
      barMode: item.bar_mode,
    },
    querySelector: (sel) => els[sel] || null,
  });

  const runs = [];
  for (const swap of [false, true]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      runs.push([true, () => rig.applyPose(t, { swapSides: swap })]);
    }
  }
  runs.push([false, () => rig.applyHold(0.25)], [false, () => rig.applyHold(1.0)]);
  for (const ph of [0, 0.8, 2.4]) runs.push([false, () => rig.applyRestBreath(ph)]);

  for (const [isPoseRun, stepFn] of runs) {
    stepFn();
    const hf = [Number(els[".js-farm-f"].attrs.x2), Number(els[".js-farm-f"].attrs.y2)];
    const hb = [Number(els[".js-farm-b"].attrs.x2), Number(els[".js-farm-b"].attrs.y2)];
    const wf = [Number(els[".js-weight"].attrs.cx), Number(els[".js-weight"].attrs.cy)];
    const wb = [Number(els[".js-weight-b"].attrs.cx), Number(els[".js-weight-b"].attrs.cy)];
    if (item.eq_mode === "barbell" || item.eq_mode === "dumbbell") {
      const rf = item.eq_mode === "barbell" ? 11.5 : 8.2;
      const rb = item.eq_mode === "barbell" ? 10.0 : 7.0;
      if (Math.hypot(wf[0] - hf[0], wf[1] - hf[1]) > 0.03 || Math.hypot(wb[0] - hb[0], wb[1] - hb[1]) > 0.03) {
        failures.push(`${item.arch}:${item.eq_mode} detached`);
        break;
      }
      if (isPoseRun && (wf[1] + rf > 175.01 || wb[1] + rb > 175.01 || wf[0] - rf < -0.01 || wf[0] + rf > 240.01)) {
        failures.push(`${item.arch}:${item.eq_mode} out of bounds`);
        break;
      }
    } else if (item.eq_mode === "kettlebells") {
      const hdl = [Number(els[".js-kb-handle-f"].attrs.cx), Number(els[".js-kb-handle-f"].attrs.cy)];
      if (Math.hypot(hdl[0] - hf[0], hdl[1] - hf[1]) > 3.0) {
        failures.push(`${item.arch}:kettlebells handle detached`);
        break;
      }
      if (isPoseRun && (wf[1] + 8.4 > 175.01 || wb[1] + 7.2 > 175.01 || wf[0] - 8.4 < -0.01 || wf[0] + 8.4 > 240.01)) {
        failures.push(`${item.arch}:kettlebells bell out of bounds`);
        break;
      }
    }
  }
}
process.stdout.write(JSON.stringify({ failures }));
