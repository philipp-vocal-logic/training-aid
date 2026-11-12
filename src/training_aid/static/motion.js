(function () {
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function bindSvg(svgEl) {
    if (!svgEl || !svgEl.dataset.poseA || !svgEl.dataset.poseB) {
      return { applyPose: function () {} };
    }
    const poseA = JSON.parse(svgEl.dataset.poseA);
    const poseB = JSON.parse(svgEl.dataset.poseB);

    function lerpPt(key, t) {
      return [
        lerp(poseA[key][0], poseB[key][0], t),
        lerp(poseA[key][1], poseB[key][1], t),
      ];
    }

    function setLine(sel, p1, p2) {
      const el = svgEl.querySelector(sel);
      if (!el) return;
      el.setAttribute("x1", p1[0].toFixed(1));
      el.setAttribute("y1", p1[1].toFixed(1));
      el.setAttribute("x2", p2[0].toFixed(1));
      el.setAttribute("y2", p2[1].toFixed(1));
    }

    function setCircle(sel, p) {
      const el = svgEl.querySelector(sel);
      if (!el) return;
      el.setAttribute("cx", p[0].toFixed(1));
      el.setAttribute("cy", p[1].toFixed(1));
    }

    function applyPose(t) {
      const head = lerpPt("head", t);
      const shoulder = lerpPt("shoulder", t);
      const hip = lerpPt("hip", t);
      const ef = lerpPt("elbow_f", t);
      const hf = lerpPt("hand_f", t);
      const eb = lerpPt("elbow_b", t);
      const hb = lerpPt("hand_b", t);
      const kf = lerpPt("knee_f", t);
      const ff = lerpPt("foot_f", t);
      const kb = lerpPt("knee_b", t);
      const fb = lerpPt("foot_b", t);

      setCircle(".js-head", head);
      setCircle(".js-j-shoulder", shoulder);
      setCircle(".js-j-hip", hip);
      setCircle(".js-j-knee", kf);
      setCircle(".js-j-elbow", ef);

      setLine(".js-torso", shoulder, hip);
      setLine(".js-thigh-f", hip, kf);
      setLine(".js-shin-f", kf, ff);
      setLine(".js-thigh-b", hip, kb);
      setLine(".js-shin-b", kb, fb);
      setLine(".js-uarm-f", shoulder, ef);
      setLine(".js-farm-f", ef, hf);
      setLine(".js-uarm-b", shoulder, eb);
      setLine(".js-farm-b", eb, hb);

      setCircle(".js-weight", hf);
      setCircle(".js-weight-b", hb);

      const shadowEl = svgEl.querySelector(".js-shadow");
      if (shadowEl) {
        const sx = (shoulder[0] + hip[0] + ff[0]) / 3;
        const lowY = Math.max(hip[1], shoulder[1], head[1]);
        const rx = Math.max(22, Math.min(46, 26 + (lowY - 100) * 0.22));
        shadowEl.setAttribute("cx", sx.toFixed(1));
        shadowEl.setAttribute("rx", rx.toFixed(1));
      }

      const auraEl = svgEl.querySelector(".js-aura");
      if (auraEl) {
        auraEl.setAttribute("r", (80 + 8 * t).toFixed(1));
      }

      const ringEl = svgEl.querySelector(".js-ring");
      if (ringEl) {
        ringEl.setAttribute("r", (62 + 6 * t).toFixed(1));
      }

      const pulseEl = svgEl.querySelector(".js-pulse");
      if (pulseEl) {
        pulseEl.setAttribute("r", (21 + 9 * t).toFixed(1));
      }
    }

    return { applyPose: applyPose };
  }

  window.TrainingMotion = { bindSvg: bindSvg };
})();
