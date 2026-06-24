import { describe, expect, it } from "vitest";

import { parseUserMindSnapshot } from "../src/schemas/user-mind.js";
import { buildReflectionWindow, hasReflectionSignal } from "../src/services/user-mind-data.service.js";
import { formatUserMindForPrompt } from "../src/services/user-mind-prompt.js";
import type { MauriUser } from "../src/types.js";

const baseUser: MauriUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ravin",
  archetype: "Student Grind",
  onboarding_state: "active",
  subscription_status: "Trial_Active",
  onboarding_completed_at: "2026-06-01T00:00:00.000Z",
  trial_started_at: "2026-06-01T00:00:00.000Z",
  trial_ends_at: "2026-06-08T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Money", "LocalBuzz"],
  morning_digest_enabled: true,
  calendar_sync_enabled: true,
  memory_resurfacing_enabled: true,
  local_alerts_enabled: true,
  school_alerts_enabled: true,
  payday_day_of_month: 25,
  monthly_income_rs: 18000,
  weekly_focus_habit: "Study_Deep_Work",
  weekly_focus_set_at: "2026-06-15T00:00:00.000Z",
  open_loop_followups_enabled: true,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z"
};

describe("user mind snapshot schema", () => {
  it("parses a valid mind snapshot payload", () => {
    const parsed = parseUserMindSnapshot(
      JSON.stringify({
        life_summary: "Final-year student balancing exams and part-time work.",
        personality_notes: "Direct advice lands better than long lectures.",
        money_pattern: "Food and transport dominate; weekend spends trigger guilt.",
        habit_pattern: "Study intent is high early week, slips after Wednesday.",
        emotional_pattern: "Stress spikes before exams and after overspending.",
        active_goals: ["Pass finals", "Keep gym 2x/week"],
        recent_wins: ["Logged spend 4 days in a row"],
        open_loops: ["Mentioned job interview on Friday"],
        advice_preferences: "Empathise first, then one concrete next move.",
        things_to_avoid: ["Preachy budget lectures when venting"]
      })
    );

    expect(parsed.active_goals).toHaveLength(2);
    expect(parsed.things_to_avoid[0]).toContain("Preachy");
  });
});

describe("user mind prompt formatting", () => {
  it("formats snapshot fields for conversational prompts", () => {
    const text = formatUserMindForPrompt({
      life_summary: "Student in exam season.",
      personality_notes: "Warm but direct.",
      money_pattern: "Tight budget.",
      habit_pattern: "Gym slips midweek.",
      emotional_pattern: "Anxiety before exams.",
      active_goals: ["Finish dissertation"],
      recent_wins: ["Hit study streak"],
      open_loops: ["Interview Friday"],
      advice_preferences: "Empathy first.",
      things_to_avoid: ["Generic motivation"]
    });

    expect(text).toContain("Life summary:");
    expect(text).toContain("Interview Friday");
    expect(text).toContain("Generic motivation");
  });
});

describe("user mind reflection helpers", () => {
  it("builds a lookback window", () => {
    const window = buildReflectionWindow(new Date("2026-06-22T02:00:00.000Z"), 7);
    expect(window.end).toBe("2026-06-22T02:00:00.000Z");
    expect(window.start).toBe("2026-06-15T02:00:00.000Z");
  });

  it("detects when there is enough signal to reflect", () => {
    const window = buildReflectionWindow(new Date("2026-06-22T02:00:00.000Z"), 7);
    expect(
      hasReflectionSignal({
        user: baseUser,
        window,
        financeLogs: [],
        habitLogs: [],
        todos: [],
        emotionLogs: [],
        conversationSamples: [],
        activeReminders: [],
        upcomingCalendarEvents: [],
        previousMindSnapshot: null
      })
    ).toBe(false);

    expect(
      hasReflectionSignal({
        user: baseUser,
        window,
        financeLogs: [],
        habitLogs: [],
        todos: [],
        emotionLogs: [],
        conversationSamples: [
          {
            memory_type: "user_message",
            content_text: "Exam stress is killing me",
            created_at: "2026-06-21T10:00:00.000Z"
          }
        ],
        activeReminders: [],
        upcomingCalendarEvents: [],
        previousMindSnapshot: null
      })
    ).toBe(true);
  });
});
