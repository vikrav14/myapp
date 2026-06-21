import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser, PaymentEvent, PaymentProvider } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { findUserById, findUserByPhoneNumber, updateUserState } from "./user.service.js";

interface ActivateSubscriptionInput {
  user: MauriUser;
  provider: PaymentProvider;
  transactionReference: string;
  amount: number;
  currency?: string | undefined;
  paidAt?: string | undefined;
  durationDays?: number | undefined;
  rawPayload?: unknown;
  requestId?: string | undefined;
}

export interface NormalizedPaymentCallback {
  provider: Extract<PaymentProvider, "MCB_JUICE" | "BLINK">;
  transactionReference: string;
  amount: number;
  currency: string;
  paidAt?: string | undefined;
  userId?: string | undefined;
  phoneNumber?: string | undefined;
  rawPayload: unknown;
}

function mapPaymentEvent(record: Record<string, unknown>): PaymentEvent {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    provider: String(record.provider),
    status: String(record.status),
    amount: Number(record.amount),
    currency: String(record.currency),
    transaction_reference: String(record.transaction_reference),
    paid_at: String(record.paid_at),
    raw_payload: record.raw_payload ?? null,
    created_at: String(record.created_at)
  };
}

function addDays(baseDate: Date, durationDays: number): string {
  const nextDate = new Date(baseDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + durationDays);
  return nextDate.toISOString();
}

export function buildPaymentActivatedReply(user: MauriUser): string {
  const name = user.first_name?.trim() || "You’re";
  const renewalText = user.subscription_ends_at
    ? `Your premium access is live until ${new Date(user.subscription_ends_at).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      })}.`
    : "Your premium access is live.";

  return `${name} unlocked.

Payment landed clean.

${renewalText}

Send the next brain dump when you’re ready. Mauri memory is open again.`;
}

export async function activatePaidSubscription(input: ActivateSubscriptionInput): Promise<{
  user: MauriUser;
  paymentEvent: PaymentEvent;
  wasDuplicate: boolean;
}> {
  const {
    user,
    provider,
    transactionReference,
    amount,
    currency = "MUR",
    paidAt,
    durationDays = env.DEFAULT_SUBSCRIPTION_DAYS,
    rawPayload,
    requestId
  } = input;

  const normalizedPaidAt = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();

  const { data: existingPayment, error: existingPaymentError } = await supabase
    .from("payment_events")
    .select("*")
    .eq("provider", provider)
    .eq("transaction_reference", transactionReference)
    .maybeSingle();

  if (existingPaymentError) {
    throw new Error(`Failed to check duplicate payment event: ${existingPaymentError.message}`);
  }

  if (existingPayment) {
    throw new Error(`Payment reference already processed for ${provider}: ${transactionReference}`);
  }

  const currentSubscriptionEnd =
    user.subscription_ends_at && new Date(user.subscription_ends_at).getTime() > Date.now()
      ? new Date(user.subscription_ends_at)
      : null;

  const nextSubscriptionAnchor = currentSubscriptionEnd ?? new Date(normalizedPaidAt);
  const nextSubscriptionEnd = addDays(nextSubscriptionAnchor, durationDays);

  const { data: paymentData, error: paymentError } = await supabase
    .from("payment_events")
    .insert({
      user_id: user.id,
      provider,
      status: "confirmed",
      amount,
      currency,
      transaction_reference: transactionReference,
      paid_at: normalizedPaidAt,
      raw_payload: rawPayload ?? null
    })
    .select("*")
    .single();

  if (paymentError) {
    throw new Error(`Failed to insert payment event: ${paymentError.message}`);
  }

  const updatedUser = await updateUserState(user.id, {
    subscription_status: "Paid_Active",
    locked_at: null,
    subscription_started_at:
      currentSubscriptionEnd && user.subscription_started_at ? user.subscription_started_at : normalizedPaidAt,
    subscription_ends_at: nextSubscriptionEnd,
    last_payment_at: normalizedPaidAt
  });

  const paymentEvent = mapPaymentEvent(paymentData);

  await recordAuditEventBestEffort({
    requestId,
    eventType: "payment_activated",
    actorType: "payment_provider",
    actorId: provider,
    userId: updatedUser.id,
    entityType: "payment_event",
    entityId: paymentEvent.id,
    message: "Subscription activated from payment confirmation.",
    metadata: {
      provider,
      transactionReference,
      amount,
      currency,
      subscriptionEndsAt: updatedUser.subscription_ends_at
    }
  });

  return {
    user: updatedUser,
    paymentEvent,
    wasDuplicate: false
  };
}

export async function activatePaidSubscriptionIdempotent(input: ActivateSubscriptionInput): Promise<{
  user: MauriUser;
  paymentEvent: PaymentEvent;
  wasDuplicate: boolean;
}> {
  const { data: existingPayment, error: existingPaymentError } = await supabase
    .from("payment_events")
    .select("*")
    .eq("provider", input.provider)
    .eq("transaction_reference", input.transactionReference)
    .maybeSingle();

  if (existingPaymentError) {
    throw new Error(`Failed to check duplicate payment event: ${existingPaymentError.message}`);
  }

  if (existingPayment) {
    const existingUser = await findUserById(String(existingPayment.user_id));
    if (!existingUser) {
      throw new Error(`Payment reference already exists but user ${String(existingPayment.user_id)} could not be loaded.`);
    }

    return {
      user: existingUser,
      paymentEvent: mapPaymentEvent(existingPayment),
      wasDuplicate: true
    };
  }

  return activatePaidSubscription(input);
}

function sanitizeReferenceValue(value: string): string {
  return value.trim();
}

export function parseMauriPaymentReference(reference: string): {
  userId?: string | undefined;
  phoneNumber?: string | undefined;
} {
  const trimmed = sanitizeReferenceValue(reference);
  if (!trimmed) {
    return {};
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const phonePattern = /^\+?\d{6,20}$/;

  const lower = trimmed.toLowerCase();
  const prefixes = ["mauri:user:", "user:", "uid:"];
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      const candidate = trimmed.slice(prefix.length).split(":")[0]?.trim() ?? "";
      if (uuidPattern.test(candidate)) {
        return { userId: candidate };
      }
    }
  }

  const phonePrefixes = ["mauri:phone:", "phone:", "tel:"];
  for (const prefix of phonePrefixes) {
    if (lower.startsWith(prefix)) {
      const candidate = trimmed.slice(prefix.length).split(":")[0]?.trim() ?? "";
      if (phonePattern.test(candidate)) {
        return { phoneNumber: candidate.replace(/^\+/, "") };
      }
    }
  }

  if (uuidPattern.test(trimmed)) {
    return { userId: trimmed };
  }

  if (phonePattern.test(trimmed)) {
    return { phoneNumber: trimmed.replace(/^\+/, "") };
  }

  return {};
}

export async function resolvePaymentCallbackUser(input: {
  userId?: string | undefined;
  phoneNumber?: string | undefined;
  referenceCandidates?: string[] | undefined;
}): Promise<MauriUser | null> {
  if (input.userId) {
    return findUserById(input.userId);
  }

  if (input.phoneNumber) {
    return findUserByPhoneNumber(input.phoneNumber.replace(/^\+/, ""));
  }

  for (const candidate of input.referenceCandidates ?? []) {
    const parsed = parseMauriPaymentReference(candidate);
    if (parsed.userId) {
      const user = await findUserById(parsed.userId);
      if (user) {
        return user;
      }
    }

    if (parsed.phoneNumber) {
      const user = await findUserByPhoneNumber(parsed.phoneNumber);
      if (user) {
        return user;
      }
    }
  }

  return null;
}
