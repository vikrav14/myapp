import { describe, expect, it } from "vitest";

import {
  buildQuietWeekFallbackSignal,
  buildWeeklyReportNarrativePrompt,
  isQuietReportWeek,
  type WeeklyReportNarrativeContext
} from "../src/services/report.service.js";
import type { WeeklyDiagnosticSummary } from "../src/types.js";

function quietSummary(): WeeklyDiagnosticSummary {
  return {
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
}

function baseNarrative(overrides: Partial<WeeklyReportNarrativeContext> = {}): WeeklyReportNarrativeContext {
  return {
    userMindSnapshotPrompt: null,
    activeFocus: null,
    strategyTrack: null,
    openLoops: [],
    weeklyFocusHabit: null,
    momentumDelta: null,
    priorMomentumScore: null,
    isQuietWeek: true,
    ...overrides
  };
}

describe("weekly report narrative helpers", () => {
  it("detects quiet weeks from log counts", () => {
    expect(isQuietReportWeek(quietSummary())).toBe(true);
    expect(
      isQuietReportWeek({
        ...quietSummary(),
        finance: { total_spent: 100, entry_count: 1, top_category: "Food" }
      })
    ).toBe(false);
  });

  it("builds narrative prompt with Mauri Memory, loops, and momentum delta", () => {
    const prompt = buildWeeklyReportNarrativePrompt(
      baseNarrative({
        activeFocus: "Balancing shop overheads vs newborn schedule",
        strategyTrack: "Personal Finance + Parenting",
        userMindSnapshotPrompt: "Life summary: Wedding loan pressure still heavy",
        openLoops: ["Dad lost factory job", "Parents expect loan payment"],
        weeklyFocusHabit: "Log one family-money moment before you react",
        priorMomentumScore: 30,
        momentumDelta: -8,
        isQuietWeek: true
      })
    );

    expect(prompt).toContain("Mauri Memory — active focus:");
    expect(prompt).toContain("Balancing shop overheads");
    expect(prompt).toContain("Mauri Memory — strategy track:");
    expect(prompt).toContain("Dad lost factory job");
    expect(prompt).toContain("Weekly focus habit:");
    expect(prompt).toContain("Momentum vs last week:");
    expect(prompt).toContain("Do not sound empty or robotic");
  });

  it("prefers active focus in quiet-week fallback copy", () => {
    const signal = buildQuietWeekFallbackSignal(
      baseNarrative({
        activeFocus: "Brain fried by 8pm before side hustle gets a minute"
      })
    );

    expect(signal).toContain("brain fried by 8pm");
  });

  it("prefers open loops in quiet-week fallback copy", () => {
    const signal = buildQuietWeekFallbackSignal(
      baseNarrative({
        openLoops: ["Parents expect loan payment after dad lost job"]
      })
    );

    expect(signal).toContain("Parents expect loan payment");
  });

  it("falls back to snapshot life summary when logs are quiet", () => {
    const signal = buildQuietWeekFallbackSignal(
      baseNarrative({
        userMindSnapshotPrompt: "Life summary: Brain fried by 8pm before side hustle gets a minute"
      })
    );

    expect(signal).toContain("brain fried by 8pm");
  });
});
