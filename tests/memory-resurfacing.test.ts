import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateUserState = vi.fn();

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

const { handleMemoryResurfaceToggleMessage } = await import("../src/services/memory-resurfacing.service.js");

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
  weekly_focus_habit: null,
  weekly_focus_set_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("handleMemoryResurfaceToggleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turns memory resurfacing off", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...activeUser,
      memory_resurfacing_enabled: false
    });

    const result = await handleMemoryResurfaceToggleMessage({
      user: activeUser,
      message: "resurface off"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("off");
    expect(mockUpdateUserState).toHaveBeenCalledWith(activeUser.id, {
      memory_resurfacing_enabled: false
    });
  });

  it("ignores unrelated messages", async () => {
    const result = await handleMemoryResurfaceToggleMessage({
      user: activeUser,
      message: "I spent 150 on mine frite"
    });

    expect(result.handled).toBe(false);
  });
});
