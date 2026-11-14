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
  ".js-clavicle",
  ".js-pelvis",
  ".js-j-shoulder-b",
  ".js-j-hip-b",
  ".js-j-knee-b",
  ".js-j-elbow-b",
  ".js-anchor",
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

function setVisibilityEl(el, visible) {
  if (!el) return;
  el.setAttribute("visibility", visible ? "visible" : "hidden");
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

  const archetype = svgEl.dataset.archetype || "";
  const tempoMode = svgEl.dataset.tempoMode || "standard";
  const holdStyle = svgEl.dataset.holdStyle || "settle";
  const isFront = svgEl.dataset.view === "front";
  const eqMode = svgEl.dataset.equipment || "body_only";
  const bandTarget = svgEl.dataset.bandTarget || "hand";
  const cableTarget = svgEl.dataset.cableTarget || "hand";
  const anchorX = svgEl.dataset.anchorX !== undefined ? parseFloat(svgEl.dataset.anchorX) : null;
  const anchorY = svgEl.dataset.anchorY !== undefined ? parseFloat(svgEl.dataset.anchorY) : null;
  const forefootX = svgEl.dataset.forefootX !== undefined ? parseFloat(svgEl.dataset.forefootX) : null;
  const forefootY = svgEl.dataset.forefootY !== undefined ? parseFloat(svgEl.dataset.forefootY) : null;

  // Cache all DOM element references once at bind time
  const els = Object.fromEntries(RIG_SELECTORS.map((sel) => [sel, svgEl.querySelector(sel)]));

  function renderPoseState(pose, auraAmt, swapSides, unilateralMode = "none") {
    const reflectFront = isFront && swapSides;
    const singleProp = unilateralMode === "arm_single" || unilateralMode === "side";
    const hipX = reflectFront ? 240.0 - pose.hip_x : pose.hip_x;
    const hipY = pose.hip_y;
    const lumbar = reflectFront ? -180.0 - pose.lumbar : pose.lumbar;
    const thoracic = reflectFront ? -180.0 - pose.thoracic : pose.thoracic;
    const neck = reflectFront ? -180.0 - pose.neck : pose.neck;

    let uf = swapSides ? pose.uarm_b : pose.uarm_f;
    let ffAngle = swapSides ? pose.farm_b : pose.farm_f;
    let ub = swapSides ? pose.uarm_f : pose.uarm_b;
    let fbAngle = swapSides ? pose.farm_f : pose.farm_b;
    let tf = swapSides ? pose.thigh_b : pose.thigh_f;
    let sf = swapSides ? pose.shin_b : pose.shin_f;
    let tb = swapSides ? pose.thigh_f : pose.thigh_b;
    let sb = swapSides ? pose.shin_f : pose.shin_b;

    if (reflectFront) {
      uf = 180.0 - uf;
      ffAngle = 180.0 - ffAngle;
      ub = 180.0 - ub;
      fbAngle = 180.0 - fbAngle;
      tf = 180.0 - tf;
      sf = 180.0 - sf;
      tb = 180.0 - tb;
      sb = 180.0 - sb;
    }

    const hip = [hipX, hipY];
    const midSpine = stepPt(hip, bones.lumbar, lumbar);
    const shoulder = stepPt(midSpine, bones.thoracic, thoracic);
    const head = stepPt(shoulder, bones.neck, neck);

    let hipF = hip;
    let hipB = [hip[0] + bones.back_dx, hip[1] + bones.back_dy];
    let shoulderF = shoulder;
    let shoulderB = [shoulder[0] + bones.back_dx, shoulder[1] + bones.back_dy];
    if (isFront) {
      const pelvisR = bones.pelvis_r !== undefined ? bones.pelvis_r : 9.5;
      const clavicleR = bones.clavicle_r !== undefined ? bones.clavicle_r : 14.5;
      const lumRad = lumbar * DEG_TO_RAD;
      const thoRad = thoracic * DEG_TO_RAD;
      const nxL = -Math.sin(lumRad);
      const nyL = Math.cos(lumRad);
      const nxT = -Math.sin(thoRad);
      const nyT = Math.cos(thoRad);
      hipF = [hip[0] + pelvisR * nxL, hip[1] + pelvisR * nyL];
      hipB = [hip[0] - pelvisR * nxL, hip[1] - pelvisR * nyL];
      shoulderF = [shoulder[0] + clavicleR * nxT, shoulder[1] + clavicleR * nyT];
      shoulderB = [shoulder[0] - clavicleR * nxT, shoulder[1] - clavicleR * nyT];
    }

    const kneeF = stepPt(hipF, bones.thigh, tf);
    const footF = stepPt(kneeF, bones.shin, sf);
    const kneeB = stepPt(hipB, bones.thigh, tb);
    const footB = stepPt(kneeB, bones.shin, sb);

    const elbowF = stepPt(shoulderF, bones.uarm, uf);
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
    setLineEl(els[".js-clavicle"], shoulderB, shoulderF);
    setLineEl(els[".js-pelvis"], hipB, hipF);

    setCircleEl(els[".js-j-shoulder"], shoulderF[0], shoulderF[1]);
    setCircleEl(els[".js-j-shoulder-b"], shoulderB[0], shoulderB[1]);
    setCircleEl(els[".js-j-hip"], hipF[0], hipF[1]);
    setCircleEl(els[".js-j-hip-b"], hipB[0], hipB[1]);
    setCircleEl(els[".js-j-knee"], kneeF[0], kneeF[1]);
    setCircleEl(els[".js-j-knee-b"], kneeB[0], kneeB[1]);
    setCircleEl(els[".js-j-elbow"], elbowF[0], elbowF[1]);
    setCircleEl(els[".js-j-elbow-b"], elbowB[0], elbowB[1]);

    setLineEl(els[".js-thigh-f"], hipF, kneeF);
    setLineEl(els[".js-shin-f"], kneeF, footF);
    setLineEl(els[".js-thigh-b"], hipB, kneeB);
    setLineEl(els[".js-shin-b"], kneeB, footB);

    if (forefootX !== null && forefootY !== null) {
      setLineEl(els[".js-forefoot-f"], footF, [forefootX, forefootY]);
      setLineEl(els[".js-forefoot-b"], footB, [forefootX - 5.0, forefootY - 1.0]);
    }
    const hideTuckedForefoot = archetype === "calf_raise" && unilateralMode === "leg";
    setVisibilityEl(els[".js-forefoot-f"], !hideTuckedForefoot || !swapSides);
    setVisibilityEl(els[".js-forefoot-b"], !hideTuckedForefoot || swapSides);

    setLineEl(els[".js-uarm-f"], shoulderF, elbowF);
    setLineEl(els[".js-farm-f"], elbowF, handF);
    setLineEl(els[".js-uarm-b"], shoulderB, elbowB);
    setLineEl(els[".js-farm-b"], elbowB, handB);

    if (eqMode === "dumbbell") {
      setCircleEl(els[".js-weight"], handF[0], handF[1]);
      setCircleEl(els[".js-weight-cap"], handF[0], handF[1]);
      setCircleEl(els[".js-weight-b"], handB[0], handB[1]);
      setVisibilityEl(els[".js-weight"], !singleProp || !swapSides);
      setVisibilityEl(els[".js-weight-cap"], !singleProp || !swapSides);
      setVisibilityEl(els[".js-weight-b"], !singleProp || swapSides);
    } else if (eqMode === "kettlebells") {
      setCircleEl(els[".js-kb-handle-f"], handF[0], handF[1] + 2.5);
      setCircleEl(els[".js-weight"], handF[0], handF[1] + 9.0);
      setCircleEl(els[".js-weight-b"], handB[0], handB[1] + 8.0);
      setVisibilityEl(els[".js-kb-handle-f"], !singleProp || !swapSides);
      setVisibilityEl(els[".js-weight"], !singleProp || !swapSides);
      setVisibilityEl(els[".js-weight-b"], !singleProp || swapSides);
    } else if (eqMode === "barbell") {
      setCircleEl(els[".js-weight-b"], handB[0], handB[1]);
      if (isFront) {
        const [leftH, rightH] = handB[0] <= handF[0] ? [handB, handF] : [handF, handB];
        setLineEl(
          els[".js-bar-shaft"],
          [leftH[0] - 8.0, leftH[1]],
          [rightH[0] + 8.0, rightH[1]],
        );
      } else {
        setLineEl(
          els[".js-bar-shaft"],
          [handB[0] - 6.0, handB[1] - 2.0],
          [handF[0] + 6.0, handF[1] + 2.0],
        );
      }
      setCircleEl(els[".js-weight"], handF[0], handF[1]);
      setCircleEl(els[".js-bar-hub"], handF[0], handF[1]);
    } else if (eqMode === "bands" && (bandTarget === "span" || (anchorX !== null && anchorY !== null))) {
      if (bandTarget === "span") {
        setLineEl(els[".js-band-b"], handB, handF);
        setLineEl(els[".js-band-f"], handB, handF);
      } else {
        const anchor = [reflectFront ? 240.0 - anchorX : anchorX, anchorY];
        setCircleEl(els[".js-anchor"], anchor[0], anchor[1]);
        let bTargetB = handB;
        let bTargetF = handF;
        if (bandTarget === "shoulder") {
          bTargetB = shoulderB;
          bTargetF = shoulderF;
        } else if (bandTarget === "foot") {
          bTargetB = footB;
          bTargetF = footF;
        }
        setLineEl(els[".js-band-b"], anchor, bTargetB);
        setLineEl(els[".js-band-f"], anchor, bTargetF);
        setVisibilityEl(els[".js-band-f"], !singleProp || !swapSides);
        setVisibilityEl(els[".js-band-b"], !singleProp || swapSides);
      }
    } else if ((eqMode === "cable" || eqMode === "machine") && anchorX !== null && anchorY !== null) {
      const cAnchorX = reflectFront ? 240.0 - anchorX : anchorX;
      setCircleEl(els[".js-anchor"], cAnchorX, anchorY);
      const cAtt = cableTarget === "foot" ? (swapSides ? footB : footF) : (swapSides ? handB : handF);
      setLineEl(els[".js-cable"], [cAnchorX, anchorY], cAtt);
      setCircleEl(els[".js-cable-grip"], cAtt[0], cAtt[1]);
    }

    if (els[".js-shadow"]) {
      const minX = Math.min(head[0], shoulder[0], hip[0], footF[0], footB[0], handF[0], handB[0]);
      const maxX = Math.max(head[0], shoulder[0], hip[0], footF[0], footB[0], handF[0], handB[0]);
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
    const swapSides = Boolean(opts?.swapSides);
    const unilateralMode = opts?.unilateralMode || "none";
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
    if ((unilateralMode === "arm_single" || unilateralMode === "arm_pair") && archetype !== "side_bend") {
      if (archetype === "pull_up") {
        pose.uarm_b = 88.0;
        pose.farm_b = 92.0;
      } else if (archetype === "pushup") {
        pose.uarm_b = 195.0;
        pose.farm_b = 175.0;
      } else {
        pose.uarm_b = poseA.uarm_b;
        pose.farm_b = poseA.farm_b;
      }
    } else if (unilateralMode === "leg") {
      if (archetype === "leg_extension_curl") {
        pose.thigh_b = poseA.thigh_b;
        pose.shin_b = poseA.shin_b;
      } else if (archetype === "calf_raise") {
        pose.thigh_b = poseA.thigh_b - 10.0;
        pose.shin_b = poseA.shin_b + 38.0;
      }
    }
    renderPoseState(pose, t, swapSides, unilateralMode);
  }

  function applyRestBreath(phase, opts) {
    const wave = Math.sin((phase || 0) * 1.9);
    const breathAmt = 0.3 * (0.5 + 0.5 * wave);
    const pose = isFront
      ? {
          hip_x: poseA.hip_x,
          hip_y: poseA.hip_y - 0.4 * wave,
          lumbar: poseA.lumbar,
          thoracic: poseA.thoracic,
          neck: poseA.neck,
          uarm_f: poseA.uarm_f - 1.4 * wave,
          farm_f: poseA.farm_f,
          uarm_b: poseA.uarm_b + 1.4 * wave,
          farm_b: poseA.farm_b,
          thigh_f: poseA.thigh_f,
          shin_f: poseA.shin_f,
          thigh_b: poseA.thigh_b,
          shin_b: poseA.shin_b,
        }
      : {
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
    renderPoseState(pose, breathAmt, false, opts?.unilateralMode || "none");
  }

  function applyHold(phaseElapsed, opts) {
    const phase = phaseElapsed || 0;
    if (holdStyle === "pulse") {
      applyPose(0.5 - 0.5 * Math.cos(phase * Math.PI), opts);
    } else {
      const settle = Math.min(1, phase / 0.45);
      const holdBreath = 0.92 + 0.08 * (0.5 - 0.5 * Math.cos(phase * Math.PI));
      applyPose(settle * holdBreath, opts);
    }
  }

  return { applyPose, applyRestBreath, applyHold, tempoMode, holdStyle };
}
