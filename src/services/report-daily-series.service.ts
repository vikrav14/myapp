import { env } from "../lib/env.js";
import type { WeeklyDailySeries, WeeklyDiagnosticSummary, WeeklyWeekOverWeek } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(isoTimestamp: string, timezone: string = env.MORNING_BRIEF_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(isoTimestamp));
}

export function buildReportDayKeys(
  weekStart: string,
  timezone: string = env.MORNING_BRIEF_TIMEZONE
): string[] {
  const keys: string[] = [];
  let cursor = new Date(weekStart);

  for (let index = 0; index < 7; index += 1) {
    keys.push(localDateKey(cursor.toISOString(), timezone));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return keys;
}

export function buildReportDayLabels(
  weekStart: string,
  timezone: string = env.MORNING_BRIEF_TIMEZONE
): string[] {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short"
  });
  let cursor = new Date(weekStart);

  return Array.from({ length: 7 }, () => {
    const label = formatter.format(cursor);
    cursor = new Date(cursor.getTime() + DAY_MS);
    return label;
  });
}

function dayIndexForTimestamp(
  timestamp: string,
  dayKeys: string[],
  timezone: string = env.MORNING_BRIEF_TIMEZONE
): number | null {
  const key = localDateKey(timestamp, timezone);
  const index = dayKeys.indexOf(key);
  return index >= 0 ? index : null;
}

function initNullableSeries(length: number): Array<number | null> {
  return Array.from({ length }, () => null);
}

export function buildSpendDailySeries(input: {
  weekStart: string;
  rows: Array<{ amount?: number | null; logged_at?: string | null }>;
  timezone?: string;
}): Array<number | null> {
  const timezone = input.timezone ?? env.MORNING_BRIEF_TIMEZONE;
  const dayKeys = buildReportDayKeys(input.weekStart, timezone);
  const totals = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);

  for (const row of input.rows) {
    if (!row.logged_at) {
      continue;
    }

    const index = dayIndexForTimestamp(row.logged_at, dayKeys, timezone);
    if (index === null) {
      continue;
    }

    totals[index] = (totals[index] ?? 0) + Number(row.amount ?? 0);
    counts[index] = (counts[index] ?? 0) + 1;
  }

  return totals.map((total, index) => ((counts[index] ?? 0) > 0 ? Math.round(total) : null));
}

export function buildHabitWinsDailySeries(input: {
  weekStart: string;
  rows: Array<{ is_success?: boolean | null; logged_at?: string | null }>;
  timezone?: string;
}): Array<number | null> {
  const timezone = input.timezone ?? env.MORNING_BRIEF_TIMEZONE;
  const dayKeys = buildReportDayKeys(input.weekStart, timezone);
  const wins = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);

  for (const row of input.rows) {
    if (!row.logged_at) {
      continue;
    }

    const index = dayIndexForTimestamp(row.logged_at, dayKeys, timezone);
    if (index === null) {
      continue;
    }

    counts[index] = (counts[index] ?? 0) + 1;
    if (row.is_success) {
      wins[index] = (wins[index] ?? 0) + 1;
    }
  }

  return wins.map((value, index) => ((counts[index] ?? 0) > 0 ? value : null));
}

export function buildMoodDailySeries(input: {
  weekStart: string;
  rows: Array<{ anxiety_score?: number | null; logged_at?: string | null }>;
  timezone?: string;
}): Array<number | null> {
  const timezone = input.timezone ?? env.MORNING_BRIEF_TIMEZONE;
  const dayKeys = buildReportDayKeys(input.weekStart, timezone);
  const totals = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);

  for (const row of input.rows) {
    if (!row.logged_at || row.anxiety_score === null || row.anxiety_score === undefined) {
      continue;
    }

    const index = dayIndexForTimestamp(row.logged_at, dayKeys, timezone);
    if (index === null) {
      continue;
    }

    totals[index] = (totals[index] ?? 0) + Number(row.anxiety_score);
    counts[index] = (counts[index] ?? 0) + 1;
  }

  return totals.map((total, index) => {
    const count = counts[index] ?? 0;
    return count > 0 ? Math.round((total / count) * 10) / 10 : null;
  });
}

export function buildWeeklyDailySeries(input: {
  weekStart: string;
  financeRows: Array<{ amount?: number | null; logged_at?: string | null }>;
  habitRows: Array<{ is_success?: boolean | null; logged_at?: string | null }>;
  emotionRows: Array<{ anxiety_score?: number | null; logged_at?: string | null }>;
  timezone?: string;
}): WeeklyDailySeries {
  const timezone = input.timezone ?? env.MORNING_BRIEF_TIMEZONE;

  return {
    labels: buildReportDayLabels(input.weekStart, timezone),
    spend_rs: buildSpendDailySeries({
      weekStart: input.weekStart,
      rows: input.financeRows,
      timezone
    }),
    habit_wins: buildHabitWinsDailySeries({
      weekStart: input.weekStart,
      rows: input.habitRows,
      timezone
    }),
    mood_avg: buildMoodDailySeries({
      weekStart: input.weekStart,
      rows: input.emotionRows,
      timezone
    })
  };
}

function countSeriesSignal(values: Array<number | null>): number {
  return values.filter((value) => value !== null).length;
}

export function hasWeeklyReportCharts(summary: WeeklyDiagnosticSummary): boolean {
  const daily = summary.daily;
  if (!daily) {
    return false;
  }

  return countSeriesSignal(daily.spend_rs) >= 2 || countSeriesSignal(daily.habit_wins) >= 2;
}

export function buildWeekOverWeekComparison(input: {
  current: WeeklyDiagnosticSummary;
  prior: WeeklyDiagnosticSummary | null | undefined;
}): WeeklyWeekOverWeek {
  const prior = input.prior;
  const momentumDelta =
    prior && typeof prior.momentum_score === "number"
      ? input.current.momentum_score - prior.momentum_score
      : null;

  if (!prior) {
    return {
      prior_week_start: null,
      spend_delta_pct: null,
      habit_wins_delta: null,
      momentum_delta: momentumDelta
    };
  }

  const priorSpend = prior.finance.total_spent;
  const currentSpend = input.current.finance.total_spent;
  const spendDeltaPct =
    prior.finance.entry_count > 0 && priorSpend > 0
      ? Math.round(((currentSpend - priorSpend) / priorSpend) * 100)
      : null;

  const habitWinsDelta =
    prior.habits.total_logs > 0 || input.current.habits.total_logs > 0
      ? input.current.habits.successful_logs - prior.habits.successful_logs
      : null;

  return {
    prior_week_start: prior.window.week_start,
    spend_delta_pct: spendDeltaPct,
    habit_wins_delta: habitWinsDelta,
    momentum_delta: momentumDelta
  };
}

export function formatWeekOverWeekLine(
  label: string,
  delta: number | null,
  unit: "pct" | "count" | "momentum"
): string | null {
  if (delta === null) {
    return null;
  }

  if (delta === 0) {
    return `${label}: flat vs last week`;
  }

  if (unit === "pct") {
    const direction = delta > 0 ? "up" : "down";
    return `${label}: ${direction} ${Math.abs(delta)}% vs last week`;
  }

  const direction = delta > 0 ? "up" : "down";
  const suffix = unit === "momentum" ? " pts" : "";
  return `${label}: ${direction} ${Math.abs(delta)}${suffix} vs last week`;
}
