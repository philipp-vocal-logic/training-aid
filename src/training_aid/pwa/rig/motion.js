const DEG_TO_RAD = Math.PI / 180;

export const RIG_SELECTORS = Object.freeze([
  ".js-head",
  ".js-neck",
  ".js-torso",
  ".js-thigh-f",
  ".js-shin-f",
  ".js-thigh-b",
  ".js-shin-b",
  ".js-forefoot-f",
  ".js-forefoot-b",
  ".js-uarm-f",
  ".js-farm-f",
  ".js-uarm-b",
  ".js-farm-b",
  ".js-j-shoulder",
  ".js-j-hip",
  ".js-j-knee",
  ".js-j-elbow",
  ".js-weight",
  ".js-weight-cap",
  ".js-weight-b",
  ".js-kb-handle-f",
  ".js-bar-shaft",
  ".js-bar-hub",
  ".js-band-f",
  ".js-band-b",
  ".js-cable",
  ".js-cable-grip",
  ".js-shadow",
  ".js-aura",
  ".js-ring",
  ".js-pulse",
]);

const TURNAROUND_BY_MODE = Object.freeze({
  standard: 0.43,
  explosive: 0.31,
  alternating: 0.5,
  hold: 1.0,
});

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function stepPt(origin, length, deg) {
  const rad = deg * DEG_TO_RAD;
  return [origin[0] + length * Math.cos(rad), origin[1] + length * Math.sin(rad)];
}

export function prefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

export function turnaroundForMode(mode) {
  return TURNAROUND_BY_MODE[mode] !== undefined ? TURNAROUND_BY_MODE[mode] : 0.43;
}

export function tempoCurve(frac, mode) {
  const f = ((frac % 1) + 1) % 1;
  if (mode === "alternating") {
    return 0.5 - 0.5 * Math.cos(f * Math.PI * 2);
  }
  if (mode === "explosive") {
    if (f < 0.26) return 0.5 - 0.5 * Math.cos((f / 0.26) * Math.PI);
    if (f < 0.36) return 1.0;
    return 0.5 + 0.5 * Math.cos(((f - 0.36) / 0.64) * Math.PI);
  }
  if (f < 0.38) return 0.5 - 0.5 * Math.cos((f / 0.38) * Math.PI);
  if (f < 0.48) return 1.0;
  return 0.5 + 0.5 * Math.cos(((f - 0.48) / 0.52) * Math.PI);
}

function setLineEl(el, p1, p2) {
  if (!el) return;
  el.setAttribute("x1", p1[0].toFixed(2));
  el.setAttribute("y1", p1[1].toFixed(2));
  el.setAttribute("x2", p2[0].toFixed(2));
  el.setAttribute("y2", p2[1].toFixed(2));
}

function setCircleEl(el, x, y) {
  if (!el) return;
  el.setAttribute("cx", x.toFixed(2));
  el.setAttribute("cy", y.toFixed(2));
}

