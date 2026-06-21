import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser, PaymentEvent, PaymentProvider } from "../types.js";
import { updateUserState } from "./user.service.js";

interface ActivateSubscriptionInput {
  user: MauriUser;
  provider: PaymentProvider;
  transactionReference: string;
  amount: number;
  currency?: string | undefined;
  paidAt?: string | undefined;
  durationDays?: number | undefined;
  rawPayload?: unknown;
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
}> {
  const {
    user,
    provider,
    transactionReference,
    amount,
    currency = "MUR",
    paidAt,
    durationDays = env.DEFAULT_SUBSCRIPTION_DAYS,
    rawPayload
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

  return {
    user: updatedUser,
    paymentEvent: mapPaymentEvent(paymentData)
  };
}
