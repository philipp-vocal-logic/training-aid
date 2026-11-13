/* Client-side SPA controller for Training Aid zero-backend static PWA */
(function () {
  "use strict";

  var root =
    typeof window !== "undefined"
      ? window
      : typeof globalThis !== "undefined"
        ? globalThis
        : this;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var REST_SECONDS = 20;

  var SOUND_THEME_OPTIONS = [
    { id: "off", label: "Off" },
    { id: "minimal", label: "Minimal Cues" },
    { id: "techno", label: "Techno Pulse" },
    { id: "trance", label: "Trance Arp" },
    { id: "studio", label: "Studio Kit" },
  ];

  var SETUP_PRESCRIPTIONS = {
    light: "2 sets · \u221220% load",
    moderate: "3 sets · Base load",
    intense: "4 sets · +20% load",
  };

  var SETUP_SPEEDS = {
    light: 0.36,
    moderate: 0.39,
    intense: 0.42,
  };

  var SHORT_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  var EQUIPMENT_PROP_ALIASES = {
    body_only: "body_only",
    none: "body_only",
    foam_roll: "body_only",
    exercise_ball: "body_only",
    medicine_ball: "body_only",
    other: "body_only",
    dumbbell: "dumbbell",
    dumbbells: "dumbbell",
    barbell: "barbell",
    e_z_curl_bar: "barbell",
    kettlebells: "kettlebells",
    kettlebell: "kettlebells",
    bands: "bands",
    band: "bands",
    cable: "cable",
    machine: "machine",
  };

  function normalizeEqProp(raw) {
    if (!raw) return "body_only";
    var key = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, "_");
    return EQUIPMENT_PROP_ALIASES[key] || key || "body_only";
  }

  function resolveCatalogSvgKey(svgs, keyOrArch, fallbackArch) {
    if (!svgs || typeof svgs !== "object") return null;
    if (keyOrArch && svgs[keyOrArch]) return keyOrArch;
    if (keyOrArch && String(keyOrArch).indexOf(":") !== -1) {
      var parts = String(keyOrArch).split(":");
      var normCandidate = parts[0] + ":" + normalizeEqProp(parts[1]);
      if (svgs[normCandidate]) return normCandidate;
    }
    if (fallbackArch && svgs[fallbackArch]) return fallbackArch;
    if (keyOrArch && String(keyOrArch).indexOf(":") !== -1) {
      var bare = String(keyOrArch).split(":")[0];
      if (svgs[bare]) return bare;
    }
    if (svgs["squat:body_only"]) return "squat:body_only";
    if (svgs.squat) return "squat";
    var allKeys = Object.keys(svgs);
    return allKeys.length > 0 ? allKeys[0] : null;
  }

  function resolveCatalogSvg(svgs, keyOrArch, fallbackArch) {
    var resolvedKey = resolveCatalogSvgKey(svgs, keyOrArch, fallbackArch);
    return resolvedKey && svgs[resolvedKey] ? svgs[resolvedKey] : "";
  }

  /**
   * Assign ONLY trusted build-time SVG or deterministic TrainingQR SVG markup.
   * User-controlled strings are NEVER passed here.
   */
  function setTrustedSvg(containerEl, trustedSvgMarkup) {
    if (!containerEl) return;
    var trimmed =
      typeof trustedSvgMarkup === "string" ? trustedSvgMarkup.trim() : "";
    if (trimmed.indexOf("<svg") === 0) {
      containerEl.innerHTML = trimmed;
    } else {
      containerEl.replaceChildren();
    }
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = props[k];
        if (v === undefined || v === null) continue;
        if (k === "className") {
          node.className = v;
        } else if (k === "textContent") {
          node.textContent = String(v);
        } else if (k === "dataset" && typeof v === "object") {
          var dKeys = Object.keys(v);
          for (var d = 0; d < dKeys.length; d++) {
            if (v[dKeys[d]] !== undefined && v[dKeys[d]] !== null) {
              node.dataset[dKeys[d]] = String(v[dKeys[d]]);
            }
          }
        } else if (k === "style" && typeof v === "object") {
          var sKeys = Object.keys(v);
          for (var s = 0; s < sKeys.length; s++) {
            node.style[sKeys[s]] = v[sKeys[s]];
          }
        } else if (
          k === "checked" ||
          k === "disabled" ||
          k === "hidden" ||
          k === "required" ||
          k === "readOnly" ||
          k === "selected"
        ) {
          node[k] = Boolean(v);
        } else if (k === "value") {
          node.value = String(v);
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  function svgNode(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = attrs[k];
        if (v === undefined || v === null) continue;
        if (k === "textContent") {
          node.textContent = String(v);
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(parent, children) {
    if (children === undefined || children === null) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) {
        appendChildren(parent, children[i]);
      }
    } else if (typeof children === "string" || typeof children === "number") {
      parent.appendChild(document.createTextNode(String(children)));
    } else {
      parent.appendChild(children);
    }
  }

  function formatLogDate(rawIso) {
    if (!rawIso) return "";
    var dt = rawIso instanceof Date ? rawIso : new Date(rawIso);
    if (Number.isNaN(dt.getTime())) return "";
    var mon = SHORT_MONTHS[dt.getUTCMonth()] || "";
    var day = String(dt.getUTCDate()).padStart(2, "0");
    return mon + " " + day;
  }

  function buildProgressChartSvg(series) {
    var labels = (series && Array.isArray(series.labels) && series.labels) || [];
    var values = (series && Array.isArray(series.values) && series.values) || [];
    var n = Math.min(labels.length, values.length);
    if (n === 0) return null;

    var width = 760;
    var height = 400;
    var padL = 56;
    var padR = 26;
    var padT = 24;
    var padB = 42;
    var plotW = width - padL - padR;
    var plotH = height - padT - padB;

    var rawMin = 85;
    var rawMax = 115;
    for (var i = 0; i < n; i++) {
      var val = Number(values[i]) || 100;
      if (val < rawMin) rawMin = val;
      if (val > rawMax) rawMax = val;
    }
    var minVal = Math.floor((rawMin - 10) / 10) * 10;
    var maxVal = Math.ceil((rawMax + 10) / 10) * 10;
    if (maxVal <= minVal) maxVal = minVal + 20;
    var ySpan = maxVal - minVal;
    var yStep = ySpan > 80 ? 20 : 10;

    function xAt(idx) {
      if (n === 1) return padL + plotW * 0.5;
      return padL + (idx / (n - 1)) * plotW;
    }

    function yAt(v) {
      var ratio = (v - minVal) / ySpan;
      return padT + plotH - ratio * plotH;
    }

    var svg = svgNode("svg", {
      class: "progress-svg-chart",
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Workout intensity progression chart",
    });

    var defs = svgNode("defs", null, [
      svgNode(
        "linearGradient",
        { id: "intensityAreaGrad", x1: "0", y1: "0", x2: "0", y2: "1" },
        [
          svgNode("stop", {
            offset: "0%",
            "stop-color": "#34d399",
            "stop-opacity": "0.34",
          }),
          svgNode("stop", {
            offset: "100%",
            "stop-color": "#10b981",
            "stop-opacity": "0.0",
          }),
        ]
      ),
    ]);
    svg.appendChild(defs);

    var gridGroup = svgNode("g", { class: "chart-grid" });

    for (var tick = minVal; tick <= maxVal; tick += yStep) {
      var ty = yAt(tick);
      gridGroup.appendChild(
        svgNode("line", {
          x1: padL.toFixed(1),
          y1: ty.toFixed(1),
          x2: (padL + plotW).toFixed(1),
          y2: ty.toFixed(1),
          stroke: "rgba(148, 163, 184, 0.1)",
          "stroke-width": "1",
        })
      );
      gridGroup.appendChild(
        svgNode("text", {
          x: (padL - 10).toFixed(1),
          y: (ty + 4).toFixed(1),
          fill: "#94a3b8",
          "font-size": "12",
          "font-weight": "600",
          "text-anchor": "end",
          textContent: tick + "%",
        })
      );
    }

    var xStride = n > 14 ? Math.ceil(n / 12) : 1;
    var pts = [];
    for (var p = 0; p < n; p++) {
      var px = xAt(p);
      var py = yAt(Number(values[p]) || 100);
      pts.push([px, py]);

      if (p % xStride === 0 || p === n - 1) {
        gridGroup.appendChild(
          svgNode("line", {
            x1: px.toFixed(1),
            y1: padT.toFixed(1),
            x2: px.toFixed(1),
            y2: (padT + plotH).toFixed(1),
            stroke: "rgba(148, 163, 184, 0.06)",
            "stroke-width": "1",
          })
        );
        gridGroup.appendChild(
          svgNode("text", {
            x: px.toFixed(1),
            y: (padT + plotH + 24).toFixed(1),
            fill: "#94a3b8",
            "font-size": "12",
            "font-weight": "600",
            "text-anchor": "middle",
            textContent: String(labels[p]),
          })
        );
      }
    }
    svg.appendChild(gridGroup);

    var lineD = "M " + pts[0][0].toFixed(2) + " " + pts[0][1].toFixed(2);
    for (var seg = 0; seg < pts.length - 1; seg++) {
      var p0 = pts[seg > 0 ? seg - 1 : seg];
      var p1 = pts[seg];
      var p2 = pts[seg + 1];
      var p3 = pts[seg + 2 < pts.length ? seg + 2 : seg + 1];
      var tension = 0.22;
      var cp1x = p1[0] + (p2[0] - p0[0]) * tension;
      var cp1y = p1[1] + (p2[1] - p0[1]) * tension;
      var cp2x = p2[0] - (p3[0] - p1[0]) * tension;
      var cp2y = p2[1] - (p3[1] - p1[1]) * tension;
      var segMinY = Math.min(p1[1], p2[1]);
      var segMaxY = Math.max(p1[1], p2[1]);
      cp1y = Math.max(segMinY, Math.min(segMaxY, cp1y));
      cp2y = Math.max(segMinY, Math.min(segMaxY, cp2y));
      lineD +=
        " C " +
        cp1x.toFixed(2) +
        " " +
        cp1y.toFixed(2) +
        ", " +
        cp2x.toFixed(2) +
        " " +
        cp2y.toFixed(2) +
        ", " +
        p2[0].toFixed(2) +
        " " +
        p2[1].toFixed(2);
    }

    var baselineY = (padT + plotH).toFixed(2);
    if (pts.length > 1) {
      var areaD =
        lineD +
        " L " +
        pts[pts.length - 1][0].toFixed(2) +
        " " +
        baselineY +
        " L " +
        pts[0][0].toFixed(2) +
        " " +
        baselineY +
        " Z";
      svg.appendChild(
        svgNode("path", {
          d: areaD,
          fill: "url(#intensityAreaGrad)",
        })
      );
      svg.appendChild(
        svgNode("path", {
          d: lineD,
          fill: "none",
          stroke: "#34d399",
          "stroke-width": "3.5",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })
      );
    }

    var pointsGroup = svgNode("g", { class: "chart-points" });
    for (var k = 0; k < pts.length; k++) {
      var circle = svgNode(
        "circle",
        {
          cx: pts[k][0].toFixed(2),
          cy: pts[k][1].toFixed(2),
          r: "6",
          fill: "#34d399",
          stroke: "#090d16",
          "stroke-width": "2.2",
        },
        [
          svgNode("title", {
            textContent: String(labels[k]) + ": " + String(values[k]) + "%",
          }),
        ]
      );
      pointsGroup.appendChild(circle);
    }
    svg.appendChild(pointsGroup);

    return svg;
  }

  function createViewScope() {
    var controller =
      typeof AbortController === "function" ? new AbortController() : null;
    var rafIds = new Set();
    var intervals = new Set();
    var timeouts = new Set();
    var cleanups = [];
    var disposed = false;

    function on(target, eventName, handler, options) {
      if (!target || typeof target.addEventListener !== "function") return;
      if (controller) {
        var opts = Object.assign({}, options || {}, {
          signal: controller.signal,
        });
        target.addEventListener(eventName, handler, opts);
      } else {
        target.addEventListener(eventName, handler, options || false);
        cleanups.push(function () {
          target.removeEventListener(eventName, handler, options || false);
        });
      }
    }

    function onMediaChange(mql, handler) {
      if (!mql) return;
      if (typeof mql.addEventListener === "function") {
        on(mql, "change", handler);
      } else if (typeof mql.addListener === "function") {
        mql.addListener(handler);
        cleanups.push(function () {
          if (typeof mql.removeListener === "function") {
            mql.removeListener(handler);
          }
        });
      }
    }

    function requestFrame(cb) {
      if (disposed || typeof requestAnimationFrame !== "function") return null;
      var id = requestAnimationFrame(function (ts) {
        rafIds.delete(id);
        if (!disposed) cb(ts);
      });
      rafIds.add(id);
      return id;
    }

    function cancelFrame(id) {
      if (id !== null && id !== undefined) {
        rafIds.delete(id);
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(id);
        }
      }
    }

    function addInterval(cb, ms) {
      if (disposed) return null;
      var id = setInterval(function () {
        if (!disposed) cb();
      }, ms);
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
      var id = setTimeout(function () {
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
      if (controller) {
        controller.abort();
      }
      rafIds.forEach(function (id) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(id);
        }
      });
      rafIds.clear();
      intervals.forEach(function (id) {
        clearInterval(id);
      });
      intervals.clear();
      timeouts.forEach(function (id) {
        clearTimeout(id);
      });
      timeouts.clear();
      for (var i = 0; i < cleanups.length; i++) {
        try {
          cleanups[i]();
        } catch (e) {
          // Ignore teardown errors
        }
      }
      cleanups.length = 0;
    }

    return {
      on: on,
      onMediaChange: onMediaChange,
      requestFrame: requestFrame,
      cancelFrame: cancelFrame,
      addInterval: addInterval,
      clearTrackedInterval: clearTrackedInterval,
      addTimeout: addTimeout,
      onCleanup: onCleanup,
      dispose: dispose,
      isDisposed: function () {
        return disposed;
      },
    };
  }

  function createFallbackSound() {
    var theme = "minimal";
    var lastActive = "minimal";
    var elapsed = 0;
    return {
      getTheme: function () {
        return theme;
      },
      setTheme: function (id) {
        theme = id || "minimal";
        if (theme !== "off") lastActive = theme;
        return theme;
      },
      toggleMute: function () {
        theme = theme === "off" ? lastActive || "minimal" : "off";
        return theme;
      },
      isMuted: function () {
        return theme === "off";
      },
      ensureAudio: function () {
        return null;
      },
      beginPhase: function () {
        elapsed = 0;
      },
      advancePhase: function (dt) {
        elapsed += Math.max(0, dt || 0);
        return elapsed;
      },
      pause: function () {},
      resume: function () {},
      stopAll: function () {},
      countdown: function () {},
      startSignal: function () {},
      midRep: function () {},
      repDone: function () {},
      holdTick: function () {},
      stopSet: function () {},
      workoutComplete: function () {},
    };
  }

  function turnaroundFor(mode) {
    if (
      root.TrainingMotion &&
      typeof root.TrainingMotion.turnaroundForMode === "function"
    ) {
      return root.TrainingMotion.turnaroundForMode(mode);
    }
    return 0.43;
  }

  function evalTempo(frac, mode) {
    if (
      root.TrainingMotion &&
      typeof root.TrainingMotion.tempoCurve === "function"
    ) {
      return root.TrainingMotion.tempoCurve(frac, mode || "standard");
    }
    return 0.5 - 0.5 * Math.cos(frac * Math.PI * 2);
  }

  function isReducedMotion() {
    if (
      root.TrainingMotion &&
      typeof root.TrainingMotion.prefersReducedMotion === "function"
    ) {
      return root.TrainingMotion.prefersReducedMotion();
    }
    return Boolean(
      root.matchMedia &&
        root.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function bindRig(svgEl) {
    if (
      root.TrainingMotion &&
      typeof root.TrainingMotion.bindSvg === "function"
    ) {
      return root.TrainingMotion.bindSvg(svgEl);
    }
    return {
      applyPose: function () {},
      applyRestBreath: function () {},
      applyHold: function () {},
      tempoMode: "standard",
      holdStyle: "settle",
    };
  }

  function makeVolumeOnIcon() {
    return svgNode(
      "svg",
      {
        id: "icon-vol-on",
        width: "18",
        height: "18",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      [
        svgNode("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }),
        svgNode("path", { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }),
        svgNode("path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14" }),
      ]
    );
  }

  function makeVolumeOffIcon() {
    return svgNode(
      "svg",
      {
        id: "icon-vol-off",
        width: "18",
        height: "18",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        style: "display: none;",
      },
      [
        svgNode("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }),
        svgNode("line", { x1: "23", y1: "9", x2: "17", y2: "15" }),
        svgNode("line", { x1: "17", y1: "9", x2: "23", y2: "15" }),
      ]
    );
  }

  function makeFullscreenIcon() {
    return svgNode(
      "svg",
      {
        width: "17",
        height: "17",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      [
        svgNode("path", {
          d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
        }),
      ]
    );
  }

  function makeCheckIcon() {
    return svgNode(
      "svg",
      {
        width: "18",
        height: "18",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.4",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      [svgNode("polyline", { points: "20 6 9 17 4 12" })]
    );
  }

  var exportedApi = {
    normalizeEqProp: normalizeEqProp,
    resolveCatalogSvgKey: resolveCatalogSvgKey,
    resolveCatalogSvg: resolveCatalogSvg,
    buildProgressChartSvg: buildProgressChartSvg,
    createViewScope: createViewScope,
    formatLogDate: formatLogDate,
  };

  root.TrainingApp = exportedApi;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportedApi;
  }

  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  /* ------------------------------------------------------------------
     Browser Application Controller
  ------------------------------------------------------------------ */

  var catalog = null;
  var store = null;
  var activeScope = null;
  var modalScope = null;
  var lastCompletedLog = null;
  var hasMountedScreen = false;

  var Sound =
    root.TrainingSound &&
    typeof root.TrainingSound.createController === "function"
      ? root.TrainingSound.createController({
          turnaroundForMode: turnaroundFor,
        })
      : createFallbackSound();

  function registerServiceWorker() {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      (window.location.protocol === "https:" ||
        window.location.protocol === "http:")
    ) {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        // Ignore offline/sandbox SW registration errors
      });
    }
  }

  function buildShareUrl(fragment) {
    var cleanFrag = String(fragment || "");
    if (cleanFrag && cleanFrag.charAt(0) !== "#") {
      cleanFrag = "#" + cleanFrag;
    }
    var loc = window.location;
    if (loc.origin && loc.origin !== "null") {
      return loc.origin + loc.pathname + loc.search + cleanFrag;
    }
    return loc.href.split("#")[0] + cleanFrag;
  }

  function canMobileShareFiles() {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.share !== "function" ||
      typeof navigator.canShare !== "function" ||
      typeof File !== "function"
    ) {
      return false;
    }
    try {
      var probe = new File(["{}"], "backup.json", {
        type: "application/json",
      });
      return Boolean(navigator.canShare({ files: [probe] }));
    } catch (e) {
      return false;
    }
  }

  function showToast(message) {
    var toastRoot = document.getElementById("toast-root");
    if (!toastRoot || !message) return;
    var pill = el("div", {
      className: "pill pill-brand toast-pill",
      role: "status",
      textContent: message,
    });
    toastRoot.appendChild(pill);
    setTimeout(function () {
      if (pill.parentNode === toastRoot) {
        toastRoot.removeChild(pill);
      }
    }, 2800);
  }

  function closeModal() {
    if (modalScope) {
      modalScope.dispose();
      modalScope = null;
    }
    var modalRoot = document.getElementById("modal-root");
    if (modalRoot) {
      modalRoot.replaceChildren();
      modalRoot.hidden = true;
    }
  }

  function openModal(buildFn, onEscape) {
    closeModal();
    var modalRoot = document.getElementById("modal-root");
    if (!modalRoot) return;
    modalScope = createViewScope();

    var backdrop = el("div", { className: "modal-backdrop" });
    var card = buildFn(modalScope);
    backdrop.appendChild(card);
    modalRoot.replaceChildren(backdrop);
    modalRoot.hidden = false;

    modalScope.on(window, "keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (typeof onEscape === "function") {
          onEscape();
        } else {
          closeModal();
        }
      }
    });
  }

  function teardownActiveView() {
    Sound.stopAll();
    if (activeScope) {
      activeScope.dispose();
      activeScope = null;
    }
  }

  function syncTopbar(activeNav, hideTopbar) {
    var topbar = document.getElementById("app-topbar");
    var nav = document.getElementById("primary-nav");
    var brandLink = document.getElementById("brand-home-link");
    var hasPlan = Boolean(store && store.hasActivePlan());

    if (topbar) {
      topbar.hidden = Boolean(hideTopbar);
    }
    if (brandLink) {
      brandLink.setAttribute("href", hasPlan ? "#plan" : "#setup");
    }
    if (nav) {
      nav.hidden = !hasPlan;
      var links = nav.querySelectorAll("a[data-nav]");
      for (var i = 0; i < links.length; i++) {
        var lnk = links[i];
        if (lnk.dataset.nav === activeNav) {
          lnk.setAttribute("aria-current", "page");
        } else {
          lnk.removeAttribute("aria-current");
        }
      }
    }
  }

  function navigateTo(hash) {
    var target = hash.charAt(0) === "#" ? hash : "#" + hash;
    if (window.location.hash === target) {
      handleRoute();
    } else {
      window.location.hash = target;
    }
  }

  function replaceHash(hash) {
    var target = hash.charAt(0) === "#" ? hash : "#" + hash;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + target
    );
  }

  /* ------------------------------------------------------------------
     Screen 1: Setup & Cross-Device Portability (#setup)
  ------------------------------------------------------------------ */

  function renderSetupScreen() {
    teardownActiveView();
    var scope = createViewScope();
    activeScope = scope;
    hasMountedScreen = true;

    document.title = "Setup";
    syncTopbar("setup", false);

    var state = store.getState();
    var profile = (state && state.profile) || null;
    var curName = profile && profile.name ? profile.name : "";
    var curEq = profile && profile.equipment ? profile.equipment : "body_only";
    var curInt =
      profile && profile.starting_intensity
        ? profile.starting_intensity
        : "moderate";
    var curDays = profile && profile.weekly_goal ? Number(profile.weekly_goal) : 3;
    if (curDays !== 2 && curDays !== 3 && curDays !== 4) {
      curDays = 3;
    }

    var programsCfg = (catalog && catalog.programs) || {};
    var eqArchMap = programsCfg.equipment_archetypes || {
      body_only: "squat",
      dumbbells: "curl",
      kettlebell_bands: "hinge",
      full_gym: "bench_press",
    };
    var eqPropMap = programsCfg.setup_equipment_props || {
      body_only: "body only",
      dumbbells: "dumbbell",
      kettlebell_bands: "bands",
      full_gym: "barbell",
    };

    function getSetupSvgMarkup(eqKey) {
      var arch = eqArchMap[eqKey] || "squat";
      var prop = eqPropMap[eqKey] || "body_only";
      var composite = arch + ":" + normalizeEqProp(prop);
      return resolveCatalogSvg(catalog.svgs, composite, arch);
    }

    var prescriptionPill = el("span", {
      className: "pill",
      id: "setup-prescription-pill",
      textContent: SETUP_PRESCRIPTIONS[curInt] || SETUP_PRESCRIPTIONS.moderate,
    });

    var svgWrap = el("div", {
      id: "setup-svg-wrap",
      className: "stage-svg-wrap",
    });
    setTrustedSvg(svgWrap, getSetupSvgMarkup(curEq));

    var stageSection = el(
      "section",
      { className: "graphic-stage", "aria-label": "Exercise preview" },
      [
        el("div", { className: "stage-hud-top" }, [
          el(
            "div",
            {
              style: { display: "flex", alignItems: "center", gap: "0.45rem" },
            },
            [
              el("span", { className: "pill pill-brand", textContent: "Setup" }),
              prescriptionPill,
            ]
          ),
        ]),
        svgWrap,
      ]
    );

    var nameInput = el("input", {
      type: "text",
      name: "name",
      className: "minimal-input",
      value: curName,
      placeholder: "Name",
      required: true,
      maxlength: "50",
    });

    function makeRadioTile(groupName, val, labelText, isChecked) {
      var radio = el("input", {
        type: "radio",
        name: groupName,
        value: val,
        checked: isChecked,
      });
      return {
        input: radio,
        label: el("label", { className: "tile-option" }, [
          radio,
          el("span", { textContent: labelText }),
        ]),
      };
    }

    var eqTiles = [
      makeRadioTile("equipment", "body_only", "Body Only", curEq === "body_only"),
      makeRadioTile("equipment", "dumbbells", "Dumbbells", curEq === "dumbbells"),
      makeRadioTile(
        "equipment",
        "kettlebell_bands",
        "KB · Bands",
        curEq === "kettlebell_bands"
      ),
      makeRadioTile("equipment", "full_gym", "Full Gym", curEq === "full_gym"),
    ];

    var intTiles = [
      makeRadioTile("starting_intensity", "light", "Easy", curInt === "light"),
      makeRadioTile(
        "starting_intensity",
        "moderate",
        "Moderate",
        curInt === "moderate"
      ),
      makeRadioTile(
        "starting_intensity",
        "intense",
        "Intense",
        curInt === "intense"
      ),
    ];

    var dayTiles = [
      makeRadioTile("days_per_week", "2", "2\u00d7", curDays === 2),
      makeRadioTile("days_per_week", "3", "3\u00d7", curDays === 3),
      makeRadioTile("days_per_week", "4", "4\u00d7", curDays === 4),
    ];

    var setupForm = el("form", { className: "setup-form" }, [
      el("label", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Name" }),
        nameInput,
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Equipment" }),
        el(
          "div",
          { className: "tile-grid-2" },
          eqTiles.map(function (t) {
            return t.label;
          })
        ),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Intensity" }),
        el(
          "div",
          { className: "tile-grid-3" },
          intTiles.map(function (t) {
            return t.label;
          })
        ),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Weekly" }),
        el(
          "div",
          { className: "tile-grid-3" },
          dayTiles.map(function (t) {
            return t.label;
          })
        ),
      ]),
      el("button", {
        type: "submit",
        className: "btn-primary",
        style: { marginTop: "0.35rem", width: "100%" },
        textContent: "Start \u2192",
      }),
    ]);

    /* Portability & Cross-Device Card */
    var hasPlan = store.hasActivePlan();

    var shareBtn = el("button", {
      type: "button",
      id: "share-plan-btn",
      className: "btn-ghost btn-compact",
      disabled: !hasPlan,
      textContent: "Share Plan / QR",
    });

    var qrFrame = el("div", { id: "share-qr-wrap", className: "qr-frame" });
    var shareUrlInput = el("input", {
      type: "text",
      id: "share-url-input",
      className: "minimal-input share-url-input",
      readOnly: true,
      "aria-label": "Shareable plan URL",
    });
    var copyLinkBtn = el("button", {
      type: "button",
      id: "copy-share-link-btn",
      className: "btn-ghost btn-compact",
      textContent: "Copy Link",
    });
    var openTabLink = el("a", {
      id: "open-tab-link",
      className: "share-tab-link",
      href: "#plan",
      target: "_blank",
      rel: "noopener",
      textContent: "Open Tab Link",
    });

    var sharePanel = el(
      "div",
      { id: "share-result-panel", className: "share-panel", hidden: true },
      [
        qrFrame,
        el("div", { className: "share-url-row" }, [shareUrlInput, copyLinkBtn]),
        el("div", { className: "share-hint" }, [
          openTabLink,
          " — Scan the QR code on another device, copy the link, or open this tab link to hand off via Chrome / Safari synced tabs.",
        ]),
      ]
    );

    var includeLogsCheckbox = el("input", {
      type: "checkbox",
      id: "backup-include-logs",
      checked: true,
    });

    var exportJsonBtn = el("button", {
      type: "button",
      id: "export-json-btn",
      className: "btn-ghost btn-compact",
      disabled: !hasPlan,
      textContent: "Export .json",
    });

    var shareCloudBtn = canMobileShareFiles()
      ? el("button", {
          type: "button",
          id: "share-json-file-btn",
          className: "btn-ghost btn-compact",
          disabled: !hasPlan,
          textContent: "Save to Cloud",
        })
      : null;

    var importFileInput = el("input", {
      type: "file",
      id: "import-json-input",
      className: "file-input-hidden",
      accept: ".json,application/json",
    });

    var importFileLabel = el(
      "label",
      {
        className: "btn-ghost btn-compact file-btn-label",
        tabindex: "0",
        role: "button",
      },
      [el("span", { textContent: "Import .json" }), importFileInput]
    );

    var backupButtons = [exportJsonBtn];
    if (shareCloudBtn) backupButtons.push(shareCloudBtn);
    backupButtons.push(importFileLabel);

    var portabilityStatus = el("span", {
      id: "portability-status",
      className: "pill pill-brand",
      hidden: true,
    });

    var portabilityCard = el(
      "section",
      {
        className: "portability-card",
        "aria-label": "Portability and Cross-Device Backup",
      },
      [
        el("div", { className: "portability-head" }, [
          el("span", {
            className: "field-label",
            textContent: "Portability & Backup",
          }),
          portabilityStatus,
        ]),
        el("div", { className: "portability-block" }, [
          el("div", { className: "portability-actions" }, [
            shareBtn,
            !hasPlan
              ? el("span", {
                  className: "muted",
                  style: { fontSize: "0.76rem" },
                  textContent: "Create or import a plan to share",
                })
              : null,
          ]),
          sharePanel,
        ]),
        el("hr", { className: "portability-divider" }),
        el("div", { className: "portability-block" }, [
          el("label", { className: "checkbox-row" }, [
            includeLogsCheckbox,
            el("span", { textContent: "Include workout history" }),
          ]),
          el("div", { className: "portability-actions" }, backupButtons),
        ]),
      ]
    );

    var sidePane = el("section", { className: "side-pane" }, [
      setupForm,
      portabilityCard,
    ]);

    var mainEl = el("main", { className: "split-screen" }, [
      stageSection,
      sidePane,
    ]);

    var appRoot = document.getElementById("app-root");
    appRoot.replaceChildren(mainEl);

    /* Animation & Interactive Bindings */
    var rig = bindRig(svgWrap.querySelector("svg"));
    var speed = SETUP_SPEEDS[curInt] || SETUP_SPEEDS.moderate;
    var phase = 0;
    var currentT = 0;
    var lastTs = null;
    var rafId = null;

    function setPortabilityFeedback(msg) {
      portabilityStatus.textContent = msg;
      portabilityStatus.hidden = false;
      showToast(msg);
    }

    function stopLoop() {
      if (rafId !== null) {
        scope.cancelFrame(rafId);
        rafId = null;
      }
      lastTs = null;
    }

    function frame(ts) {
      rafId = null;
      if (document.hidden || isReducedMotion()) {
        lastTs = null;
        return;
      }
      var dt = lastTs === null ? 0 : Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      phase = (phase + dt * speed) % 1;
      currentT = evalTempo(phase, "standard");
      rig.applyPose(currentT);
      rafId = scope.requestFrame(frame);
    }

    function ensureLoop() {
      if (document.hidden || isReducedMotion()) {
        stopLoop();
        if (isReducedMotion() && rig) {
          currentT = 0.85;
          rig.applyPose(0.85);
        }
        return;
      }
      if (rafId === null) {
        lastTs = null;
        rafId = scope.requestFrame(frame);
      }
    }

    eqTiles.forEach(function (tile) {
      scope.on(tile.input, "change", function () {
        if (!tile.input.checked) return;
        setTrustedSvg(svgWrap, getSetupSvgMarkup(tile.input.value));
        rig = bindRig(svgWrap.querySelector("svg"));
        rig.applyPose(isReducedMotion() ? 0.85 : currentT);
      });
    });

    intTiles.forEach(function (tile) {
      scope.on(tile.input, "change", function () {
        if (!tile.input.checked) return;
        var v = tile.input.value;
        speed = SETUP_SPEEDS[v] || SETUP_SPEEDS.moderate;
        prescriptionPill.textContent =
          SETUP_PRESCRIPTIONS[v] || SETUP_PRESCRIPTIONS.moderate;
      });
    });

    scope.on(setupForm, "submit", function (e) {
      e.preventDefault();
      var chosenEq = "body_only";
      eqTiles.forEach(function (t) {
        if (t.input.checked) chosenEq = t.input.value;
      });
      var chosenInt = "moderate";
      intTiles.forEach(function (t) {
        if (t.input.checked) chosenInt = t.input.value;
      });
      var chosenDays = 3;
      dayTiles.forEach(function (t) {
        if (t.input.checked) chosenDays = Number(t.input.value);
      });

      var cleanName = nameInput.value.trim() || "Athlete";
      store.setupPlan({
        name: cleanName,
        equipment: chosenEq,
        starting_intensity: chosenInt,
        days_per_week: chosenDays,
        sound_theme: store.getSoundTheme(),
      });
      navigateTo("#plan");
    });

    scope.on(shareBtn, "click", function () {
      if (!store.hasActivePlan()) return;
      Promise.resolve(store.encodeShareFragment())
        .then(function (fragment) {
          if (scope.isDisposed()) return;
          var shareUrl = buildShareUrl(fragment);
          shareUrlInput.value = shareUrl;
          openTabLink.setAttribute("href", shareUrl);
          if (
            root.TrainingQR &&
            typeof root.TrainingQR.renderSvg === "function"
          ) {
            setTrustedSvg(
              qrFrame,
              root.TrainingQR.renderSvg(shareUrl, { margin: 2 })
            );
          }
          sharePanel.hidden = false;
        })
        .catch(function () {
          showToast("Could not encode share link");
        });
    });

    scope.on(shareUrlInput, "click", function () {
      shareUrlInput.select();
    });

    scope.on(copyLinkBtn, "click", function () {
      var urlText = shareUrlInput.value;
      if (!urlText) return;
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        navigator.clipboard
          .writeText(urlText)
          .then(function () {
            setPortabilityFeedback("Link copied");
          })
          .catch(function () {
            shareUrlInput.select();
            document.execCommand("copy");
            setPortabilityFeedback("Link copied");
          });
      } else {
        shareUrlInput.select();
        document.execCommand("copy");
        setPortabilityFeedback("Link copied");
      }
    });

    function buildBackupFilename() {
      var iso = new Date().toISOString().slice(0, 10);
      return "training-aid-backup-" + iso + ".json";
    }

    scope.on(exportJsonBtn, "click", function () {
      if (!store.hasActivePlan()) return;
      var jsonText = store.exportBackupJson({
        includeLogs: includeLogsCheckbox.checked,
      });
      var filename = buildBackupFilename();
      var blob = new Blob([jsonText], { type: "application/json" });
      var blobUrl = URL.createObjectURL(blob);
      var dl = el("a", { href: blobUrl, download: filename });
      document.body.appendChild(dl);
      dl.click();
      document.body.removeChild(dl);
      setTimeout(function () {
        URL.revokeObjectURL(blobUrl);
      }, 1500);
      setPortabilityFeedback("Backup exported");
    });

    if (shareCloudBtn) {
      scope.on(shareCloudBtn, "click", function () {
        if (!store.hasActivePlan()) return;
        var jsonText = store.exportBackupJson({
          includeLogs: includeLogsCheckbox.checked,
        });
        var file = new File([jsonText], buildBackupFilename(), {
          type: "application/json",
        });
        navigator
          .share({ files: [file], title: "Training Aid Backup" })
          .then(function () {
            setPortabilityFeedback("Backup shared");
          })
          .catch(function () {
            // User dismissed share sheet
          });
      });
    }

    scope.on(importFileLabel, "keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        importFileInput.click();
      }
    });

    scope.on(importFileInput, "change", function () {
      var file = importFileInput.files && importFileInput.files[0];
      if (!file) return;
      file
        .text()
        .then(function (jsonText) {
          importFileInput.value = "";
          promptJsonBackupImport(jsonText);
        })
        .catch(function () {
          importFileInput.value = "";
          showToast("Could not read backup file");
        });
    });

    scope.on(document, "visibilitychange", function () {
      if (document.hidden) {
        stopLoop();
      } else {
        ensureLoop();
      }
    });

    var reducedQuery = root.matchMedia
      ? root.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    scope.onMediaChange(reducedQuery, ensureLoop);

    ensureLoop();
  }

  function promptJsonBackupImport(jsonText) {
    var parsed;
    try {
      parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || parsed.schema_version !== 1) {
        throw new Error("Unsupported backup format");
      }
    } catch (err) {
      openModal(function (mScope) {
        var dismissBtn = el("button", {
          type: "button",
          className: "btn-ghost",
          textContent: "Dismiss",
        });
        mScope.on(dismissBtn, "click", closeModal);
        return el(
          "div",
          {
            className: "modal-card is-error",
            role: "dialog",
            "aria-modal": "true",
          },
          [
            el("h2", {
              className: "modal-title",
              textContent: "Invalid Backup File",
            }),
            el("div", {
              className: "muted",
              textContent:
                "Please choose a valid Training Aid .json backup file (schema v1).",
            }),
            el("div", { className: "modal-actions" }, [dismissBtn]),
          ]
        );
      });
      return;
    }

    var incomingName =
      parsed.profile && typeof parsed.profile.name === "string"
        ? parsed.profile.name.trim().slice(0, 50) || "Athlete"
        : "Athlete";
    var incomingPlan =
      parsed.plan && typeof parsed.plan.name === "string"
        ? parsed.plan.name.trim().slice(0, 80) || "Training Plan"
        : "Training Plan";
    var routineCount =
      parsed.plan && Array.isArray(parsed.plan.routines)
        ? parsed.plan.routines.length
        : 0;
    var logCount = Array.isArray(parsed.logs) ? parsed.logs.length : 0;

    openModal(function (mScope) {
      var cancelBtn = el("button", {
        type: "button",
        className: "btn-ghost",
        textContent: "Cancel",
      });
      var mergeBtn = el("button", {
        type: "button",
        className: "btn-ghost",
        textContent: "Import & Merge History",
      });
      var replaceBtn = el("button", {
        type: "button",
        className: "btn-primary",
        textContent: store.hasActivePlan()
          ? "Replace Local Data"
          : "Import Backup",
      });

      function runImport(mergeLogs) {
        try {
          store.importBackupJson(jsonText, { mergeLogs: mergeLogs });
          Sound.setTheme(store.getSoundTheme());
          closeModal();
          showToast("Backup imported");
          navigateTo("#plan");
        } catch (err) {
          closeModal();
          showToast(
            err && err.message ? err.message : "Backup validation failed"
          );
        }
      }

      mScope.on(cancelBtn, "click", closeModal);
      mScope.on(mergeBtn, "click", function () {
        runImport(true);
      });
      mScope.on(replaceBtn, "click", function () {
        runImport(false);
      });

      var actionBtns = [cancelBtn];
      if (store.hasActivePlan()) {
        actionBtns.push(mergeBtn);
      }
      actionBtns.push(replaceBtn);

      return el(
        "div",
        { className: "modal-card", role: "dialog", "aria-modal": "true" },
        [
          el("div", { className: "modal-stats" }, [
            el("span", {
              className: "pill pill-brand",
              textContent: "Backup Restore",
            }),
            el("span", {
              className: "pill",
              textContent: routineCount + " days",
            }),
            el("span", {
              className: "pill",
              textContent: logCount + " workouts",
            }),
          ]),
          el("h2", { className: "modal-title", textContent: incomingPlan }),
          el("div", {
            className: "muted",
            textContent:
              "Athlete: " +
              incomingName +
              (store.hasActivePlan()
                ? " — Confirm before replacing local plan data."
                : ""),
          }),
          el("div", { className: "modal-actions" }, actionBtns),
        ]
      );
    });
  }

  /* ------------------------------------------------------------------
     Incoming #import=<token> Confirmation Modal
  ------------------------------------------------------------------ */

  function handleIncomingShareImport(rawHash) {
    if (!hasMountedScreen) {
      if (store.hasActivePlan()) {
        renderPlanScreen();
      } else {
        renderSetupScreen();
      }
    }

    function finishImportFlow() {
      closeModal();
      replaceHash("#plan");
      handleRoute();
    }

    Promise.resolve()
      .then(function () {
        return store.decodeShareFragment(rawHash);
      })
      .then(function (preview) {
        var incState = (preview && preview.state) || {};
        var athleteName =
          (incState.profile && incState.profile.name) || "Athlete";
        var planName =
          (incState.plan && incState.plan.name) || "Shared Training Plan";
        var rCount = Number(preview.routineCount) || 0;
        var exCount = Number(preview.exerciseCount) || 0;

        openModal(function (mScope) {
          var cancelBtn = el("button", {
            type: "button",
            id: "import-cancel-btn",
            className: "btn-ghost",
            textContent: "Cancel",
          });
          var confirmBtn = el("button", {
            type: "button",
            id: "import-confirm-btn",
            className: "btn-primary",
            textContent: "Import Plan (Keep History)",
          });

          mScope.on(cancelBtn, "click", finishImportFlow);
          mScope.on(confirmBtn, "click", function () {
            preview.apply({ keepExistingLogs: true });
            Sound.setTheme(store.getSoundTheme());
            finishImportFlow();
            showToast("Plan imported");
          });

          return el(
            "div",
            {
              className: "modal-card",
              role: "dialog",
              "aria-modal": "true",
              "aria-label": "Import shared training plan",
            },
            [
              el("div", { className: "modal-stats" }, [
                el("span", {
                  className: "pill pill-brand",
                  textContent: "Shared Plan",
                }),
                el("span", {
                  className: "pill",
                  textContent: rCount + " routines",
                }),
                el("span", {
                  className: "pill",
                  textContent: exCount + " exercises",
                }),
              ]),
              el("h2", { className: "modal-title", textContent: planName }),
              el("div", {
                className: "muted",
                textContent:
                  "Athlete: " +
                  athleteName +
                  " · Your local workout history will be preserved.",
              }),
              el("div", { className: "modal-actions" }, [
                cancelBtn,
                confirmBtn,
              ]),
            ]
          );
        }, finishImportFlow);
      })
      .catch(function () {
        openModal(function (mScope) {
          var cancelBtn = el("button", {
            type: "button",
            id: "import-cancel-btn",
            className: "btn-ghost",
            textContent: "Cancel",
          });
          mScope.on(cancelBtn, "click", finishImportFlow);
          return el(
            "div",
            {
              className: "modal-card is-error",
              role: "dialog",
              "aria-modal": "true",
              "aria-label": "Invalid share link",
            },
            [
              el("h2", {
                className: "modal-title",
                textContent: "Invalid Share Link",
              }),
              el("div", {
                className: "muted",
                textContent:
                  "This #import= link is malformed or corrupted and could not be imported.",
              }),
              el("div", { className: "modal-actions" }, [cancelBtn]),
            ]
          );
        }, finishImportFlow);
      });
  }

  /* ------------------------------------------------------------------
     Screen 2: Plan Overview (#plan)
  ------------------------------------------------------------------ */

  function getCardIntensityPercent(card) {
    if (card && typeof card.intensity_percent === "number") {
      return card.intensity_percent;
    }
    if (
      card &&
      card.routine &&
      typeof card.routine.intensity_percent === "number"
    ) {
      return card.routine.intensity_percent;
    }
    var lvl = (card && card.routine && Number(card.routine.intensity_level)) || 0;
    return 100 + Math.max(-5, lvl) * 10;
  }

  function renderPlanScreen() {
    if (!store.hasActivePlan()) {
      replaceHash("#setup");
      renderSetupScreen();
      return;
    }

    teardownActiveView();
    var scope = createViewScope();
    activeScope = scope;
    hasMountedScreen = true;

    document.title = "Plan";
    syncTopbar("plan", false);

    var state = store.getState();
    var routineCards = store.buildRoutineCards();
    var nextCard = store.getNextRoutineCard();
    var stats = store.getStats();

    var completedLog = lastCompletedLog;
    lastCompletedLog = null;

    var stageTag = el("span", {
      className: "pill pill-brand",
      id: "stage-tag",
      textContent: "Next",
    });

    var nextIntensityPct = nextCard ? getCardIntensityPercent(nextCard) : 100;
    var stageIntensityPill = el("span", {
      className: "pill",
      id: "stage-intensity",
      hidden: !nextCard || (nextCard.routine.intensity_level || 0) === 0,
      textContent: nextIntensityPct + "%",
    });

    var completedBanner = null;
    if (completedLog) {
      var deltaLabel = "Saved";
      if (completedLog.next_intensity_choice === "more") {
        deltaLabel = "+10%";
      } else if (completedLog.next_intensity_choice === "less") {
        deltaLabel = "\u221210%";
      }
      completedBanner = el("span", {
        className: "pill pill-brand",
        role: "status",
        textContent: "\u2713 " + deltaLabel,
      });
    }

    var initialKey = resolveCatalogSvgKey(
      catalog.svgs,
      nextCard ? nextCard.lead_svg_key : "squat:body_only",
      nextCard ? nextCard.lead_archetype : "squat"
    );

    var svgWrap = el("div", {
      id: "overview-svg-wrap",
      className: "stage-svg-wrap",
    });
    setTrustedSvg(svgWrap, resolveCatalogSvg(catalog.svgs, initialKey, "squat"));

    var stageTitleEl = el("h1", {
      className: "stage-title",
      id: "stage-routine-title",
      textContent: nextCard ? nextCard.routine.name : "",
    });

    var stageActionBtn = null;
    if (nextCard) {
      var hasExercises = nextCard.exercises && nextCard.exercises.length > 0;
      stageActionBtn = el("a", {
        id: "stage-start-btn",
        className: "btn-primary",
        href: hasExercises
          ? "#workout/" + encodeURIComponent(nextCard.routine.id)
          : "#edit/" + encodeURIComponent(nextCard.routine.id),
        textContent: hasExercises ? "\u25b6 Start" : "+ Add",
      });
    }

    var stageSection = el(
      "section",
      { className: "graphic-stage", "aria-label": "Next workout preview" },
      [
        el("div", { className: "stage-hud-top" }, [
          el(
            "div",
            {
              style: { display: "flex", alignItems: "center", gap: "0.45rem" },
            },
            [stageTag, stageIntensityPill]
          ),
          completedBanner,
        ]),
        svgWrap,
        nextCard
          ? el("div", { className: "stage-hud-bottom" }, [
              el("div", null, [
                el("div", {
                  className: "muted",
                  style: { marginBottom: "0.15rem" },
                  textContent: state.plan.name,
                }),
                stageTitleEl,
              ]),
              stageActionBtn,
            ])
          : null,
      ]
    );

    var weeklyGoal = Math.max(1, Number(stats.weekly_goal) || 3);
    var pct = Math.min(
      100,
      Math.round(((Number(stats.workouts_this_week) || 0) / weeklyGoal) * 100)
    );

    var addDayBtn = el("button", {
      type: "button",
      className: "btn-ghost",
      title: "Add day",
      textContent: "+ Day",
    });

    scope.on(addDayBtn, "click", function () {
      var created = store.addWorkoutDay();
      if (created && created.id) {
        navigateTo("#edit/" + encodeURIComponent(created.id));
      }
    });

    var weekStrip = el("div", { className: "week-strip" }, [
      el("span", { className: "pill", textContent: stats.message }),
      el("div", { className: "mini-bar", "aria-label": "Weekly goal" }, [
        el("div", {
          className: "mini-bar-fill",
          style: { width: pct + "%" },
        }),
      ]),
      addDayBtn,
    ]);

    var currentKey = initialKey;
    var rig = bindRig(svgWrap.querySelector("svg"));
    var phase = 0;
    var currentT = 0;
    var lastTs = null;
    var rafId = null;

    function swapStageSvg(keyOrArch, fallbackArch) {
      var resolved = resolveCatalogSvgKey(catalog.svgs, keyOrArch, fallbackArch);
      if (!resolved || resolved === currentKey) return;
      currentKey = resolved;
      setTrustedSvg(svgWrap, catalog.svgs[resolved]);
      rig = bindRig(svgWrap.querySelector("svg"));
      rig.applyPose(isReducedMotion() ? 0.85 : currentT);
    }

    var articleElements = [];

    var cardNodes = routineCards.map(function (card) {
      var isNext = Boolean(nextCard && card.routine.id === nextCard.routine.id);
      var cardPct = getCardIntensityPercent(card);
      var hasEx = Boolean(card.exercises && card.exercises.length > 0);
      var routineIdEnc = encodeURIComponent(card.routine.id);

      var exListNode;
      if (hasEx) {
        exListNode = el(
          "ul",
          { className: "ex-list" },
          card.exercises.map(function (row) {
            var thumbSrc =
              row.thumb_url ||
              row.svg_url ||
              (row.exercise && row.exercise.thumb_url) ||
              "./svgs/thumbs/squat__body_only.svg";
            var li = el(
              "li",
              {
                className: "ex-row",
                dataset: {
                  archetype: row.archetype,
                  svgKey: row.svg_key || row.archetype,
                },
              },
              [
                el("div", { className: "ex-row-left" }, [
                  el("img", {
                    src: thumbSrc,
                    alt: "",
                    className: "svg-thumb",
                  }),
                  el("span", {
                    className: "ex-row-name",
                    textContent: row.exercise.name,
                  }),
                ]),
                el("span", {
                  className: "ex-row-target",
                  textContent: row.scaled.formatted,
                }),
              ]
            );

            scope.on(li, "mouseenter", function () {
              swapStageSvg(row.svg_key || row.archetype, row.archetype);
            });
            scope.on(li, "click", function () {
              swapStageSvg(row.svg_key || row.archetype, row.archetype);
              stageTitleEl.textContent = card.routine.name;
              var lvl = card.routine.intensity_level || 0;
              if (lvl !== 0) {
                stageIntensityPill.textContent = cardPct + "%";
                stageIntensityPill.hidden = false;
              } else {
                stageIntensityPill.hidden = true;
              }
              if (stageActionBtn) {
                stageActionBtn.setAttribute(
                  "href",
                  hasEx
                    ? "#workout/" + routineIdEnc
                    : "#edit/" + routineIdEnc
                );
                stageActionBtn.textContent = hasEx ? "\u25b6 Start" : "+ Add";
              }
              articleElements.forEach(function (a) {
                a.classList.toggle("is-next", a === article);
              });
            });

            return li;
          })
        );
      } else {
        exListNode = el("a", {
          href: "#edit/" + routineIdEnc,
          className: "muted",
          textContent: "+ Add exercises",
        });
      }

      var article = el(
        "article",
        {
          className: "routine-card" + (isNext ? " is-next" : ""),
          dataset: {
            archetype: card.lead_archetype,
            svgKey: card.lead_svg_key || card.lead_archetype,
            routineName: card.routine.name,
            startUrl: "#workout/" + routineIdEnc,
            hasEx: hasEx ? "1" : "0",
          },
        },
        [
          el("div", { className: "routine-card-head" }, [
            el(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  minWidth: "0",
                },
              },
              [
                el("span", {
                  className: "routine-name",
                  textContent: card.routine.name,
                }),
                (card.routine.intensity_level || 0) !== 0
                  ? el("span", {
                      className: "pill",
                      textContent: cardPct + "%",
                    })
                  : null,
              ]
            ),
            el("div", { style: { display: "flex", gap: "0.35rem" } }, [
              el("a", {
                href: "#edit/" + routineIdEnc,
                className: "btn-ghost",
                style: { padding: "0.28rem 0.65rem" },
                "aria-label": "Edit",
                textContent: "\u270e",
              }),
              hasEx
                ? el("a", {
                    href: "#workout/" + routineIdEnc,
                    className: "btn-ghost",
                    style: { padding: "0.28rem 0.65rem" },
                    "aria-label": "Start",
                    textContent: "\u25b6",
                  })
                : null,
            ]),
          ]),
          exListNode,
        ]
      );

      articleElements.push(article);
      return article;
    });

    var sidePane = el(
      "section",
      { className: "side-pane" },
      [weekStrip].concat(cardNodes)
    );

    var mainEl = el("main", { className: "split-screen" }, [
      stageSection,
      sidePane,
    ]);

    document.getElementById("app-root").replaceChildren(mainEl);

    function activeTempoMode() {
      return rig && rig.tempoMode && rig.tempoMode !== "hold"
        ? rig.tempoMode
        : "standard";
    }

    function stopLoop() {
      if (rafId !== null) {
        scope.cancelFrame(rafId);
        rafId = null;
      }
      lastTs = null;
    }

    function tick(ts) {
      rafId = null;
      if (document.hidden || isReducedMotion()) {
        lastTs = null;
        return;
      }
      var dt = lastTs === null ? 0 : Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      phase = (phase + dt * 0.38) % 1;
      currentT = evalTempo(phase, activeTempoMode());
      rig.applyPose(currentT);
      rafId = scope.requestFrame(tick);
    }

    function ensureLoop() {
      if (document.hidden || isReducedMotion()) {
        stopLoop();
        if (isReducedMotion() && rig) {
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

    scope.on(document, "visibilitychange", function () {
      if (document.hidden) {
        stopLoop();
      } else {
        ensureLoop();
      }
    });

    var reducedQuery = root.matchMedia
      ? root.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    scope.onMediaChange(reducedQuery, ensureLoop);

    ensureLoop();
  }

  /* ------------------------------------------------------------------
     Screen 3: Routine Editor (#edit/<routineId>)
  ------------------------------------------------------------------ */

  function renderRoutineEditScreen(routineId) {
    if (!store.hasActivePlan()) {
      replaceHash("#setup");
      renderSetupScreen();
      return;
    }

    var routine = store.getRoutine(routineId);
    if (!routine) {
      replaceHash("#plan");
      renderPlanScreen();
      return;
    }

    teardownActiveView();
    var scope = createViewScope();
    activeScope = scope;
    hasMountedScreen = true;

    document.title = routine.name;
    syncTopbar("plan", false);

    var leftPane = el("section", { className: "editor-pane" });
    var searchInput = el("input", {
      type: "search",
      name: "q",
      className: "minimal-input",
      placeholder: "Search...",
      "aria-label": "Search exercises",
    });
    var searchResultsWrap = el("div", { id: "search-results" });
    var rightPane = el("section", { className: "editor-pane" }, [
      searchInput,
      searchResultsWrap,
    ]);

    var mainEl = el("main", { className: "editor-screen" }, [
      leftPane,
      rightPane,
    ]);
    document.getElementById("app-root").replaceChildren(mainEl);

    function refreshRoutineExercises() {
      var latestRoutine = store.getRoutine(routineId);
      if (!latestRoutine) return;
      var cards = store.buildRoutineCards([latestRoutine]);
      var rows = cards && cards[0] ? cards[0].exercises : [];
      var routineIdEnc = encodeURIComponent(latestRoutine.id);

      var headerRow = el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.6rem" } },
        [
          el("a", {
            href: "#plan",
            className: "btn-ghost",
            style: { padding: "0.35rem 0.75rem" },
            "aria-label": "Back",
            textContent: "\u2190",
          }),
          el("h1", {
            style: { fontSize: "1.15rem", fontWeight: "800", margin: "0" },
            textContent: latestRoutine.name,
          }),
          rows.length > 0
            ? el("a", {
                href: "#workout/" + routineIdEnc,
                className: "btn-primary",
                style: {
                  marginLeft: "auto",
                  padding: "0.4rem 0.95rem",
                  fontSize: "0.85rem",
                },
                textContent: "\u25b6",
              })
            : null,
        ]
      );

      var listContent;
      if (rows.length > 0) {
        listContent = el(
          "ul",
          { className: "ex-list" },
          rows.map(function (row) {
            var thumbSrc =
              row.thumb_url ||
              row.svg_url ||
              (row.exercise && row.exercise.thumb_url) ||
              "./svgs/thumbs/squat__body_only.svg";
            var removeBtn = el("button", {
              type: "button",
              className: "btn-ghost",
              style: { padding: "0.3rem 0.65rem" },
              "aria-label": "Remove",
              textContent: "\u2715",
            });
            scope.on(removeBtn, "click", function () {
              store.removeExerciseFromRoutine(latestRoutine.id, row.item.id);
              refreshRoutineExercises();
            });
            return el("li", { className: "catalog-card" }, [
              el("div", { className: "ex-row-left" }, [
                el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
                el("div", { style: { minWidth: "0" } }, [
                  el("div", {
                    className: "ex-row-name",
                    textContent: row.exercise.name,
                  }),
                  el("div", {
                    className: "ex-row-target",
                    textContent: row.scaled.formatted,
                  }),
                ]),
              ]),
              removeBtn,
            ]);
          })
        );
      } else {
        listContent = el("div", {
          className: "muted",
          textContent: "+ Select exercises",
        });
      }

      leftPane.replaceChildren(headerRow, listContent);
    }

    function refreshCatalogSearch() {
      var results = store.searchCatalog(searchInput.value, 16) || [];
      if (results.length === 0) {
        searchResultsWrap.replaceChildren(
          el("div", { className: "muted", textContent: "\u2014" })
        );
        return;
      }

      var grid = el(
        "div",
        { className: "catalog-grid" },
        results.map(function (rawItem) {
          var ex = rawItem && rawItem.exercise ? rawItem.exercise : rawItem;
          var thumbSrc =
            (rawItem && (rawItem.thumb_url || rawItem.svg_url)) ||
            (ex && (ex.thumb_url || ex.svg_url)) ||
            "./svgs/thumbs/squat__body_only.svg";
          var addBtn = el("button", {
            type: "button",
            className: "btn-ghost",
            style: { padding: "0.3rem 0.7rem" },
            "aria-label": "Add",
            textContent: "+",
          });
          scope.on(addBtn, "click", function () {
            store.addExerciseToRoutine(routineId, ex.id);
            refreshRoutineExercises();
          });
          return el("div", { className: "catalog-card" }, [
            el("div", { className: "ex-row-left" }, [
              el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
              el("div", { style: { minWidth: "0" } }, [
                el("div", { className: "ex-row-name", textContent: ex.name }),
                el("div", {
                  className: "muted",
                  style: { fontSize: "0.75rem", textTransform: "capitalize" },
                  textContent: ex.primary_muscle || "",
                }),
              ]),
            ]),
            addBtn,
          ]);
        })
      );

      searchResultsWrap.replaceChildren(grid);
    }

    scope.on(searchInput, "input", refreshCatalogSearch);
    scope.on(searchInput, "search", refreshCatalogSearch);

    refreshRoutineExercises();
    refreshCatalogSearch();
  }

  /* ------------------------------------------------------------------
     Screen 4: Full-Screen Active Workout (#workout/<routineId>)
  ------------------------------------------------------------------ */

  function renderWorkoutScreen(routineId) {
    if (!store.hasActivePlan()) {
      replaceHash("#setup");
      renderSetupScreen();
      return;
    }

    var routine = store.getRoutine(routineId);
    if (!routine) {
      replaceHash("#plan");
      renderPlanScreen();
      return;
    }

    teardownActiveView();
    var scope = createViewScope();
    activeScope = scope;
    hasMountedScreen = true;

    document.title = routine.name;
    syncTopbar("", true);

    var playlist = store.buildPlaylist(routine.id) || [];
    var appRoot = document.getElementById("app-root");

    if (playlist.length === 0) {
      var emptyMain = el(
        "main",
        {
          id: "workout-viewport",
          className: "workout-viewport",
          dataset: { state: "FINISHED" },
        },
        [
          el("div", { className: "finish-screen" }, [
            el("a", {
              href: "#plan",
              className: "hud-icon-btn",
              style: { position: "absolute", top: "1rem", left: "1.2rem" },
              "aria-label": "Exit",
              textContent: "\u2715",
            }),
            el("h1", {
              className: "stage-title",
              style: { marginBottom: "1.2rem" },
              textContent: routine.name,
            }),
            el("a", {
              href: "#edit/" + encodeURIComponent(routine.id),
              className: "btn-primary",
              textContent: "+ Exercises",
            }),
          ]),
        ]
      );
      appRoot.replaceChildren(emptyMain);
      return;
    }

    Sound.setTheme(store.getSoundTheme());

    var firstEx = playlist[0];

    var stepProgressEl = el("span", {
      id: "step-progress",
      className: "pill",
      textContent: "1/" + playlist.length + " \u00b7 S1/" + firstEx.sets,
    });
    var titleEl = el("h1", {
      id: "ex-title",
      className: "hud-ex-title",
      textContent: firstEx.name,
    });
    var howToEl = el("div", {
      id: "ex-how-to",
      className: "muted",
      style: {
        fontSize: "0.78rem",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      textContent: firstEx.how_to || "",
    });
    var weightEl = el("span", {
      id: "ex-weight",
      className: "pill pill-brand",
      style: { display: firstEx.weight_label ? "inline-flex" : "none" },
      textContent: firstEx.weight_label || "",
    });

    var soundSelect = el(
      "select",
      {
        id: "sound-theme-select",
        className: "hud-select",
        "aria-label": "Sound theme",
      },
      SOUND_THEME_OPTIONS.map(function (opt) {
        return el("option", { value: opt.id, textContent: opt.label });
      })
    );

    var iconVolOn = makeVolumeOnIcon();
    var iconVolOff = makeVolumeOffIcon();
    var soundBtn = el(
      "button",
      {
        type: "button",
        id: "sound-toggle",
        className: "hud-icon-btn",
        "aria-label": "Sound",
      },
      [iconVolOn, iconVolOff]
    );
    var fsBtn = el(
      "button",
      {
        type: "button",
        id: "fs-toggle",
        className: "hud-icon-btn",
        "aria-label": "Fullscreen",
      },
      [makeFullscreenIcon()]
    );
    var earlyBtn = el(
      "button",
      {
        type: "button",
        id: "early-finish-btn",
        className: "hud-icon-btn",
        "aria-label": "Finish",
      },
      [makeCheckIcon()]
    );

    var svgHolder = el("div", { id: "svg-holder" });
    setTrustedSvg(svgHolder, firstEx.svg_markup);
    var canvasTapArea = el(
      "div",
      { id: "canvas-tap-area", className: "workout-svg-canvas" },
      [svgHolder]
    );

    var phaseCueEl = el("div", {
      id: "phase-cue",
      className: "phase-cue-float",
      textContent: firstEx.cue_work,
    });

    var repReadoutEl = el("div", {
      id: "rep-readout",
      className: "rep-readout",
      textContent: "0/" + firstEx.reps + (firstEx.is_hold ? "s" : ""),
    });
    var skipBtn = el("button", {
      type: "button",
      id: "skip-btn",
      className: "hud-icon-btn",
      style: { display: "none" },
      "aria-label": "Skip",
      textContent: "\u23ed",
    });
    var primaryBtn = el("button", {
      type: "button",
      id: "primary-btn",
      className: "btn-primary",
      textContent: "\u25b6 Start",
    });
    var progressFillEl = el("div", {
      id: "set-progress-fill",
      className: "edge-progress-fill",
    });

    var stageEl = el("div", { id: "coach-stage" }, [
      el("header", { className: "workout-hud-top" }, [
        el("div", { className: "hud-title-cluster" }, [
          el("a", {
            href: "#plan",
            className: "hud-icon-btn",
            "aria-label": "Exit",
            textContent: "\u2715",
          }),
          stepProgressEl,
          el("div", { style: { minWidth: "0" } }, [titleEl, howToEl]),
          weightEl,
        ]),
        el("div", { className: "hud-actions" }, [
          soundSelect,
          soundBtn,
          fsBtn,
          earlyBtn,
        ]),
      ]),
      canvasTapArea,
      phaseCueEl,
      el("footer", { className: "workout-hud-bottom" }, [
        repReadoutEl,
        el("div", { className: "coach-controls" }, [skipBtn, primaryBtn]),
      ]),
      el("div", { className: "edge-progress" }, [progressFillEl]),
    ]);

    function makeFinishChoiceTile(choiceVal, deltaText, wordText, isMore) {
      var btn = el(
        "button",
        {
          type: "button",
          name: "next_intensity_choice",
          value: choiceVal,
          className: "finish-tile" + (isMore ? " finish-tile-more" : ""),
        },
        [
          el("span", { className: "finish-delta", textContent: deltaText }),
          el("span", { className: "finish-word", textContent: wordText }),
        ]
      );
      return btn;
    }

    var lessBtn = makeFinishChoiceTile("less", "\u221210%", "Easier", false);
    var keepBtn = makeFinishChoiceTile("keep", "=", "Same", false);
    var moreBtn = makeFinishChoiceTile("more", "+10%", "Harder", true);

    var finishScreenEl = el(
      "div",
      {
        id: "finish-form",
        className: "finish-screen",
        style: { display: "none" },
      },
      [
        el("div", { className: "finish-check", textContent: "\u2713" }),
        el("h2", { className: "stage-title", textContent: routine.name }),
        el("div", { className: "finish-grid" }, [lessBtn, keepBtn, moreBtn]),
      ]
    );

    var viewportEl = el(
      "main",
      {
        id: "workout-viewport",
        className: "workout-viewport",
        dataset: { state: "IDLE" },
      },
      [stageEl, finishScreenEl]
    );

    appRoot.replaceChildren(viewportEl);

    /* Workout Session State Machine */
    function syncSoundUi() {
      var theme = Sound.getTheme();
      soundSelect.value = theme;
      var muted = Sound.isMuted();
      iconVolOn.style.display = muted ? "none" : "block";
      iconVolOff.style.display = muted ? "block" : "none";
    }
    syncSoundUi();

    var state = "IDLE";
    var paused = false;
    var exIdx = 0;
    var setNum = 1;
    var phaseElapsed = 0;
    var idleElapsed = 0;
    var lastFrameTs = null;
    var rafId = null;
    var lastCountdownInt = null;
    var lastCompletedRep = 0;
    var midRepFiredForRep = -1;
    var lastDiscretePoseKey = null;
    var durationMinutes = 25;
    var sessionStartMs = Date.now();

    var durationInterval = scope.addInterval(function () {
      if (state === "FINISHED") {
        scope.clearTrackedInterval(durationInterval);
        return;
      }
      var mins = Math.floor((Date.now() - sessionStartMs) / 60000);
      if (mins >= 1) {
        durationMinutes = mins;
      }
    }, 10000);

    var rig = bindRig(svgHolder.querySelector("svg"));

    function currentEx() {
      return playlist[exIdx];
    }

    function formatReadout(done, ex) {
      return done + "/" + ex.reps + (ex.is_hold ? "s" : "");
    }

    function setCueText(text) {
      if (phaseCueEl.textContent !== text) {
        phaseCueEl.textContent = text;
      }
    }

    function applyNeutralBreath(phaseSec) {
      if (!rig) return;
      if (isReducedMotion()) {
        if (lastDiscretePoseKey !== "neutral") {
          lastDiscretePoseKey = "neutral";
          rig.applyPose(0);
        }
        return;
      }
      lastDiscretePoseKey = null;
      if (typeof rig.applyRestBreath === "function") {
        rig.applyRestBreath(phaseSec);
      } else {
        rig.applyPose(0);
      }
    }

    function shouldRunLoop() {
      if (paused || state === "FINISHED" || document.hidden) return false;
      if (state === "IDLE" && isReducedMotion()) return false;
      return true;
    }

    function stopLoop() {
      if (rafId !== null) {
        scope.cancelFrame(rafId);
        rafId = null;
      }
      lastFrameTs = null;
    }

    function ensureLoop() {
      if (!shouldRunLoop()) {
        stopLoop();
        return;
      }
      if (rafId === null) {
        lastFrameTs = null;
        rafId = scope.requestFrame(tick);
      }
    }

    function setState(nextState) {
      state = nextState;
      viewportEl.dataset.state = nextState;
    }

    function loadStagePreview() {
      var ex = currentEx();
      stepProgressEl.textContent =
        exIdx + 1 + "/" + playlist.length + " \u00b7 S" + setNum + "/" + ex.sets;
      titleEl.textContent = ex.name;
      howToEl.textContent = ex.how_to || "";
      if (ex.weight_label) {
        weightEl.textContent = ex.weight_label;
        weightEl.style.display = "inline-flex";
      } else {
        weightEl.style.display = "none";
      }
      setTrustedSvg(svgHolder, ex.svg_markup);
      rig = bindRig(svgHolder.querySelector("svg"));
      lastDiscretePoseKey = null;
      applyNeutralBreath(0);
    }

    function popCounter() {
      if (isReducedMotion()) return;
      repReadoutEl.classList.add("pop");
      scope.addTimeout(function () {
        repReadoutEl.classList.remove("pop");
      }, 140);
    }

    function beginCountdown() {
      var ex = currentEx();
      setState("COUNTDOWN");
      paused = false;
      phaseElapsed = 0;
      lastCountdownInt = 3;
      loadStagePreview();
      repReadoutEl.textContent = formatReadout(0, ex);
      progressFillEl.style.width = "0%";
      setCueText("3");
      Sound.resume();
      Sound.beginPhase("COUNTDOWN", {
        countdownSeconds: 3.0,
        repSeconds: ex.rep_seconds,
      });
      Sound.countdown(3);
      primaryBtn.textContent = "\u23f8";
      skipBtn.style.display = "inline-flex";
      ensureLoop();
    }

    function beginActiveSet() {
      var ex = currentEx();
      var mode = ex.tempo_mode || rig.tempoMode || "standard";
      setState("ACTIVE");
      paused = false;
      phaseElapsed = 0;
      lastCompletedRep = 0;
      midRepFiredForRep = -1;
      lastDiscretePoseKey = null;
      repReadoutEl.textContent = formatReadout(0, ex);
      progressFillEl.style.width = "0%";
      primaryBtn.textContent = "\u23f8";
      skipBtn.style.display = "inline-flex";
      Sound.beginPhase("ACTIVE", {
        repSeconds: ex.rep_seconds,
        reps: ex.reps,
        tempoMode: mode,
        turnaround: turnaroundFor(mode),
        isHold: Boolean(ex.is_hold),
      });
      Sound.startSignal();
      setCueText(ex.cue_work);
      if (isReducedMotion() && rig) {
        lastDiscretePoseKey = ex.is_hold ? "hold" : "0:1:0";
        rig.applyPose(1, { swapSides: false });
      }
      ensureLoop();
    }

    function completeEntireWorkout() {
      setState("FINISHED");
      stopLoop();
      scope.clearTrackedInterval(durationInterval);
      Sound.beginPhase("FINISHED", {});
      Sound.workoutComplete();
      stageEl.style.display = "none";
      finishScreenEl.style.display = "flex";
    }

    function finishCurrentSet() {
      var completedEx = currentEx();
      repReadoutEl.textContent = formatReadout(completedEx.reps, completedEx);
      progressFillEl.style.width = "100%";
      popCounter();

      if (setNum < completedEx.sets) {
        setNum += 1;
      } else if (exIdx + 1 < playlist.length) {
        exIdx += 1;
        setNum = 1;
      } else {
        completeEntireWorkout();
        return;
      }

      setState("REST");
      phaseElapsed = 0;
      lastCountdownInt = null;
      loadStagePreview();
      Sound.beginPhase("REST", { restSeconds: REST_SECONDS });
      Sound.stopSet();
      setCueText("Rest \u00b7 " + currentEx().name);
      primaryBtn.textContent = "\u23f8";
      ensureLoop();
    }

    function tick(ts) {
      rafId = null;
      if (!shouldRunLoop()) {
        lastFrameTs = null;
        return;
      }

      var dt =
        lastFrameTs === null ? 0 : Math.min(0.1, (ts - lastFrameTs) / 1000);
      lastFrameTs = ts;

      if (state === "IDLE") {
        idleElapsed += dt;
        applyNeutralBreath(idleElapsed);
      } else if (state === "COUNTDOWN") {
        phaseElapsed = Sound.advancePhase(dt);
        applyNeutralBreath(phaseElapsed);

        var rem = Math.ceil(3.0 - phaseElapsed);
        if (rem >= 1) {
          setCueText(String(rem));
          if (rem !== lastCountdownInt) {
            lastCountdownInt = rem;
            Sound.countdown(rem);
          }
        }
        if (phaseElapsed >= 3.0) {
          beginActiveSet();
        }
      } else if (state === "ACTIVE") {
        phaseElapsed = Sound.advancePhase(dt);
        var ex = currentEx();
        var totalSec = ex.reps * ex.rep_seconds;

        if (phaseElapsed >= totalSec) {
          finishCurrentSet();
        } else {
          var repFloat = phaseElapsed / ex.rep_seconds;
          var completed = Math.min(ex.reps, Math.floor(repFloat));
          var repIndex = Math.floor(repFloat);
          var frac = repFloat - repIndex;

          progressFillEl.style.width =
            Math.min(100, (phaseElapsed / totalSec) * 100).toFixed(1) + "%";

          if (ex.is_hold) {
            if (isReducedMotion()) {
              if (lastDiscretePoseKey !== "hold") {
                lastDiscretePoseKey = "hold";
                rig.applyPose(1);
              }
            } else {
              rig.applyHold(phaseElapsed);
            }
            setCueText(
              Math.floor(phaseElapsed / 2) % 2 === 0
                ? ex.cue_work
                : ex.cue_return
            );
          } else {
            var mode = ex.tempo_mode || rig.tempoMode || "standard";
            var turnaround = turnaroundFor(mode);
            var isWorkPhase = frac < turnaround;
            var poseOpts = {
              swapSides: Boolean(ex.is_alternating && repIndex % 2 === 1),
            };

            if (isReducedMotion()) {
              var discreteT = isWorkPhase ? 1 : 0;
              var poseKey =
                repIndex +
                ":" +
                discreteT +
                ":" +
                (poseOpts.swapSides ? "1" : "0");
              if (poseKey !== lastDiscretePoseKey) {
                lastDiscretePoseKey = poseKey;
                rig.applyPose(discreteT, poseOpts);
              }
            } else {
              var t = evalTempo(frac, mode);
              rig.applyPose(t, poseOpts);
            }

            setCueText(isWorkPhase ? ex.cue_work : ex.cue_return);

            if (
              !isWorkPhase &&
              midRepFiredForRep < repIndex &&
              repIndex < ex.reps
            ) {
              midRepFiredForRep = repIndex;
              Sound.midRep();
            }
          }

          if (completed > lastCompletedRep) {
            lastCompletedRep = completed;
            repReadoutEl.textContent = formatReadout(completed, ex);
            popCounter();
            if (completed < ex.reps) {
              if (ex.is_hold) {
                Sound.holdTick(ex.reps - completed);
              } else {
                Sound.repDone(completed, ex.reps);
              }
            }
          }
        }
      } else if (state === "REST") {
        phaseElapsed = Sound.advancePhase(dt);
        var restRem = Math.max(0, Math.ceil(REST_SECONDS - phaseElapsed));
        if (phaseElapsed >= 0.6) {
          var restReadout = restRem + "s";
          if (repReadoutEl.textContent !== restReadout) {
            repReadoutEl.textContent = restReadout;
          }
        }
        progressFillEl.style.width =
          Math.max(
            0,
            ((REST_SECONDS - phaseElapsed) / REST_SECONDS) * 100
          ).toFixed(1) + "%";
        setCueText(
          restRem <= 3 && restRem > 0
            ? String(restRem)
            : "Rest \u00b7 " + currentEx().name
        );
        applyNeutralBreath(phaseElapsed);

        if (restRem <= 3 && restRem >= 1 && restRem !== lastCountdownInt) {
          lastCountdownInt = restRem;
          Sound.countdown(restRem);
        }
        if (phaseElapsed >= REST_SECONDS) {
          beginActiveSet();
        }
      }

      if (shouldRunLoop() && rafId === null) {
        rafId = scope.requestFrame(tick);
      }
    }

    function togglePlayPause() {
      Sound.ensureAudio();
      if (state === "IDLE") {
        beginCountdown();
        return;
      }
      if (state === "FINISHED") return;
      paused = !paused;
      primaryBtn.textContent = paused ? "\u25b6" : "\u23f8";
      if (paused) {
        Sound.pause();
        stopLoop();
        setCueText("Paused");
      } else {
        Sound.resume();
        ensureLoop();
      }
    }

    function skipCurrentPhase() {
      Sound.ensureAudio();
      if (state === "IDLE" || state === "FINISHED") return;
      if (paused) {
        Sound.stopAll();
        paused = false;
        Sound.resume();
      }
      primaryBtn.textContent = "\u23f8";
      if (state === "REST" || state === "COUNTDOWN") {
        beginActiveSet();
      } else if (state === "ACTIVE") {
        finishCurrentSet();
      }
    }

    function submitWorkoutCompletion(choice) {
      var allIds = playlist.map(function (item) {
        return item.item_id;
      });
      lastCompletedLog = store.completeWorkout(routine.id, {
        next_intensity_choice: choice,
        duration_minutes: durationMinutes,
        completed_ids: allIds,
      });
      navigateTo("#plan");
    }

    scope.on(primaryBtn, "click", togglePlayPause);
    scope.on(canvasTapArea, "click", togglePlayPause);
    scope.on(skipBtn, "click", skipCurrentPhase);

    scope.on(soundSelect, "change", function () {
      var applied = Sound.setTheme(soundSelect.value);
      store.setSoundTheme(applied);
      Sound.ensureAudio();
      syncSoundUi();
      soundSelect.blur();
    });

    scope.on(soundSelect, "keydown", function (e) {
      if (e.code === "Space") {
        e.stopPropagation();
      }
    });

    scope.on(soundBtn, "click", function () {
      var nextTheme = Sound.toggleMute();
      store.setSoundTheme(nextTheme);
      Sound.ensureAudio();
      syncSoundUi();
    });

    scope.on(fsBtn, "click", function () {
      if (
        !document.fullscreenElement &&
        document.documentElement.requestFullscreen
      ) {
        document.documentElement.requestFullscreen().catch(function () {});
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
    });

    scope.on(earlyBtn, "click", function () {
      paused = true;
      setState("FINISHED");
      Sound.stopAll();
      Sound.beginPhase("FINISHED", {});
      stopLoop();
      scope.clearTrackedInterval(durationInterval);
      stageEl.style.display = "none";
      finishScreenEl.style.display = "flex";
    });

    [lessBtn, keepBtn, moreBtn].forEach(function (btn) {
      scope.on(btn, "click", function () {
        submitWorkoutCompletion(btn.value);
      });
    });

    scope.on(document, "visibilitychange", function () {
      if (document.hidden) {
        Sound.pause();
        stopLoop();
      } else {
        if (!paused && state !== "IDLE" && state !== "FINISHED") {
          Sound.resume();
        }
        ensureLoop();
      }
    });

    var reducedQuery = root.matchMedia
      ? root.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    scope.onMediaChange(reducedQuery, function () {
      lastDiscretePoseKey = null;
      if (state !== "ACTIVE" && state !== "FINISHED") {
        applyNeutralBreath(0);
      }
      ensureLoop();
    });

    scope.on(window, "keydown", function (e) {
      if (e.target && e.target.tagName === "SELECT") return;
      if (e.code === "Space" && state !== "FINISHED") {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === "ArrowRight") {
        skipCurrentPhase();
      }
    });

    applyNeutralBreath(0);
    ensureLoop();
  }

  /* ------------------------------------------------------------------
     Screen 5: Stats & Inline SVG Progression Chart (#progress)
  ------------------------------------------------------------------ */

  function renderProgressScreen() {
    if (!store.hasActivePlan()) {
      replaceHash("#setup");
      renderSetupScreen();
      return;
    }

    teardownActiveView();
    var scope = createViewScope();
    activeScope = scope;
    hasMountedScreen = true;

    document.title = "Stats";
    syncTopbar("progress", false);

    var stats = store.getStats();
    var logs = store.getLogsDesc() || [];
    var series = store.getProgressSeries() || { labels: [], values: [] };
    var hasLogs = logs.length > 0 && series.values && series.values.length > 0;

    var kpiStrip = el("section", { className: "kpi-strip" }, [
      el("div", { className: "kpi-cell" }, [
        el("span", {
          className: "kpi-num",
          textContent: String(stats.total_workouts || 0),
        }),
        el("span", { className: "kpi-label", textContent: "Done" }),
      ]),
      el("div", { className: "kpi-cell" }, [
        el("span", {
          className: "kpi-num",
          textContent: String(stats.week_streak || 0) + "w",
        }),
        el("span", { className: "kpi-label", textContent: "Streak" }),
      ]),
      el("div", { className: "kpi-cell" }, [
        el("span", {
          className: "kpi-num",
          textContent: String(stats.avg_plan_intensity || 100) + "%",
        }),
        el("span", { className: "kpi-label", textContent: "Load" }),
      ]),
    ]);

    var chartStage = el("div", { className: "chart-stage" });
    var emptySvgWrap = null;

    if (hasLogs) {
      var chartSvg = buildProgressChartSvg(series);
      if (chartSvg) {
        chartStage.appendChild(chartSvg);
      }
    } else {
      emptySvgWrap = el("div", {
        id: "empty-progress-svg",
        className: "stage-svg-wrap",
        style: { opacity: "0.72" },
      });
      setTrustedSvg(
        emptySvgWrap,
        resolveCatalogSvg(catalog.svgs, "squat:body_only", "squat")
      );
      chartStage.appendChild(emptySvgWrap);
      chartStage.appendChild(
        el(
          "div",
          {
            className: "stage-hud-bottom",
            style: { justifyContent: "center" },
          },
          [
            el("a", {
              href: "#plan",
              className: "btn-primary",
              textContent: "\u25b6 Start",
            }),
          ]
        )
      );
    }

    var logRail = null;
    if (logs.length > 0) {
      logRail = el(
        "aside",
        { className: "log-rail", "aria-label": "History" },
        logs.map(function (log) {
          var choice = log.next_intensity_choice;
          var badgeText = "=";
          if (choice === "more") badgeText = "+10%";
          else if (choice === "less") badgeText = "\u221210%";
          var dateStr = formatLogDate(log.completed_at);
          var pct =
            typeof log.intensity_percent === "number"
              ? log.intensity_percent
              : Math.max(50, 100 + (Number(log.intensity_at_session) || 0) * 10);

          return el("div", { className: "log-item" }, [
            el("div", { style: { minWidth: "0" } }, [
              el("div", {
                style: {
                  fontWeight: "700",
                  fontSize: "0.86rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
                textContent: log.routine_name,
              }),
              el("div", {
                className: "muted",
                style: { fontSize: "0.76rem" },
                textContent: (dateStr ? dateStr + " \u00b7 " : "") + pct + "%",
              }),
            ]),
            el("span", {
              className: "pill" + (choice === "more" ? " pill-brand" : ""),
              textContent: badgeText,
            }),
          ]);
        })
      );
    }

    var progressBody = el(
      "section",
      {
        className:
          "progress-body" + (logs.length === 0 ? " is-empty" : ""),
      },
      [chartStage, logRail]
    );

    var mainEl = el("main", { className: "progress-screen" }, [
      kpiStrip,
      progressBody,
    ]);
    document.getElementById("app-root").replaceChildren(mainEl);

    if (emptySvgWrap) {
      var emptySvg = emptySvgWrap.querySelector("svg");
      var rig = bindRig(emptySvg);
      var phase = 0;
      var lastTs = null;
      var rafId = null;

      function stopEmptyLoop() {
        if (rafId !== null) {
          scope.cancelFrame(rafId);
          rafId = null;
        }
        lastTs = null;
      }

      function frameEmpty(ts) {
        rafId = null;
        if (document.hidden || isReducedMotion()) {
          lastTs = null;
          return;
        }
        var dt = lastTs === null ? 0 : Math.min(0.1, (ts - lastTs) / 1000);
        lastTs = ts;
        phase = (phase + dt * 0.36) % 1;
        rig.applyPose(evalTempo(phase, "standard"));
        rafId = scope.requestFrame(frameEmpty);
      }

      function ensureEmptyLoop() {
        if (document.hidden || isReducedMotion()) {
          stopEmptyLoop();
          if (isReducedMotion()) {
            rig.applyPose(0.85);
          }
          return;
        }
        if (rafId === null) {
          lastTs = null;
          rafId = scope.requestFrame(frameEmpty);
        }
      }

      scope.on(document, "visibilitychange", function () {
        if (document.hidden) {
          stopEmptyLoop();
        } else {
          ensureEmptyLoop();
        }
      });

      var reducedQuery = root.matchMedia
        ? root.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
      scope.onMediaChange(reducedQuery, ensureEmptyLoop);

      ensureEmptyLoop();
    }
  }

  /* ------------------------------------------------------------------
     Hash Router & Boot
  ------------------------------------------------------------------ */

  function handleRoute() {
    if (!store || !catalog) return;

    var rawHash = window.location.hash || "";
    if (rawHash.indexOf("#import=") === 0) {
      handleIncomingShareImport(rawHash);
      return;
    }

    closeModal();

    var clean = rawHash.replace(/^#+/, "");
    if (!clean || clean === "/" || clean === "plan") {
      if (!store.hasActivePlan()) {
        replaceHash("#setup");
        renderSetupScreen();
      } else {
        renderPlanScreen();
      }
      return;
    }

    if (clean === "setup") {
      renderSetupScreen();
      return;
    }

    if (clean === "progress") {
      renderProgressScreen();
      return;
    }

    if (clean.indexOf("edit/") === 0) {
      var editId = decodeURIComponent(clean.slice(5));
      renderRoutineEditScreen(editId);
      return;
    }

    if (clean.indexOf("workout/") === 0) {
      var workoutId = decodeURIComponent(clean.slice(8));
      renderWorkoutScreen(workoutId);
      return;
    }

    if (store.hasActivePlan()) {
      replaceHash("#plan");
      renderPlanScreen();
    } else {
      replaceHash("#setup");
      renderSetupScreen();
    }
  }

  function loadCatalog() {
    if (root.__TRAINING_CATALOG__) {
      return Promise.resolve(root.__TRAINING_CATALOG__);
    }
    return fetch("./data/catalog.json").then(function (resp) {
      if (!resp.ok) {
        throw new Error("Failed to load catalog (" + resp.status + ")");
      }
      return resp.json();
    });
  }

  function boot() {
    registerServiceWorker();
    loadCatalog()
      .then(function (loadedCatalog) {
        catalog = loadedCatalog;
        if (
          !root.TrainingStore ||
          typeof root.TrainingStore.createStore !== "function"
        ) {
          throw new Error("TrainingStore missing");
        }
        store = root.TrainingStore.createStore({ catalog: catalog });
        Sound.setTheme(store.getSoundTheme());
        window.addEventListener("hashchange", handleRoute);
        handleRoute();
      })
      .catch(function (err) {
        var appRoot = document.getElementById("app-root");
        if (appRoot) {
          appRoot.replaceChildren(
            el("main", { className: "boot-screen" }, [
              el("div", {
                className: "muted",
                textContent:
                  "Unable to load trainer catalog: " +
                  (err && err.message ? err.message : "offline"),
              }),
            ])
          );
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
