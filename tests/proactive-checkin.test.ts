import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProactiveCheckInCandidate } from "../src/services/proactive-checkin.service.js";

const mockUpdateUserState = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            then: undefined,
            data: null,
            count: 0,
            error: null
          })
        })
      })
    })
  }
}));

const {
  handleProactiveCheckInMessage,
  parseMyCheckinsCommand,
  parseNotNowCommand,
  pickProactiveCandidate
} = await import("../src/services/proactive-checkin.service.js");

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
  local_alerts_enabled: true,
  school_alerts_enabled: true,
  payday_day_of_month: 25,
  monthly_income_rs: 25000,
  weekly_focus_habit: "gym",
  weekly_focus_set_at: "2026-06-01T00:00:00.000Z",
  open_loop_followups_enabled: true,
  proactive_checkins_paused_until: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("proactive check-in parsing", () => {
  it("parses not now commands", () => {
    expect(parseNotNowCommand("not now")).toBe(true);
    expect(parseNotNowCommand("pause checkins")).toBe(true);
    expect(parseNotNowCommand("I spent 150 on food")).toBe(false);
  });

  it("parses my checkins command", () => {
    expect(parseMyCheckinsCommand("my checkins")).toBe(true);
    expect(parseMyCheckinsCommand("help")).toBe(false);
  });
});

describe("pickProactiveCandidate", () => {
  it("prefers care over curious when both exist", () => {
    const candidates: ProactiveCheckInCandidate[] = [
      {
        mode: "curious",
        hookSummary: "Getting to know you",
        deliveryKey: "curious-1"
      },
      {
        mode: "care",
        hookSummary: "Stress has been high",
        deliveryKey: "care-1"
      }
    ];

    expect(pickProactiveCandidate(candidates)?.mode).toBe("care");
  });
});

describe("handleProactiveCheckInMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pauses proactive check-ins on not now", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      proactive_checkins_paused_until: "2026-06-29T00:00:00.000Z"
    });

    const result = await handleProactiveCheckInMessage({
      user: activeUser,
      message: "not now"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("7 days");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      activeUser.id,
      expect.objectContaining({
        proactive_checkins_paused_until: expect.any(String)
      })
    );
  });

  it("ignores unrelated messages", async () => {
    const result = await handleProactiveCheckInMessage({
      user: activeUser,
      message: "remind me to gym at 6pm"
    });

    expect(result.handled).toBe(false);
  });
});
