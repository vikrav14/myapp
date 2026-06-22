import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

interface BlinkTokenCache {
  accessToken: string;
  expiresAtMs: number;
}

let tokenCache: BlinkTokenCache | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function resetBlinkTokenCacheForTests(): void {
  tokenCache = null;
}

function blinkCredentialsConfigured(): boolean {
  return Boolean(env.BLINK_API_KEY?.trim() && env.BLINK_SECRET_KEY?.trim());
}

export function isBlinkPaylinkAutomationEnabled(): boolean {
  return blinkCredentialsConfigured();
}

async function getBlinkAccessToken(): Promise<string> {
  if (!blinkCredentialsConfigured()) {
    throw new Error("Blink API credentials are not configured.");
  }

  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const response = await fetch(env.BLINK_TOKEN_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      api_key: env.BLINK_API_KEY,
      secret_key: env.BLINK_SECRET_KEY,
      application_name: "Mauri Backend",
      application_description: "Mauri WhatsApp premium checkout",
      source_site: env.PAYMENT_CALLBACK_BASE_URL ?? "mauri-backend"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Blink token request failed with status ${response.status}: ${body}`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.access_token !== "string" || !payload.access_token.trim()) {
    throw new Error("Blink token response did not include access_token.");
  }

  const expiredOn =
    typeof payload.expired_on === "string" ? Date.parse(payload.expired_on) : Date.now() + 30 * 60_000;

  tokenCache = {
    accessToken: payload.access_token,
    expiresAtMs: Number.isFinite(expiredOn) ? expiredOn : Date.now() + 30 * 60_000
  };

  return tokenCache.accessToken;
}

export interface BlinkPaylinkResult {
  id: string;
  paylinkUrl: string;
  transactionUnique: string;
  rawResponse: Record<string, unknown>;
}

export async function createBlinkPaylink(payload: Record<string, unknown>): Promise<BlinkPaylinkResult> {
  const accessToken = await getBlinkAccessToken();
  const response = await fetch(env.BLINK_PAYLINK_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  const responseBody: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = isRecord(responseBody) ? JSON.stringify(responseBody) : String(responseBody ?? "");
    throw new Error(`Blink paylink creation failed with status ${response.status}: ${detail}`);
  }

  if (!isRecord(responseBody)) {
    throw new Error("Blink paylink response was not a JSON object.");
  }

  const paylinkUrl =
    typeof responseBody.paylink_url === "string"
      ? responseBody.paylink_url
      : typeof responseBody.paylinkUrl === "string"
        ? responseBody.paylinkUrl
        : null;
  const paylinkId =
    typeof responseBody.id === "string" || typeof responseBody.id === "number"
      ? String(responseBody.id)
      : null;
  const transactionUnique =
    typeof responseBody.transaction_unique === "string"
      ? responseBody.transaction_unique
      : typeof payload.transaction_unique === "string"
        ? payload.transaction_unique
        : null;

  if (!paylinkUrl || !paylinkId || !transactionUnique) {
    throw new Error("Blink paylink response was missing paylink_url, id, or transaction_unique.");
  }

  logger.info(
    {
      paylinkId,
      transactionUnique
    },
    "Blink paylink created."
  );

  return {
    id: paylinkId,
    paylinkUrl,
    transactionUnique,
    rawResponse: responseBody
  };
}
