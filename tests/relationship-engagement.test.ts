import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHasEngagementDelivery = vi.fn();
const mockRecordEngagementDelivery = vi.fn();
const mockCanSendProactiveOutbound = vi.fn();
const mockRecordProactivePing = vi.fn();
const mockSendWhatsAppMessage = vi.fn();
const mockSendMauriReply = vi.fn();
const mockLoadUserMindFacts = vi.fn();
const mockGetUserMindSnapshot = vi.fn();
const mockGenerateTierOneDeepenReply = vi.fn();

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
              }))
            }))
          }))
        }))
      })),
      insert: vi.fn().mockResolvedValue({ error: null })
    }))
  }
}));

vi.mock("../src/services/engagement-delivery.service.js", () => ({
  hasEngagementDelivery: mockHasEngagementDelivery,
  recordEngagementDelivery: mockRecordEngagementDelivery
}));

vi.mock("../src/services/outbound-pace.service.js", () => ({
  canSendProactiveOutbound: mockCanSendProactiveOutbound,
  recordProactivePing: mockRecordProactivePing
}));

vi.mock("../src/services/user-mind.service.js", () => ({
  loadUserMindFacts: mockLoadUserMindFacts
}));

vi.mock("../src/services/user-mind-snapshot.service.js", () => ({
  getUserMindSnapshot: mockGetUserMindSnapshot
}));

vi.mock("../src/services/ai.service.js", () => ({
  generateTierOneDeepenReply: mockGenerateTierOneDeepenReply
}));

vi.mock("../src/services/whatsapp.service.js", () => ({
  sendWhatsAppMessage: mockSendWhatsAppMessage,
  sendMauriReply: mockSendMauriReply
}));

const {
  buildEveningRelationshipPing,
  handleMorningMoodMessage,
  handleTierOneDeepenMessage,
  isTierOneReliefMessage,
  parseMorningMoodReply
} = await import("../src/services/relationship-engagement.service.js");

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Vik",
  archetype: "Life & Habit Tracking" as const,
  brief_focus: null,
  active_modules: ["habits"] as const,
  onboarding_state: "active" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: new Date().toISOString(),
  trial_started_at: new Date().toISOString(),
  trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  topic_preferences: [],
  morning_digest_enabled: true,
  weekly_focus_habit: "Morning check-in: mood plus one small win.",
  open_loop_followups_enabled: true,
  memory_resurfacing_enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start_hour: 22,
  quiet_hours_end_hour: 7,
  proactive_checkins_paused_until: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("relationship engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasEngagementDelivery.mockResolvedValue(false);
    mockRecordEngagementDelivery.mockResolvedValue(undefined);
    mockLoadUserMindFacts.mockResolvedValue([
      {
        id: "f1",
        user_id: activeUser.id,
        category: "stressors",
        fact_key: "money",
        fact_value: "Struggling with money as a painter",
        source: "onboarding",
        confidence: 1,
        user_visible: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      }
    ]);
    mockGenerateTierOneDeepenReply.mockResolvedValue(
      "Glad it landed, Vik. What's still heaviest — money or the career change idea?"
    );
  });

  it("builds an evening ping tied to the user's thread", () => {
    const message = buildEveningRelationshipPing({
      firstName: "Vik",
      threadSnippet: "career change and money pressure"
    });

    expect(message.toLowerCase()).toContain("separate from this morning");
    expect(message).toContain("brain dump");
    expect(message).toContain("not now");
  });

  it("parses morning mood taps", () => {
    expect(parseMorningMoodReply("mood 4")).toBe(4);
    expect(parseMorningMoodReply("hello")).toBeNull();
  });

  it("detects tier-1 relief messages", () => {
    expect(isTierOneReliefMessage("Noted. Thank you for making me feel better.")).toBe(true);
    expect(isTierOneReliefMessage("remind me to gym")).toBe(false);
  });

  it("deepens once after a tier-1 relief message", async () => {
    const first = await handleTierOneDeepenMessage({
      user: activeUser,
      message: "Thank you for making me feel better."
    });

    expect(first.handled).toBe(true);
    expect(first.reply).toContain("Glad it landed");
    expect(mockRecordEngagementDelivery).toHaveBeenCalled();

    mockHasEngagementDelivery.mockResolvedValue(true);

    const second = await handleTierOneDeepenMessage({
      user: activeUser,
      message: "Thanks again"
    });

    expect(second.handled).toBe(false);
  });

  it("logs morning mood replies", async () => {
    const result = await handleMorningMoodMessage({
      user: activeUser,
      message: "mood 3"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("3/5");
    expect(mockRecordEngagementDelivery).toHaveBeenCalled();
  });
});
