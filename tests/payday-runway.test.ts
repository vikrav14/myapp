import { describe, expect, it } from "vitest";

import {
  buildPaydayRunwayReply,
  getPayCycleBounds,
  parseFinanceCommand
} from "../src/services/payday-runway.service.js";
import { mauritiusLocalToUtc } from "../src/services/reminder-time.service.js";

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
  topic_preferences: ["Traffic", "Money", "LocalBuzz"] as const,
  morning_digest_enabled: true,
  calendar_sync_enabled: true,
  memory_resurfacing_enabled: true,
  payday_day_of_month: 25,
  monthly_income_rs: 25000,
  weekly_focus_habit: null,
  weekly_focus_set_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("parseFinanceCommand", () => {
  it("parses runway and setup commands", () => {
    expect(parseFinanceCommand("my runway")).toEqual({ type: "runway" });
    expect(parseFinanceCommand("payday 25")).toEqual({ type: "setPayday", day: 25 });
    expect(parseFinanceCommand("salary 25000")).toEqual({ type: "setSalary", amount: 25000 });
  });
});

describe("getPayCycleBounds", () => {
  it("computes days until payday from a mid-cycle date", () => {
    const now = mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 12, minute: 0 });
    const bounds = getPayCycleBounds(25, now);

    expect(bounds.daysUntilPayday).toBe(3);
    expect(bounds.daysElapsed).toBeGreaterThan(0);
  });
});

describe("buildPaydayRunwayReply", () => {
  it("includes breathing room when income is set", () => {
    const reply = buildPaydayRunwayReply(
      activeUser,
      {
        totalSpent: 5000,
        entryCount: 8,
        topCategory: "Food"
      },
      mauritiusLocalToUtc({ year: 2026, month: 6, day: 22, hour: 12, minute: 0 })
    );

    expect(reply).toContain("Payday runway");
    expect(reply).toContain("Rs 5000");
    expect(reply).toContain("breathing room");
  });

  it("prompts setup when payday is missing", () => {
    const reply = buildPaydayRunwayReply(
      { ...activeUser, payday_day_of_month: null },
      { totalSpent: 0, entryCount: 0, topCategory: null }
    );

    expect(reply).toContain("set your payday");
  });
});
