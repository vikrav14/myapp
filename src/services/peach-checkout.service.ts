import { createHmac } from "node:crypto";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function serializePeachValue(value: string | boolean | number): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

export function peachJuiceCheckoutAutomationConfigured(): boolean {
  return Boolean(env.PEACH_ENTITY_ID?.trim() && env.PEACH_CHECKOUT_SECRET?.trim());
}

export function isPeachJuiceCheckoutAutomationEnabled(): boolean {
  return peachJuiceCheckoutAutomationConfigured();
}

export function signPeachCheckoutParameters(
  params: Record<string, string | boolean | number>,
  secret: string
): string {
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}${serializePeachValue(params[key]!)}`)
    .join("");

  return createHmac("sha256", secret).update(message).digest("hex");
}

export interface PeachJuiceCheckoutResult {
  checkoutId: string | null;
  redirectUrl: string;
  rawResponse: Record<string, unknown>;
}

function extractRedirectUrl(responseBody: Record<string, unknown>): string | null {
  const candidates = [
    responseBody.redirectUrl,
    responseBody.redirect_url,
    responseBody.checkoutUrl,
    responseBody.checkout_url
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractCheckoutId(responseBody: Record<string, unknown>): string | null {
  const candidates = [responseBody.checkoutId, responseBody.checkout_id, responseBody.id];

  for (const candidate of candidates) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate);
    }
  }

  return null;
}

export async function createPeachJuiceCheckout(
  payload: Record<string, string | boolean | number>
): Promise<PeachJuiceCheckoutResult> {
  if (!peachJuiceCheckoutAutomationConfigured()) {
    throw new Error("Peach checkout credentials are not configured.");
  }

  const signature = signPeachCheckoutParameters(payload, env.PEACH_CHECKOUT_SECRET!);
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    body.set(key, serializePeachValue(value));
  }

  body.set("signature", signature);

  const response = await fetch(env.PEACH_CHECKOUT_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const responseBody: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = isRecord(responseBody) ? JSON.stringify(responseBody) : String(responseBody ?? "");
    throw new Error(`Peach checkout initiation failed with status ${response.status}: ${detail}`);
  }

  if (!isRecord(responseBody)) {
    throw new Error("Peach checkout response was not a JSON object.");
  }

  const redirectUrl = extractRedirectUrl(responseBody);
  if (!redirectUrl) {
    throw new Error("Peach checkout response was missing redirectUrl.");
  }

  const checkoutId = extractCheckoutId(responseBody);

  logger.info(
    {
      checkoutId,
      merchantTransactionId: payload.merchantTransactionId
    },
    "Peach Juice checkout initiated."
  );

  return {
    checkoutId,
    redirectUrl,
    rawResponse: responseBody
  };
}
