import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBuildLockedReplyForUser = vi.fn();
const mockUpdateUserState = vi.fn();
const mockAssignWeeklyFocusForUser = vi.fn();

vi.mock("../src/services/paywall.service.js", () => ({
  buildLockedReplyForUser: mockBuildLockedReplyForUser
}));

vi.mock("../src/services/user.service.js", () => ({
  updateUserState: mockUpdateUserState
}));

vi.mock("../src/services/weekly-focus.service.js", () => ({
  assignWeeklyFocusForUser: mockAssignWeeklyFocusForUser
}));

const mockIngestUserMindMessage = vi.fn();
const mockLoadUserMindFacts = vi.fn();
const mockResolveKnowYouAcknowledgement = vi.fn();
const mockSeedLifeThreadsFromOnboarding = vi.fn();
const mockListPendingFollowUpsForUser = vi.fn();

vi.mock("../src/services/user-mind.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/user-mind.service.js")>(
    "../src/services/user-mind.service.js"
  );

  return {
    ...actual,
    ingestUserMindMessage: mockIngestUserMindMessage,
    loadUserMindFacts: mockLoadUserMindFacts,
    resolveKnowYouAcknowledgement: mockResolveKnowYouAcknowledgement
  };
});

vi.mock("../src/services/open-loop-follow-up.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/open-loop-follow-up.service.js")>(
    "../src/services/open-loop-follow-up.service.js"
  );

  return {
    ...actual,
    seedLifeThreadsFromOnboarding: mockSeedLifeThreadsFromOnboarding,
    listPendingFollowUpsForUser: mockListPendingFollowUpsForUser
  };
});

const { handleOnboardingMessage } = await import("../src/services/onboarding.service.js");

const awaitingTopicsUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  active_modules: [] as const,
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
    mockAssignWeeklyFocusForUser.mockImplementation(async (user: { id: string }) => ({
      ...user,
      weekly_focus_habit: "45 minutes deep study before noon",
      weekly_focus_set_at: "2026-06-22T00:00:00.000Z"
    }));
    mockIngestUserMindMessage.mockResolvedValue([]);
    mockLoadUserMindFacts.mockResolvedValue([]);
    mockResolveKnowYouAcknowledgement.mockImplementation(async (input: { user: { first_name?: string | null } }) => {
      const name = input.user.first_name?.trim() || "there";
      return `${name} — thanks for sharing that with me.`;
    });
    mockSeedLifeThreadsFromOnboarding.mockResolvedValue(0);
    mockListPendingFollowUpsForUser.mockResolvedValue([]);
  });

  it("prompts know-you first for awaiting_know_you users with short replies", async () => {
    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_know_you",
        archetype: "Life & Habit Tracking"
      },
      isNewUser: true,
      message: "hi"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Before I track anything");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });

  it("stores know-you profile then moves to archetype selection", async () => {
    mockLoadUserMindFacts.mockResolvedValue([
      {
        id: "fact-1",
        user_id: awaitingTopicsUser.id,
        category: "life_context",
        fact_key: "work",
        fact_value: "printing shop owner",
        source: "onboarding",
        confidence: 1,
        user_visible: true,
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-22T00:00:00.000Z"
      }
    ]);
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "awaiting_archetype",
      archetype: "Entrepreneur Mode"
    });

    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_know_you"
      },
      isNewUser: true,
      message: "I'm 34 in Beau Bassin running a printing shop. Direct tone please."
    });

    expect(mockIngestUserMindMessage).toHaveBeenCalled();
    expect(mockSeedLifeThreadsFromOnboarding).toHaveBeenCalled();
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({ onboarding_state: "awaiting_archetype" })
    );
    expect(result.reply).toContain("thanks for sharing");
    expect(result.interactive?.listButtonLabel).toBe("Pick vibe");
    expect(result.sendTextBeforeInteractive).toBe(true);
  });

  it("delays archetype picker for heavy know-you shares and reframes the lane ask", async () => {
    mockLoadUserMindFacts.mockResolvedValue([
      {
        id: "fact-1",
        user_id: awaitingTopicsUser.id,
        category: "relationships",
        fact_key: "wife",
        fact_value: "Jeshna — awaiting biopsy results",
        source: "onboarding",
        confidence: 1,
        user_visible: true,
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-22T00:00:00.000Z"
      },
      {
        id: "fact-2",
        user_id: awaitingTopicsUser.id,
        category: "relationships",
        fact_key: "mum",
        fact_value: "Mum — not doing great",
        source: "onboarding",
        confidence: 1,
        user_visible: true,
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-22T00:00:00.000Z"
      }
    ]);
    mockResolveKnowYouAcknowledgement.mockResolvedValue(
      "Vik — that's a lot at once. Jeshna's health and waiting on results, your mum… I hear you."
    );
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      first_name: "Vik",
      onboarding_state: "awaiting_archetype"
    });

    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_know_you"
      },
      isNewUser: true,
      message:
        "I'm 39, Lower Vale, Tech Lead at Deel. Jeshna's health — waiting on biopsy results. Mum's not great. So much at once. No guilt trips."
    });

    expect(mockSeedLifeThreadsFromOnboarding).toHaveBeenCalled();
    expect(result.reply).toContain("Jeshna");
    expect(result.interactive?.listButtonLabel).toBe("Pick brief lane");
    expect(result.interactive?.body).toContain("separately");
    expect(result.sendTextBeforeInteractive).toBe(true);
  });

  it("maps entrepreneur selection when user replies 4", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "awaiting_modules",
      archetype: "Entrepreneur Mode"
    });
    mockListPendingFollowUpsForUser.mockResolvedValue([
      { loop_text: "Jeshna — awaiting biopsy results", scheduled_for: "2026-06-25T06:00:00.000Z" }
    ]);

    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_archetype"
      },
      isNewUser: false,
      message: "4"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Entrepreneur Mode");
    expect(result.interactive?.listButtonLabel).toBe("Pick modules");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "awaiting_modules",
        archetype: "Entrepreneur Mode"
      })
    );
  });

  it("maps custom lane users to module step before tags", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "awaiting_modules",
      archetype: "Custom"
    });

    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_archetype"
      },
      isNewUser: false,
      message: "custom"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Custom");
    expect(result.reply).toContain("modules");
    expect(result.interactive?.listButtonLabel).toBe("Pick modules");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "awaiting_modules",
        archetype: "Custom"
      })
    );
  });

  it("requires custom tags for Custom lane instead of OK", async () => {
    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        archetype: "Custom"
      },
      isNewUser: false,
      message: "OK"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("type your own");
    expect(result.interactive).toBeUndefined();
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });

  it("suggests module picker after archetype selection", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "awaiting_modules",
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
    expect(result.interactive?.listButtonLabel).toBe("Pick modules");
    expect(result.reply).toContain("Student Grind");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "awaiting_modules",
        archetype: "Student Grind"
      })
    );
  });

  it("moves to topic selection after modules are chosen", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...awaitingTopicsUser,
      onboarding_state: "awaiting_topics",
      archetype: "Corporate / Career",
      active_modules: ["career", "habits"]
    });

    const result = await handleOnboardingMessage({
      user: {
        ...awaitingTopicsUser,
        onboarding_state: "awaiting_modules",
        archetype: "Corporate / Career"
      },
      isNewUser: false,
      message: "modules suggested"
    });

    expect(result.handled).toBe(true);
    expect(result.interactive?.listButtonLabel).toBe("Pick tags");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "awaiting_topics",
        active_modules: ["career", "habits"]
      })
    );
  });

  it("activates with archetype defaults when the user replies OK", async () => {
    const activatedUser = {
      ...awaitingTopicsUser,
      onboarding_state: "active" as const,
      active_modules: ["student"] as const,
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
    expect(result.reply).toContain("habit");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      awaitingTopicsUser.id,
      expect.objectContaining({
        onboarding_state: "active",
        topic_preferences: ["Traffic", "Money", "LocalBuzz"]
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
  });

  it("re-prompts when topic selection is invalid", async () => {
    const result = await handleOnboardingMessage({
      user: awaitingTopicsUser,
      isNewUser: false,
      message: "Traffic"
    });

    expect(result.handled).toBe(true);
    expect(result.interactive?.listButtonLabel).toBe("Pick tags");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });
});
