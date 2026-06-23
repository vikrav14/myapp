import { describe, expect, it } from "vitest";

import { buildTrialProgressPing, buildTrialSquadTease } from "../src/services/engagement-stats.service.js";

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-07-01T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Money", "LocalBuzz"],
  morning_digest_enabled: true,
  weekly_focus_habit: "45 minutes deep study before noon",
  weekly_focus_set_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("trial engagement copy", () => {
  it("builds a mid-trial progress ping", () => {
    const message = buildTrialProgressPing(activeUser, {
      financeEntries: 2,
      totalSpent: 150,
      habitLogs: 2,
      successfulHabits: 2,
      completedTodos: 1,
      openTodos: 1,
      averageAnxiety: 3
    });

    expect(message).toContain("Mid-trial check-in");
    expect(message).toContain("help");
  });

  it("builds a squad tease", () => {
    expect(buildTrialSquadTease(activeUser)).toContain("create squad");
  });
});
