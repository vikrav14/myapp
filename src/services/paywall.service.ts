import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriReplyPayload, MauriUser, PaymentCheckoutSessionRecord } from "../types.js";
import { isBlinkPaylinkAutomationEnabled } from "./blink-paylink.service.js";
import { isPeachJuiceCheckoutAutomationEnabled } from "./peach-checkout.service.js";
import { createPaymentCheckoutSession } from "./payment-link.service.js";
import { MAURI_TYPED_ESCAPE_HATCH, isRichMediaEnabled } from "./rich-media.service.js";
import { buildPaymentCtaInteractive } from "./whatsapp-interactive.service.js";

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
  provider: "MCB_JUICE" | "BLINK",
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
  const providers: Array<"MCB_JUICE" | "BLINK"> = [];

  if (env.MCB_JUICE_PAYMENT_LINK || isPeachJuiceCheckoutAutomationEnabled()) {
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

function resolveCheckoutUrl(
  session: PaymentCheckoutSessionRecord | null,
  fallback: string | undefined
): string | null {
  return session?.checkout_url ?? fallback ?? null;
}

function formatProviderLine(
  label: string,
  fallbackUrl: string | undefined,
  session: PaymentCheckoutSessionRecord | null
): string | null {
  const checkoutUrl = resolveCheckoutUrl(session, fallbackUrl);

  if (!checkoutUrl && !session) {
    return null;
  }

  const reference = session?.provider_reference ? ` Ref ${session.provider_reference}.` : "";

  if (checkoutUrl) {
    return `${label}: ${checkoutUrl}.${reference}`;
  }

  return `${label} reference:${reference.trim()}`;
}

export interface PaywallReply extends MauriReplyPayload {
  sendTextBeforeInteractive?: boolean | undefined;
  secondaryInteractive?: MauriReplyPayload["interactive"];
}

function buildPaywallText(input: {
  firstName?: string | null;
  variant: "locked" | "trial_cliffhanger" | "voluntary";
  paymentLines: string[];
  useCta: boolean;
}): string {
  const name = input.firstName?.trim() || "Hey";
  const intro =
    input.variant === "trial_cliffhanger"
      ? `${name} — your trial window is closing soon.`
      : input.variant === "voluntary"
        ? `${name} — here's how to unlock premium when you're ready.`
        : `${name}, your Mauri vault is locked right now.`;

  const holdLine =
    input.variant === "locked"
      ? "Your trial ended, so I'm holding the deeper memory and tracking layer until premium is active."
      : input.variant === "trial_cliffhanger"
        ? "Keep memory, runway, Sunday reports, and gentle follow-ups live after trial."
        : "Premium keeps memory, runway, Sunday reports, and gentle follow-ups live.";

  const paymentTail = input.useCta
    ? "Tap the pay button in the next message — or reply pay juice / pay blink anytime.\n\nQuestions about what's included? Just ask in your own words."
    : input.paymentLines.length > 0
      ? `${input.paymentLines.join("\n")}\n\nOnce payment lands and gets confirmed, Mauri opens back up automatically.`
      : "Payment links are not wired yet, so confirm the payment through the internal activation route after payment for now.";

  return [intro, "", holdLine, "", `Premium is Rs ${env.SUBSCRIPTION_MONTHLY_PRICE_RS} per month.`, "", paymentTail, "", MAURI_TYPED_ESCAPE_HATCH].join(
    "\n"
  );
}

export async function buildPaywallReplyForUser(
  user: MauriUser,
  requestId?: string | undefined,
  variant: "locked" | "trial_cliffhanger" | "voluntary" = "locked"
): Promise<PaywallReply> {
  const options = await preparePaywallPaymentOptions(user, requestId);
  const paymentLines = [
    formatProviderLine("Juice", env.MCB_JUICE_PAYMENT_LINK, options.juiceSession),
    formatProviderLine("Blink", env.BLINK_PAYMENT_LINK, options.blinkSession)
  ].filter((line): line is string => Boolean(line));

  const juiceUrl = resolveCheckoutUrl(options.juiceSession, env.MCB_JUICE_PAYMENT_LINK);
  const blinkUrl = resolveCheckoutUrl(options.blinkSession, env.BLINK_PAYMENT_LINK);
  const useCta = Boolean(isRichMediaEnabled() && env.WHATSAPP_INTERACTIVE_ENABLED && (juiceUrl || blinkUrl));

  const text = buildPaywallText({
    firstName: user.first_name,
    variant,
    paymentLines,
    useCta
  });

  if (!useCta) {
    return { text };
  }

  const primaryUrl = juiceUrl ?? blinkUrl;
  const primaryProvider = juiceUrl ? "juice" : "blink";

  if (!primaryUrl) {
    return { text };
  }

  const reply: PaywallReply = {
    text,
    sendTextBeforeInteractive: true,
    interactive: buildPaymentCtaInteractive({
      provider: primaryProvider,
      firstName: user.first_name,
      amountRs: env.SUBSCRIPTION_MONTHLY_PRICE_RS,
      checkoutUrl: primaryUrl,
      variant
    })
  };

  if (juiceUrl && blinkUrl) {
    reply.secondaryInteractive = buildPaymentCtaInteractive({
      provider: "blink",
      firstName: user.first_name,
      amountRs: env.SUBSCRIPTION_MONTHLY_PRICE_RS,
      checkoutUrl: blinkUrl,
      variant
    });
  }

  return reply;
}

export async function buildLockedReplyForUser(
  user: MauriUser,
  requestId?: string | undefined
): Promise<string> {
  const reply = await buildPaywallReplyForUser(user, requestId, "locked");
  return reply.text ?? "";
}

export function parsePayCommand(
  message: string
): { type: "show" } | { type: "juice" } | { type: "blink" } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (normalized === "pay" || normalized === "subscribe" || normalized === "unlock" || normalized === "premium") {
    return { type: "show" };
  }

  if (normalized === "pay juice" || normalized === "juice") {
    return { type: "juice" };
  }

  if (normalized === "pay blink" || normalized === "blink") {
    return { type: "blink" };
  }

  return null;
}

