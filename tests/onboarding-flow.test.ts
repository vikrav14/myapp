import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBuildLockedReplyForUser = vi.fn();
const mockUpdateUserState = vi.fn();
const mockBuildOnboardingPreviewBrief = vi.fn();
const mockAssignWeeklyFocusForUser = vi.fn();

vi.mock("../src/services/paywall.service.js", () => ({
  buildLockedReplyForUser: mockBuildLockedReplyForUser
}));

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/services/morning-brief-preview.service.js", () => ({
  buildOnboardingPreviewBrief: mockBuildOnboardingPreviewBrief
}));

vi.mock("../src/services/weekly-focus.service.js", () => ({
  assignWeeklyFocusForUser: mockAssignWeeklyFocusForUser
}));

const { handleOnboardingMessage } = await import("../src/services/onboarding.service.js");

const awaitingTopicsUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "awaiting_topics" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: null,
  trial_started_at: null,
  trial_ends_at: null,
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: [],
  morning_digest_enabled: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("handleOnboardingMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildOnboardingPreviewBrief.mockResolvedValue("Preview of your 7:00 vibe check.");
    mockAssignWeeklyFocusForUser.mockImplementation(async (user: { id: string }) => ({
      ...user,
      weekly_focus_habit: "45 minutes deep study before noon",
      weekly_focus_set_at: "2026-06-22T00:00:00.000Z"
    }));
  });

  it("suggests archetype-specific topics after archetype selection", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      archetype: "Student Grind"
    });

    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_archetype",
        archetype: "Life & Habit Tracking"
      },
      isNewUser: true,
      message: "study"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Student Grind");
    expect(result.reply).toContain("#Traffic #Money #LocalBuzz");
    expect(result.reply).toContain("Reply OK to confirm");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "awaiting_topics",
        archetype: "Student Grind"
      })
    );
  });

  it("activates with archetype defaults when the user replies OK", async () => {
    const activatedUser = {
      ...awaitingTopicsUser,
      onboarding_state: "active" as const,
      topic_preferences: ["Traffic", "Money", "LocalBuzz"],
      trial_started_at: "2026-06-22T00:00:00.000Z",
      trial_ends_at: "2026-06-29T00:00:00.000Z"
    };
    mockUpdateUserState.mockResolvedValue(activatedUser);
    mockAssignWeeklyFocusForUser.mockResolvedValue({
      ...activatedUser,
      weekly_focus_habit: "45 minutes deep study before noon"
    });

    const result = await handleOnboardingMessage({
      user: awaitingTopicsUser,
      isNewUser: false,
      message: "OK"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("exam pressure");
    expect(result.reply).toContain("one habit");
    expect(result.followUpReply).toContain("Preview");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "active",
        topic_preferences: ["Traffic", "Money", "LocalBuzz"]
      })
    );
    expect(mockBuildOnboardingPreviewBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        archetype: "Student Grind",
        topics: ["Traffic", "Money", "LocalBuzz"]
      })
    );
  });

  it("activates with custom topics when provided", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "active",
      topic_preferences: ["Traffic", "Tech", "Money"]
    });
    mockAssignWeeklyFocusForUser.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "active",
      topic_preferences: ["Traffic", "Tech", "Money"],
      weekly_focus_habit: "45 minutes deep study before noon"
    });

    const result = await handleOnboardingMessage({
      user: awaitingTopicsUser,
      isNewUser: false,
      message: "Traffic Tech Money"
    });

    expect(result.handled).toBe(true);
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        topic_preferences: ["Traffic", "Tech", "Money"]
      })
    );
    expect(result.followUpReply).toBeTruthy();
    expect(result.discoveryReply).toContain("help");
  });

  it("re-prompts when topic selection is invalid", async () => {
    const result = await handleOnboardingMessage({
      user: awaitingTopicsUser,
      isNewUser: false,
      message: "Traffic"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Reply OK to confirm");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });
});
