import type { WeeklyDiagnosticSummary } from "../types.js";
import { buildReportWebHtml } from "./report-web.service.js";

/** Illustrative silent-week Sunday report for Vik (from VIK_TRANSCRIPT_AUDIT.md). */
export function buildVikSilentWeekPreview(): {
  html: string;
  summary: WeeklyDiagnosticSummary;
  reportText: string;
} {
  const summary: WeeklyDiagnosticSummary = {
    window: {
      week_start: "2026-06-30T00:00:00.000Z",
      week_end: "2026-07-06T23:59:59.999Z"
    },
    finance: { total_spent: 0, entry_count: 0, top_category: null },
    habits: {
      total_logs: 0,
      successful_logs: 0,
      success_rate: 0,
      total_minutes: 0,
      top_activity: null
    },
    todos: { created_count: 0, completed_count: 0, open_count: 0 },
    emotions: { average_anxiety: null, latest_anxiety: null, dominant_driver: null },
    momentum_score: 22,
    trial_cliffhanger: false
  };

  const reportText = `Vik — no money logs this week, but the weight you named is still there: parents' wedding loan, dad's job gone, 8pm crash before the marketing dream gets a minute.

Momentum's thin on paper — that doesn't mean the week didn't count. One family-money moment logged beats zero.

Side hustle: 0/3 nights — matches what you said about TV by 8. Next week: same focus — one boundary before you react.`;

  const html = buildReportWebHtml({
    firstName: "Vik",
    reportText,
    summary,
    weeklyFocus: "Log one family-money moment before you react"
  });

  return { html, summary, reportText };
}
