/* Shared DOM/SVG builders, view lifecycle scope, preview loop, and reusable UI widgets */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const getDomain = () => root.TrainingDomain || (typeof require === "function" ? require("./domain.js") : null);
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

  function formatLogDate(rawIso) {
    if (!rawIso) return "";
    const dt = rawIso instanceof Date ? rawIso : new Date(rawIso);
    if (Number.isNaN(dt.getTime())) return "";
    return `${SHORT_MONTHS[dt.getMonth()] || ""} ${String(dt.getDate()).padStart(2, "0")}`;
  }

  function formatLogDateTime(rawIso) {
    if (!rawIso) return "";
    const dt = rawIso instanceof Date ? rawIso : new Date(rawIso);
    if (Number.isNaN(dt.getTime())) return "";
    const mon = SHORT_MONTHS[dt.getMonth()] || "";
    const day = String(dt.getDate()).padStart(2, "0");
    const yr = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${mon} ${day}, ${yr} \u00b7 ${hh}:${mm}`;
  }

  function renderEquipmentChipBar(scope, selectedList, onChange, extraNode) {
    const domain = getDomain();
    const options = (domain && domain.EQUIPMENT_OPTIONS) || [];
    const activeSet = new Set(Array.isArray(selectedList) ? selectedList : []);

    const chips = options.map((opt) => {
      const active = activeSet.has(opt.id);
      const btn = el("button", {
        type: "button",
        className: "equip-chip" + (active ? " is-active" : ""),
        dataset: { equipId: opt.id },
        "aria-pressed": active ? "true" : "false",
        textContent: opt.label,
      });
      scope.on(btn, "click", () => {
        const next = new Set(activeSet);
        if (next.has(opt.id)) next.delete(opt.id);
        else next.add(opt.id);
        onChange([...next]);
      });
      return btn;
    });

    return el("div", { className: "equip-chip-bar", role: "group", "aria-label": "Available equipment" }, [
      el("span", { className: "equip-chip is-baseline", textContent: "Bodyweight \u2713" }),
      ...chips,
      extraNode || null,
    ]);
  }

  function renderPacingControls(scope, timing, onTimingChange) {
    const domain = getDomain();
    const speedModes = (domain && domain.VALID_SPEED_MODES) || ["slow", "normal", "fast"];
    const speedLabels = (domain && domain.SPEED_LABELS) || { slow: "Slow", normal: "Normal", fast: "Fast" };
    const restPresets = (domain && domain.REST_PRESETS) || [15, 30, 45, 60, 90];

    const speedSelect = el(
      "select",
      { className: "hud-select pacing-select", "aria-label": "Exercise speed" },
      speedModes.map((m) =>
        el("option", { value: m, selected: timing.speed_mode === m, textContent: `Speed: ${speedLabels[m] || m}` })
      )
    );
    const curRest = Number(timing.rest_seconds) || 30;
    const restValues = restPresets.includes(curRest) ? restPresets : [...restPresets, curRest].sort((a, b) => a - b);
    const restSelect = el(
      "select",
      { className: "hud-select pacing-select", "aria-label": "Rest interval" },
      restValues.map((sec) =>
        el("option", { value: String(sec), selected: curRest === sec, textContent: `Rest: ${sec}s` })
      )
    );

    scope.on(speedSelect, "change", () => onTimingChange({ speed_mode: speedSelect.value }));
    scope.on(restSelect, "change", () => onTimingChange({ rest_seconds: Number(restSelect.value) }));

    return el("div", { className: "pacing-strip" }, [speedSelect, restSelect]);
  }

  function renderEditableExerciseRow(scope, row, handlers) {
    const domain = getDomain();
    const isWeighted = Boolean(
      (domain && domain.isWeightedCatalogEquipment(row.exercise.equipment) && !row.exercise.is_hold) ||
        (row.item.base_weight_kg !== null && row.item.base_weight_kg !== undefined)
    );
    const thumbSrc = row.thumb_url || "./svgs/thumbs/squat__body_only.svg";

    const setsInput = el("input", {
      type: "number", min: "1", max: "20", value: String(row.item.sets),
      className: "rx-num-input", "aria-label": `Sets for ${row.exercise.name}`,
    });
    const repsInput = el("input", {
      type: "number", min: "1", max: "600", value: String(row.item.base_reps),
      className: "rx-num-input", "aria-label": `${row.exercise.is_hold ? "Seconds" : "Reps"} for ${row.exercise.name}`,
    });
    const weightInput = isWeighted
      ? el("input", {
          type: "number", min: "0.5", max: "500", step: "0.5",
          value: row.item.base_weight_kg ? String(row.item.base_weight_kg) : "10",
          className: "rx-num-input rx-weight-input", "aria-label": `Weight kg for ${row.exercise.name}`,
        })
      : null;

    const commitPatch = () => {
      handlers.onUpdate({
        sets: Number(setsInput.value),
        base_reps: Number(repsInput.value),
        base_weight_kg: weightInput ? Number(weightInput.value) : null,
      });
    };
    scope.on(setsInput, "change", commitPatch);
    scope.on(repsInput, "change", commitPatch);
    if (weightInput) scope.on(weightInput, "change", commitPatch);

    const swapBtn = el("button", {
      type: "button", className: "btn-ghost btn-icon-sm",
      title: "Swap with random exercise", "aria-label": "Random swap", textContent: "\u21bb",
    });
    const removeBtn = el("button", {
      type: "button", className: "btn-ghost btn-icon-sm",
      title: "Remove exercise", "aria-label": "Remove", textContent: "\u2715",
    });
    scope.on(swapBtn, "click", handlers.onSwap);
    scope.on(removeBtn, "click", handlers.onRemove);

    return el("li", { className: "catalog-card editable-ex-card" }, [
      el("div", { className: "ex-row-left" }, [
        el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
        el("div", { style: { minWidth: "0" } }, [
          el("div", { className: "ex-row-name", textContent: row.exercise.name }),
          el("div", { className: "rx-inline-controls" }, [
            setsInput,
            el("span", { className: "muted", textContent: "\u00d7" }),
            repsInput,
            el("span", { className: "muted", textContent: row.exercise.is_hold ? "sec" : "reps" }),
            ...(weightInput
              ? [el("span", { className: "muted", textContent: "@" }), weightInput, el("span", { className: "muted", textContent: "kg" })]
              : []),
          ]),
        ]),
      ]),
      el("div", { className: "rx-row-actions" }, [swapBtn, removeBtn]),
    ]);
  }

  const exportedDom = {
    SVG_NS, el, svgNode, setTrustedSvg, resolveSvgMarkup, createViewScope,
    bindPreviewLoop, openModal, closeModal, showToast, makeVolumeOnIcon,
    makeVolumeOffIcon, makeFullscreenIcon, formatLogDate, formatLogDateTime,
    renderEquipmentChipBar, renderPacingControls, renderEditableExerciseRow,
  };

  root.TrainingDom = exportedDom;
  if (typeof module !== "undefined" && module.exports) module.exports = exportedDom;
})();
