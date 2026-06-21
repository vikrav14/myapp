import { Router } from "express";
import { z } from "zod";

import { env } from "../lib/env.js";
import { buildPaymentActivatedReply, activatePaidSubscription } from "../services/payment.service.js";
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

function hasAdminAccess(adminKey: string | undefined): boolean {
  return Boolean(env.INTERNAL_ADMIN_API_KEY && adminKey === env.INTERNAL_ADMIN_API_KEY);
}

export const paymentsRouter = Router();

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

    const result = await activatePaidSubscription({
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
    if (payload.sendConfirmationMessage) {
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
      confirmationPreview
    });
  } catch (error) {
    next(error);
  }
});
