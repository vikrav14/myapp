import { env } from "./env.js";
import { getSecurityPostureSummary } from "./network-security.js";
import { isBlinkPaylinkAutomationEnabled } from "../services/blink-paylink.service.js";
import { isPeachJuiceCheckoutAutomationEnabled } from "../services/peach-checkout.service.js";

export type DeployPreflightStatus = "ok" | "warning" | "error";

export interface DeployPreflightCheck {
  key: string;
  label: string;
  status: DeployPreflightStatus;
  message: string;
}

export interface DeployPreflightReport {
  ready: boolean;
  environment: string;
  publicBaseUrl: string | null;
  webhookUrls: {
    whatsapp: string | null;
    juiceCallback: string | null;
    blinkCallback: string | null;
  };
  paymentProviders: {
    peachJuiceAutomation: boolean;
    blinkAutomation: boolean;
    manualJuiceLink: boolean;
    manualBlinkLink: boolean;
  };
  securityWarnings: string[];
  checks: DeployPreflightCheck[];
}

const DEFAULT_ADMIN_KEY = "change-this-for-server-to-server-payment-confirmation";

function pushCheck(
  checks: DeployPreflightCheck[],
  input: DeployPreflightCheck
): void {
  checks.push(input);
}

function isHttpsUrl(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("https://");
}

