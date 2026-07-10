import { describe, expect, it } from "vitest";

import type { MauriUser } from "../src/types.js";
import {
  formatQuietHoursWindow,
  isProactiveOutboundPaused,
  isWithinQuietHours
} from "../src/services/outbound-pace.service.js";

const baseUser: MauriUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active",
  subscription_status: "Trial_Active",
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2027-07-01T00:00:00.000Z",
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
  payday_day_of_month: null,
  monthly_income_rs: null,
  weekly_focus_habit: null,
  weekly_focus_set_at: null,
  open_loop_followups_enabled: true,
  proactive_checkins_paused_until: null,
  quiet_hours_enabled: true,
  quiet_hours_start_hour: 22,
  quiet_hours_end_hour: 7,
  notification_config: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("outbound pace", () => {
  it("detects overnight quiet hours", () => {
    const lateNight = new Date("2026-06-22T20:30:00.000Z"); // 00:30 Mauritius
    const morning = new Date("2026-06-22T04:30:00.000Z"); // 08:30 Mauritius
    const afternoon = new Date("2026-06-22T10:30:00.000Z"); // 14:30 Mauritius

    expect(isWithinQuietHours(baseUser, lateNight)).toBe(true);
    expect(isWithinQuietHours(baseUser, morning)).toBe(false);
    expect(isWithinQuietHours(baseUser, afternoon)).toBe(false);
  });

  it("respects quiet hours toggle", () => {
    const lateNight = new Date("2026-06-22T20:30:00.000Z");
    expect(isWithinQuietHours({ ...baseUser, quiet_hours_enabled: false }, lateNight)).toBe(false);
  });

  it("detects proactive pause window", () => {
    expect(
      isProactiveOutboundPaused({
        ...baseUser,
        proactive_checkins_paused_until: "2099-01-01T00:00:00.000Z"
      })
    ).toBe(true);
  });

  it("formats quiet hours window", () => {
    expect(formatQuietHoursWindow(baseUser)).toContain("Mauritius time");
  });
});
