import { randomBytes, randomUUID } from "node:crypto";

import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser, PaymentCheckoutSessionRecord, PaymentProvider } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function callbackUrlFor(provider: "MCB_JUICE" | "BLINK"): string | null {
  if (!env.PAYMENT_CALLBACK_BASE_URL) {
    return null;
  }

  const base = env.PAYMENT_CALLBACK_BASE_URL.replace(/\/$/, "");
  return provider === "MCB_JUICE" ? `${base}/webhooks/payments/juice` : `${base}/webhooks/payments/blink`;
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

export function buildMauriUserReference(user: MauriUser): string {
  return `mauri:user:${user.id}`;
}

function buildBlinkProviderReference(user: MauriUser): string {
  return `${buildMauriUserReference(user)}:${Date.now().toString(36)}`;
}

function buildJuiceProviderReference(): string {
  const token = randomBytes(6).toString("hex").slice(0, 12).toUpperCase();
  return `MJ${token}`.slice(0, 14);
}

function buildMcbJuicePayload(input: {
  user: MauriUser;
  userReference: string;
  providerReference: string;
  amount: number;
  currency: string;
  durationDays: number;
}): {
  endpoint: string;
  payload: Record<string, string | boolean>;
} {
  const callbackUrl = callbackUrlFor("MCB_JUICE");
  const payload: Record<string, string | boolean> = {
    "authentication.entityId": env.PEACH_ENTITY_ID ?? "configure-PEACH_ENTITY_ID",
    amount: input.amount.toFixed(2),
    currency: input.currency,
    paymentType: "DB",
    nonce: randomUUID(),
    shopperResultUrl: env.PAYMENT_RETURN_URL ?? "configure-PAYMENT_RETURN_URL",
    merchantTransactionId: input.providerReference,
    defaultPaymentMethod: "MCBJUICE",
    forceDefaultMethod: true,
    "customer.merchantCustomerId": input.user.id,
    "customer.givenName": input.user.first_name ?? "Mauri User",
    "customer.mobile": input.user.phone_number,
    "customParameters[MAURI_USER_ID]": input.user.id,
    "customParameters[MAURI_PHONE]": input.user.phone_number,
    "customParameters[MAURI_REFERENCE]": `${input.userReference}:${input.providerReference}`,
    "customParameters[MAURI_DURATION_DAYS]": String(input.durationDays)
  };

  if (callbackUrl) {
    payload["notificationUrl"] = callbackUrl;
  }

  return {
    endpoint: env.PEACH_CHECKOUT_URL,
    payload
  };
}

function buildBlinkPayload(input: {
  user: MauriUser;
  userReference: string;
  providerReference: string;
  amount: number;
  currency: string;
  durationDays: number;
}): {
  endpoint: string;
  payload: Record<string, unknown>;
} {
  const callbackUrl = callbackUrlFor("BLINK");

  return {
    endpoint: env.BLINK_PAYLINK_API_URL,
    payload: {
      payment_method: ["open-banking"],
      transaction_type: "SALE",
      currency: input.currency,
      amount: input.amount,
      full_name: input.user.first_name ?? "Mauri User",
      mobile_number: input.user.phone_number,
      transaction_unique: `${input.userReference}:${input.providerReference}`,
      notes: `Mauri premium for ${input.durationDays} days`,
      notification_url: callbackUrl,
      redirect_url: env.PAYMENT_RETURN_URL ?? undefined
    }
  };
}

export async function createPaymentCheckoutSession(input: {
  user: MauriUser;
  provider: Extract<PaymentProvider, "MCB_JUICE" | "BLINK">;
  amount: number;
  currency?: string | undefined;
  durationDays?: number | undefined;
  requestId?: string | undefined;
}): Promise<PaymentCheckoutSessionRecord> {
  const amount = input.amount;
  const currency = input.currency ?? "MUR";
  const durationDays = input.durationDays ?? env.DEFAULT_SUBSCRIPTION_DAYS;
  const userReference = buildMauriUserReference(input.user);
  const providerReference =
    input.provider === "MCB_JUICE" ? buildJuiceProviderReference() : buildBlinkProviderReference(input.user);

  const providerConfig =
    input.provider === "MCB_JUICE"
      ? buildMcbJuicePayload({
          user: input.user,
          userReference,
          providerReference,
          amount,
          currency,
          durationDays
        })
      : buildBlinkPayload({
          user: input.user,
          userReference,
          providerReference,
          amount,
          currency,
          durationDays
        });

  const { data, error } = await supabase
    .from("payment_checkout_sessions")
    .insert({
      user_id: input.user.id,
      provider: input.provider,
      status: "prepared",
      user_reference: userReference,
      provider_reference: providerReference,
      amount,
      currency,
      duration_days: durationDays,
      provider_payload: providerConfig.payload,
      provider_endpoint: providerConfig.endpoint,
      checkout_url: null
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create payment checkout session: ${error.message}`);
  }

  const session = mapPaymentCheckoutSessionRecord(data);

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "payment_session_created",
    actorType: "admin_api",
    userId: input.user.id,
    entityType: "payment_checkout_session",
    entityId: session.id,
    message: "Payment checkout session prepared.",
    metadata: {
      provider: session.provider,
      providerReference: session.provider_reference,
      amount: session.amount,
      currency: session.currency,
      durationDays: session.duration_days
    }
  });

  return session;
}

export async function markCheckoutSessionActivated(input: {
  provider: Extract<PaymentProvider, "MCB_JUICE" | "BLINK">;
  candidateReferences: string[];
  paymentEventId: string;
}): Promise<void> {
  const references = input.candidateReferences.map((value) => value.trim()).filter(Boolean);
  if (!references.length) {
    return;
  }

  const now = new Date().toISOString();
  const { data: sessionRows, error: sessionLookupError } = await supabase
    .from("payment_checkout_sessions")
    .select("id, provider_reference, user_reference")
    .eq("provider", input.provider)
    .in("provider_reference", references);

  if (sessionLookupError) {
    throw new Error(`Failed to load checkout session for activation: ${sessionLookupError.message}`);
  }

  const providerReferenceMatches = (sessionRows ?? []).map((row) => String(row.provider_reference));
  const unmatchedReferences = references.filter((reference) => !providerReferenceMatches.includes(reference));

  let userReferenceRows: Array<{ id: string }> = [];
  if (unmatchedReferences.length > 0) {
    const { data: userRefData, error: userRefError } = await supabase
      .from("payment_checkout_sessions")
      .select("id")
      .eq("provider", input.provider)
      .in("user_reference", unmatchedReferences);

    if (userRefError) {
      throw new Error(`Failed to match checkout session user references: ${userRefError.message}`);
    }

    userReferenceRows = (userRefData ?? []).map((row) => ({ id: String(row.id) }));
  }

  const sessionIds = [
    ...(sessionRows ?? []).map((row) => String(row.id)),
    ...userReferenceRows.map((row) => row.id)
  ];

  if (!sessionIds.length) {
    return;
  }

  const { error: updateError } = await supabase
    .from("payment_checkout_sessions")
    .update({
      status: "activated",
      activated_payment_event_id: input.paymentEventId,
      activated_at: now,
      updated_at: now
    })
    .in("id", sessionIds);

  if (updateError) {
    throw new Error(`Failed to mark checkout session as activated: ${updateError.message}`);
  }
}
