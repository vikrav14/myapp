import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateBlinkPaylink = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();
const mockSupabaseInsert = vi.fn();
const mockSupabaseSingle = vi.fn();

vi.mock("../src/lib/env.js", () => ({
  env: {
    SUBSCRIPTION_MONTHLY_PRICE_RS: 200,
    DEFAULT_SUBSCRIPTION_DAYS: 30,
    PAYMENT_RETURN_URL: "https://mauri.example.com/payments/return",
    PAYMENT_CALLBACK_BASE_URL: "https://mauri.example.com",
    BLINK_CALLBACK_TOKEN: "test-blink-token",
    BLINK_PAYLINK_API_URL: "https://api.blinkpayment.co.uk/api/paylink/v1/paylinks"
  }
}));

vi.mock("../src/services/blink-paylink.service.js", () => ({
  isBlinkPaylinkAutomationEnabled: () => true,
  createBlinkPaylink: mockCreateBlinkPaylink
}));

vi.mock("../src/services/audit.service.js", () => ({
  recordAuditEventBestEffort: mockRecordAuditEventBestEffort
}));

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: mockSupabaseInsert
    }))
  }
}));

const { createPaymentCheckoutSession } = await import("../src/services/payment-link.service.js");

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  phone_number: "23052525252",
  first_name: "Ava",
  archetype: "Student Grind",
  onboarding_state: "active" as const,
  subscription_status: "Locked" as const,
  onboarding_completed_at: "2026-01-01T00:00:00.000Z",
  trial_started_at: "2026-01-01T00:00:00.000Z",
  trial_ends_at: "2026-01-01T00:00:00.000Z",
  locked_at: "2026-06-22T00:00:00.000Z",
  subscription_started_at: null,
  subscription_ends_at: null,
  last_payment_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("createPaymentCheckoutSession Blink automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
    mockCreateBlinkPaylink.mockResolvedValue({
      id: "paylink-99",
      paylinkUrl: "https://pay.blinkpayment.co.uk/paylink-99",
      transactionUnique: "mauri:user:11111111-1111-4111-8111-111111111111:abc",
      rawResponse: {
        id: "paylink-99",
        paylink_url: "https://pay.blinkpayment.co.uk/paylink-99"
      }
    });
    mockSupabaseInsert.mockReturnValue({
      select: () => ({
        single: mockSupabaseSingle
      })
    });
    mockSupabaseSingle.mockResolvedValue({
      data: {
        id: "session-blink-1",
        user_id: user.id,
        provider: "BLINK",
        status: "prepared",
        user_reference: `mauri:user:${user.id}`,
        provider_reference: "blink-ref",
        amount: 200,
        currency: "MUR",
        duration_days: 30,
        provider_payload: {},
        provider_endpoint: "https://api.blinkpayment.co.uk/api/paylink/v1/paylinks",
        checkout_url: "https://pay.blinkpayment.co.uk/paylink-99",
        provider_session_id: "paylink-99",
        provider_response: { id: "paylink-99" },
        activated_payment_event_id: null,
        activated_at: null,
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-22T00:00:00.000Z"
      },
      error: null
    });
  });

  it("stores the generated Blink paylink URL on the checkout session", async () => {
    const session = await createPaymentCheckoutSession({
      user,
      provider: "BLINK",
      amount: 200,
      requestId: "req-blink-1"
    });

    expect(mockCreateBlinkPaylink).toHaveBeenCalled();
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "BLINK",
        checkout_url: "https://pay.blinkpayment.co.uk/paylink-99",
        provider_session_id: "paylink-99"
      })
    );
    expect(session.checkout_url).toBe("https://pay.blinkpayment.co.uk/paylink-99");
    expect(session.provider_session_id).toBe("paylink-99");
  });
});
