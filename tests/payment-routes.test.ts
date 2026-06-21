import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreatePaymentCheckoutSession = vi.fn();
const mockMarkCheckoutSessionActivated = vi.fn();
const mockActivatePaidSubscriptionIdempotent = vi.fn();
const mockResolvePaymentCallbackUser = vi.fn();
const mockFindUserById = vi.fn();
const mockFindUserByPhoneNumber = vi.fn();
const mockSendWhatsAppMessage = vi.fn();

vi.mock("../src/services/payment-link.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/payment-link.service.js")>(
    "../src/services/payment-link.service.js"
  );

  return {
    ...actual,
    createPaymentCheckoutSession: mockCreatePaymentCheckoutSession,
    markCheckoutSessionActivated: mockMarkCheckoutSessionActivated
  };
});

vi.mock("../src/services/payment.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/payment.service.js")>(
    "../src/services/payment.service.js"
  );

  return {
    ...actual,
    activatePaidSubscriptionIdempotent: mockActivatePaidSubscriptionIdempotent,
    resolvePaymentCallbackUser: mockResolvePaymentCallbackUser
  };
});

vi.mock("../src/services/user.service.js", () => ({
  findUserById: mockFindUserById,
  findUserByPhoneNumber: mockFindUserByPhoneNumber
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

const activeUser = {
  id: "22222222-2222-4222-8222-222222222222",
  phone_number: "23057777777",
  first_name: "Mia",
  archetype: "Life & Habit Tracking",
  onboarding_state: "active" as const,
  subscription_status: "Locked" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-01-08T00:00:00.000Z",
  locked_at: "2026-01-09T00:00:00.000Z",
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-09T00:00:00.000Z"
};

describe("Payment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an internal payment checkout session for Blink", async () => {
    mockFindUserById.mockResolvedValue(activeUser);
    mockCreatePaymentCheckoutSession.mockResolvedValue({
      id: "session-1",
      user_id: activeUser.id,
      provider: "BLINK",
      status: "prepared",
      user_reference: `mauri:user:${activeUser.id}`,
      provider_reference: `mauri:user:${activeUser.id}:abc123`,
      amount: 200,
      currency: "MUR",
      duration_days: 30,
      provider_payload: {
        transaction_unique: `mauri:user:${activeUser.id}:abc123`
      },
      provider_endpoint: "https://api.blinkpayment.co.uk/api/paylink/v1/paylinks",
      checkout_url: null,
      provider_session_id: null,
      provider_response: null,
      activated_payment_event_id: null,
      activated_at: null,
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z"
    });

    const app = createApp();
    const response = await request(app)
      .post("/internal/payments/links")
      .set("x-mauri-admin-key", "test-admin-key")
      .send({
        userId: activeUser.id,
        provider: "BLINK",
        amount: 200
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.provider).toBe("BLINK");
    expect(response.body.sessionId).toBe("session-1");
    expect(mockCreatePaymentCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        user: activeUser,
        provider: "BLINK",
        amount: 200
      })
    );
  });

  it("processes a successful Blink webhook callback", async () => {
    mockResolvePaymentCallbackUser.mockResolvedValue(activeUser);
    mockActivatePaidSubscriptionIdempotent.mockResolvedValue({
      user: {
        ...activeUser,
        subscription_status: "Paid_Active" as const,
        subscription_ends_at: "2026-02-09T00:00:00.000Z"
      },
      paymentEvent: {
        id: "payment-event-1"
      },
      wasDuplicate: false
    });

    const app = createApp();
    const response = await request(app)
      .post("/webhooks/payments/blink?token=test-blink-token")
      .send({
        transaction_id: "354792196",
        reference: `mauri:user:${activeUser.id}`,
        amount: "200.00",
        payment_method: "open-banking",
        status: "Paid"
      });

    expect(response.status).toBe(200);
    expect(response.body.accepted).toBe(true);
    expect(response.body.provider).toBe("BLINK");
    expect(mockResolvePaymentCallbackUser).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceCandidates: [expect.stringContaining(activeUser.id)]
      })
    );
    expect(mockActivatePaidSubscriptionIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        user: activeUser,
        provider: "BLINK",
        transactionReference: "354792196",
        amount: 200
      })
    );
    expect(mockMarkCheckoutSessionActivated).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "BLINK",
        paymentEventId: "payment-event-1"
      })
    );
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
      activeUser.phone_number,
      expect.stringContaining("unlocked"),
      expect.objectContaining({
        userId: activeUser.id,
        metadata: expect.objectContaining({
          flow: "blink_callback_confirmation"
        })
      })
    );
  });

  it("rejects a Juice webhook with an invalid Peach signature", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/webhooks/payments/juice?token=test-juice-token")
      .set("content-type", "application/x-www-form-urlencoded")
      .set("x-webhook-timestamp", String(Math.floor(Date.now() / 1000)))
      .set("x-webhook-id", "wh_123")
      .set("x-webhook-signature", "deadbeef")
      .send(
        "result.code=000.100.110&paymentBrand=MCBJUICE&amount=200.00&currency=MUR&checkoutId=ck_123456789"
      );

    expect(response.status).toBe(403);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toBe("invalid_peach_signature");
    expect(mockResolvePaymentCallbackUser).not.toHaveBeenCalled();
    expect(mockActivatePaidSubscriptionIdempotent).not.toHaveBeenCalled();
  });
});
