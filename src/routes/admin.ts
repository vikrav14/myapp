import { Router } from "express";
import { z } from "zod";

import { hasAdminAccess } from "../lib/internal-auth.js";
import {
  adminUpdateUser,
  getAdminOverview,
  getAdminUserProfile,
  listAdminAuditEvents,
  listAdminOutboundMessages,
  listAdminPaymentSessions,
  listAdminReports,
  listAdminUsers
} from "../services/admin.service.js";
import { getRequestId } from "../lib/request-tracing.js";
import { recordAuditEventBestEffort } from "../services/audit.service.js";
import { retryOutboundMessageById } from "../services/outbound-retry.service.js";

const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

const listUsersQuerySchema = paginationSchema.extend({
  subscriptionStatus: z.enum(["Trial_Active", "Paid_Active", "Locked"]).optional(),
  onboardingState: z.enum(["awaiting_archetype", "active"]).optional(),
  search: z.string().trim().min(1).optional()
});

const listSessionsQuerySchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  provider: z.enum(["MCB_JUICE", "BLINK", "MANUAL"]).optional(),
  status: z.string().trim().min(1).optional()
});

const listReportsQuerySchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  deliveryStatus: z.string().trim().min(1).optional()
});

const listAuditEventsQuerySchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  eventType: z.string().trim().min(1).optional(),
  severity: z.enum(["info", "warning", "error"]).optional(),
  requestId: z.string().trim().min(1).optional()
});

const listOutboundMessagesQuerySchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  status: z.string().trim().min(1).optional()
});

const userParamsSchema = z.object({
  userId: z.string().uuid()
});

const updateUserBodySchema = z
  .object({
    first_name: z.string().trim().min(1).nullable().optional(),
    archetype: z.string().trim().min(1).optional(),
    onboarding_state: z.enum(["awaiting_archetype", "active"]).optional(),
    subscription_status: z.enum(["Trial_Active", "Paid_Active", "Locked"]).optional(),
    trial_ends_at: z.iso.datetime().nullable().optional(),
    subscription_ends_at: z.iso.datetime().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one update field is required."
  });

function ensureAdmin(headerValue: string | undefined): boolean {
  return hasAdminAccess(headerValue);
}

export const adminRouter = Router();

adminRouter.use((request, response, next) => {
  if (!ensureAdmin(request.header("x-mauri-admin-key") ?? undefined)) {
    response.status(403).json({
      ok: false,
      error: "Unauthorized admin request."
    });
    return;
  }

  next();
});

adminRouter.get("/overview", async (_request, response, next) => {
  try {
    const overview = await getAdminOverview();
    response.status(200).json({
      ok: true,
      overview
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users", async (request, response, next) => {
  try {
    const query = listUsersQuerySchema.parse(request.query);
    const result = await listAdminUsers(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      users: result.users
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users/:userId", async (request, response, next) => {
  try {
    const params = userParamsSchema.parse(request.params);
    const profile = await getAdminUserProfile(params.userId);

    if (!profile.user) {
      response.status(404).json({
        ok: false,
        error: "User not found."
      });
      return;
    }

    response.status(200).json({
      ok: true,
      profile
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:userId", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const params = userParamsSchema.parse(request.params);
    const updates = updateUserBodySchema.parse(request.body);
    const user = await adminUpdateUser({
      userId: params.userId,
      updates
    });

    await recordAuditEventBestEffort({
      requestId,
      eventType: "admin_user_updated",
      severity: "info",
      actorType: "admin_api",
      userId: user.id,
      entityType: "user",
      entityId: user.id,
      message: "Admin updated user state.",
      metadata: updates
    });

    response.status(200).json({
      ok: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/audit-events", async (request, response, next) => {
  try {
    const query = listAuditEventsQuerySchema.parse(request.query);
    const result = await listAdminAuditEvents(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      events: result.events
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/payment-sessions", async (request, response, next) => {
  try {
    const query = listSessionsQuerySchema.parse(request.query);
    const result = await listAdminPaymentSessions(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      sessions: result.sessions
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/outbound-messages", async (request, response, next) => {
  try {
    const query = listOutboundMessagesQuerySchema.parse(request.query);
    const result = await listAdminOutboundMessages(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      messages: result.messages
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/outbound-messages/:messageId/retry", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const messageId = z.string().uuid().parse(request.params.messageId);
    const result = await retryOutboundMessageById(messageId);

    await recordAuditEventBestEffort({
      requestId,
      eventType: "admin_outbound_retry_requested",
      actorType: "admin_api",
      entityType: "outbound_message",
      entityId: messageId,
      message: "Admin requested outbound message retry.",
      metadata: result
    });

    response.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/reports", async (request, response, next) => {
  try {
    const query = listReportsQuerySchema.parse(request.query);
    const result = await listAdminReports(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      reports: result.reports
    });
  } catch (error) {
    next(error);
  }
});
