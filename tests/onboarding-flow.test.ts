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
const mockResetProfileForKnowYouOnboarding = vi.fn();
const mockGenerateExpressSetupQuestionReply = vi.fn();

vi.mock("../src/services/ai.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/ai.service.js")>("../src/services/ai.service.js");
  return {
    ...actual,
    generateExpressSetupQuestionReply: mockGenerateExpressSetupQuestionReply
  };
});

vi.mock("../src/services/user-mind.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/user-mind.service.js")>(
    "../src/services/user-mind.service.js"
  );

  return {
    ...actual,
    ingestUserMindMessage: mockIngestUserMindMessage,
    loadUserMindFacts: mockLoadUserMindFacts,
    resolveKnowYouAcknowledgement: mockResolveKnowYouAcknowledgement,
    resetProfileForKnowYouOnboarding: mockResetProfileForKnowYouOnboarding
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

const baseUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Life & Habit Tracking",
  brief_focus: null,
  active_modules: [] as const,
  onboarding_state: "awaiting_express_start" as const,
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

const financeFacts = [
  {
    id: "fact-1",
    user_id: baseUser.id,
    category: "life_context",
    fact_key: "work",
    fact_value: "working in finance in Ébène",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z"
  },
  {
    id: "fact-2",
    user_id: baseUser.id,
    category: "stressors",
    fact_key: "commute",
    fact_value: "2 hours in traffic daily from Flic-en-Flac",
    source: "onboarding",
    confidence: 1,
    user_visible: true,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z"
  }
];

describe("handleOnboardingMessage express flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssignWeeklyFocusForUser.mockImplementation(async (user: { id: string }) => ({
      ...user,
      weekly_focus_habit: "One focused work block without scrolling",
      weekly_focus_set_at: "2026-06-22T00:00:00.000Z"
    }));
    mockIngestUserMindMessage.mockResolvedValue(financeFacts);
    mockLoadUserMindFacts.mockResolvedValue(financeFacts);
    mockResolveKnowYouAcknowledgement.mockImplementation(async (input: { user: { first_name?: string | null } }) => {
      const name = input.user.first_name?.trim() || "there";
      return `${name} — thanks for sharing that with me.`;
    });
    mockSeedLifeThreadsFromOnboarding.mockResolvedValue(0);
    mockListPendingFollowUpsForUser.mockResolvedValue([]);
    mockResetProfileForKnowYouOnboarding.mockResolvedValue(undefined);
    mockGenerateExpressSetupQuestionReply.mockResolvedValue(
      "I picked Money because you mentioned the MCB card — LocalBuzz for Triolet local context, not random templates."
    );
  });

  it("prompts know-you first for short replies", async () => {
    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_know_you" },
      isNewUser: true,
      message: "hi"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Before I track anything");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });

  it("moves know-you submissions to express start preview", async () => {
    mockUpdateUserState.mockResolvedValue({
      ...baseUser,
      first_name: "Vik",
      onboarding_state: "awaiting_express_start"
    });

    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_know_you" },
      isNewUser: true,
      message:
        "I'm 42, working in finance in Ébène. Spend 2 hours in traffic daily from Flic-en-Flac. Running on empty with dad's dementia care on weekends."
    });

    expect(mockResetProfileForKnowYouOnboarding).toHaveBeenCalledWith(baseUser.id);
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      baseUser.id,
      expect.objectContaining({ onboarding_state: "awaiting_express_start" })
    );
    expect(result.reply).toContain("Morning pulse");
    expect(result.reply).toContain("Start my trial");
    expect(result.interactive?.buttons?.[0]?.title).toBe("Start my trial");
  });

  it("adds trust bridge for heavy know-you shares", async () => {
    mockResolveKnowYouAcknowledgement.mockResolvedValue("Vik — that's a lot at once. I hear you.");
    mockUpdateUserState.mockResolvedValue({
      ...baseUser,
      first_name: "Vik",
      onboarding_state: "awaiting_express_start"
    });

    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_know_you" },
      isNewUser: true,
      message:
        "I'm 39, Lower Vale, Tech Lead at Deel. Jeshna's health — waiting on biopsy results. Mum's not great. So much at once. No guilt trips."
    });

    expect(result.reply).toContain("check in gently");
    expect(result.reply).toContain("Morning pulse");
    expect(result.interactive?.buttons?.[0]?.id).toBe("express_start");
  });

  it("activates on start confirmation with inferred setup", async () => {
    const activatedUser = {
      ...baseUser,
      first_name: "Vik",
      onboarding_state: "active" as const,
      archetype: "Corporate / Career",
      active_modules: ["career", "habits"] as const,
      topic_preferences: ["Traffic", "Tech", "Money"],
      trial_started_at: "2026-06-22T00:00:00.000Z",
      trial_ends_at: "2026-06-29T00:00:00.000Z"
    };
    mockUpdateUserState.mockResolvedValue(activatedUser);
    mockAssignWeeklyFocusForUser.mockResolvedValue({
      ...activatedUser,
      weekly_focus_habit: "One focused work block without scrolling"
    });

    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_express_start", first_name: "Vik" },
      isNewUser: false,
      message: "start my trial"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("You're in, Vik");
    expect(result.reply).toContain("7am pulse");
    expect(result.reply).not.toContain("Corporate / Career shapes");
    expect(mockUpdateUserState).toHaveBeenCalledWith(
      baseUser.id,
      expect.objectContaining({
        onboarding_state: "active",
        archetype: "Corporate / Career",
        active_modules: ["career", "habits"],
        topic_preferences: ["Traffic", "Tech", "Money"]
      })
    );
  });

  it("re-prompts express start when confirmation is missing", async () => {
    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_express_start", first_name: "Vik" },
      isNewUser: false,
      message: "wait what"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("ask how I chose");
    expect(result.interactive?.buttons?.[0]?.title).toBe("Start my trial");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });

  it("answers setup questions conversationally instead of replaying the card", async () => {
    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_express_start", first_name: "Vik" },
      isNewUser: false,
      message: "How do you know this or choose this for me?"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("MCB");
    expect(result.reply).not.toContain("here's what I'll set up for you");
    expect(mockGenerateExpressSetupQuestionReply).toHaveBeenCalled();
    expect(result.interactive?.buttons?.[0]?.title).toBe("Start my trial");
    expect(mockUpdateUserState).not.toHaveBeenCalled();
  });

  it("migrates legacy awaiting_archetype users to express start", async () => {
    const result = await handleOnboardingMessage({
      user: { ...baseUser, onboarding_state: "awaiting_archetype" },
      isNewUser: false,
      message: "4"
    });

    expect(result.reply).toContain("Morning pulse");
    expect(result.interactive?.buttons?.[0]?.title).toBe("Start my trial");
  });
});
