// Native ESM rig safe-grip checker invoked by training_aid.audit.rig_checks.
import { pathToFileURL } from "node:url";
import { makeRigElementMap } from "./helpers/dom_harness.mjs";

const motionPath = process.env.TA_MOTION_JS;
if (!motionPath) {
  throw new Error("TA_MOTION_JS environment variable is required");
}

const combos = JSON.parse(process.env.TA_COMBOS_JSON || "[]");
const motionMod = await import(pathToFileURL(motionPath).href);
const { bindSvg, RIG_SELECTORS } = motionMod;

if (typeof bindSvg !== "function" || !Array.isArray(RIG_SELECTORS)) {
  throw new Error("motion.js must export bindSvg and RIG_SELECTORS");
}

const failures = [];
for (const item of combos) {
  const els = makeRigElementMap(RIG_SELECTORS);
  const rig = bindSvg({
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
  for (const ph of [0, 0.8, 2.4]) {
    runs.push([false, () => rig.applyRestBreath(ph)]);
  }

  for (const [isPoseRun, stepFn] of runs) {
    stepFn();
    const hf = [
      Number(els[".js-farm-f"].attrs.x2),
      Number(els[".js-farm-f"].attrs.y2),
    ];
    const hb = [
      Number(els[".js-farm-b"].attrs.x2),
      Number(els[".js-farm-b"].attrs.y2),
    ];
    const wf = [
      Number(els[".js-weight"].attrs.cx),
      Number(els[".js-weight"].attrs.cy),
    ];
    const wb = [
      Number(els[".js-weight-b"].attrs.cx),
      Number(els[".js-weight-b"].attrs.cy),
    ];
    if (item.eq_mode === "barbell" || item.eq_mode === "dumbbell") {
      const rf = item.eq_mode === "barbell" ? 11.5 : 8.2;
      const rb = item.eq_mode === "barbell" ? 10.0 : 7.0;
      if (
        Math.hypot(wf[0] - hf[0], wf[1] - hf[1]) > 0.03 ||
        Math.hypot(wb[0] - hb[0], wb[1] - hb[1]) > 0.03
      ) {
        failures.push(`${item.arch}:${item.eq_mode} detached`);
        break;
      }
      if (
        isPoseRun &&
        (wf[1] + rf > 175.01 ||
          wb[1] + rb > 175.01 ||
          wf[0] - rf < -0.01 ||
          wf[0] + rf > 240.01)
      ) {
        failures.push(`${item.arch}:${item.eq_mode} out of bounds`);
        break;
      }
    } else if (item.eq_mode === "kettlebells") {
      const hdl = [
        Number(els[".js-kb-handle-f"].attrs.cx),
        Number(els[".js-kb-handle-f"].attrs.cy),
      ];
      if (Math.hypot(hdl[0] - hf[0], hdl[1] - hf[1]) > 3.0) {
        failures.push(`${item.arch}:kettlebells handle detached`);
        break;
      }
      if (
        isPoseRun &&
        (wf[1] + 8.4 > 175.01 ||
          wb[1] + 7.2 > 175.01 ||
          wf[0] - 8.4 < -0.01 ||
          wf[0] + 8.4 > 240.01)
      ) {
        failures.push(`${item.arch}:kettlebells bell out of bounds`);
        break;
      }
    }
  }
}

process.stdout.write(JSON.stringify({ failures }));
