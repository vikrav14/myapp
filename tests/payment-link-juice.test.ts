import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreatePeachJuiceCheckout = vi.fn();
const mockRecordAuditEventBestEffort = vi.fn();
const mockSupabaseInsert = vi.fn();
const mockSupabaseSingle = vi.fn();

vi.mock("../src/lib/env.js", () => ({
  env: {
    SUBSCRIPTION_MONTHLY_PRICE_RS: 200,
    DEFAULT_SUBSCRIPTION_DAYS: 30,
    PAYMENT_RETURN_URL: "https://mauri.example.com/payments/return",
    PAYMENT_CALLBACK_BASE_URL: "https://mauri.example.com",
    MCB_JUICE_CALLBACK_TOKEN: "test-juice-token",
    PEACH_ENTITY_ID: "test-peach-entity",
    PEACH_CHECKOUT_URL: "https://secure.peachpayments.com/checkout/initiate"
  }
}));

vi.mock("../src/services/peach-checkout.service.js", () => ({
  isPeachJuiceCheckoutAutomationEnabled: () => true,
  createPeachJuiceCheckout: mockCreatePeachJuiceCheckout
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

describe("createPaymentCheckoutSession Juice automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEventBestEffort.mockResolvedValue(undefined);
    mockCreatePeachJuiceCheckout.mockResolvedValue({
      checkoutId: "checkout-99",
      redirectUrl: "https://secure.peachpayments.com/checkout?checkoutId=checkout-99",
      rawResponse: {
        checkoutId: "checkout-99",
        redirectUrl: "https://secure.peachpayments.com/checkout?checkoutId=checkout-99"
      }
    });
    mockSupabaseInsert.mockReturnValue({
      select: () => ({
        single: mockSupabaseSingle
      })
    });
    mockSupabaseSingle.mockResolvedValue({
      data: {
        id: "session-juice-1",
        user_id: user.id,
        provider: "MCB_JUICE",
        status: "prepared",
        user_reference: `mauri:user:${user.id}`,
        provider_reference: "MJABCDEF",
        amount: 200,
        currency: "MUR",
        duration_days: 30,
        provider_payload: {},
        provider_endpoint: "https://secure.peachpayments.com/checkout/initiate",
        checkout_url: "https://secure.peachpayments.com/checkout?checkoutId=checkout-99",
        provider_session_id: "checkout-99",
        provider_response: { checkoutId: "checkout-99" },
        activated_payment_event_id: null,
        activated_at: null,
        created_at: "2026-06-22T00:00:00.000Z",
        updated_at: "2026-06-22T00:00:00.000Z"
      },
      error: null
    });
  });

  it("stores the generated Peach redirect URL on the checkout session", async () => {
    const session = await createPaymentCheckoutSession({
      user,
      provider: "MCB_JUICE",
      amount: 200,
      requestId: "req-juice-1"
    });

    expect(mockCreatePeachJuiceCheckout).toHaveBeenCalled();
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "MCB_JUICE",
        checkout_url: "https://secure.peachpayments.com/checkout?checkoutId=checkout-99",
        provider_session_id: "checkout-99"
      })
    );
    expect(session.checkout_url).toContain("checkoutId=checkout-99");
    expect(session.provider_session_id).toBe("checkout-99");
  });
});
