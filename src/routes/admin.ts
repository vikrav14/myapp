import { Router } from "express";
import { z } from "zod";

import { hasAdminAccess } from "../lib/internal-auth.js";
import { getSecurityPostureSummary } from "../lib/network-security.js";
import {
  adminUpdateUser,
  getAdminDashboardData,
  getAdminOverview,
  getAdminUserProfile,
  listAdminAuditEvents,
  listAdminDeadLetters,
  listAdminOutboundMessages,
  listAdminPaymentSessions,
  listAdminReports,
  listAdminUsers
} from "../services/admin.service.js";
import { getRequestId } from "../lib/request-tracing.js";
import { recordAuditEventBestEffort } from "../services/audit.service.js";
import { retryOutboundMessageById } from "../services/outbound-retry.service.js";
import { updateDeadLetterStatus } from "../services/dead-letter.service.js";
import {
  discardOutboundMessage,
  getOutboundMessageById,
  requeueOutboundMessage
} from "../services/outbound-message.service.js";

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

const listDeadLettersQuerySchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  status: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional()
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

function renderDashboardHtml(input: Awaited<ReturnType<typeof getAdminDashboardData>>): string {
  const overview = input.overview;

  const deadLetterRows = input.recentDeadLetters
    .map(
      (item) =>
        `<tr><td>${item.category}</td><td>${item.status}</td><td>${item.source_id}</td><td>${item.last_error ?? ""}</td><td>${item.created_at}</td></tr>`
    )
    .join("");

  const outboundRows = input.recentOutboundFailures
    .map(
      (item) =>
        `<tr><td>${item.status}</td><td>${item.phone_number}</td><td>${item.attempt_count}</td><td>${item.last_error ?? ""}</td><td>${item.updated_at}</td></tr>`
    )
    .join("");

  const auditRows = input.recentAuditEvents
    .map(
      (item) =>
        `<tr><td>${item.event_type}</td><td>${item.severity}</td><td>${item.user_id ?? ""}</td><td>${item.created_at}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Mauri Ops Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111827; background: #f9fafb; }
      h1, h2 { margin-bottom: 8px; }
      .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
      .card { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
      .label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
      .value { font-size: 24px; font-weight: bold; margin-top: 8px; }
      table { width: 100%; border-collapse: collapse; background: white; margin-bottom: 24px; }
      th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 13px; vertical-align: top; }
      th { background: #f3f4f6; }
      .section { margin-top: 24px; }
    </style>
  </head>
  <body>
    <h1>Mauri Ops Dashboard</h1>
    <p>Live operational snapshot from the internal admin surface.</p>

    <div class="cards">
      <div class="card"><div class="label">Users</div><div class="value">${overview.users.total}</div></div>
      <div class="card"><div class="label">Paid Active</div><div class="value">${overview.users.paidActive}</div></div>
      <div class="card"><div class="label">Open Dead Letters</div><div class="value">${overview.operations.openDeadLetters}</div></div>
      <div class="card"><div class="label">Outbound Pending</div><div class="value">${overview.operations.outboundPending}</div></div>
    </div>

    <div class="cards">
      <div class="card"><div class="label">Reports This Week</div><div class="value">${overview.operations.reportsThisWeek}</div></div>
      <div class="card"><div class="label">Payment Events This Week</div><div class="value">${overview.operations.paymentEvents}</div></div>
      <div class="card"><div class="label">Voice Notes This Week</div><div class="value">${overview.operations.voiceNotes}</div></div>
      <div class="card"><div class="label">Outbound Failed</div><div class="value">${overview.operations.outboundFailed}</div></div>
    </div>

    <div class="section">
      <h2>Recent Dead Letters</h2>
      <table>
        <thead><tr><th>Category</th><th>Status</th><th>Source</th><th>Last Error</th><th>Created</th></tr></thead>
        <tbody>${deadLetterRows || "<tr><td colspan='5'>No dead letters.</td></tr>"}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Recent Outbound Failures</h2>
      <table>
        <thead><tr><th>Status</th><th>Phone</th><th>Attempts</th><th>Last Error</th><th>Updated</th></tr></thead>
        <tbody>${outboundRows || "<tr><td colspan='5'>No outbound failures.</td></tr>"}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Recent Audit Events</h2>
      <table>
        <thead><tr><th>Event</th><th>Severity</th><th>User</th><th>Created</th></tr></thead>
        <tbody>${auditRows || "<tr><td colspan='4'>No audit events.</td></tr>"}</tbody>
      </table>
    </div>
  </body>
</html>`;
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

adminRouter.get("/dashboard", async (_request, response, next) => {
  try {
    const dashboardData = await getAdminDashboardData();
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.status(200).send(renderDashboardHtml(dashboardData));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/security-posture", (_request, response) => {
  response.status(200).json({
    ok: true,
    securityPosture: getSecurityPostureSummary()
  });
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

adminRouter.get("/dead-letters", async (request, response, next) => {
  try {
    const query = listDeadLettersQuerySchema.parse(request.query);
    const result = await listAdminDeadLetters(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      deadLetters: result.deadLetters
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

adminRouter.post("/outbound-messages/:messageId/requeue", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const messageId = z.string().uuid().parse(request.params.messageId);
    const message = await getOutboundMessageById(messageId);

    if (!message) {
      response.status(404).json({
        ok: false,
        error: "Outbound message not found."
      });
      return;
    }

    const result = await requeueOutboundMessage(messageId);

    await updateDeadLetterStatus({
      sourceTable: "outbound_messages",
      sourceId: messageId,
      status: "requeued",
      requestId,
      message: "Admin manually requeued dead-letter outbound message."
    });

    response.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/outbound-messages/:messageId/discard", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const messageId = z.string().uuid().parse(request.params.messageId);
    const message = await getOutboundMessageById(messageId);

    if (!message) {
      response.status(404).json({
        ok: false,
        error: "Outbound message not found."
      });
      return;
    }

    const discarded = await discardOutboundMessage(messageId);

    await updateDeadLetterStatus({
      sourceTable: "outbound_messages",
      sourceId: messageId,
      status: "discarded",
      requestId,
      message: "Admin discarded dead-letter outbound message."
    });

    response.status(200).json({
      ok: true,
      message: discarded
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
