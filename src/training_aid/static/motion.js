(function () {
  var DEG_TO_RAD = Math.PI / 180;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function stepPt(origin, length, deg) {
    var rad = deg * DEG_TO_RAD;
    return [
      origin[0] + length * Math.cos(rad),
      origin[1] + length * Math.sin(rad),
    ];
  }

  function prefersReducedMotion() {
    return Boolean(
      typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  var TURNAROUND_BY_MODE = {
    standard: 0.43,
    explosive: 0.31,
    alternating: 0.5,
    hold: 1.0,
  };

  function turnaroundForMode(mode) {
    return TURNAROUND_BY_MODE[mode] !== undefined
      ? TURNAROUND_BY_MODE[mode]
      : 0.43;
  }

  function tempoCurve(frac, mode) {
    var f = ((frac % 1) + 1) % 1;
    if (mode === "alternating") {
      return 0.5 - 0.5 * Math.cos(f * Math.PI * 2);
    }
    if (mode === "explosive") {
      if (f < 0.26) {
        return 0.5 - 0.5 * Math.cos((f / 0.26) * Math.PI);
      }
      if (f < 0.36) {
        return 1.0;
      }
      return 0.5 + 0.5 * Math.cos(((f - 0.36) / 0.64) * Math.PI);
    }
    // "standard" default asymmetric lifting tempo
    if (f < 0.38) {
      return 0.5 - 0.5 * Math.cos((f / 0.38) * Math.PI);
    }
    if (f < 0.48) {
      return 1.0;
    }
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

  function bindSvg(svgEl) {
    if (
      !svgEl ||
      !svgEl.dataset ||
      !svgEl.dataset.poseA ||
      !svgEl.dataset.poseB ||
      !svgEl.dataset.bones
    ) {
      return {
        applyPose: function () {},
        applyRestBreath: function () {},
        applyHold: function () {},
        tempoMode:
          svgEl && svgEl.dataset && svgEl.dataset.tempoMode
            ? svgEl.dataset.tempoMode
            : "standard",
        holdStyle:
          svgEl && svgEl.dataset && svgEl.dataset.holdStyle
            ? svgEl.dataset.holdStyle
            : "settle",
      };
    }

    var bones = JSON.parse(svgEl.dataset.bones);
    var poseA = JSON.parse(svgEl.dataset.poseA);
    var poseB = JSON.parse(svgEl.dataset.poseB);

    var tempoMode = svgEl.dataset.tempoMode || "standard";
    var holdStyle = svgEl.dataset.holdStyle || "settle";
    var eqMode = svgEl.dataset.equipment || "body_only";
    var barMode = svgEl.dataset.barMode || "hands";
    var bandTarget = svgEl.dataset.bandTarget || "hand";
    var cableTarget = svgEl.dataset.cableTarget || "hand";
    var anchorX =
      svgEl.dataset.anchorX !== undefined
        ? parseFloat(svgEl.dataset.anchorX)
        : null;
    var anchorY =
      svgEl.dataset.anchorY !== undefined
        ? parseFloat(svgEl.dataset.anchorY)
        : null;
    var forefootX =
      svgEl.dataset.forefootX !== undefined
        ? parseFloat(svgEl.dataset.forefootX)
        : null;
    var forefootY =
      svgEl.dataset.forefootY !== undefined
        ? parseFloat(svgEl.dataset.forefootY)
        : null;

    // Cache all DOM element references once at bind time
    var elHead = svgEl.querySelector(".js-head");
    var elNeck = svgEl.querySelector(".js-neck");
    var elTorso = svgEl.querySelector(".js-torso");
    var elThighF = svgEl.querySelector(".js-thigh-f");
    var elShinF = svgEl.querySelector(".js-shin-f");
    var elThighB = svgEl.querySelector(".js-thigh-b");
    var elShinB = svgEl.querySelector(".js-shin-b");
    var elForefootF = svgEl.querySelector(".js-forefoot-f");
    var elForefootB = svgEl.querySelector(".js-forefoot-b");
    var elUarmF = svgEl.querySelector(".js-uarm-f");
    var elFarmF = svgEl.querySelector(".js-farm-f");
    var elUarmB = svgEl.querySelector(".js-uarm-b");
    var elFarmB = svgEl.querySelector(".js-farm-b");
    var elJShoulder = svgEl.querySelector(".js-j-shoulder");
    var elJHip = svgEl.querySelector(".js-j-hip");
    var elJKnee = svgEl.querySelector(".js-j-knee");
    var elJElbow = svgEl.querySelector(".js-j-elbow");
    var elWeightF = svgEl.querySelector(".js-weight");
    var elWeightCap = svgEl.querySelector(".js-weight-cap");
    var elWeightB = svgEl.querySelector(".js-weight-b");
    var elKbHandleF = svgEl.querySelector(".js-kb-handle-f");
    var elBarShaft = svgEl.querySelector(".js-bar-shaft");
    var elBarHub = svgEl.querySelector(".js-bar-hub");
    var elBandF = svgEl.querySelector(".js-band-f");
    var elBandB = svgEl.querySelector(".js-band-b");
    var elCable = svgEl.querySelector(".js-cable");
    var elCableGrip = svgEl.querySelector(".js-cable-grip");
    var elShadow = svgEl.querySelector(".js-shadow");
    var elAura = svgEl.querySelector(".js-aura");
    var elRing = svgEl.querySelector(".js-ring");
    var elPulse = svgEl.querySelector(".js-pulse");

    function renderPoseState(pose, auraAmt, swapSides) {
      var uf = swapSides ? pose.uarm_b : pose.uarm_f;
      var ffAngle = swapSides ? pose.farm_b : pose.farm_f;
      var ub = swapSides ? pose.uarm_f : pose.uarm_b;
      var fbAngle = swapSides ? pose.farm_f : pose.farm_b;
      var tf = swapSides ? pose.thigh_b : pose.thigh_f;
      var sf = swapSides ? pose.shin_b : pose.shin_f;
      var tb = swapSides ? pose.thigh_f : pose.thigh_b;
      var sb = swapSides ? pose.shin_f : pose.shin_b;

      var hip = [pose.hip_x, pose.hip_y];
      var midSpine = stepPt(hip, bones.lumbar, pose.lumbar);
      var shoulder = stepPt(midSpine, bones.thoracic, pose.thoracic);
      var head = stepPt(shoulder, bones.neck, pose.neck);

      var hipB = [hip[0] + bones.back_dx, hip[1] + bones.back_dy];
      var shoulderB = [shoulder[0] + bones.back_dx, shoulder[1] + bones.back_dy];

      var kneeF = stepPt(hip, bones.thigh, tf);
      var footF = stepPt(kneeF, bones.shin, sf);
      var kneeB = stepPt(hipB, bones.thigh, tb);
      var footB = stepPt(kneeB, bones.shin, sb);

      var elbowF = stepPt(shoulder, bones.uarm, uf);
      var handF = stepPt(elbowF, bones.farm, ffAngle);
      var elbowB = stepPt(shoulderB, bones.uarm, ub);
      var handB = stepPt(elbowB, bones.farm, fbAngle);

      setCircleEl(elHead, head[0], head[1]);
      setLineEl(elNeck, shoulder, head);
      if (elTorso) {
        elTorso.setAttribute(
          "d",
          "M " +
            hip[0].toFixed(2) +
            " " +
            hip[1].toFixed(2) +
            " Q " +
            midSpine[0].toFixed(2) +
            " " +
            midSpine[1].toFixed(2) +
            " " +
            shoulder[0].toFixed(2) +
            " " +
            shoulder[1].toFixed(2)
        );
      }

      setCircleEl(elJShoulder, shoulder[0], shoulder[1]);
      setCircleEl(elJHip, hip[0], hip[1]);
      setCircleEl(elJKnee, kneeF[0], kneeF[1]);
      setCircleEl(elJElbow, elbowF[0], elbowF[1]);

      setLineEl(elThighF, hip, kneeF);
      setLineEl(elShinF, kneeF, footF);
      setLineEl(elThighB, hipB, kneeB);
      setLineEl(elShinB, kneeB, footB);

      if (forefootX !== null && forefootY !== null) {
        setLineEl(elForefootF, footF, [forefootX, forefootY]);
        setLineEl(elForefootB, footB, [forefootX - 5.0, forefootY - 1.0]);
      }

      setLineEl(elUarmF, shoulder, elbowF);
      setLineEl(elFarmF, elbowF, handF);
      setLineEl(elUarmB, shoulderB, elbowB);
      setLineEl(elFarmB, elbowB, handB);

      // Update decoupled equipment props
      if (eqMode === "dumbbell") {
        setCircleEl(elWeightF, handF[0], handF[1]);
        setCircleEl(elWeightCap, handF[0], handF[1]);
        setCircleEl(elWeightB, handB[0], handB[1]);
      } else if (eqMode === "kettlebells") {
        var kbFy = Math.min(165.0, handF[1] + 9.0);
        var kbBy = Math.min(165.0, handB[1] + 8.0);
        var hdlFy = Math.min(159.0, handF[1] + 2.5);
        setCircleEl(elKbHandleF, handF[0], hdlFy);
        setCircleEl(elWeightF, handF[0], kbFy);
        setCircleEl(elWeightB, handB[0], kbBy);
      } else if (eqMode === "barbell") {
        var pb = barMode === "shoulder" ? shoulderB : handB;
        var pf = barMode === "shoulder" ? shoulder : handF;
        setCircleEl(elWeightB, pb[0], pb[1]);
        setLineEl(
          elBarShaft,
          [pb[0] - 6.0, pb[1] - 2.0],
          [pf[0] + 6.0, pf[1] + 2.0]
        );
        setCircleEl(elWeightF, pf[0], pf[1]);
        setCircleEl(elBarHub, pf[0], pf[1]);
      } else if (eqMode === "bands" && anchorX !== null && anchorY !== null) {
        var anchor = [anchorX, anchorY];
        var bTargetB = handB;
        var bTargetF = handF;
        if (bandTarget === "shoulder") {
          bTargetB = shoulderB;
          bTargetF = shoulder;
        } else if (bandTarget === "foot") {
          bTargetB = footB;
          bTargetF = footF;
        }
        setLineEl(elBandB, anchor, bTargetB);
        setLineEl(elBandF, anchor, bTargetF);
      } else if (
        (eqMode === "cable" || eqMode === "machine") &&
        anchorX !== null &&
        anchorY !== null
      ) {
        var cAtt = cableTarget === "foot" ? footF : handF;
        setLineEl(elCable, [anchorX, anchorY], cAtt);
        setCircleEl(elCableGrip, cAtt[0], cAtt[1]);
      }

      if (elShadow) {
        var minX = Math.min(
          head[0],
          shoulder[0],
          hip[0],
          footF[0],
          footB[0],
          handF[0]
        );
        var maxX = Math.max(
          head[0],
          shoulder[0],
          hip[0],
          footF[0],
          footB[0],
          handF[0]
        );
        var sx = (minX + maxX) * 0.5;
        var rx = Math.max(22.0, Math.min(82.0, (maxX - minX) * 0.5 + 12.0));
        elShadow.setAttribute("cx", sx.toFixed(2));
        elShadow.setAttribute("rx", rx.toFixed(2));
      }

      if (elAura) {
        elAura.setAttribute("r", (80.0 + 8.0 * auraAmt).toFixed(2));
      }
      if (elRing) {
        elRing.setAttribute("r", (62.0 + 6.0 * auraAmt).toFixed(2));
      }
      if (elPulse) {
        elPulse.setAttribute("r", (21.0 + 9.0 * auraAmt).toFixed(2));
      }
    }

    function applyPose(t, opts) {
      var pose = {
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
      var swap = Boolean(opts && opts.swapSides);
      renderPoseState(pose, t, swap);
    }

    function applyRestBreath(phase) {
      var wave = Math.sin((phase || 0) * 1.9);
      var breathAmt = 0.3 * (0.5 + 0.5 * wave);
      var pose = {
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
      var phase = phaseElapsed || 0;
      if (holdStyle === "pulse") {
        applyPose(0.5 - 0.5 * Math.cos(phase * Math.PI));
      } else {
        var settle = Math.min(1, phase / 0.45);
        var holdBreath = 0.92 + 0.08 * (0.5 - 0.5 * Math.cos(phase * Math.PI));
        applyPose(settle * holdBreath);
      }
    }

    return {
      applyPose: applyPose,
      applyRestBreath: applyRestBreath,
      applyHold: applyHold,
      tempoMode: tempoMode,
      holdStyle: holdStyle,
    };
  }

  window.TrainingMotion = {
    bindSvg: bindSvg,
    tempoCurve: tempoCurve,
    turnaroundForMode: turnaroundForMode,
    prefersReducedMotion: prefersReducedMotion,
  };
})();
