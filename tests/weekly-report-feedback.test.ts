import { describe, expect, it } from "vitest";

import type { WeeklyDiagnosticSummary } from "../src/types.js";
import {
  decideWeeklyFeedbackPrompt,
  parseServiceFeedbackMessage,
  type WeeklyFeedbackSignals
} from "../src/services/weekly-report-feedback.service.js";

function baseSummary(overrides: Partial<WeeklyDiagnosticSummary> = {}): WeeklyDiagnosticSummary {
  return {
    window: {
      week_start: "2026-06-16T00:00:00.000Z",
      week_end: "2026-06-22T23:59:59.999Z"
    },
    finance: { total_spent: 500, entry_count: 2, top_category: "Food" },
    habits: {
      total_logs: 3,
      successful_logs: 2,
      success_rate: 66,
      total_minutes: 120,
      top_activity: "Study_Deep_Work"
    },
    todos: { created_count: 2, completed_count: 1, open_count: 1 },
    emotions: { average_anxiety: 3, latest_anxiety: 3, dominant_driver: "Exams" },
    momentum_score: 55,
    trial_cliffhanger: false,
    ...overrides
  };
}

function baseSignals(overrides: Partial<WeeklyFeedbackSignals> = {}): WeeklyFeedbackSignals {
  return {
    priorReportCount: 5,
    weeksSinceFeedback: 8,
    messageCountThisWeek: 10,
    momentumDelta: 0,
    accountAgeDays: 45,
    ...overrides
  };
}

describe("decideWeeklyFeedbackPrompt", () => {
  it("skips during trial cliffhanger weeks", () => {
    const result = decideWeeklyFeedbackPrompt({
      summary: baseSummary({ trial_cliffhanger: true }),
      signals: baseSignals()
    });

    expect(result.include).toBe(false);
    expect(result.skip_reason).toBe("trial_cliffhanger");
  });

  it("skips when feedback was recent", () => {
    const result = decideWeeklyFeedbackPrompt({
      summary: baseSummary(),
      signals: baseSignals({ weeksSinceFeedback: 2 })
    });

    expect(result.include).toBe(false);
    expect(result.skip_reason).toBe("recent_feedback");
  });

  it("includes early calibration for first reports", () => {
    const result = decideWeeklyFeedbackPrompt({
      summary: baseSummary(),
      signals: baseSignals({ priorReportCount: 1 })
    });

    expect(result.include).toBe(true);
    expect(result.reason).toBe("early_calibration");
    expect(result.variant).toBe("open");
  });

  it("includes context ask when momentum drops sharply", () => {
    const result = decideWeeklyFeedbackPrompt({
      summary: baseSummary({ momentum_score: 40 }),
      signals: baseSignals({ momentumDelta: -20 })
    });

    expect(result.include).toBe(true);
    expect(result.reason).toBe("momentum_drop");
    expect(result.variant).toBe("context");
  });

  it("includes periodic rating pulse for long-term users", () => {
    const result = decideWeeklyFeedbackPrompt({
      summary: baseSummary(),
      signals: baseSignals({ weeksSinceFeedback: null, priorReportCount: 6 })
    });

    expect(result.include).toBe(true);
    expect(result.reason).toBe("periodic_pulse");
    expect(result.variant).toBe("rating");
  });

  it("skips ghost weeks with no signal", () => {
    const result = decideWeeklyFeedbackPrompt({
      summary: baseSummary({
        finance: { total_spent: 0, entry_count: 0, top_category: null },
        habits: {
          total_logs: 0,
          successful_logs: 0,
          success_rate: 0,
          total_minutes: 0,
          top_activity: null
        },
        todos: { created_count: 0, completed_count: 0, open_count: 0 },
        emotions: { average_anxiety: null, latest_anxiety: null, dominant_driver: null }
      }),
      signals: baseSignals({ messageCountThisWeek: 0 })
    });

    expect(result.include).toBe(false);
    expect(result.skip_reason).toBe("ghost_week");
  });
});

describe("parseServiceFeedbackMessage", () => {
  it("parses numeric ratings", () => {
    expect(parseServiceFeedbackMessage("rate 4")).toEqual({ kind: "rating", rating: 4 });
    expect(parseServiceFeedbackMessage("mauri 5/5")).toEqual({ kind: "rating", rating: 5 });
  });

  it("parses free-text feedback", () => {
    expect(parseServiceFeedbackMessage("mauri feedback: you sound too preachy on money")).toEqual({
      kind: "text",
      text: "you sound too preachy on money"
    });
  });

  it("ignores unrelated chat", () => {
    expect(parseServiceFeedbackMessage("I spent 150 on mine frite")).toBeNull();
  });
});
