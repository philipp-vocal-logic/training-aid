/* Shared DOM/SVG builders, view lifecycle scope, preview loop, and UI helpers */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const BOOL_PROPS = new Set(["checked", "disabled", "hidden", "required", "readOnly", "selected"]);

  function appendChildren(parent, children) {
    if (children === undefined || children === null) return;
    if (Array.isArray(children)) {
      for (const child of children) appendChildren(parent, child);
    } else if (typeof children === "string" || typeof children === "number") {
      parent.appendChild(document.createTextNode(String(children)));
    } else {
      parent.appendChild(children);
    }
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null) continue;
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = String(v);
        else if (k === "dataset" && typeof v === "object") {
          for (const [dk, dv] of Object.entries(v)) {
            if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
          }
        } else if (k === "style" && typeof v === "object") {
          for (const [sk, sv] of Object.entries(v)) node.style[sk] = sv;
        } else if (BOOL_PROPS.has(k)) node[k] = Boolean(v);
        else if (k === "value") node.value = String(v);
        else node.setAttribute(k, String(v));
      }
    }
    appendChildren(node, children);
    return node;
  }

  function svgNode(tag, attrs, children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null) continue;
        if (k === "textContent") node.textContent = String(v);
        else node.setAttribute(k, String(v));
      }
    }
    appendChildren(node, children);
    return node;
  }

  function setTrustedSvg(container, svgMarkup) {
    if (!container) return;
    const trimmed = typeof svgMarkup === "string" ? svgMarkup.trim() : "";
    if (trimmed.startsWith("<svg")) container.innerHTML = trimmed;
    else container.replaceChildren();
  }

  function resolveSvgMarkup(catalog, arch, eqMode) {
    const svgs = catalog && (catalog.svgs || catalog);
    if (!svgs || typeof svgs !== "object") return "";
    const rawArch = String(arch || "squat");
    if (rawArch.includes(":") && !eqMode && svgs[rawArch]) return svgs[rawArch];
    const baseArch = rawArch.includes(":") ? rawArch.split(":")[0] : rawArch;
    const rawEq = eqMode || (rawArch.includes(":") ? rawArch.split(":")[1] : "body_only");
    const mode = String(rawEq || "body_only").trim().replace(/\s+/g, "_") || "body_only";
    return svgs[`${baseArch}:${mode}`] || svgs[`${baseArch}:body_only`] || svgs["squat:body_only"] || "";
  }

  function createViewScope() {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const rafIds = new Set();
    const intervals = new Set();
    const timeouts = new Set();
    const cleanups = [];
    let disposed = false;

    function on(target, eventName, handler, options) {
      if (!target || typeof target.addEventListener !== "function") return;
      if (controller) {
        target.addEventListener(eventName, handler, { ...(options || {}), signal: controller.signal });
      } else {
        target.addEventListener(eventName, handler, options || false);
        cleanups.push(() => target.removeEventListener(eventName, handler, options || false));
      }
    }

    function onMediaChange(mql, handler) {
      if (!mql) return;
      if (typeof mql.addEventListener === "function") on(mql, "change", handler);
      else if (typeof mql.addListener === "function") {
        mql.addListener(handler);
        cleanups.push(() => typeof mql.removeListener === "function" && mql.removeListener(handler));
      }
    }

    function requestFrame(cb) {
      if (disposed || typeof requestAnimationFrame !== "function") return null;
      const id = requestAnimationFrame((ts) => {
        rafIds.delete(id);
        if (!disposed) cb(ts);
      });
      rafIds.add(id);
      return id;
    }

    function cancelFrame(id) {
      if (id !== null && id !== undefined) {
        rafIds.delete(id);
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
      }
    }

    function addInterval(cb, ms) {
      if (disposed) return null;
      const id = setInterval(() => !disposed && cb(), ms);
      intervals.add(id);
      return id;
    }

    function clearTrackedInterval(id) {
      if (id !== null && id !== undefined) {
        intervals.delete(id);
        clearInterval(id);
      }
    }

    function addTimeout(cb, ms) {
      if (disposed) return null;
      const id = setTimeout(() => {
        timeouts.delete(id);
        if (!disposed) cb();
      }, ms);
      timeouts.add(id);
      return id;
    }

    function onCleanup(fn) {
      if (typeof fn === "function") cleanups.push(fn);
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (controller) controller.abort();
      for (const id of rafIds) if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
      rafIds.clear();
      for (const id of intervals) clearInterval(id);
      intervals.clear();
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      for (const fn of cleanups) {
        try { fn(); } catch { /* ignore */ }
      }
      cleanups.length = 0;
    }

    return {
      on, onMediaChange, requestFrame, cancelFrame, addInterval,
      clearTrackedInterval, addTimeout, onCleanup, dispose,
      isDisposed: () => disposed,
    };
  }

  function resolveSvgElement(target) {
    const node = typeof target === "function" ? target() : target;
    if (!node) return null;
    if (node.dataset && node.dataset.poseA) return node;
    return typeof node.querySelector === "function" ? node.querySelector("svg") || node : node;
  }

  function bindPreviewLoop(scope, svgEl, getParams) {
    const motion = root.TrainingMotion;
    let currentTarget = svgEl;
    let currentSvg = resolveSvgElement(currentTarget);
    let rig = motion.bindSvg(currentSvg);
    let phase = 0, currentT = 0, lastTs = null, rafId = null;

    function readParams() {
      const raw = typeof getParams === "function" ? getParams(rig) : getParams;
      if (typeof raw === "number") return { speed: raw, tempoMode: "standard" };
      const cfg = raw || {};
      const fallbackMode = rig && rig.tempoMode && rig.tempoMode !== "hold" ? rig.tempoMode : "standard";
      return { speed: Number(cfg.speed) > 0 ? Number(cfg.speed) : 0.38, tempoMode: cfg.tempoMode || fallbackMode };
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
      if (scope.isDisposed() || (typeof document !== "undefined" && document.hidden) || motion.prefersReducedMotion()) {
        lastTs = null;
        return;
      }
      const nextSvg = resolveSvgElement(currentTarget);
      if (nextSvg && nextSvg !== currentSvg) {
        currentSvg = nextSvg;
        rig = motion.bindSvg(currentSvg);
      }
      const dt = lastTs === null ? 0 : Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      const params = readParams();
      phase = (phase + dt * params.speed) % 1;
      currentT = motion.tempoCurve(phase, params.tempoMode);
      rig.applyPose(currentT);
      rafId = scope.requestFrame(tick);
    }

    function ensure() {
      if (scope.isDisposed()) return;
      if ((typeof document !== "undefined" && document.hidden) || motion.prefersReducedMotion()) {
        stop();
        if (motion.prefersReducedMotion() && rig) {
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
      rig = motion.bindSvg(currentSvg);
      rig.applyPose(motion.prefersReducedMotion() ? 0.85 : currentT);
      ensure();
      return rig;
    }

    if (typeof document !== "undefined") {
      scope.on(document, "visibilitychange", () => (document.hidden ? stop() : ensure()));
    }
    scope.onMediaChange(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)"), ensure);
    scope.onCleanup(stop);
    ensure();
    return { rebind, stop, ensure, getRig: () => rig };
  }

  let modalScope = null;

  function closeModal() {
    if (modalScope) {
      modalScope.dispose();
      modalScope = null;
    }
    const modalRoot = typeof document !== "undefined" && document.getElementById("modal-root");
    if (modalRoot) {
      modalRoot.replaceChildren();
      modalRoot.hidden = true;
    }
  }

  function openModal(buildFn, onEscape) {
    closeModal();
    const modalRoot = typeof document !== "undefined" && document.getElementById("modal-root");
    if (!modalRoot) return;
    modalScope = createViewScope();
    modalRoot.replaceChildren(el("div", { className: "modal-backdrop" }, [buildFn(modalScope)]));
    modalRoot.hidden = false;
    if (typeof window !== "undefined") {
      modalScope.on(window, "keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (typeof onEscape === "function") onEscape();
          else closeModal();
        }
      });
    }
  }

  function showToast(message) {
    const toastRoot = typeof document !== "undefined" && message && document.getElementById("toast-root");
    if (!toastRoot) return;
    const pill = el("div", { className: "pill pill-brand toast-pill", role: "status", textContent: message });
    toastRoot.appendChild(pill);
    setTimeout(() => pill.parentNode === toastRoot && toastRoot.removeChild(pill), 2800);
  }

  const ICON_BASE = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round",
  };

  const makeVolumeOnIcon = () => svgNode("svg", { ...ICON_BASE, id: "icon-vol-on", width: "18", height: "18" }, [
    svgNode("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }),
    svgNode("path", { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }),
    svgNode("path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14" }),
  ]);

  const makeVolumeOffIcon = () => svgNode("svg", { ...ICON_BASE, id: "icon-vol-off", width: "18", height: "18", style: "display: none;" }, [
    svgNode("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }),
    svgNode("line", { x1: "23", y1: "9", x2: "17", y2: "15" }),
    svgNode("line", { x1: "17", y1: "9", x2: "23", y2: "15" }),
  ]);

  const makeFullscreenIcon = () => svgNode("svg", { ...ICON_BASE, width: "17", height: "17" }, [
    svgNode("path", { d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" }),
  ]);

  const makeCheckIcon = () => svgNode("svg", { ...ICON_BASE, width: "18", height: "18", "stroke-width": "2.4" }, [
    svgNode("polyline", { points: "20 6 9 17 4 12" }),
  ]);

  function canShareJsonFile() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function" ||
        typeof navigator.canShare !== "function" || typeof File !== "function") return false;
    try {
      return Boolean(navigator.canShare({ files: [new File(["{}"], "backup.json", { type: "application/json" })] }));
    } catch { return false; }
  }

  function copyTextToClipboard(text) {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(String(text));
    }
    return Promise.reject(new Error("Clipboard API unavailable"));
  }

  function formatLogDate(rawIso) {
    if (!rawIso) return "";
    const dt = rawIso instanceof Date ? rawIso : new Date(rawIso);
    return Number.isNaN(dt.getTime()) ? "" : `${SHORT_MONTHS[dt.getUTCMonth()] || ""} ${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  function buildShareUrl(fragment) {
    let cleanFrag = String(fragment || "");
    if (cleanFrag && !cleanFrag.startsWith("#")) cleanFrag = "#" + cleanFrag;
    if (typeof window === "undefined" || !window.location) return cleanFrag;
    const loc = window.location;
    return loc.origin && loc.origin !== "null" ? loc.origin + loc.pathname + loc.search + cleanFrag : String(loc.href || "").split("#")[0] + cleanFrag;
  }

  const exportedDom = {
    SVG_NS, el, svgNode, setTrustedSvg, resolveSvgMarkup, createViewScope,
    bindPreviewLoop, openModal, closeModal, showToast, makeVolumeOnIcon,
    makeVolumeOffIcon, makeFullscreenIcon, makeCheckIcon, canShareJsonFile,
    copyTextToClipboard, formatLogDate, buildShareUrl,
  };

  root.TrainingDom = exportedDom;
  if (typeof module !== "undefined" && module.exports) module.exports = exportedDom;
})();
