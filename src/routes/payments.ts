import express, { Router } from "express";
import { z } from "zod";

import { env } from "../lib/env.js";
import { hasAdminAccess } from "../lib/internal-auth.js";
import {
  activatePaidSubscriptionIdempotent,
  buildPaymentActivatedReply,
  resolvePaymentCallbackUser
} from "../services/payment.service.js";
import { findUserById, findUserByPhoneNumber } from "../services/user.service.js";
import { sendWhatsAppMessage } from "../services/whatsapp.service.js";

const paymentConfirmationSchema = z
  .object({
    userId: z.string().uuid().optional(),
    phoneNumber: z.string().min(6).optional(),
    provider: z.enum(["MCB_JUICE", "BLINK", "MANUAL"]),
    transactionReference: z.string().min(1),
    amount: z.coerce.number().positive(),
    currency: z.string().min(3).default("MUR"),
    paidAt: z.iso.datetime().optional(),
    durationDays: z.coerce.number().int().positive().optional(),
    sendConfirmationMessage: z.boolean().default(true),
    rawPayload: z.unknown().optional()
  })
  .refine((value) => Boolean(value.userId || value.phoneNumber), {
    message: "Either userId or phoneNumber is required.",
    path: ["userId"]
  });

export const paymentsRouter = Router();
export const paymentWebhooksRouter = Router();

function normalizePhoneNumber(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().replace(/^\+/, "") : undefined;
}

function normalizeUserId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseNumericAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readConfiguredToken(
  request: express.Request,
  provider: "MCB_JUICE" | "BLINK"
): string | undefined {
  const headerToken = request.header("x-mauri-provider-token") ?? undefined;
  const queryToken = typeof request.query.token === "string" ? request.query.token : undefined;
  const bodyToken =
    typeof request.body === "object" &&
    request.body !== null &&
    "token" in request.body &&
    typeof request.body.token === "string"
      ? request.body.token
      : undefined;

  const expectedToken =
    provider === "MCB_JUICE" ? env.MCB_JUICE_CALLBACK_TOKEN : env.BLINK_CALLBACK_TOKEN;

  if (!expectedToken) {
    return undefined;
  }

  return headerToken ?? queryToken ?? bodyToken;
}

function ensureProviderToken(
  request: express.Request,
  provider: "MCB_JUICE" | "BLINK"
): { ok: true } | { ok: false; response: { ok: false; error: string } } {
  const expectedToken =
    provider === "MCB_JUICE" ? env.MCB_JUICE_CALLBACK_TOKEN : env.BLINK_CALLBACK_TOKEN;

  if (!expectedToken) {
    return { ok: true };
  }

  const providedToken = readConfiguredToken(request, provider);
  if (providedToken !== expectedToken) {
    return {
      ok: false,
      response: {
        ok: false,
        error: `${provider} callback token validation failed.`
      }
    };
  }

  return { ok: true };
}

function isMcbJuiceSuccess(resultCode: string | null, paymentBrand: string | null): boolean {
  if (paymentBrand && paymentBrand.toUpperCase() !== "MCBJUICE") {
    return false;
  }

  return Boolean(resultCode && resultCode.startsWith("000."));
}

function normalizeMcbJuiceCallback(rawBody: string): {
  shouldProcess: boolean;
  reason?: string | undefined;
  payload?: {
    provider: "MCB_JUICE";
    transactionReference: string;
    amount: number;
    currency: string;
    paidAt?: string | undefined;
    userId?: string | undefined;
    phoneNumber?: string | undefined;
    referenceCandidates: string[];
    rawPayload: Record<string, string>;
  };
} {
  const params = new URLSearchParams(rawBody);
  const payloadObject: Record<string, string> = {};
  params.forEach((value, key) => {
    payloadObject[key] = value;
  });

  const resultCode = params.get("result.code");
  const paymentBrand = params.get("paymentBrand");

  if (!isMcbJuiceSuccess(resultCode, paymentBrand)) {
    return {
      shouldProcess: false,
      reason: resultCode ? `ignored_result_code:${resultCode}` : "missing_result_code"
    };
  }

  const amount = parseNumericAmount(params.get("amount"));
  const transactionReference = params.get("checkoutId") ?? params.get("ndc") ?? params.get("merchantTransactionId");
  if (amount === null || !transactionReference) {
    return {
      shouldProcess: false,
      reason: "missing_amount_or_transaction_reference"
    };
  }

  const referenceCandidates = [
    params.get("merchantTransactionId"),
    params.get("customParameters[MAURI_USER_ID]"),
    params.get("customParameters[MAURI_PHONE]"),
    params.get("customParameters[reference]"),
    params.get("customParameters[userId]"),
    params.get("customParameters[phoneNumber]"),
    params.get("customer.merchantCustomerId"),
    params.get("customer.givenName")
  ].filter((value): value is string => Boolean(value && value.trim()));

  return {
    shouldProcess: true,
    payload: {
      provider: "MCB_JUICE",
      transactionReference,
      amount,
      currency: params.get("currency") ?? "MUR",
      paidAt: params.get("timestamp") ?? undefined,
      userId: normalizeUserId(params.get("customParameters[MAURI_USER_ID]")),
      phoneNumber:
        normalizePhoneNumber(params.get("customParameters[MAURI_PHONE]")) ??
        normalizePhoneNumber(params.get("phoneNumber")),
      referenceCandidates,
      rawPayload: payloadObject
    }
  };
}

