import { DAY_MS } from "./constants.js";
import { stepToIntensityPercent } from "./prescription.js";

export function parseUtcDate(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : new Date(input.getTime());
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === "string") {
    let s = input.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
      s = `${s.replace(" ", "T")}Z`;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function localDateKey(input) {
  const d = input ? parseUtcDate(input) : new Date();
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoYearWeekUtc(utcMidnightMs) {
  const d = new Date(utcMidnightMs);
  const isoDow = d.getUTCDay() || 7;
  const thursdayMs = utcMidnightMs + (4 - isoDow) * DAY_MS;
  const isoYear = new Date(thursdayMs).getUTCFullYear();
  const dayOfYear = Math.round((thursdayMs - Date.UTC(isoYear, 0, 1)) / DAY_MS);
  const isoWeek = Math.floor(dayOfYear / 7) + 1;
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

export function computeWeekStreak(logs, nowDate) {
  if (!Array.isArray(logs) || logs.length === 0) return 0;
  const ref = parseUtcDate(nowDate) || new Date();
  const activeWeeks = new Set();

  for (const entry of logs) {
    const dt = entry ? parseUtcDate(entry.completed_at) : null;
    if (dt) {
      activeWeeks.add(isoYearWeekUtc(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())));
    }
  }
  if (activeWeeks.size === 0) return 0;

  let cursorMs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  if (!activeWeeks.has(isoYearWeekUtc(cursorMs))) {
    const prevMs = cursorMs - 7 * DAY_MS;
    if (!activeWeeks.has(isoYearWeekUtc(prevMs))) return 0;
    cursorMs = prevMs;
  }

  let streak = 0;
  while (activeWeeks.has(isoYearWeekUtc(cursorMs))) {
    streak += 1;
    cursorMs -= 7 * DAY_MS;
  }
  return streak;
}

export function sortLogsDesc(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  return logs
    .map((log, idx) => ({ log, idx, ts: Date.parse(log.completed_at) || 0 }))
    .sort((a, b) => (b.ts !== a.ts ? b.ts - a.ts : a.idx - b.idx))
    .map(({ log }) => Object.assign(structuredClone(log), {
      intensity_percent: stepToIntensityPercent(log.intensity_at_session),
    }));
}

export function computePlanStats(state, logsDesc, nowDate) {
  const now = parseUtcDate(nowDate) || new Date();
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const startOfWeekMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - mondayOffset * DAY_MS;
  let workoutsThisWeek = 0;

  for (const lg of logsDesc) {
    const dt = parseUtcDate(lg.completed_at);
    if (dt && dt.getTime() >= startOfWeekMs) workoutsThisWeek += 1;
  }

  const routines = Array.isArray(state?.plan?.routines) ? state.plan.routines : [];
  let avgPlanIntensity = 100;
  if (routines.length > 0) {
    const sumPct = routines.reduce((acc, rt) => acc + stepToIntensityPercent(rt.intensity_level), 0);
    avgPlanIntensity = Math.round(sumPct / routines.length);
  } else if (logsDesc.length > 0) {
    avgPlanIntensity = logsDesc[0].intensity_percent;
  }

  const weeklyGoal = Math.max(1, Math.trunc(Number(state?.profile?.weekly_goal) || 3));
  const totalWorkouts = logsDesc.length;
  const suffix = totalWorkouts > 0 && workoutsThisWeek >= weeklyGoal ? " \u2713" : "";

  return {
    workouts_this_week: workoutsThisWeek,
    weekly_goal: weeklyGoal,
    total_workouts: totalWorkouts,
    week_streak: computeWeekStreak(logsDesc, now),
    avg_plan_intensity: avgPlanIntensity,
    message: `${workoutsThisWeek}/${weeklyGoal} this week${suffix}`,
  };
}

export function buildProgressSeries(logsDesc) {
  if (!Array.isArray(logsDesc) || logsDesc.length === 0) return { labels: [], values: [] };
  const chrono = logsDesc.slice().reverse();
  return {
    labels: ["0", ...chrono.map((_, i) => `#${i + 1}`)],
    values: [100, ...chrono.map((lg) => lg.intensity_percent)],
  };
}
