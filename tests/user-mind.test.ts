import { describe, expect, it } from "vitest";

import {
  buildKnowYouAcknowledgement,
  buildKnowYouPrompt,
  buildUserMindProfileReply,
  extractionToFactRows,
  isKnowYouSkipMessage,
  isKnowYouTooShort,
  parseUserMindCommand
} from "../src/services/user-mind.service.js";

describe("user mind helpers", () => {
  it("maps extraction fields to fact rows", () => {
    const rows = extractionToFactRows(
      {
        preferred_name: "Ravin",
        age: 34,
        area: "Beau Bassin",
        work: "printing shop owner",
        interests: ["football", "fitness"],
        goals: ["cashflow clarity"],
        tone_preference: "direct, no lectures"
      },
      "onboarding"
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "identity", fact_key: "preferred_name", fact_value: "Ravin" }),
        expect.objectContaining({ category: "location", fact_value: "Beau Bassin" }),
        expect.objectContaining({ category: "life_context", fact_value: "printing shop owner" }),
        expect.objectContaining({ category: "preferences", fact_value: "direct, no lectures" })
      ])
    );
  });

  it("parses profile and remember commands", () => {
    expect(parseUserMindCommand("what do you know about me")).toEqual({ type: "profile" });
    expect(parseUserMindCommand("remember that I live in Quatre Bornes")).toEqual({
      type: "remember",
      text: "I live in Quatre Bornes"
    });
    expect(parseUserMindCommand("forget that football")).toEqual({
      type: "forget",
      text: "football"
    });
  });

  it("detects skip and short know-you replies", () => {
    expect(isKnowYouSkipMessage("skip")).toBe(true);
    expect(isKnowYouTooShort("hi")).toBe(true);
    expect(isKnowYouTooShort("I run a shop in Beau Bassin")).toBe(false);
  });

  it("builds profile reply from stored facts", () => {
    const reply = buildUserMindProfileReply(
      {
        id: "u1",
        phone_number: "23050000000",
        first_name: "Neelum",
        archetype: "Corporate / Career",
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
        weekly_focus_habit: null,
        weekly_focus_set_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      [
        {
          id: "f1",
          user_id: "u1",
          category: "location",
          fact_key: "area",
          fact_value: "Rose Hill",
          source: "onboarding",
          confidence: 1,
          user_visible: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ]
    );

    expect(reply).toContain("Rose Hill");
    expect(reply).toContain("not just this week's logs");
  });

  it("builds know-you acknowledgement with saved facts", () => {
    const reply = buildKnowYouAcknowledgement({
      user: {
        id: "u1",
        phone_number: "23050000000",
        first_name: "Ravin",
        archetype: "Entrepreneur Mode",
        onboarding_state: "awaiting_archetype",
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
        weekly_focus_habit: null,
        weekly_focus_set_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      facts: [
        {
          id: "f1",
          user_id: "u1",
          category: "identity",
          fact_key: "age",
          fact_value: "26",
          source: "onboarding",
          confidence: 1,
          user_visible: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "f2",
          user_id: "u1",
          category: "life_context",
          fact_key: "work",
          fact_value: "printing shop owner",
          source: "onboarding",
          confidence: 1,
          user_visible: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "f3",
          user_id: "u1",
          category: "boundaries",
          fact_key: "no_guilt_trips",
          fact_value: "no guilt trips",
          source: "onboarding",
          confidence: 1,
          user_visible: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      skipped: false
    });

    expect(reply).toContain("26");
    expect(reply).toContain("printing shop owner");
    expect(reply).toContain("Student Grind");
    expect(reply).toContain("correct me");
  });

  it("builds compact acknowledgement for archetype handoff", () => {
    const reply = buildKnowYouAcknowledgement({
      user: {
        id: "u1",
        phone_number: "23050000000",
        first_name: "Vik",
        archetype: "Life & Habit Tracking",
        onboarding_state: "awaiting_archetype",
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
        weekly_focus_habit: null,
        weekly_focus_set_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      facts: [
        {
          id: "f1",
          user_id: "u1",
          category: "identity",
          fact_key: "age_band",
          fact_value: "mid-20s",
          source: "onboarding",
          confidence: 1,
          user_visible: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "f2",
          user_id: "u1",
          category: "location",
          fact_key: "area",
          fact_value: "Moka",
          source: "onboarding",
          confidence: 1,
          user_visible: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      skipped: false,
      compact: true
    });

    expect(reply).toContain("mid-20s");
    expect(reply).toContain("Moka");
    expect(reply).not.toContain("Student Grind");
  });

  it("includes friend-first prompt copy", () => {
    const prompt = buildKnowYouPrompt({
      id: "u1",
      phone_number: "23050000000",
      first_name: "Ravin",
      archetype: "Life & Habit Tracking",
      onboarding_state: "awaiting_know_you",
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
      weekly_focus_habit: null,
      weekly_focus_set_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });

    expect(prompt).toContain("Before I track anything");
    expect(prompt).toContain("How I'm different");
    expect(prompt).toContain("ChatGPT");
    expect(prompt).toContain("off-peak reflection");
    expect(prompt).toContain("What you unlock");
    expect(prompt).toContain("Squads");
    expect(prompt).toContain("👋");
    expect(prompt).toContain("your age");
    expect(prompt).toContain("what to avoid");
  });
});
