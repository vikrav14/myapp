import { describe, expect, it } from "vitest";

import { signPeachCheckoutParameters } from "../src/services/peach-checkout.service.js";

describe("signPeachCheckoutParameters", () => {
  it("matches Peach HMAC SHA256 signing rules", () => {
    const params = {
      amount: "100.00",
      "authentication.entityId": "entity-123",
      currency: "MUR",
      defaultPaymentMethod: "MCBJUICE",
      forceDefaultMethod: true,
      merchantTransactionId: "MJABCDEF",
      nonce: "nonce-1",
      paymentType: "DB",
      shopperResultUrl: "https://mauri.example.com/payments/return"
    };

    const signature = signPeachCheckoutParameters(params, "test-peach-checkout-secret");

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signature).toBe(signPeachCheckoutParameters(params, "test-peach-checkout-secret"));
  });
});