export function bindSvg(svgEl) {
  if (!svgEl?.dataset?.poseA || !svgEl?.dataset?.poseB || !svgEl?.dataset?.bones) {
    return {
      applyPose() {},
      applyRestBreath() {},
      applyHold() {},
      tempoMode: svgEl?.dataset?.tempoMode || "standard",
      holdStyle: svgEl?.dataset?.holdStyle || "settle",
    };
  }

  const bones = JSON.parse(svgEl.dataset.bones);
  const poseA = JSON.parse(svgEl.dataset.poseA);
  const poseB = JSON.parse(svgEl.dataset.poseB);

  const tempoMode = svgEl.dataset.tempoMode || "standard";
  const holdStyle = svgEl.dataset.holdStyle || "settle";
  const eqMode = svgEl.dataset.equipment || "body_only";
  const bandTarget = svgEl.dataset.bandTarget || "hand";
  const cableTarget = svgEl.dataset.cableTarget || "hand";
  const anchorX = svgEl.dataset.anchorX !== undefined ? parseFloat(svgEl.dataset.anchorX) : null;
  const anchorY = svgEl.dataset.anchorY !== undefined ? parseFloat(svgEl.dataset.anchorY) : null;
  const forefootX = svgEl.dataset.forefootX !== undefined ? parseFloat(svgEl.dataset.forefootX) : null;
  const forefootY = svgEl.dataset.forefootY !== undefined ? parseFloat(svgEl.dataset.forefootY) : null;

  // Cache all DOM element references once at bind time
  const els = Object.fromEntries(RIG_SELECTORS.map((sel) => [sel, svgEl.querySelector(sel)]));

  function renderPoseState(pose, auraAmt, swapSides) {
    const uf = swapSides ? pose.uarm_b : pose.uarm_f;
    const ffAngle = swapSides ? pose.farm_b : pose.farm_f;
    const ub = swapSides ? pose.uarm_f : pose.uarm_b;
    const fbAngle = swapSides ? pose.farm_f : pose.farm_b;
    const tf = swapSides ? pose.thigh_b : pose.thigh_f;
    const sf = swapSides ? pose.shin_b : pose.shin_f;
    const tb = swapSides ? pose.thigh_f : pose.thigh_b;
    const sb = swapSides ? pose.shin_f : pose.shin_b;

    const hip = [pose.hip_x, pose.hip_y];
    const midSpine = stepPt(hip, bones.lumbar, pose.lumbar);
    const shoulder = stepPt(midSpine, bones.thoracic, pose.thoracic);
    const head = stepPt(shoulder, bones.neck, pose.neck);

    const hipB = [hip[0] + bones.back_dx, hip[1] + bones.back_dy];
    const shoulderB = [shoulder[0] + bones.back_dx, shoulder[1] + bones.back_dy];

    const kneeF = stepPt(hip, bones.thigh, tf);
    const footF = stepPt(kneeF, bones.shin, sf);
    const kneeB = stepPt(hipB, bones.thigh, tb);
    const footB = stepPt(kneeB, bones.shin, sb);

    const elbowF = stepPt(shoulder, bones.uarm, uf);
    const handF = stepPt(elbowF, bones.farm, ffAngle);
    const elbowB = stepPt(shoulderB, bones.uarm, ub);
    const handB = stepPt(elbowB, bones.farm, fbAngle);

    setCircleEl(els[".js-head"], head[0], head[1]);
    setLineEl(els[".js-neck"], shoulder, head);
    if (els[".js-torso"]) {
      els[".js-torso"].setAttribute(
        "d",
        `M ${hip[0].toFixed(2)} ${hip[1].toFixed(2)} Q ${midSpine[0].toFixed(2)} ${midSpine[1].toFixed(2)} ${shoulder[0].toFixed(2)} ${shoulder[1].toFixed(2)}`,
      );
    }

    setCircleEl(els[".js-j-shoulder"], shoulder[0], shoulder[1]);
    setCircleEl(els[".js-j-hip"], hip[0], hip[1]);
    setCircleEl(els[".js-j-knee"], kneeF[0], kneeF[1]);
    setCircleEl(els[".js-j-elbow"], elbowF[0], elbowF[1]);

    setLineEl(els[".js-thigh-f"], hip, kneeF);
    setLineEl(els[".js-shin-f"], kneeF, footF);
    setLineEl(els[".js-thigh-b"], hipB, kneeB);
    setLineEl(els[".js-shin-b"], kneeB, footB);

    if (forefootX !== null && forefootY !== null) {
      setLineEl(els[".js-forefoot-f"], footF, [forefootX, forefootY]);
      setLineEl(els[".js-forefoot-b"], footB, [forefootX - 5.0, forefootY - 1.0]);
    }

    setLineEl(els[".js-uarm-f"], shoulder, elbowF);
    setLineEl(els[".js-farm-f"], elbowF, handF);
    setLineEl(els[".js-uarm-b"], shoulderB, elbowB);
    setLineEl(els[".js-farm-b"], elbowB, handB);

    if (eqMode === "dumbbell") {
      setCircleEl(els[".js-weight"], handF[0], handF[1]);
      setCircleEl(els[".js-weight-cap"], handF[0], handF[1]);
      setCircleEl(els[".js-weight-b"], handB[0], handB[1]);
    } else if (eqMode === "kettlebells") {
      setCircleEl(els[".js-kb-handle-f"], handF[0], handF[1] + 2.5);
      setCircleEl(els[".js-weight"], handF[0], handF[1] + 9.0);
      setCircleEl(els[".js-weight-b"], handB[0], handB[1] + 8.0);
    } else if (eqMode === "barbell") {
      setCircleEl(els[".js-weight-b"], handB[0], handB[1]);
      setLineEl(
        els[".js-bar-shaft"],
        [handB[0] - 6.0, handB[1] - 2.0],
        [handF[0] + 6.0, handF[1] + 2.0],
      );
      setCircleEl(els[".js-weight"], handF[0], handF[1]);
      setCircleEl(els[".js-bar-hub"], handF[0], handF[1]);
    } else if (eqMode === "bands" && anchorX !== null && anchorY !== null) {
      const anchor = [anchorX, anchorY];
      let bTargetB = handB;
      let bTargetF = handF;
      if (bandTarget === "shoulder") {
        bTargetB = shoulderB;
        bTargetF = shoulder;
      } else if (bandTarget === "foot") {
        bTargetB = footB;
        bTargetF = footF;
      }
      setLineEl(els[".js-band-b"], anchor, bTargetB);
      setLineEl(els[".js-band-f"], anchor, bTargetF);
    } else if ((eqMode === "cable" || eqMode === "machine") && anchorX !== null && anchorY !== null) {
      const cAtt = cableTarget === "foot" ? footF : handF;
      setLineEl(els[".js-cable"], [anchorX, anchorY], cAtt);
      setCircleEl(els[".js-cable-grip"], cAtt[0], cAtt[1]);
    }

    if (els[".js-shadow"]) {
      const minX = Math.min(head[0], shoulder[0], hip[0], footF[0], footB[0], handF[0]);
      const maxX = Math.max(head[0], shoulder[0], hip[0], footF[0], footB[0], handF[0]);
      const sx = (minX + maxX) * 0.5;
      const rx = Math.max(22.0, Math.min(82.0, (maxX - minX) * 0.5 + 12.0));
      els[".js-shadow"].setAttribute("cx", sx.toFixed(2));
      els[".js-shadow"].setAttribute("rx", rx.toFixed(2));
    }

    if (els[".js-aura"]) els[".js-aura"].setAttribute("r", (80.0 + 8.0 * auraAmt).toFixed(2));
    if (els[".js-ring"]) els[".js-ring"].setAttribute("r", (62.0 + 6.0 * auraAmt).toFixed(2));
    if (els[".js-pulse"]) els[".js-pulse"].setAttribute("r", (21.0 + 9.0 * auraAmt).toFixed(2));
  }

  function applyPose(t, opts) {
    const pose = {
      hip_x: lerp(poseA.hip_x, poseB.hip_x, t),
      hip_y: lerp(poseA.hip_y, poseB.hip_y, t),
      lumbar: lerp(poseA.lumbar, poseB.lumbar, t),
      thoracic: lerp(poseA.thoracic, poseB.thoracic, t),
      neck: lerp(poseA.neck, poseB.neck, t),
      uarm_f: lerp(poseA.uarm_f, poseB.uarm_f, t),
      farm_f: lerp(poseA.farm_f, poseB.farm_f, t),
      uarm_b: lerp(poseA.uarm_b, poseB.uarm_b, t),
      farm_b: lerp(poseA.farm_b, poseB.farm_b, t),
      thigh_f: lerp(poseA.thigh_f, poseB.thigh_f, t),
      shin_f: lerp(poseA.shin_f, poseB.shin_f, t),
      thigh_b: lerp(poseA.thigh_b, poseB.thigh_b, t),
      shin_b: lerp(poseA.shin_b, poseB.shin_b, t),
    };
    renderPoseState(pose, t, Boolean(opts?.swapSides));
  }

  function applyRestBreath(phase) {
    const wave = Math.sin((phase || 0) * 1.9);
    const breathAmt = 0.3 * (0.5 + 0.5 * wave);
    const pose = {
      hip_x: poseA.hip_x,
      hip_y: poseA.hip_y,
      lumbar: poseA.lumbar - 0.7 * wave,
      thoracic: poseA.thoracic - 1.7 * wave,
      neck: poseA.neck + 1.0 * wave,
      uarm_f: poseA.uarm_f + 1.2 * wave,
      farm_f: poseA.farm_f,
      uarm_b: poseA.uarm_b + 1.2 * wave,
      farm_b: poseA.farm_b,
      thigh_f: poseA.thigh_f,
      shin_f: poseA.shin_f,
      thigh_b: poseA.thigh_b,
      shin_b: poseA.shin_b,
    };
    renderPoseState(pose, breathAmt, false);
  }

  function applyHold(phaseElapsed) {
    const phase = phaseElapsed || 0;
    if (holdStyle === "pulse") {
      applyPose(0.5 - 0.5 * Math.cos(phase * Math.PI));
    } else {
      const settle = Math.min(1, phase / 0.45);
      const holdBreath = 0.92 + 0.08 * (0.5 - 0.5 * Math.cos(phase * Math.PI));
      applyPose(settle * holdBreath);
    }
  }

  return { applyPose, applyRestBreath, applyHold, tempoMode, holdStyle };
}
