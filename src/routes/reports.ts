import { Router } from "express";
import { z } from "zod";

import { hasAdminAccess } from "../lib/internal-auth.js";
import { generateWeeklyDiagnosticReport } from "../services/report.service.js";
import { findUserById, findUserByPhoneNumber } from "../services/user.service.js";

const weeklyReportRequestSchema = z
  .object({
    userId: z.string().uuid().optional(),
    phoneNumber: z.string().min(6).optional(),
    referenceDate: z.iso.datetime().optional(),
    sendMessage: z.boolean().default(false),
    forceRegenerate: z.boolean().default(false)
  })
  .refine((value) => Boolean(value.userId || value.phoneNumber), {
    message: "Either userId or phoneNumber is required.",
    path: ["userId"]
  });

export const reportsRouter = Router();

reportsRouter.post("/weekly", async (request, response, next) => {
  try {
    if (!hasAdminAccess(request.header("x-mauri-admin-key") ?? undefined)) {
      response.status(403).json({
        ok: false,
        error: "Unauthorized weekly report request."
      });
      return;
    }

    const payload = weeklyReportRequestSchema.parse(request.body);
    const user = payload.userId
      ? await findUserById(payload.userId)
      : await findUserByPhoneNumber(payload.phoneNumber ?? "");

    if (!user) {
      response.status(404).json({
        ok: false,
        error: "User not found for weekly report generation."
      });
      return;
    }

    const report = await generateWeeklyDiagnosticReport({
      user,
      referenceDate: payload.referenceDate ? new Date(payload.referenceDate) : undefined,
      sendMessage: payload.sendMessage,
      forceRegenerate: payload.forceRegenerate
    });

    response.status(200).json({
      ok: true,
      reportId: report.id,
      userId: report.user_id,
      weekStart: report.week_start,
      weekEnd: report.week_end,
      deliveryStatus: report.delivery_status,
      sentAt: report.sent_at,
      reportText: report.report_text,
      summary: report.summary_json
    });
  } catch (error) {
    next(error);
  }
});
