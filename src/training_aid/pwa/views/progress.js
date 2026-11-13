/* Screen 5: Stats & Inline SVG Progression Chart (#progress) */
(function () {
  "use strict";

  const root =
    typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const getDom = () => root.TrainingDom || (typeof require === "function" ? require("../dom.js") : null);

  function buildProgressChartSvg(series) {
    const { svgNode } = getDom();
    const labels = (series && Array.isArray(series.labels) && series.labels) || [];
    const values = (series && Array.isArray(series.values) && series.values) || [];
    const n = Math.min(labels.length, values.length);
    if (n === 0) return null;

    const width = 760, height = 400, padL = 56, padR = 26, padT = 24, padB = 42;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let rawMin = 85, rawMax = 115;
    for (let i = 0; i < n; i++) {
      const val = Number(values[i]) || 100;
      if (val < rawMin) rawMin = val;
      if (val > rawMax) rawMax = val;
    }
    const minVal = Math.floor((rawMin - 10) / 10) * 10;
    const maxVal = Math.max(minVal + 20, Math.ceil((rawMax + 10) / 10) * 10);
    const ySpan = maxVal - minVal;
    const yStep = ySpan > 80 ? 20 : 10;

    const xAt = (idx) => (n === 1 ? padL + plotW * 0.5 : padL + (idx / (n - 1)) * plotW);
    const yAt = (v) => padT + plotH - ((v - minVal) / ySpan) * plotH;

    const svg = svgNode("svg", {
      class: "progress-svg-chart",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Workout intensity progression chart",
    });

    svg.appendChild(
      svgNode("defs", null, [
        svgNode("linearGradient", { id: "intensityAreaGrad", x1: "0", y1: "0", x2: "0", y2: "1" }, [
          svgNode("stop", { offset: "0%", "stop-color": "#34d399", "stop-opacity": "0.34" }),
          svgNode("stop", { offset: "100%", "stop-color": "#10b981", "stop-opacity": "0.0" }),
        ]),
      ])
    );

    const gridGroup = svgNode("g", { class: "chart-grid" });
    for (let tick = minVal; tick <= maxVal; tick += yStep) {
      const ty = yAt(tick);
      gridGroup.appendChild(
        svgNode("line", {
          x1: padL.toFixed(1), y1: ty.toFixed(1),
          x2: (padL + plotW).toFixed(1), y2: ty.toFixed(1),
          stroke: "rgba(148, 163, 184, 0.1)", "stroke-width": "1",
        })
      );
      gridGroup.appendChild(
        svgNode("text", {
          x: (padL - 10).toFixed(1), y: (ty + 4).toFixed(1),
          fill: "#94a3b8", "font-size": "12", "font-weight": "600",
          "text-anchor": "end", textContent: `${tick}%`,
        })
      );
    }

    const xStride = n > 14 ? Math.ceil(n / 12) : 1;
    const pts = [];
    for (let p = 0; p < n; p++) {
      const px = xAt(p);
      const py = yAt(Number(values[p]) || 100);
      pts.push([px, py]);
      if (p % xStride === 0 || p === n - 1) {
        gridGroup.appendChild(
          svgNode("line", {
            x1: px.toFixed(1), y1: padT.toFixed(1),
            x2: px.toFixed(1), y2: (padT + plotH).toFixed(1),
            stroke: "rgba(148, 163, 184, 0.06)", "stroke-width": "1",
          })
        );
        gridGroup.appendChild(
          svgNode("text", {
            x: px.toFixed(1), y: (padT + plotH + 24).toFixed(1),
            fill: "#94a3b8", "font-size": "12", "font-weight": "600",
            "text-anchor": "middle", textContent: String(labels[p]),
          })
        );
      }
    }
    svg.appendChild(gridGroup);

    if (pts.length > 1) {
      const polyPoints = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      const baselineY = (padT + plotH).toFixed(2);
      const areaPoints = `${polyPoints} ${pts[pts.length - 1][0].toFixed(2)},${baselineY} ${pts[0][0].toFixed(2)},${baselineY}`;
      svg.appendChild(svgNode("polygon", { points: areaPoints, fill: "url(#intensityAreaGrad)" }));
      svg.appendChild(
        svgNode("polyline", {
          points: polyPoints, fill: "none", stroke: "#34d399",
          "stroke-width": "3.5", "stroke-linecap": "round", "stroke-linejoin": "round",
        })
      );
    }

    const pointsGroup = svgNode("g", { class: "chart-points" });
    for (let k = 0; k < pts.length; k++) {
      pointsGroup.appendChild(
        svgNode(
          "circle",
          {
            cx: pts[k][0].toFixed(2), cy: pts[k][1].toFixed(2), r: "6",
            fill: "#34d399", stroke: "#090d16", "stroke-width": "2.2",
          },
          [svgNode("title", { textContent: `${labels[k]}: ${values[k]}%` })]
        )
      );
    }
    svg.appendChild(pointsGroup);
    return svg;
  }

  function renderProgressView(ctx) {
    const dom = getDom();
    const { el, setTrustedSvg, resolveSvgMarkup, bindPreviewLoop, formatLogDate } = dom;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const { store, catalog } = ctx;
    const syncTopbar = ctx.syncTopbar || (() => {});

    document.title = "Stats";
    syncTopbar("progress", false);

    const stats = store.getStats();
    const logs = store.getLogsDesc() || [];
    const series = store.getProgressSeries() || { labels: [], values: [] };
    const hasLogs = logs.length > 0 && series.values && series.values.length > 0;

    const kpiStrip = el("section", { className: "kpi-strip" }, [
      el("div", { className: "kpi-cell" }, [
        el("span", { className: "kpi-num", textContent: String(stats.total_workouts || 0) }),
        el("span", { className: "kpi-label", textContent: "Done" }),
      ]),
      el("div", { className: "kpi-cell" }, [
        el("span", { className: "kpi-num", textContent: `${stats.week_streak || 0}w` }),
        el("span", { className: "kpi-label", textContent: "Streak" }),
      ]),
      el("div", { className: "kpi-cell" }, [
        el("span", { className: "kpi-num", textContent: `${stats.avg_plan_intensity || 100}%` }),
        el("span", { className: "kpi-label", textContent: "Load" }),
      ]),
    ]);

    const chartStage = el("div", { className: "chart-stage" });
    let emptySvgWrap = null;

    if (hasLogs) {
      const chartSvg = buildProgressChartSvg(series);
      if (chartSvg) chartStage.appendChild(chartSvg);
    } else {
      emptySvgWrap = el("div", {
        id: "empty-progress-svg", className: "stage-svg-wrap", style: { opacity: "0.72" },
      });
      setTrustedSvg(emptySvgWrap, resolveSvgMarkup(catalog, "squat", "body_only"));
      chartStage.appendChild(emptySvgWrap);
      chartStage.appendChild(
        el("div", { className: "stage-hud-bottom", style: { justifyContent: "center" } }, [
          el("a", { href: "#plan", className: "btn-primary", textContent: "\u25b6 Start" }),
        ])
      );
    }

    const logRail = logs.length > 0
      ? el(
          "aside",
          { className: "log-rail", "aria-label": "History" },
          logs.map((log) => {
            const choice = log.next_intensity_choice;
            const badgeText = choice === "more" ? "+10%" : choice === "less" ? "\u221210%" : "=";
            const dateStr = formatLogDate(log.completed_at);
            const pct = typeof log.intensity_percent === "number"
              ? log.intensity_percent
              : Math.max(50, 100 + (Number(log.intensity_at_session) || 0) * 10);

            return el("div", { className: "log-item" }, [
              el("div", { style: { minWidth: "0" } }, [
                el("div", {
                  style: { fontWeight: "700", fontSize: "0.86rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
                  textContent: log.routine_name,
                }),
                el("div", { className: "muted", style: { fontSize: "0.76rem" }, textContent: `${dateStr ? `${dateStr} \u00b7 ` : ""}${pct}%` }),
              ]),
              el("span", { className: "pill" + (choice === "more" ? " pill-brand" : ""), textContent: badgeText }),
            ]);
          })
        )
      : null;

    const progressBody = el(
      "section",
      { className: "progress-body" + (logs.length === 0 ? " is-empty" : "") },
      [chartStage, logRail]
    );

    document.getElementById("app-root").replaceChildren(
      el("main", { className: "progress-screen" }, [kpiStrip, progressBody])
    );

    if (emptySvgWrap) {
      bindPreviewLoop(scope, emptySvgWrap, { speed: 0.36, tempoMode: "standard" });
    }

    return scope;
  }

  renderProgressView.render = renderProgressView;
  renderProgressView.buildProgressChartSvg = buildProgressChartSvg;
  root.TrainingViews = root.TrainingViews || {};
  root.TrainingViews.progress = renderProgressView;
  if (typeof module !== "undefined" && module.exports) module.exports = renderProgressView;
})();
