import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: "production" as "development" | "test" | "production",
  PAYMENT_CALLBACK_BASE_URL: "https://mauri.example.com",
  PAYMENT_RETURN_URL: "https://mauri.example.com/payments/return",
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_PHONE_NUMBER_ID: "123456",
  INTERNAL_ADMIN_API_KEY: "secure-admin-key",
  MCB_JUICE_PAYMENT_LINK: undefined as string | undefined,
  BLINK_PAYMENT_LINK: undefined as string | undefined,
  MCB_JUICE_CALLBACK_TOKEN: "juice-token",
  BLINK_CALLBACK_TOKEN: "blink-token",
  PEACH_ENTITY_ID: "peach-entity",
  PEACH_CHECKOUT_SECRET: "peach-secret",
  PEACH_WEBHOOK_SECRET: "peach-webhook-secret",
  BLINK_API_KEY: "blink-key",
  BLINK_SECRET_KEY: "blink-secret",
  TRUST_PROXY: "true",
  ENABLE_SECURITY_HEADERS: true,
  ADMIN_IP_ALLOWLIST: "203.0.113.10/32",
  PAYMENT_WEBHOOK_IP_ALLOWLIST: "198.51.100.0/24",
  WHATSAPP_WEBHOOK_IP_ALLOWLIST: "192.0.2.0/24",
  METRICS_IP_ALLOWLIST: "203.0.113.10/32"
}));

vi.mock("../src/lib/env.js", () => ({
  env: mockEnv
}));

const { buildPublicWebhookUrl, getDeployPreflightReport } = await import("../src/lib/deploy-preflight.js");

describe("deploy preflight", () => {
  beforeEach(() => {
    mockEnv.NODE_ENV = "production";
    mockEnv.PAYMENT_CALLBACK_BASE_URL = "https://mauri.example.com";
    mockEnv.PAYMENT_RETURN_URL = "https://mauri.example.com/payments/return";
    mockEnv.WHATSAPP_ACCESS_TOKEN = "wa-token";
    mockEnv.WHATSAPP_PHONE_NUMBER_ID = "123456";
    mockEnv.INTERNAL_ADMIN_API_KEY = "secure-admin-key";
    mockEnv.MCB_JUICE_PAYMENT_LINK = undefined;
    mockEnv.BLINK_PAYMENT_LINK = undefined;
    mockEnv.MCB_JUICE_CALLBACK_TOKEN = "juice-token";
    mockEnv.BLINK_CALLBACK_TOKEN = "blink-token";
    mockEnv.PEACH_ENTITY_ID = "peach-entity";
    mockEnv.PEACH_CHECKOUT_SECRET = "peach-secret";
    mockEnv.PEACH_WEBHOOK_SECRET = "peach-webhook-secret";
    mockEnv.BLINK_API_KEY = "blink-key";
    mockEnv.BLINK_SECRET_KEY = "blink-secret";
    mockEnv.TRUST_PROXY = "true";
    mockEnv.ENABLE_SECURITY_HEADERS = true;
    mockEnv.ADMIN_IP_ALLOWLIST = "203.0.113.10/32";
    mockEnv.PAYMENT_WEBHOOK_IP_ALLOWLIST = "198.51.100.0/24";
    mockEnv.WHATSAPP_WEBHOOK_IP_ALLOWLIST = "192.0.2.0/24";
    mockEnv.METRICS_IP_ALLOWLIST = "203.0.113.10/32";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds public webhook URLs from the callback base", () => {
    expect(buildPublicWebhookUrl("/webhooks/whatsapp")).toBe("https://mauri.example.com/webhooks/whatsapp");
  });

  it("passes when production payment and security settings are configured", () => {
    const report = getDeployPreflightReport();

    expect(report.ready).toBe(true);
    expect(report.paymentProviders.peachJuiceAutomation).toBe(true);
    expect(report.paymentProviders.blinkAutomation).toBe(true);
    expect(report.webhookUrls.whatsapp).toBe("https://mauri.example.com/webhooks/whatsapp");
    expect(report.webhookUrls.juiceCallback).toBe(
      "https://mauri.example.com/webhooks/payments/juice?token=juice-token"
    );
    expect(report.webhookUrls.blinkCallback).toBe(
      "https://mauri.example.com/webhooks/payments/blink?token=blink-token"
    );
  });

  it("fails when the public callback base URL is missing", () => {
    mockEnv.PAYMENT_CALLBACK_BASE_URL = undefined;

    const report = getDeployPreflightReport();

    expect(report.ready).toBe(false);
    expect(report.checks.some((check) => check.key === "payment_callback_base_url" && check.status === "error")).toBe(
      true
    );
  });

  it("warns when only manual payment links are configured", () => {
    mockEnv.PEACH_ENTITY_ID = undefined;
    mockEnv.PEACH_CHECKOUT_SECRET = undefined;
    mockEnv.BLINK_API_KEY = undefined;
    mockEnv.BLINK_SECRET_KEY = undefined;
    mockEnv.MCB_JUICE_PAYMENT_LINK = "https://pay.example.com/juice";
    mockEnv.BLINK_PAYMENT_LINK = "https://pay.example.com/blink";

    const report = getDeployPreflightReport();

    expect(report.ready).toBe(true);
    expect(report.paymentProviders.peachJuiceAutomation).toBe(false);
    expect(report.paymentProviders.blinkAutomation).toBe(false);
    expect(report.paymentProviders.manualJuiceLink).toBe(true);
    expect(report.paymentProviders.manualBlinkLink).toBe(true);
    expect(report.checks.some((check) => check.key === "peach_juice_checkout" && check.status === "warning")).toBe(
      true
    );
    expect(report.checks.some((check) => check.key === "blink_paylink" && check.status === "warning")).toBe(true);
  });
});