function normalizeBlinkCallback(body: unknown): {
  shouldProcess: boolean;
  reason?: string | undefined;
  payload?: {
    provider: "BLINK";
    transactionReference: string;
    amount: number;
    currency: string;
    paidAt?: string | undefined;
    userId?: string | undefined;
    phoneNumber?: string | undefined;
    referenceCandidates: string[];
    rawPayload: Record<string, unknown>;
  };
} {
  if (typeof body !== "object" || body === null) {
    return {
      shouldProcess: false,
      reason: "invalid_json_body"
    };
  }

  const payload = body as Record<string, unknown>;
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : null;
  const state = typeof payload.state === "string" ? payload.state.toLowerCase() : null;
  const responseStatus =
    typeof payload.responseStatus === "string" || typeof payload.responseStatus === "number"
      ? String(payload.responseStatus)
      : null;
  const responseCode =
    typeof payload.responseCode === "string" || typeof payload.responseCode === "number"
      ? String(payload.responseCode)
      : null;

  const success =
    status === "paid" ||
    state === "paid" ||
    state === "complete" ||
    state === "completed" ||
    state === "successful" ||
    state === "success" ||
    responseStatus === "1";
  const ignore =
    status === "pending" ||
    status === "processing" ||
    state === "received" ||
    state === "pending" ||
    responseStatus === "2" ||
    responseCode === "65802";

  if (!success) {
    return {
      shouldProcess: false,
      reason: ignore ? "non_final_blink_status" : "unsuccessful_blink_status"
    };
  }

  const amount = parseNumericAmount(payload.amount);
  const transactionReference =
    typeof payload.transaction_id === "string"
      ? payload.transaction_id
      : typeof payload.transactionId === "string"
        ? payload.transactionId
        : typeof payload.reference === "string"
          ? payload.reference
          : null;

  if (amount === null || !transactionReference) {
    return {
      shouldProcess: false,
      reason: "missing_amount_or_transaction_reference"
    };
  }

  const referenceCandidates = [
    payload.reference,
    payload.transaction_unique,
    payload.userId,
    payload.phoneNumber,
    payload.orderReference
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());

  return {
    shouldProcess: true,
    payload: {
      provider: "BLINK",
      transactionReference,
      amount,
      currency: typeof payload.currency === "string" ? payload.currency : "MUR",
      paidAt:
        typeof payload.paid_at === "string"
          ? payload.paid_at
          : typeof payload.timestamp === "string"
            ? payload.timestamp
            : undefined,
      userId: normalizeUserId(payload.userId),
      phoneNumber: normalizePhoneNumber(payload.phoneNumber),
      referenceCandidates,
      rawPayload: payload
    }
  };
}

paymentsRouter.post("/confirm", async (request, response, next) => {
  try {
    if (!hasAdminAccess(request.header("x-mauri-admin-key") ?? undefined)) {
      response.status(403).json({
        ok: false,
        error: "Unauthorized payment confirmation request."
      });
      return;
    }

    const payload = paymentConfirmationSchema.parse(request.body);
    const user = payload.userId
      ? await findUserById(payload.userId)
      : await findUserByPhoneNumber(payload.phoneNumber ?? "");

    if (!user) {
      response.status(404).json({
        ok: false,
        error: "User not found for payment confirmation."
      });
      return;
    }

    const result = await activatePaidSubscriptionIdempotent({
      user,
      provider: payload.provider,
      transactionReference: payload.transactionReference,
      amount: payload.amount,
      currency: payload.currency,
      paidAt: payload.paidAt,
      durationDays: payload.durationDays,
      rawPayload: payload.rawPayload
    });

    let confirmationPreview: string | null = null;
    if (payload.sendConfirmationMessage && !result.wasDuplicate) {
      confirmationPreview = buildPaymentActivatedReply(result.user);
      await sendWhatsAppMessage(result.user.phone_number, confirmationPreview);
    }

    response.status(200).json({
      ok: true,
      userId: result.user.id,
      phoneNumber: result.user.phone_number,
      subscriptionStatus: result.user.subscription_status,
      subscriptionEndsAt: result.user.subscription_ends_at,
      paymentEventId: result.paymentEvent.id,
      wasDuplicate: result.wasDuplicate,
      confirmationPreview
    });
  } catch (error) {
    next(error);
  }
});

