import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHasEngagementDelivery = vi.fn();
const mockRecordEngagementDelivery = vi.fn();
const mockFindOutboundByProviderMessageId = vi.fn();
const mockFindRecentActivationOutboundForUser = vi.fn();
const mockSendWhatsAppMessage = vi.fn();
const mockSendWhatsAppSticker = vi.fn();
const mockDeliverWhatsAppReaction = vi.fn();
const mockResolveLockedInStickerUrl = vi.fn();

vi.mock("../src/services/engagement-delivery.service.js", () => ({
  hasEngagementDelivery: mockHasEngagementDelivery,
  recordEngagementDelivery: mockRecordEngagementDelivery
}));

vi.mock("../src/services/outbound-message.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/outbound-message.service.js")>(
    "../src/services/outbound-message.service.js"
  );

  return {
    ...actual,
    findOutboundByProviderMessageId: mockFindOutboundByProviderMessageId,
    findRecentActivationOutboundForUser: mockFindRecentActivationOutboundForUser
  };
});

vi.mock("../src/services/rich-media.service.js", () => ({
  resolveLockedInStickerUrl: mockResolveLockedInStickerUrl
}));

vi.mock("../src/services/whatsapp.service.js", () => ({
  sendWhatsAppMessage: mockSendWhatsAppMessage,
  sendWhatsAppSticker: mockSendWhatsAppSticker,
  deliverWhatsAppReaction: mockDeliverWhatsAppReaction
}));

const {
  ACTIVATION_REACTION_ACK_KEY,
  HELP_FOCUS_REACTION_ACK_KEY,
  MAURI_POSITIVE_REACTION_EMOJI,
  buildActivationReactionAck,
  buildHelpFocusReactionAck,
  deliverInboundReactionAck,
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
  help_focus_primary: "productivity",
  help_focus_secondary: "relationship",
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
    mockSendWhatsAppSticker.mockResolvedValue(true);
    mockResolveLockedInStickerUrl.mockReturnValue("https://mauri.example/media/locked-in-sticker.webp");
    mockDeliverWhatsAppReaction.mockResolvedValue(undefined);
  });

  it("detects positive activation reactions", () => {
    expect(isPositiveActivationReaction("👍")).toBe(true);
    expect(isPositiveActivationReaction("👎")).toBe(false);
  });

  it("builds fallback text for sticker delivery", () => {
    expect(buildActivationReactionAck("Vik")).toContain("Perfect, Vik");
    expect(buildHelpFocusReactionAck(activeUser)).toContain("Productivity + Relationship");
  });

  it("uses sticker mode on first activation reaction", async () => {
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
    expect(first.mode).toBe("sticker");
    expect(mockRecordEngagementDelivery).toHaveBeenCalledWith(activeUser.id, ACTIVATION_REACTION_ACK_KEY);

    await deliverInboundReactionAck({
      user: activeUser,
      phoneNumber: activeUser.phone_number,
      targetMessageId: "wamid-activation",
      result: first
    });

    expect(mockDeliverWhatsAppReaction).toHaveBeenCalledWith({
      to: activeUser.phone_number,
      messageId: "wamid-activation",
      emoji: MAURI_POSITIVE_REACTION_EMOJI
    });
    expect(mockSendWhatsAppSticker).toHaveBeenCalled();
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("reacts only on repeat advice-focus reactions", async () => {
    mockHasEngagementDelivery.mockResolvedValue(true);
    mockFindOutboundByProviderMessageId.mockResolvedValue({
      body: "[interactive:list] Vik — for advice I'm leaning into Productivity + Relationship.",
      metadata: {
        flow: "help_focus",
        interactive: true,
        interactive_payload: { header: "Advice focus", body: "Pick lane" },
        provider_message_id: "wamid-help-focus"
      }
    });

    const result = await handleActivationReactionMessage({
      user: activeUser,
      emoji: "👍",
      targetMessageId: "wamid-help-focus"
    });

    expect(result.handled).toBe(true);
    expect(result.mode).toBe("repeat");
    expect(result.reply).toBeUndefined();

    await deliverInboundReactionAck({
      user: activeUser,
      phoneNumber: activeUser.phone_number,
      targetMessageId: "wamid-help-focus",
      result
    });

    expect(mockDeliverWhatsAppReaction).toHaveBeenCalled();
    expect(mockSendWhatsAppSticker).not.toHaveBeenCalled();
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("locks advice lane with sticker on first help-focus reaction", async () => {
    mockFindOutboundByProviderMessageId.mockResolvedValue({
      body: "[interactive:list] Vik — for advice I'm leaning into Productivity + Relationship.",
      metadata: {
        flow: "help_focus",
        interactive: true,
        interactive_payload: {
          header: "Advice focus",
          body: "Vik — for advice I'm leaning into Productivity + Relationship."
        },
        provider_message_id: "wamid-help-focus"
      }
    });

    const result = await handleActivationReactionMessage({
      user: activeUser,
      emoji: "👍",
      targetMessageId: "wamid-help-focus"
    });

    expect(result.handled).toBe(true);
    expect(result.mode).toBe("sticker");
    expect(mockRecordEngagementDelivery).toHaveBeenCalledWith(activeUser.id, HELP_FOCUS_REACTION_ACK_KEY);
  });

  it("falls back to text when sticker delivery fails", async () => {
    mockSendWhatsAppSticker.mockResolvedValue(false);
    mockFindOutboundByProviderMessageId.mockResolvedValue({
      body: "[interactive:buttons] Vik — happy with that advice lane, or want to switch?",
      metadata: {
        flow: "express_activation",
        interactive: true,
        interactive_payload: { header: "Advice focus", body: "Pick lane" },
        provider_message_id: "wamid-help-focus"
      }
    });

    const result = await handleActivationReactionMessage({
      user: activeUser,
      emoji: "👍",
      targetMessageId: "wamid-help-focus"
    });

    await deliverInboundReactionAck({
      user: activeUser,
      phoneNumber: activeUser.phone_number,
      targetMessageId: "wamid-help-focus",
      result
    });

    expect(mockSendWhatsAppSticker).toHaveBeenCalled();
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
      activeUser.phone_number,
      expect.stringContaining("Locked in, Vik"),
      expect.any(Object)
    );
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
