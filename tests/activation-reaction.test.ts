import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHasEngagementDelivery = vi.fn();
const mockRecordEngagementDelivery = vi.fn();
const mockFindOutboundByProviderMessageId = vi.fn();
const mockFindRecentActivationOutboundForUser = vi.fn();
const mockSendWhatsAppMessage = vi.fn();

vi.mock("../src/services/engagement-delivery.service.js", () => ({
  hasEngagementDelivery: mockHasEngagementDelivery,
  recordEngagementDelivery: mockRecordEngagementDelivery
}));

vi.mock("../src/services/outbound-message.service.js", () => ({
  findOutboundByProviderMessageId: mockFindOutboundByProviderMessageId,
  findRecentActivationOutboundForUser: mockFindRecentActivationOutboundForUser,
  isActivationOutboundMessage: (record: { body: string; metadata?: { flow?: string } | null }) =>
    record.metadata?.flow === "express_activation" || record.body.startsWith("You're in,")
}));

vi.mock("../src/services/whatsapp.service.js", () => ({
  sendWhatsAppMessage: mockSendWhatsAppMessage
}));

const {
  ACTIVATION_REACTION_ACK_KEY,
  buildActivationReactionAck,
  handleActivationReactionMessage,
  isPositiveActivationReaction
} = await import("../src/services/activation-reaction.service.js");

const activeUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Vik",
  archetype: "Life & Habit Tracking" as const,
  brief_focus: null,
  active_modules: [] as const,
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
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("activation reaction ack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasEngagementDelivery.mockResolvedValue(false);
    mockRecordEngagementDelivery.mockResolvedValue(undefined);
    mockFindOutboundByProviderMessageId.mockResolvedValue(null);
    mockFindRecentActivationOutboundForUser.mockResolvedValue(null);
  });

  it("detects positive activation reactions", () => {
    expect(isPositiveActivationReaction("👍")).toBe(true);
    expect(isPositiveActivationReaction("👎")).toBe(false);
  });

  it("builds a warm one-line ack", () => {
    expect(buildActivationReactionAck("Vik")).toContain("Perfect, Vik");
    expect(buildActivationReactionAck("Vik")).toContain("tomorrow at 7");
  });

  it("sends ack once when reaction targets activation message", async () => {
    mockFindOutboundByProviderMessageId.mockResolvedValue({
      body: "You're in, Vik ✌️",
      metadata: { flow: "express_activation", provider_message_id: "wamid-activation" }
    });

    const first = await handleActivationReactionMessage({
      user: activeUser,
      emoji: "👍",
      targetMessageId: "wamid-activation"
    });

    expect(first.handled).toBe(true);
    expect(first.reply).toContain("Perfect, Vik");
    expect(mockRecordEngagementDelivery).toHaveBeenCalledWith(activeUser.id, ACTIVATION_REACTION_ACK_KEY);

    mockHasEngagementDelivery.mockResolvedValue(true);

    const second = await handleActivationReactionMessage({
      user: activeUser,
      emoji: "👍",
      targetMessageId: "wamid-activation"
    });

    expect(second.handled).toBe(true);
    expect(second.reply).toBeUndefined();
  });

  it("falls back to recent activation within the onboarding window", async () => {
    mockFindRecentActivationOutboundForUser.mockResolvedValue({
      body: "You're in, Vik ✌️",
      metadata: { flow: "express_activation" }
    });

    const result = await handleActivationReactionMessage({
      user: activeUser,
      emoji: "👍",
      targetMessageId: "wamid-unknown"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toBeDefined();
  });

  it("ignores reactions for non-active users", async () => {
    const result = await handleActivationReactionMessage({
      user: { ...activeUser, onboarding_state: "awaiting_express_start" },
      emoji: "👍",
      targetMessageId: "wamid-activation"
    });

    expect(result.handled).toBe(false);
    expect(mockRecordEngagementDelivery).not.toHaveBeenCalled();
  });
});
