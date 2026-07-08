import { describe, expect, it } from "vitest";

import { buildReportWebHtml } from "../src/services/report-web.service.js";
import { buildReportWebUrl, signSundayCardToken } from "../src/services/rich-media.service.js";
import { summaryToActivitySnapshot } from "../src/services/engagement-stats.service.js";
import { getWeeklyReportWindow } from "../src/services/report.service.js";
import type { WeeklyDiagnosticSummary } from "../src/types.js";

function summary(): WeeklyDiagnosticSummary {
  return {
    window: {
      week_start: "2026-06-30T00:00:00.000Z",
      week_end: "2026-07-06T23:59:59.999Z"
    },
    finance: { total_spent: 8000, entry_count: 1, top_category: "Family" },
    habits: { total_logs: 2, successful_logs: 1, success_rate: 50, total_minutes: 60, top_activity: "Study" },
    todos: { created_count: 1, completed_count: 0, open_count: 2 },
    emotions: { average_anxiety: 3, latest_anxiety: 3, dominant_driver: "money" },
    momentum_score: 42,
    trial_cliffhanger: false
  };
}

describe("report web UI", () => {
  it("builds mobile HTML with momentum and roast/hype CTAs", () => {
    const html = buildReportWebHtml({
      firstName: "Vik",
      reportText: "Quiet week on the logs — the loan weight is still live.",
      summary: summary(),
      weeklyFocus: "Log one family-money moment before you react"
    });

    expect(html).toContain("Vik's week");
    expect(html).toContain("Momentum");
    expect(html).toContain("42");
    expect(html).toContain("roast me");
    expect(html).toContain("hype me");
    expect(html).toContain("family-money moment");
  });

  it("builds a signed report web URL", () => {
    const token = signSundayCardToken({
      userId: "11111111-1111-4111-8111-111111111111",
      weekStart: "2026-06-30T00:00:00.000Z"
    });

    expect(token).toBeTruthy();
  });
});

describe("engagement week alignment", () => {
  it("maps weekly report summary to roast/hype snapshot fields", () => {
    const snapshot = summaryToActivitySnapshot(summary());

    expect(snapshot).toEqual({
      financeEntries: 1,
      totalSpent: 8000,
      habitLogs: 2,
      successfulHabits: 1,
      completedTodos: 0,
      openTodos: 2,
      averageAnxiety: 3
    });
  });

  it("uses Monday-start calendar weeks", () => {
    const window = getWeeklyReportWindow(new Date("2026-07-08T12:00:00.000Z"));
    expect(window.weekStart).toBe("2026-07-06T00:00:00.000Z");
  });
});
