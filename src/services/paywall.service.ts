import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser, PaymentCheckoutSessionRecord, PaymentProvider } from "../types.js";
import { isBlinkPaylinkAutomationEnabled } from "./blink-paylink.service.js";
import { createPaymentCheckoutSession } from "./payment-link.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapPaymentCheckoutSessionRecord(record: Record<string, unknown>): PaymentCheckoutSessionRecord {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    provider: String(record.provider),
    status: String(record.status),
    user_reference: String(record.user_reference),
    provider_reference: String(record.provider_reference),
    amount: Number(record.amount),
    currency: String(record.currency),
    duration_days: Number(record.duration_days),
    provider_payload: isRecord(record.provider_payload) ? record.provider_payload : {},
    provider_endpoint: record.provider_endpoint ? String(record.provider_endpoint) : null,
    checkout_url: record.checkout_url ? String(record.checkout_url) : null,
    provider_session_id: record.provider_session_id ? String(record.provider_session_id) : null,
    provider_response: isRecord(record.provider_response) ? record.provider_response : null,
    activated_payment_event_id: record.activated_payment_event_id ? String(record.activated_payment_event_id) : null,
    activated_at: record.activated_at ? String(record.activated_at) : null,
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

async function getOrCreateRecentPreparedSession(
  user: MauriUser,
  provider: Extract<PaymentProvider, "MCB_JUICE" | "BLINK">,
  requestId?: string | undefined
): Promise<PaymentCheckoutSessionRecord> {
  const since = new Date();
  since.setUTCHours(since.getUTCHours() - 24);

  const { data, error } = await supabase
    .from("payment_checkout_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .eq("status", "prepared")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load recent ${provider} checkout session: ${error.message}`);
  }

  if (data) {
    return mapPaymentCheckoutSessionRecord(data as Record<string, unknown>);
  }

  return createPaymentCheckoutSession({
    user,
    provider,
    amount: env.SUBSCRIPTION_MONTHLY_PRICE_RS,
    durationDays: env.DEFAULT_SUBSCRIPTION_DAYS,
    requestId
  });
}

export interface PaywallPaymentOptions {
  juiceSession: PaymentCheckoutSessionRecord | null;
  blinkSession: PaymentCheckoutSessionRecord | null;
}

export async function preparePaywallPaymentOptions(
  user: MauriUser,
  requestId?: string | undefined
): Promise<PaywallPaymentOptions> {
  const providers: Array<Extract<PaymentProvider, "MCB_JUICE" | "BLINK">> = [];

  if (env.MCB_JUICE_PAYMENT_LINK || env.PEACH_ENTITY_ID) {
    providers.push("MCB_JUICE");
  }

  if (env.BLINK_PAYMENT_LINK || isBlinkPaylinkAutomationEnabled()) {
    providers.push("BLINK");
  }

  if (!providers.length) {
    return {
      juiceSession: null,
      blinkSession: null
    };
  }

  const sessions = await Promise.all(
    providers.map(async (provider) => {
      try {
        return await getOrCreateRecentPreparedSession(user, provider, requestId);
      } catch (error) {
        logger.warn({ error, userId: user.id, provider }, "Failed to prepare paywall checkout session.");
        return null;
      }
    })
  );

  return {
    juiceSession: sessions.find((session) => session?.provider === "MCB_JUICE") ?? null,
    blinkSession: sessions.find((session) => session?.provider === "BLINK") ?? null
  };
}

function formatProviderLine(
  label: string,
  fallbackUrl: string | undefined,
  session: PaymentCheckoutSessionRecord | null
): string | null {
  const checkoutUrl = session?.checkout_url ?? fallbackUrl ?? null;

  if (!checkoutUrl && !session) {
    return null;
  }

  const reference = session?.provider_reference ? ` Ref ${session.provider_reference}.` : "";

  if (checkoutUrl) {
    return `${label}: ${checkoutUrl}.${reference}`;
  }

  return `${label} reference:${reference.trim()}`;
}

export async function buildLockedReplyForUser(
  user: MauriUser,
  requestId?: string | undefined
): Promise<string> {
  const name = user.first_name?.trim() || "Hey";
  const options = await preparePaywallPaymentOptions(user, requestId);

  const paymentLines = [
    formatProviderLine("Juice", env.MCB_JUICE_PAYMENT_LINK, options.juiceSession),
    formatProviderLine("Blink", env.BLINK_PAYMENT_LINK, options.blinkSession)
  ].filter((line): line is string => Boolean(line));

  const paymentTail =
    paymentLines.length > 0
      ? `${paymentLines.join("\n")}\n\nOnce payment lands and gets confirmed, Mauri opens back up automatically.`
      : "Payment links are not wired yet, so confirm the payment through the internal activation route after payment for now.";

  return `${name}, your Mauri vault is locked right now.

Your trial window ended, so I’m holding the deeper memory and tracking layer until premium is active.

Premium is Rs ${env.SUBSCRIPTION_MONTHLY_PRICE_RS} per month.

${paymentTail}`;
}
