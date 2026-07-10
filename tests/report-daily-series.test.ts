import { describe, expect, it } from "vitest";

import {
  buildSpendDailySeries,
  buildWeeklyDailySeries,
  buildWeekOverWeekComparison,
  hasWeeklyReportCharts
} from "../src/services/report-daily-series.service.js";
import type { WeeklyDiagnosticSummary } from "../src/types.js";

const weekStart = "2026-07-06T00:00:00.000Z";

function baseSummary(overrides: Partial<WeeklyDiagnosticSummary> = {}): WeeklyDiagnosticSummary {
  return {
    window: { week_start: weekStart, week_end: "2026-07-12T23:59:59.999Z" },
    finance: { total_spent: 1200, entry_count: 2, top_category: "Food" },
    habits: { total_logs: 3, successful_logs: 2, success_rate: 66, total_minutes: 90, top_activity: "Study" },
    todos: { created_count: 1, completed_count: 1, open_count: 0 },
    emotions: { average_anxiety: 3, latest_anxiety: 3, dominant_driver: "money" },
    momentum_score: 48,
    trial_cliffhanger: false,
    ...overrides
  };
}

describe("report daily series", () => {
  it("buckets spend and habit wins by Mauritius-local day", () => {
    const daily = buildWeeklyDailySeries({
      weekStart,
      financeRows: [
        { amount: 500, logged_at: "2026-07-07T10:00:00.000Z" },
        { amount: 700, logged_at: "2026-07-09T12:00:00.000Z" }
      ],
      habitRows: [
        { is_success: true, logged_at: "2026-07-07T08:00:00.000Z" },
        { is_success: false, logged_at: "2026-07-08T08:00:00.000Z" },
        { is_success: true, logged_at: "2026-07-09T08:00:00.000Z" }
      ],
      emotionRows: []
    });

    expect(daily.labels).toHaveLength(7);
    expect(daily.spend_rs.filter((value) => value !== null)).toHaveLength(2);
    expect(daily.habit_wins.filter((value) => value !== null)).toHaveLength(3);
    expect(hasWeeklyReportCharts({ ...baseSummary(), daily })).toBe(true);
  });

  it("uses null for ghost days with no logs", () => {
    const spend = buildSpendDailySeries({
      weekStart,
      rows: [{ amount: 200, logged_at: "2026-07-07T10:00:00.000Z" }]
    });

    expect(spend.filter((value) => value === null).length).toBe(6);
  });

  it("builds week-over-week deltas from prior summary", () => {
    const current = baseSummary({ momentum_score: 60 });
    const prior = baseSummary({
      window: { week_start: "2026-06-29T00:00:00.000Z", week_end: "2026-07-05T23:59:59.999Z" },
      finance: { total_spent: 1000, entry_count: 2, top_category: "Food" },
      habits: { total_logs: 2, successful_logs: 1, success_rate: 50, total_minutes: 60, top_activity: "Study" },
      momentum_score: 50
    });

    const wow = buildWeekOverWeekComparison({ current, prior });

    expect(wow.momentum_delta).toBe(10);
    expect(wow.spend_delta_pct).toBe(20);
    expect(wow.habit_wins_delta).toBe(1);
  });

  it("does not flag charts when only one day has signal", () => {
    const daily = buildWeeklyDailySeries({
      weekStart,
      financeRows: [{ amount: 100, logged_at: "2026-07-07T10:00:00.000Z" }],
      habitRows: [],
      emotionRows: []
    });

    expect(hasWeeklyReportCharts({ ...baseSummary(), daily })).toBe(false);
  });
});