paymentWebhooksRouter.post(
  "/juice",
  express.text({ type: ["application/x-www-form-urlencoded", "text/plain"] }),
  async (request, response, next) => {
    try {
      const tokenCheck = ensureProviderToken(request, "MCB_JUICE");
      if (!tokenCheck.ok) {
        response.status(403).json(tokenCheck.response);
        return;
      }

      const rawBody = typeof request.body === "string" ? request.body : "";
      const normalized = normalizeMcbJuiceCallback(rawBody);
      if (!normalized.shouldProcess || !normalized.payload) {
        response.status(200).json({
          ok: true,
          accepted: false,
          provider: "MCB_JUICE",
          reason: normalized.reason ?? "ignored"
        });
        return;
      }

      const user = await resolvePaymentCallbackUser({
        userId: normalized.payload.userId,
        phoneNumber: normalized.payload.phoneNumber,
        referenceCandidates: normalized.payload.referenceCandidates
      });

      if (!user) {
        response.status(200).json({
          ok: true,
          accepted: false,
          provider: "MCB_JUICE",
          reason: "user_not_resolved",
          transactionReference: normalized.payload.transactionReference
        });
        return;
      }

      const result = await activatePaidSubscriptionIdempotent({
        user,
        provider: normalized.payload.provider,
        transactionReference: normalized.payload.transactionReference,
        amount: normalized.payload.amount,
        currency: normalized.payload.currency,
        paidAt: normalized.payload.paidAt,
        rawPayload: normalized.payload.rawPayload
      });

      let confirmationPreview: string | null = null;
      if (!result.wasDuplicate) {
        confirmationPreview = buildPaymentActivatedReply(result.user);
        await sendWhatsAppMessage(result.user.phone_number, confirmationPreview);
      }

      response.status(200).json({
        ok: true,
        accepted: true,
        provider: "MCB_JUICE",
        userId: result.user.id,
        paymentEventId: result.paymentEvent.id,
        wasDuplicate: result.wasDuplicate,
        confirmationPreview
      });
    } catch (error) {
      next(error);
    }
  }
);

paymentWebhooksRouter.post("/blink", async (request, response, next) => {
  try {
    const tokenCheck = ensureProviderToken(request, "BLINK");
    if (!tokenCheck.ok) {
      response.status(403).json(tokenCheck.response);
      return;
    }

    const normalized = normalizeBlinkCallback(request.body);
    if (!normalized.shouldProcess || !normalized.payload) {
      response.status(200).json({
        ok: true,
        accepted: false,
        provider: "BLINK",
        reason: normalized.reason ?? "ignored"
      });
      return;
    }

    const user = await resolvePaymentCallbackUser({
      userId: normalized.payload.userId,
      phoneNumber: normalized.payload.phoneNumber,
      referenceCandidates: normalized.payload.referenceCandidates
    });

    if (!user) {
      response.status(200).json({
        ok: true,
        accepted: false,
        provider: "BLINK",
        reason: "user_not_resolved",
        transactionReference: normalized.payload.transactionReference
      });
      return;
    }

    const result = await activatePaidSubscriptionIdempotent({
      user,
      provider: normalized.payload.provider,
      transactionReference: normalized.payload.transactionReference,
      amount: normalized.payload.amount,
      currency: normalized.payload.currency,
      paidAt: normalized.payload.paidAt,
      rawPayload: normalized.payload.rawPayload
    });

    let confirmationPreview: string | null = null;
    if (!result.wasDuplicate) {
      confirmationPreview = buildPaymentActivatedReply(result.user);
      await sendWhatsAppMessage(result.user.phone_number, confirmationPreview);
    }

    response.status(200).json({
      ok: true,
      accepted: true,
      provider: "BLINK",
      userId: result.user.id,
      paymentEventId: result.paymentEvent.id,
      wasDuplicate: result.wasDuplicate,
      confirmationPreview
    });
  } catch (error) {
    next(error);
  }
});