export function buildPublicWebhookUrl(path: string): string | null {
  if (!env.PAYMENT_CALLBACK_BASE_URL?.trim()) {
    return null;
  }

  const base = env.PAYMENT_CALLBACK_BASE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildProviderNotificationUrl(provider: "MCB_JUICE" | "BLINK"): string | null {
  const path = provider === "MCB_JUICE" ? "/webhooks/payments/juice" : "/webhooks/payments/blink";
  const url = buildPublicWebhookUrl(path);
  if (!url) {
    return null;
  }

  const token = provider === "MCB_JUICE" ? env.MCB_JUICE_CALLBACK_TOKEN : env.BLINK_CALLBACK_TOKEN;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export function getDeployPreflightReport(): DeployPreflightReport {
  const checks: DeployPreflightCheck[] = [];
  const publicBaseUrl = env.PAYMENT_CALLBACK_BASE_URL?.trim() || null;
  const security = getSecurityPostureSummary();

  if (env.NODE_ENV !== "production") {
    pushCheck(checks, {
      key: "node_env",
      label: "NODE_ENV",
      status: "warning",
      message: `Running as ${env.NODE_ENV}. Set NODE_ENV=production on the live service.`
    });
  } else {
    pushCheck(checks, {
      key: "node_env",
      label: "NODE_ENV",
      status: "ok",
      message: "Production mode enabled."
    });
  }

  if (!publicBaseUrl) {
    pushCheck(checks, {
      key: "payment_callback_base_url",
      label: "PAYMENT_CALLBACK_BASE_URL",
      status: "error",
      message: "Set to your public HTTPS service URL, e.g. https://mauri-backend.onrender.com"
    });
  } else if (!isHttpsUrl(publicBaseUrl)) {
    pushCheck(checks, {
      key: "payment_callback_base_url",
      label: "PAYMENT_CALLBACK_BASE_URL",
      status: "error",
      message: "Must use HTTPS in production."
    });
  } else {
    pushCheck(checks, {
      key: "payment_callback_base_url",
      label: "PAYMENT_CALLBACK_BASE_URL",
      status: "ok",
      message: publicBaseUrl
    });
  }

  if (!env.PAYMENT_RETURN_URL?.trim()) {
    pushCheck(checks, {
      key: "payment_return_url",
      label: "PAYMENT_RETURN_URL",
      status: "warning",
      message: "Set a post-checkout return URL shown to users after payment."
    });
  } else if (env.NODE_ENV === "production" && !isHttpsUrl(env.PAYMENT_RETURN_URL)) {
    pushCheck(checks, {
      key: "payment_return_url",
      label: "PAYMENT_RETURN_URL",
      status: "warning",
      message: "Return URL should use HTTPS."
    });
  } else {
    pushCheck(checks, {
      key: "payment_return_url",
      label: "PAYMENT_RETURN_URL",
      status: "ok",
      message: env.PAYMENT_RETURN_URL
    });
  }

  if (!env.WHATSAPP_ACCESS_TOKEN?.trim() || !env.WHATSAPP_PHONE_NUMBER_ID?.trim()) {
    pushCheck(checks, {
      key: "whatsapp_delivery",
      label: "WhatsApp delivery",
      status: "error",
      message: "Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID for outbound messages."
    });
  } else {
    pushCheck(checks, {
      key: "whatsapp_delivery",
      label: "WhatsApp delivery",
      status: "ok",
      message: "WhatsApp send credentials configured."
    });
  }

  if (!env.INTERNAL_ADMIN_API_KEY?.trim()) {
    pushCheck(checks, {
      key: "internal_admin_api_key",
      label: "INTERNAL_ADMIN_API_KEY",
      status: "error",
      message: "Required for admin panel and internal payment/report routes."
    });
  } else if (env.INTERNAL_ADMIN_API_KEY === DEFAULT_ADMIN_KEY) {
    pushCheck(checks, {
      key: "internal_admin_api_key",
      label: "INTERNAL_ADMIN_API_KEY",
      status: "error",
      message: "Rotate away from the default example value before production traffic."
    });
  } else {
    pushCheck(checks, {
      key: "internal_admin_api_key",
      label: "INTERNAL_ADMIN_API_KEY",
      status: "ok",
      message: "Custom admin key configured."
    });
  }

  const peachAutomation = isPeachJuiceCheckoutAutomationEnabled();
  if (peachAutomation) {
    pushCheck(checks, {
      key: "peach_juice_checkout",
      label: "MCB Juice / Peach checkout",
      status: "ok",
      message: "PEACH_ENTITY_ID and PEACH_CHECKOUT_SECRET are configured."
    });
  } else {
    pushCheck(checks, {
      key: "peach_juice_checkout",
      label: "MCB Juice / Peach checkout",
      status: env.MCB_JUICE_PAYMENT_LINK?.trim() ? "warning" : "error",
      message: env.MCB_JUICE_PAYMENT_LINK?.trim()
        ? "Manual Juice link fallback only. Set PEACH_ENTITY_ID and PEACH_CHECKOUT_SECRET for auto checkout."
        : "Configure Peach checkout credentials or MCB_JUICE_PAYMENT_LINK."
    });
  }

  if (!env.PEACH_WEBHOOK_SECRET?.trim()) {
    pushCheck(checks, {
      key: "peach_webhook_secret",
      label: "PEACH_WEBHOOK_SECRET",
      status: env.NODE_ENV === "production" ? "error" : "warning",
      message: "Required to verify signed Juice/Peach payment webhooks."
    });
  } else {
    pushCheck(checks, {
      key: "peach_webhook_secret",
      label: "PEACH_WEBHOOK_SECRET",
      status: "ok",
      message: "Peach webhook signature verification enabled."
    });
  }

  if (!env.MCB_JUICE_CALLBACK_TOKEN?.trim()) {
    pushCheck(checks, {
      key: "juice_callback_token",
      label: "MCB_JUICE_CALLBACK_TOKEN",
      status: "warning",
      message: "Recommended shared token for /webhooks/payments/juice."
    });
  } else {
    pushCheck(checks, {
      key: "juice_callback_token",
      label: "MCB_JUICE_CALLBACK_TOKEN",
      status: "ok",
      message: "Juice callback token configured."
    });
  }

  const blinkAutomation = isBlinkPaylinkAutomationEnabled();
  if (blinkAutomation) {
    pushCheck(checks, {
      key: "blink_paylink",
      label: "Blink paylink automation",
      status: "ok",
      message: "BLINK_API_KEY and BLINK_SECRET_KEY are configured."
    });
  } else {
    pushCheck(checks, {
      key: "blink_paylink",
      label: "Blink paylink automation",
      status: env.BLINK_PAYMENT_LINK?.trim() ? "warning" : "error",
      message: env.BLINK_PAYMENT_LINK?.trim()
        ? "Manual Blink link fallback only. Set BLINK_API_KEY and BLINK_SECRET_KEY for auto paylinks."
        : "Configure Blink API credentials or BLINK_PAYMENT_LINK."
    });
  }

  if (!env.BLINK_CALLBACK_TOKEN?.trim()) {
    pushCheck(checks, {
      key: "blink_callback_token",
      label: "BLINK_CALLBACK_TOKEN",
      status: "warning",
      message: "Recommended shared token for /webhooks/payments/blink."
    });
  } else {
    pushCheck(checks, {
      key: "blink_callback_token",
      label: "BLINK_CALLBACK_TOKEN",
      status: "ok",
      message: "Blink callback token configured."
    });
  }

  for (const warning of security.warnings) {
    const status: DeployPreflightStatus = env.NODE_ENV === "production" ? "error" : "warning";
    pushCheck(checks, {
      key: `security_${checks.length}`,
      label: "Security posture",
      status,
      message: warning
    });
  }

  if (security.warnings.length === 0) {
    pushCheck(checks, {
      key: "security_posture",
      label: "Security posture",
      status: "ok",
      message: "IP allowlists, trust proxy, and webhook hardening look configured."
    });
  }

  const ready = checks.every((check) => check.status !== "error");

  return {
    ready,
    environment: env.NODE_ENV,
    publicBaseUrl,
    webhookUrls: {
      whatsapp: buildPublicWebhookUrl("/webhooks/whatsapp"),
      juiceCallback: buildProviderNotificationUrl("MCB_JUICE"),
      blinkCallback: buildProviderNotificationUrl("BLINK")
    },
    paymentProviders: {
      peachJuiceAutomation: peachAutomation,
      blinkAutomation,
      manualJuiceLink: Boolean(env.MCB_JUICE_PAYMENT_LINK?.trim()),
      manualBlinkLink: Boolean(env.BLINK_PAYMENT_LINK?.trim())
    },
    securityWarnings: security.warnings,
    checks
  };
}
