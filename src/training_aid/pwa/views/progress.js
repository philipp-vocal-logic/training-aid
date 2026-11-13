/* Screen 5: Stats, Weekly Adherence, Inline SVG Chart & Completed Exercise History (#progress) */
import { formatWeight, stepToIntensityPercent } from "../core/prescription.js";
import { el, formatLogDateTime } from "../ui/dom.js";
import { buildProgressChartSvg } from "../ui/progress-chart.js";
import { createViewScope } from "../ui/scope.js";

function setDetailsOpen(detailsEl, isOpen) {
  const open = Boolean(isOpen);
  detailsEl.open = open;
  if (open) detailsEl.setAttribute("open", "");
  else detailsEl.removeAttribute("open");
  return detailsEl;
}

function formatLoggedExerciseLine(ex) {
  const unit = ex.unit === "sec" ? "s" : "";
  const base = `${ex.sets}\u00d7${ex.reps}${unit}`;
  return ex.weight_kg ? `${ex.name} (${base} @ ${formatWeight(ex.weight_kg)})` : `${ex.name} (${base})`;
}

export function renderProgressView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store } = ctx;
  const syncTopbar = ctx.syncTopbar || (() => {});

  document.title = "Stats";
  syncTopbar("progress", false);

  const stats = store.getStats();
  const logs = store.getLogsDesc() || [];
  const series = store.getProgressSeries() || { labels: [], values: [] };
  const hasLogs = logs.length > 0 && series.values && series.values.length > 0;

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
    ]),
  ]);

  const chartStage = el("div", { className: "chart-stage" });

  if (hasLogs) {
    const chartSvg = buildProgressChartSvg(series);
    if (chartSvg) chartStage.appendChild(chartSvg);
  } else {
    chartStage.appendChild(
      el("div", { className: "empty-state-card" }, [
        el("div", {
          className: "muted",
          textContent: "Complete a workout to unlock your progression chart.",
        }),
        el("a", {
          href: "#plan",
          className: "btn-primary",
          textContent: "\u25b6 Start Workout",
        }),
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

            return setDetailsOpen(
              el("details", { className: "log-item log-item-detailed log-details" }, [
                el("summary", { className: "log-item-head disclosure-summary" }, [
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
                      exItems.map((ex) =>
                        el("li", { className: "log-ex-row", textContent: formatLoggedExerciseLine(ex) })
                      )
                    )
                  : null,
              ]),
              false
            );
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

  return scope;
}
