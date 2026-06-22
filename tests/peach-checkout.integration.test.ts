import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = {
  PEACH_ENTITY_ID: "test-peach-entity",
  PEACH_CHECKOUT_SECRET: "test-peach-checkout-secret",
  PEACH_CHECKOUT_URL: "https://secure.peachpayments.com/checkout/initiate"
};

vi.mock("../src/lib/env.js", () => ({
  env: mockEnv
}));

const { createPeachJuiceCheckout } = await import("../src/services/peach-checkout.service.js");

describe("createPeachJuiceCheckout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a signed checkout initiate request and returns the redirect URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checkoutId: "checkout-1",
        redirectUrl: "https://secure.peachpayments.com/checkout?checkoutId=checkout-1"
      })
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await createPeachJuiceCheckout({
      "authentication.entityId": "test-peach-entity",
      amount: "200.00",
      currency: "MUR",
      paymentType: "DB",
      nonce: "nonce-1",
      shopperResultUrl: "https://mauri.example.com/payments/return",
      merchantTransactionId: "MJABCDEF",
      defaultPaymentMethod: "MCBJUICE",
      forceDefaultMethod: true
    });

    expect(result.redirectUrl).toContain("checkoutId=checkout-1");
    expect(result.checkoutId).toBe("checkout-1");
    expect(fetchMock).toHaveBeenCalledWith(
      mockEnv.PEACH_CHECKOUT_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded"
        })
      })
    );

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("signature=");
    expect(body).toContain("merchantTransactionId=MJABCDEF");

    vi.unstubAllGlobals();
  });
});
