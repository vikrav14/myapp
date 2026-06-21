import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExtractStructuredContext = vi.fn();
const mockGenerateConversationalReply = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();
const mockLoadUserContext = vi.fn();
const mockPersistExtraction = vi.fn();
const mockStoreConversationMemory = vi.fn();
const mockEnforceAccessPolicy = vi.fn();
const mockHandleOnboardingMessage = vi.fn();
const mockGetOrCreateUser = vi.fn();
const mockResolveInboundMessageText = vi.fn();
const mockSendWhatsAppMessage = vi.fn();

vi.mock("../src/services/ai.service.js", () => ({
  extractStructuredContext: mockExtractStructuredContext,
  generateConversationalReply: mockGenerateConversationalReply
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

vi.mock("../src/services/context.service.js", () => ({
  loadUserContext: mockLoadUserContext
}));

vi.mock("../src/services/logging.service.js", () => ({
  persistExtraction: mockPersistExtraction
}));

vi.mock("../src/services/memory.service.js", () => ({
  storeConversationMemory: mockStoreConversationMemory
}));

vi.mock("../src/services/onboarding.service.js", () => ({
  enforceAccessPolicy: mockEnforceAccessPolicy,
  handleOnboardingMessage: mockHandleOnboardingMessage
}));

vi.mock("../src/services/user.service.js", () => ({
  getOrCreateUser: mockGetOrCreateUser
}));

vi.mock("../src/services/voice-note.service.js", () => ({
  resolveInboundMessageText: mockResolveInboundMessageText
}));

vi.mock("../src/services/whatsapp.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/whatsapp.service.js")>(
    "../src/services/whatsapp.service.js"
  );

  return {
    ...actual,
    sendWhatsAppMessage: mockSendWhatsAppMessage
  };
});

const { createApp } = await import("../src/app.js");

const baseUser = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Life & Habit Tracking",
  onboarding_state: "awaiting_archetype" as const,
  subscription_status: "Trial_Active" as const,
  onboarding_completed_at: null,
  trial_started_at: null,
  trial_ends_at: null,
  locked_at: null,
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("WhatsApp webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the onboarding reply for a new user awaiting archetype", async () => {
    mockGetOrCreateUser.mockResolvedValue({
      user: baseUser,
      isNewUser: true
    });
    mockEnforceAccessPolicy.mockResolvedValue({
      handled: false,
      user: baseUser
    });
    mockResolveInboundMessageText.mockResolvedValue({
      messageText: "hello mauri"
    });
    mockHandleOnboardingMessage.mockResolvedValue({
      handled: true,
      user: baseUser,
      reply: "Pick the vibe that fits you best."
    });

    const app = createApp();
    const response = await request(app)
      .post("/webhooks/whatsapp")
      .send({ from: baseUser.phone_number, text: "hello mauri", profileName: "Ava" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.replyPreview).toContain("Pick the vibe");
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
      baseUser.phone_number,
      "Pick the vibe that fits you best.",
      expect.objectContaining({
        userId: baseUser.id,
        metadata: expect.objectContaining({
          flow: "onboarding",
          sourceType: "text"
        })
      })
    );
    expect(mockExtractStructuredContext).not.toHaveBeenCalled();
  });

  it("processes a normal conversational message end-to-end", async () => {
    const activeUser = {
      ...baseUser,
      onboarding_state: "active" as const,
      trial_started_at: "2026-01-01T00:00:00.000Z",
      trial_ends_at: "2026-01-08T00:00:00.000Z"
    };

    mockGetOrCreateUser.mockResolvedValue({
      user: activeUser,
      isNewUser: false
    });
    mockEnforceAccessPolicy.mockResolvedValue({
      handled: false,
      user: activeUser
    });
    mockResolveInboundMessageText.mockResolvedValue({
      messageText: "I spent 150 on food and studied for 90 minutes"
    });
    mockHandleOnboardingMessage.mockResolvedValue({
      handled: false,
      user: activeUser
    });
    mockLoadUserContext.mockResolvedValue({
      pendingTodos: [],
      recentFinance: [],
      recentHabits: [],
      recentEmotions: [],
      semanticMemories: []
    });
    mockExtractStructuredContext.mockResolvedValue({
      finance: {
        amount: 150,
        category: "Food",
        raw_source_text: "I spent 150 on food"
      },
      habits: {
        activity_type: "Study_Deep_Work",
        duration_minutes: 90,
        is_success: true
      }
    });
    mockGenerateConversationalReply.mockResolvedValue("Good. You logged both progress and spending clearly.");

    const app = createApp();
    const response = await request(app)
      .post("/webhooks/whatsapp")
      .send({ from: activeUser.phone_number, text: "I spent 150 on food and studied for 90 minutes" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.extraction.finance.amount).toBe(150);
    expect(response.body.replyPreview).toContain("Good.");
    expect(mockLoadUserContext).toHaveBeenCalledWith(activeUser.id, expect.any(String));
    expect(mockPersistExtraction).toHaveBeenCalledWith(
      activeUser.id,
      expect.objectContaining({
        finance: expect.objectContaining({ amount: 150 })
      })
    );
    expect(mockStoreConversationMemory).toHaveBeenCalledTimes(2);
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
      activeUser.phone_number,
      "Good. You logged both progress and spending clearly.",
      expect.objectContaining({
        userId: activeUser.id,
        metadata: expect.objectContaining({
          flow: "conversational_reply"
        })
      })
    );
    expect(mockRecordAuditEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "inbound_message_processed",
        userId: activeUser.id
      })
    );
  });
});
