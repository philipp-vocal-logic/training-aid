/* Continuous SVG kinematic preview loop with visibility & reduced-motion awareness */
import { bindSvg, prefersReducedMotion, tempoCurve } from "../rig/motion.js";

function resolveSvgElement(target) {
  const node = typeof target === "function" ? target() : target;
  if (!node) return null;
  if (node.dataset && node.dataset.poseA) return node;
  return typeof node.querySelector === "function" ? node.querySelector("svg") || node : node;
}

export function bindPreviewLoop(scope, svgEl, getParams) {
  let currentTarget = svgEl;
  let currentSvg = resolveSvgElement(currentTarget);
  let rig = bindSvg(currentSvg);
  let phase = 0;
  let currentT = 0;
  let lastTs = null;
  let rafId = null;

  function readParams() {
    const raw = typeof getParams === "function" ? getParams(rig) : getParams;
    if (typeof raw === "number") return { speed: raw, tempoMode: "standard" };
    const cfg = raw || {};
    const fallbackMode = rig && rig.tempoMode && rig.tempoMode !== "hold" ? rig.tempoMode : "standard";
    return {
      speed: Number(cfg.speed) > 0 ? Number(cfg.speed) : 0.38,
      tempoMode: cfg.tempoMode || fallbackMode,
    };
  }

  function stop() {
    if (rafId !== null) {
      scope.cancelFrame(rafId);
      rafId = null;
    }
    lastTs = null;
  }

  function tick(ts) {
    rafId = null;
    if (
      scope.isDisposed() ||
      (typeof document !== "undefined" && document.hidden) ||
      prefersReducedMotion()
    ) {
      lastTs = null;
      return;
    }
    const nextSvg = resolveSvgElement(currentTarget);
    if (nextSvg && nextSvg !== currentSvg) {
      currentSvg = nextSvg;
      rig = bindSvg(currentSvg);
    }
    const dt = lastTs === null ? 0 : Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const params = readParams();
    phase = (phase + dt * params.speed) % 1;
    currentT = tempoCurve(phase, params.tempoMode);
    rig.applyPose(currentT);
    rafId = scope.requestFrame(tick);
  }

  function ensure() {
    if (scope.isDisposed()) return;
    if ((typeof document !== "undefined" && document.hidden) || prefersReducedMotion()) {
      stop();
      if (prefersReducedMotion() && rig) {
        currentT = 0.85;
        rig.applyPose(0.85);
      }
      return;
    }
    if (rafId === null) {
      lastTs = null;
      rafId = scope.requestFrame(tick);
    }
  }

  function rebind(nextTarget) {
    if (nextTarget !== undefined) currentTarget = nextTarget;
    currentSvg = resolveSvgElement(currentTarget);
    rig = bindSvg(currentSvg);
    rig.applyPose(prefersReducedMotion() ? 0.85 : currentT);
    ensure();
    return rig;
  }

  if (typeof document !== "undefined") {
    scope.on(document, "visibilitychange", () => (document.hidden ? stop() : ensure()));
  }
  const mql =
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  scope.onMediaChange(mql, ensure);
  scope.onCleanup(stop);
  ensure();
  return { rebind, stop, ensure, getRig: () => rig };
}