export async function handlePaywallMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<PaywallReply | null> {
  const command = parsePayCommand(input.message);
  if (!command) {
    return null;
  }

  const locked = input.user.subscription_status === "Locked";
  const trialActive = input.user.subscription_status === "Trial_Active";
  const paidActive = input.user.subscription_status === "Paid_Active";

  if (!locked && !trialActive && !paidActive) {
    return null;
  }

  const variant = locked ? "locked" : "voluntary";
  const options = await preparePaywallPaymentOptions(input.user, input.requestId);
  const juiceUrl = resolveCheckoutUrl(options.juiceSession, env.MCB_JUICE_PAYMENT_LINK);
  const blinkUrl = resolveCheckoutUrl(options.blinkSession, env.BLINK_PAYMENT_LINK);

  if (command.type === "juice" && juiceUrl) {
    return {
      text: `Juice checkout — Rs ${env.SUBSCRIPTION_MONTHLY_PRICE_RS}/month.\n\n${juiceUrl}\n\n${MAURI_TYPED_ESCAPE_HATCH}`,
      sendTextBeforeInteractive: true,
      interactive: buildPaymentCtaInteractive({
        provider: "juice",
        firstName: input.user.first_name,
        amountRs: env.SUBSCRIPTION_MONTHLY_PRICE_RS,
        checkoutUrl: juiceUrl,
        variant
      })
    };
  }

  if (command.type === "blink" && blinkUrl) {
    return {
      text: `Blink checkout — Rs ${env.SUBSCRIPTION_MONTHLY_PRICE_RS}/month.\n\n${blinkUrl}\n\n${MAURI_TYPED_ESCAPE_HATCH}`,
      sendTextBeforeInteractive: true,
      interactive: buildPaymentCtaInteractive({
        provider: "blink",
        firstName: input.user.first_name,
        amountRs: env.SUBSCRIPTION_MONTHLY_PRICE_RS,
        checkoutUrl: blinkUrl,
        variant
      })
    };
  }

  return buildPaywallReplyForUser(input.user, input.requestId, variant);
}

export async function buildTrialCliffhangerPaymentReply(
  user: MauriUser,
  requestId?: string | undefined
): Promise<PaywallReply | null> {
  const options = await preparePaywallPaymentOptions(user, requestId);
  const juiceUrl = resolveCheckoutUrl(options.juiceSession, env.MCB_JUICE_PAYMENT_LINK);
  const blinkUrl = resolveCheckoutUrl(options.blinkSession, env.BLINK_PAYMENT_LINK);

  if (!isRichMediaEnabled() || !env.WHATSAPP_INTERACTIVE_ENABLED || (!juiceUrl && !blinkUrl)) {
    return null;
  }

  return buildPaywallReplyForUser(user, requestId, "trial_cliffhanger");
}
