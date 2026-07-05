import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateUserState = vi.fn();
const mockCountProactivePingsToday = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/services/outbound-pace.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/outbound-pace.service.js")>(
    "../src/services/outbound-pace.service.js"
  );

  return {
    ...actual,
    countProactivePingsToday: mockCountProactivePingsToday
  };
});

const { handleQuietHoursCommandMessage } = await import("../src/services/quiet-hours-command.service.js");

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
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
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("handleQuietHoursCommandMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountProactivePingsToday.mockResolvedValue(1);
  });

  it("returns proactive ping status", async () => {
    const result = await handleQuietHoursCommandMessage({
      user: activeUser,
      message: "quiet hours"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Quiet hours: on");
    expect(result.reply).toContain("Today's unprompted pings");
  });

  it("disables quiet hours", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      quiet_hours_enabled: false
    });

    const result = await handleQuietHoursCommandMessage({
      user: activeUser,
      message: "quiet hours off"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Quiet hours off");
    expect(mockUpdateUserState).toHaveBeenCalledWith(activeUser.id, { quiet_hours_enabled: false });
  });
});
