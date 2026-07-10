import { describe, expect, it } from "vitest";

import {
  buildMauriMemoryViewFromData,
  formatMauriMemoryViewForWhatsApp,
  formatStrategyTrackReplyForUser
} from "../src/services/mauri-memory-view.service.js";
import type { MauriUser, UserMindFact } from "../src/types.js";

const baseUser: MauriUser = {
  id: "u1",
  phone_number: "23050000000",
  first_name: "Vik",
  archetype: "Entrepreneur Mode",
  onboarding_state: "active",
  subscription_status: "Trial_Active",
  onboarding_completed_at: null,
  trial_started_at: null,
  trial_ends_at: null,
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: [],
  morning_digest_enabled: true,
  calendar_sync_enabled: true,
  memory_resurfacing_enabled: true,
  local_alerts_enabled: true,
  school_alerts_enabled: true,
  payday_day_of_month: null,
  monthly_income_rs: null,
  weekly_focus_habit: "One shop block before baby wake-up",
  weekly_focus_set_at: "2026-07-01T00:00:00.000Z",
  help_focus_primary: "personal_finance",
  help_focus_secondary: "parenting",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

const sampleFacts: UserMindFact[] = [
  {
    id: "f1",
    user_id: "u1",
    category: "life_context",
    fact_key: "work",
    fact_value: "small retail shop",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "f2",
    user_id: "u1",
    category: "stressors",
    fact_key: "rent",
    fact_value: "shop overheads vs newborn schedule",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  }
];

describe("mauri memory view", () => {
  it("builds structured sections from snapshot, facts, and help focus", () => {
    const view = buildMauriMemoryViewFromData({
      user: baseUser,
      facts: sampleFacts,
      snapshot: {
        life_summary: "Balancing shop overheads vs newborn schedule.",
        personality_notes: "Direct, no guilt trips.",
        money_pattern: "Tight cashflow around rent.",
        habit_pattern: "Short work blocks when baby sleeps.",
        emotional_pattern: "Carrying family load quietly.",
        active_goals: ["keep shop afloat"],
        recent_wins: ["opened on time three days"],
        open_loops: ["uncle loan follow-up"],
        advice_preferences: "Practical, not preachy.",
        things_to_avoid: ["guilt trips"]
      },
      snapshotRefreshedAt: "2026-07-10T02:00:00.000Z"
    });

    expect(view.activeFocus).toBe("Balancing shop overheads vs newborn schedule.");
    expect(view.openLoops).toEqual(["uncle loan follow-up"]);
    expect(view.strategyTrack?.laneLabels).toContain("Personal Finance");
    expect(view.isSparse).toBe(false);
  });

  it("formats WhatsApp memory with stable section headers", () => {
    const view = buildMauriMemoryViewFromData({
      user: baseUser,
      facts: sampleFacts,
      snapshot: {
        life_summary: "Balancing shop overheads vs newborn schedule.",
        personality_notes: "Direct.",
        money_pattern: "Tight.",
        habit_pattern: "Short blocks.",
        emotional_pattern: "Tired.",
        active_goals: [],
        recent_wins: [],
        open_loops: ["uncle loan follow-up"],
        advice_preferences: "Practical.",
        things_to_avoid: []
      },
      snapshotRefreshedAt: "2026-07-10T02:00:00.000Z"
    });

    const reply = formatMauriMemoryViewForWhatsApp(baseUser, view);

    expect(reply).toContain("Mauri Memory");
    expect(reply).toContain("🧠 Active focus");
    expect(reply).toContain("Balancing shop overheads vs newborn schedule.");
    expect(reply).toContain("🛡️ Strategy track");
    expect(reply).toContain("📋 What you told me");
    expect(reply).toContain("small retail shop");
    expect(reply).toContain("🔒 Your data");
    expect(reply).toContain("Reflection refreshed:");
  });

  it("shows sparse-state copy when nothing is stored yet", () => {
    const sparseUser = { ...baseUser, help_focus_primary: null, help_focus_secondary: null, weekly_focus_habit: null };
    const view = buildMauriMemoryViewFromData({
      user: sparseUser,
      facts: []
    });

    const reply = formatMauriMemoryViewForWhatsApp(sparseUser, view);

    expect(view.isSparse).toBe(true);
    expect(reply).toContain("still building your structured profile");
    expect(reply).toContain("🧠 Active focus");
  });

  it("formats help focus with the same strategy track block", () => {
    const reply = formatStrategyTrackReplyForUser(baseUser);

    expect(reply).toContain("🛡️ Strategy track");
    expect(reply).toContain("Personal Finance");
    expect(reply).toContain("How I help:");
    expect(reply).toContain("Reply help focus to change lane.");
  });
});
