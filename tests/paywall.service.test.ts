import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreatePaymentCheckoutSession = vi.fn();
const mockSupabaseFrom = vi.fn();

vi.mock("../src/lib/env.js", () => ({
  env: {
    SUBSCRIPTION_MONTHLY_PRICE_RS: 200,
    DEFAULT_SUBSCRIPTION_DAYS: 30,
    MCB_JUICE_PAYMENT_LINK: "https://pay.example.com/juice",
    BLINK_PAYMENT_LINK: "https://pay.example.com/blink",
    PEACH_ENTITY_ID: "test-peach-entity",
    BLINK_PAYLINK_API_URL: "https://api.blinkpayment.co.uk/api/paylink/v1/paylinks"
  }
}));

vi.mock("../src/services/blink-paylink.service.js", () => ({
  isBlinkPaylinkAutomationEnabled: () => true
}));

vi.mock("../src/services/peach-checkout.service.js", () => ({
  isPeachJuiceCheckoutAutomationEnabled: () => true
}));

vi.mock("../src/services/payment-link.service.js", () => ({
  createPaymentCheckoutSession: mockCreatePaymentCheckoutSession
}));

vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: mockSupabaseFrom
  }
}));

const { buildLockedReplyForUser } = await import("../src/services/paywall.service.js");

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

describe("buildLockedReplyForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreatePaymentCheckoutSession.mockImplementation(async (input: { provider: string }) => {
      if (input.provider === "BLINK") {
        return {
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
          provider_response: null,
          activated_payment_event_id: null,
          activated_at: null,
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-22T00:00:00.000Z"
        };
      }

      if (input.provider === "MCB_JUICE") {
        return {
          id: "session-juice-1",
          user_id: user.id,
          provider: "MCB_JUICE",
          status: "prepared",
          user_reference: "mauri:user:11111111-1111-4111-8111-111111111111",
          provider_reference: "MJABCDEF",
          amount: 200,
          currency: "MUR",
          duration_days: 30,
          provider_payload: {},
          provider_endpoint: "https://secure.peachpayments.com/checkout/initiate",
          checkout_url: "https://secure.peachpayments.com/checkout?checkoutId=checkout-99",
          provider_session_id: "checkout-99",
          provider_response: null,
          activated_payment_event_id: null,
          activated_at: null,
          created_at: "2026-06-22T00:00:00.000Z",
          updated_at: "2026-06-22T00:00:00.000Z"
        };
      }
    });

    mockSupabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
                  })
                })
              })
            })
          })
        })
      })
    });
  });

  it("includes provider links and checkout references", async () => {
    const reply = await buildLockedReplyForUser(user, "req-pay-1");

    expect(reply).toContain("Juice: https://secure.peachpayments.com/checkout?checkoutId=checkout-99");
    expect(reply).toContain("MJABCDEF");
    expect(mockCreatePaymentCheckoutSession).toHaveBeenCalled();
  });

  it("prefers the generated Blink checkout URL over the static fallback", async () => {
    const reply = await buildLockedReplyForUser(user, "req-pay-1");

    expect(reply).toContain("Blink: https://pay.blinkpayment.co.uk/paylink-99");
    expect(reply).not.toContain("https://pay.example.com/blink");
  });
});
