import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MauriUser } from "../src/types.js";

const mockCanSendProactiveOutbound = vi.fn();
const mockCountProactivePingsToday = vi.fn();

vi.mock("../src/services/outbound-pace.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/outbound-pace.service.js")>(
    "../src/services/outbound-pace.service.js"
  );

  return {
    ...actual,
    canSendProactiveOutbound: mockCanSendProactiveOutbound,
    countProactivePingsToday: mockCountProactivePingsToday
  };
});

const { canSendProactiveCheckIn, buildPaceFocusCandidate } = await import(
  "../src/services/proactive-checkin.service.js"
);

const baseUser: MauriUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Vik",
  archetype: "Corporate / Career",
  brief_focus: null,
  active_modules: ["career", "habits"],
  onboarding_state: "active",
  subscription_status: "Trial_Active",
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2027-07-01T00:00:00.000Z",
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: ["Traffic", "Tech", "Money"],
  morning_digest_enabled: true,
  calendar_sync_enabled: true,
  memory_resurfacing_enabled: true,
  local_alerts_enabled: true,
  school_alerts_enabled: true,
  payday_day_of_month: null,
  monthly_income_rs: null,
  weekly_focus_habit: "One money move — log before you react",
  weekly_focus_set_at: "2026-06-22T00:00:00.000Z",
  open_loop_followups_enabled: true,
  proactive_checkins_paused_until: null,
  quiet_hours_enabled: true,
  quiet_hours_start_hour: 22,
  quiet_hours_end_hour: 7,
  help_focus_primary: "personal_finance",
  help_focus_secondary: "relationship",
  notification_config: {
    proactive_preset: "steady",
    density_profile: "pulse",
    proactive_max_per_day: 4,
    proactive_min_interval_minutes: 180,
    proactive_max_per_week: 21,
    configured_at: "2026-06-22T00:00:00.000Z"
  },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("proactive check-in pace eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanSendProactiveOutbound.mockResolvedValue({ allowed: true });
  });

  it("allows another mate ping the same day when pace budget remains", async () => {
    const result = await canSendProactiveCheckIn({
      user: baseUser,
      silenceHours: 4,
      weeklyCount: 1
    });

    expect(result.ok).toBe(true);
    expect(mockCanSendProactiveOutbound).toHaveBeenCalled();
  });

  it("defers to pace gate for min interval and daily cap", async () => {
    mockCanSendProactiveOutbound.mockResolvedValue({ allowed: false, reason: "min_interval" });

    const result = await canSendProactiveCheckIn({
      user: baseUser,
      silenceHours: 4,
      weeklyCount: 1
    });

    expect(result).toEqual({ ok: false, reason: "min_interval" });
  });

  it("blocks silent pace presets", async () => {
    const result = await canSendProactiveCheckIn({
      user: {
        ...baseUser,
        notification_config: {
          proactive_preset: "silent",
          density_profile: "pulse",
          proactive_max_per_day: 0,
          proactive_min_interval_minutes: 0,
          proactive_max_per_week: 0,
          configured_at: "2026-06-22T00:00:00.000Z"
        }
      },
      silenceHours: 12,
      weeklyCount: 0
    });

    expect(result).toEqual({ ok: false, reason: "pace_silent" });
  });

  it("builds a weekly-focus nudge candidate after pace min silence", async () => {
    const candidate = await buildPaceFocusCandidate({
      user: baseUser,
      silenceHours: 3.5
    });

    expect(candidate?.hookSummary).toContain("log before you react");
  });
});
