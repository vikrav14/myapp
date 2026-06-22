import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = {
  BLINK_API_KEY: "test-blink-api-key",
  BLINK_SECRET_KEY: "test-blink-secret-key",
  BLINK_TOKEN_API_URL: "https://api.blinkpayment.co.uk/api/pay/v1/tokens",
  BLINK_PAYLINK_API_URL: "https://api.blinkpayment.co.uk/api/paylink/v1/paylinks",
  PAYMENT_CALLBACK_BASE_URL: "https://mauri.example.com"
};

vi.mock("../src/lib/env.js", () => ({
  env: mockEnv
}));

const { createBlinkPaylink, isBlinkPaylinkAutomationEnabled, resetBlinkTokenCacheForTests } = await import(
  "../src/services/blink-paylink.service.js"
);

describe("blink paylink service", () => {
  beforeEach(() => {
    resetBlinkTokenCacheForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetBlinkTokenCacheForTests();
  });

  it("reports automation enabled when credentials exist", () => {
    expect(isBlinkPaylinkAutomationEnabled()).toBe(true);
  });

  it("creates a paylink using a cached Blink access token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "blink-access-token",
          expired_on: new Date(Date.now() + 60 * 60_000).toISOString()
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "paylink-1",
          paylink_url: "https://pay.blinkpayment.co.uk/paylink-1",
          transaction_unique: "mauri:user:111:abc"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "paylink-2",
          paylink_url: "https://pay.blinkpayment.co.uk/paylink-2",
          transaction_unique: "mauri:user:111:def"
        })
      });

    vi.stubGlobal("fetch", fetchMock);

    const result = await createBlinkPaylink({
      payment_method: ["open-banking"],
      transaction_type: "SALE",
      currency: "MUR",
      amount: 200,
      full_name: "Ava",
      mobile_number: "23052525252",
      transaction_unique: "mauri:user:111:abc"
    });

    expect(result.paylinkUrl).toBe("https://pay.blinkpayment.co.uk/paylink-1");
    expect(result.id).toBe("paylink-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await createBlinkPaylink({
      payment_method: ["open-banking"],
      transaction_type: "SALE",
      currency: "MUR",
      amount: 200,
      full_name: "Ava",
      mobile_number: "23052525252",
      transaction_unique: "mauri:user:111:def"
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.unstubAllGlobals();
  });
});
