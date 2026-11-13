/* Screen 5: Stats, Weekly Adherence, Inline SVG Chart & Completed Exercise History (#progress) */
import { formatWeight, stepToIntensityPercent } from "../core/prescription.js";
import { el, formatLogDateTime, resolveSvgMarkup, setTrustedSvg } from "../ui/dom.js";
import { bindPreviewLoop } from "../ui/preview-loop.js";
import { buildProgressChartSvg } from "../ui/progress-chart.js";
import { createViewScope } from "../ui/scope.js";
import { triggerStateExportDownload } from "./setup.js";

function formatLoggedExerciseLine(ex) {
  const unit = ex.unit === "sec" ? "s" : "";
  const base = `${ex.sets}\u00d7${ex.reps}${unit}`;
  return ex.weight_kg ? `${ex.name} (${base} @ ${formatWeight(ex.weight_kg)})` : `${ex.name} (${base})`;
}

export function renderProgressView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store, catalog } = ctx;
  const syncTopbar = ctx.syncTopbar || (() => {});

  document.title = "Stats";
  syncTopbar("progress", false);

  const stats = store.getStats();
  const logs = store.getLogsDesc() || [];
  const series = store.getProgressSeries() || { labels: [], values: [] };
  const hasLogs = logs.length > 0 && series.values && series.values.length > 0;
  const hasPlan = Boolean(store && typeof store.hasActivePlan === "function" && store.hasActivePlan());

  const exportBtn = hasPlan
    ? el("button", {
        type: "button",
        id: "progress-export-btn",
        className: "btn-ghost btn-xs",
        textContent: "Export JSON",
      })
    : null;
  if (exportBtn) {
    scope.on(exportBtn, "click", () => {
      triggerStateExportDownload(store);
    });
  }

  const kpiStrip = el("section", { className: "kpi-strip" }, [
    el("div", { className: "kpi-cell" }, [
      el("span", { className: "kpi-num", textContent: `${stats.workouts_this_week || 0}/${stats.weekly_goal || 3}` }),
      el("span", { className: "kpi-label", textContent: "This Week" }),
    ]),
    el("div", { className: "kpi-cell" }, [
      el("span", { className: "kpi-num", textContent: String(stats.total_workouts || 0) }),
      el("span", { className: "kpi-label", textContent: "Completed" }),
    ]),
    el("div", { className: "kpi-cell" }, [
      el("span", { className: "kpi-num", textContent: `${stats.week_streak || 0}w` }),
      el("span", { className: "kpi-label", textContent: "Streak" }),
    ]),
    el("div", { className: "kpi-cell" }, [
      el("span", { className: "kpi-num", textContent: `${stats.avg_plan_intensity || 100}%` }),
      el("span", { className: "kpi-label", textContent: "Plan Load" }),
      exportBtn,
    ]),
  ]);

  const chartStage = el("div", { className: "chart-stage" });
  let emptySvgWrap = null;

  if (hasLogs) {
    const chartSvg = buildProgressChartSvg(series);
    if (chartSvg) chartStage.appendChild(chartSvg);
  } else {
    emptySvgWrap = el("div", {
      id: "empty-progress-svg",
      className: "stage-svg-wrap",
      style: { opacity: "0.72" },
    });
    setTrustedSvg(emptySvgWrap, resolveSvgMarkup(catalog, "squat", "body_only"));
    chartStage.appendChild(emptySvgWrap);
    chartStage.appendChild(
      el("div", { className: "stage-hud-bottom", style: { justifyContent: "center" } }, [
        el("a", { href: "#plan", className: "btn-primary", textContent: "\u25b6 Start" }),
      ])
    );
  }

  const logRail =
    logs.length > 0
      ? el(
          "aside",
          { className: "log-rail", "aria-label": "Completed workout history" },
          logs.map((log) => {
            const choice = log.next_intensity_choice;
            const badgeText = log.is_adhoc
              ? "Quick"
              : log.was_substituted
                ? "Adapted"
                : choice === "more"
                  ? "+10%"
                  : choice === "less"
                    ? "\u221210%"
                    : "=";
            const dateTimeStr = formatLogDateTime(log.completed_at);
            const pct =
              typeof log.intensity_percent === "number"
                ? log.intensity_percent
                : stepToIntensityPercent(log.intensity_at_session);
            const exItems = Array.isArray(log.exercises) ? log.exercises : [];

            return el("div", { className: "log-item log-item-detailed" }, [
              el("div", { className: "log-item-head" }, [
                el("div", { className: "min-w-0" }, [
                  el("div", { className: "ex-row-name", textContent: log.routine_name }),
                  el("div", {
                    className: "muted text-xs",
                    textContent: `${dateTimeStr ? `${dateTimeStr} \u00b7 ` : ""}${log.duration_minutes || 25}m \u00b7 ${pct}%`,
                  }),
                ]),
                el("span", {
                  className: "pill" + (choice === "more" ? " pill-brand" : ""),
                  textContent: badgeText,
                }),
              ]),
              exItems.length > 0
                ? el(
                    "ul",
                    { className: "log-ex-list" },
                    exItems.map((ex) => el("li", { className: "log-ex-row", textContent: formatLoggedExerciseLine(ex) }))
                  )
                : null,
            ]);
          })
        )
      : null;

  const progressBody = el(
    "section",
    { className: "progress-body" + (logs.length === 0 ? " is-empty" : "") },
    [chartStage, logRail]
  );

  document
    .getElementById("app-root")
    .replaceChildren(el("main", { className: "progress-screen" }, [kpiStrip, progressBody]));

  if (emptySvgWrap) {
    bindPreviewLoop(scope, emptySvgWrap, { speed: 0.36, tempoMode: "standard" });
  }

  return scope;
}
