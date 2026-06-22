import { Router } from "express";
import { z } from "zod";

import { hasAdminAccess } from "../lib/internal-auth.js";
import { escapeHtml } from "../lib/html-escape.js";
import { getSecurityPostureSummary } from "../lib/network-security.js";
import { evaluateAndPersistOperationalAlerts, listOperationalAlerts } from "../services/alerting.service.js";
import {
  adminUpdateUser,
  adminDissolveSquad,
  adminRemoveSquadMember,
  adminUpdateSquad,
  getAdminDashboardData,
  getAdminOverview,
  getAdminSquadProfile,
  getAdminUserProfile,
  listAdminAuditEvents,
  listAdminDeadLetters,
  listAdminOutboundMessages,
  listAdminPaymentSessions,
  listAdminReports,
  listAdminSquads,
  listAdminUsers
} from "../services/admin.service.js";
import { getRequestId } from "../lib/request-tracing.js";
import { recordAuditEventBestEffort } from "../services/audit.service.js";
import { getMetricsSnapshot } from "../services/metrics.service.js";
import { retryOutboundMessageById } from "../services/outbound-retry.service.js";
import { getDeadLetterById, updateDeadLetterStatus } from "../services/dead-letter.service.js";
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

const listSquadsQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).optional(),
  memberUserId: z.string().uuid().optional()
});

const squadParamsSchema = z.object({
  squadId: z.string().uuid()
});

const squadMemberParamsSchema = z.object({
  squadId: z.string().uuid(),
  userId: z.string().uuid()
});

const updateSquadBodySchema = z.object({
  squad_name: z.string().trim().min(1)
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
        `<tr><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.source_id)}</td><td>${escapeHtml(item.last_error ?? "")}</td><td>${escapeHtml(item.created_at)}</td></tr>`
    )
    .join("");

  const outboundRows = input.recentOutboundFailures
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.phone_number)}</td><td>${escapeHtml(item.attempt_count)}</td><td>${escapeHtml(item.last_error ?? "")}</td><td>${escapeHtml(item.updated_at)}</td></tr>`
    )
    .join("");

  const auditRows = input.recentAuditEvents
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.event_type)}</td><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.user_id ?? "")}</td><td>${escapeHtml(item.created_at)}</td></tr>`
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

function renderAdminPanelHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mauri Admin Panel</title>
    <style>
      :root {
        --bg: #0b1020;
        --panel: #131a2e;
        --panel-soft: #1a2340;
        --line: #29365d;
        --text: #eef2ff;
        --muted: #9aa6c8;
        --accent: #8b5cf6;
        --success: #22c55e;
        --warning: #f59e0b;
        --danger: #ef4444;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(180deg, #09101d 0%, #101728 100%);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell { padding: 24px; display: grid; gap: 18px; }
      .panel, .card {
        background: rgba(19, 26, 46, 0.96);
        border: 1px solid var(--line);
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      }
      .panel { padding: 18px; }
      .hero { display: grid; gap: 14px; }
      .hero-top { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .hero h1 { margin: 0; font-size: 32px; }
      .hero p { margin: 0; color: var(--muted); }
      .key-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; }
      .cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
      .card { padding: 16px; }
      .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
      .value { margin-top: 8px; font-size: 28px; font-weight: 700; }
      .layout { display: grid; grid-template-columns: 1.2fr .8fr; gap: 18px; }
      .stack { display: grid; gap: 18px; }
      .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
      .panel-header h2 { margin: 0; font-size: 18px; }
      .panel-note { color: var(--muted); font-size: 12px; margin-top: 4px; }
      .filters, .two-col { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
      .two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      input, select, textarea, button {
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: var(--panel-soft);
        color: var(--text);
        font: inherit;
      }
      textarea { min-height: 90px; resize: vertical; }
      button {
        width: auto;
        cursor: pointer;
        background: linear-gradient(135deg, var(--accent) 0%, #6366f1 100%);
        border: 0;
        font-weight: 600;
      }
      button.secondary { background: #26314f; border: 1px solid var(--line); }
      button.success { background: linear-gradient(135deg, var(--success) 0%, #16a34a 100%); }
      button.warning { background: linear-gradient(135deg, var(--warning) 0%, #d97706 100%); }
      button.danger { background: linear-gradient(135deg, var(--danger) 0%, #dc2626 100%); }
      .small { padding: 7px 10px; font-size: 12px; }
      .status { color: var(--muted); font-size: 13px; }
      .status.error { color: #fecaca; }
      .status.success { color: #bbf7d0; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
      th { color: var(--muted); font-weight: 600; }
      .table-wrap { max-height: 340px; overflow: auto; }
      .pill { display: inline-flex; padding: 4px 8px; border-radius: 999px; font-size: 12px; background: rgba(255,255,255,.08); }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
      .kv { padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .ops-box { margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
      .ops-result { margin-top: 10px; white-space: pre-wrap; color: var(--muted); font-size: 13px; }
      .checkbox-row { display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
      .checkbox-row label { display: inline-flex; gap: 6px; align-items: center; }
      .hidden { display: none; }
      @media (max-width: 1200px) { .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } .layout { grid-template-columns: 1fr; } }
      @media (max-width: 900px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filters, .two-col, .key-row, .stats-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel hero">
        <div class="hero-top">
          <div>
            <h1>Mauri Admin Panel</h1>
            <p>Internal browser UI for users, reports, outbound delivery, dead letters, sessions, audit events, and security posture.</p>
          </div>
        </div>
        <div class="key-row">
          <input id="adminKey" type="password" placeholder="Paste x-mauri-admin-key" />
          <button id="saveKeyButton" class="secondary">Save key</button>
          <button id="refreshAllButton">Refresh all</button>
        </div>
        <div id="globalStatus" class="status">Save the admin key, then refresh the panel.</div>
      </div>

      <div id="overviewCards" class="cards">
        <div class="card"><div class="label">Users</div><div class="value">-</div></div>
        <div class="card"><div class="label">Paid Active</div><div class="value">-</div></div>
        <div class="card"><div class="label">Open Dead Letters</div><div class="value">-</div></div>
        <div class="card"><div class="label">Outbound Pending</div><div class="value">-</div></div>
        <div class="card"><div class="label">Reports This Week</div><div class="value">-</div></div>
      </div>

      <div id="metricsCards" class="cards">
        <div class="card"><div class="label">Outbound Failed</div><div class="value">-</div></div>
        <div class="card"><div class="label">Payment Events</div><div class="value">-</div></div>
        <div class="card"><div class="label">Voice Notes</div><div class="value">-</div></div>
        <div class="card"><div class="label">Audit Errors (24h)</div><div class="value">-</div></div>
        <div class="card"><div class="label">Duplicate Inbound (24h)</div><div class="value">-</div></div>
      </div>

      <div class="layout">
        <div class="stack">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Users</h2>
                <div class="panel-note">Search, inspect, and patch user state.</div>
              </div>
              <button id="reloadUsersButton" class="secondary small">Reload users</button>
            </div>
            <div class="filters">
              <input id="userSearch" placeholder="Search phone or first name" />
              <select id="userSubscriptionFilter">
                <option value="">All subscription states</option>
                <option value="Trial_Active">Trial_Active</option>
                <option value="Paid_Active">Paid_Active</option>
                <option value="Locked">Locked</option>
              </select>
              <select id="userOnboardingFilter">
                <option value="">All onboarding states</option>
                <option value="awaiting_archetype">awaiting_archetype</option>
                <option value="active">active</option>
              </select>
              <input id="userLimit" type="number" min="1" max="100" value="20" placeholder="Limit" />
              <button id="applyUserFiltersButton" class="secondary">Apply filters</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Phone</th><th>Subscription</th><th>Onboarding</th><th>Updated</th><th></th></tr></thead>
                <tbody id="usersTableBody"><tr><td colspan="6">No data loaded yet.</td></tr></tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Squads</h2>
                <div class="panel-note">Inspect accountability squads, members, and lifecycle actions.</div>
              </div>
              <button id="reloadSquadsButton" class="secondary small">Reload squads</button>
            </div>
            <div class="filters">
              <input id="squadSearch" placeholder="Search name or code" />
              <input id="squadMemberUserIdFilter" placeholder="Filter by member UUID" />
              <input id="squadLimit" type="number" min="1" max="100" value="20" placeholder="Limit" />
              <button id="applySquadFiltersButton" class="secondary">Apply filters</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Code</th><th>Members</th><th>Paid</th><th>Created</th><th></th></tr></thead>
                <tbody id="squadsTableBody"><tr><td colspan="6">No data loaded yet.</td></tr></tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Outbound queue</h2>
                <div class="panel-note">Retry, requeue, or discard failed sends.</div>
              </div>
              <button id="reloadOutboundButton" class="secondary small">Reload queue</button>
            </div>
            <div class="filters">
              <input id="outboundUserIdFilter" placeholder="Filter by user UUID" />
              <input id="outboundStatusFilter" placeholder="Filter by status" />
              <input id="outboundLimit" type="number" min="1" max="100" value="20" placeholder="Limit" />
              <div></div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Status</th><th>Phone</th><th>Attempts</th><th>Error</th><th>Actions</th></tr></thead>
                <tbody id="outboundTableBody"><tr><td colspan="5">No data loaded yet.</td></tr></tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Dead letters</h2>
                <div class="panel-note">Persistent recovery queue for permanently failed operations.</div>
              </div>
              <button id="reloadDeadLettersButton" class="secondary small">Reload dead letters</button>
            </div>
            <div class="filters">
              <input id="deadLetterUserIdFilter" placeholder="Filter by user UUID" />
              <input id="deadLetterStatusFilter" placeholder="Filter by status" />
              <input id="deadLetterCategoryFilter" placeholder="Filter by category" />
              <input id="deadLetterLimit" type="number" min="1" max="100" value="20" placeholder="Limit" />
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Status</th><th>Source</th><th>Error</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody id="deadLettersTableBody"><tr><td colspan="6">No data loaded yet.</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>User detail</h2>
                <div class="panel-note">Click a user row to load profile details and patch lifecycle fields.</div>
              </div>
            </div>
            <div id="userDetailEmpty" class="status">Select a user from the left table.</div>
            <div id="userDetailContent" class="hidden">
              <div id="userDetailStats" class="stats-grid"></div>
              <div id="userSquadSummary" class="ops-box hidden" style="margin-top:12px;">
                <h3 style="margin:0 0 8px;">Squad membership</h3>
                <div id="userSquadSummaryText" class="panel-note"></div>
                <div class="actions" style="margin-top:10px;">
                  <button id="viewUserSquadButton" class="secondary small">View squad</button>
                </div>
              </div>
              <div class="two-col">
                <div><label class="label">First name</label><input id="editFirstName" /></div>
                <div><label class="label">Archetype</label><input id="editArchetype" /></div>
                <div><label class="label">Onboarding state</label><select id="editOnboardingState"><option value="">No change</option><option value="awaiting_archetype">awaiting_archetype</option><option value="active">active</option></select></div>
                <div><label class="label">Subscription status</label><select id="editSubscriptionStatus"><option value="">No change</option><option value="Trial_Active">Trial_Active</option><option value="Paid_Active">Paid_Active</option><option value="Locked">Locked</option></select></div>
                <div><label class="label">Trial ends at (ISO)</label><input id="editTrialEndsAt" placeholder="2026-06-30T23:59:59.000Z" /></div>
                <div><label class="label">Subscription ends at (ISO)</label><input id="editSubscriptionEndsAt" placeholder="2026-07-30T23:59:59.000Z" /></div>
              </div>
              <div class="actions" style="margin-top:12px;">
                <button id="saveUserButton" class="success">Save user changes</button>
                <button id="reloadUserProfileButton" class="secondary">Reload profile</button>
                <button id="focusOutboundForUserButton" class="secondary">Focus queue to user</button>
                <button id="focusDeadLettersForUserButton" class="secondary">Focus dead letters to user</button>
                <button id="clearSelectedUserButton" class="secondary">Clear selection</button>
              </div>
              <div class="ops-box">
                <h3 style="margin:0 0 8px;">Ops actions</h3>
                <div class="panel-note" style="margin-bottom:10px;">Generate a checkout session or weekly diagnostic for the selected user.</div>
                <div class="two-col">
                  <div><label class="label">Payment provider</label><select id="opsPaymentProvider"><option value="MCB_JUICE">MCB_JUICE</option><option value="BLINK">BLINK</option></select></div>
                  <div><label class="label">Amount (Rs)</label><input id="opsPaymentAmount" type="number" min="1" value="200" /></div>
                  <div><label class="label">Subscription days</label><input id="opsPaymentDurationDays" type="number" min="1" value="30" /></div>
                </div>
                <div class="actions" style="margin-top:10px;">
                  <button id="generatePaymentLinkButton" class="warning small">Generate payment link</button>
                  <button id="generateWeeklyReportButton" class="warning small">Generate weekly report</button>
                </div>
                <div class="checkbox-row" style="margin-top:10px;">
                  <label><input id="opsReportSendMessage" type="checkbox" /> Send report to WhatsApp</label>
                  <label><input id="opsReportForceRegenerate" type="checkbox" /> Force regenerate</label>
                </div>
                <div id="userOpsResult" class="ops-result">Run an ops action for the selected user.</div>
              </div>
              <div id="userProfileMeta" class="panel-note" style="margin-top:10px;"></div>
              <div style="margin-top:16px;">
                <h3 style="margin:0 0 8px;">Recent payments</h3>
                <div class="table-wrap" style="max-height:180px;">
                  <table><thead><tr><th>Provider</th><th>Amount</th><th>Reference</th><th>Paid at</th></tr></thead><tbody id="userRecentPaymentsBody"><tr><td colspan="4">No user selected.</td></tr></tbody></table>
                </div>
                <h3 style="margin:16px 0 8px;">Recent sessions</h3>
                <div class="table-wrap" style="max-height:180px;">
                  <table><thead><tr><th>Provider</th><th>Status</th><th>Reference</th><th>Created</th></tr></thead><tbody id="userRecentSessionsBody"><tr><td colspan="4">No user selected.</td></tr></tbody></table>
                </div>
                <h3 style="margin:16px 0 8px;">Recent reports</h3>
                <div class="table-wrap" style="max-height:180px;">
                  <table><thead><tr><th>Status</th><th>Week start</th><th>Created</th></tr></thead><tbody id="userRecentReportsBody"><tr><td colspan="3">No user selected.</td></tr></tbody></table>
                </div>
                <h3 style="margin:16px 0 8px;">Recent voice notes</h3>
                <div class="table-wrap" style="max-height:180px;">
                  <table><thead><tr><th>Transcript preview</th><th>Created</th></tr></thead><tbody id="userRecentVoiceNotesBody"><tr><td colspan="2">No user selected.</td></tr></tbody></table>
                </div>
                <h3 style="margin:16px 0 8px;">Recent memories</h3>
                <div class="table-wrap" style="max-height:180px;">
                  <table><thead><tr><th>Type</th><th>Content</th><th>Created</th></tr></thead><tbody id="userRecentMemoriesBody"><tr><td colspan="3">No user selected.</td></tr></tbody></table>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Squad detail</h2>
                <div class="panel-note">Click a squad row to inspect members and run admin actions.</div>
              </div>
            </div>
            <div id="squadDetailEmpty" class="status">Select a squad from the left table.</div>
            <div id="squadDetailContent" class="hidden">
              <div id="squadDetailStats" class="stats-grid"></div>
              <div class="two-col" style="margin-top:12px;">
                <div><label class="label">Squad name</label><input id="editSquadName" /></div>
                <div><label class="label">Invite code</label><input id="editSquadCode" readonly /></div>
              </div>
              <div class="actions" style="margin-top:12px;">
                <button id="saveSquadButton" class="success">Save squad name</button>
                <button id="reloadSquadProfileButton" class="secondary">Reload squad</button>
                <button id="dissolveSquadButton" class="warning">Dissolve squad</button>
                <button id="clearSelectedSquadButton" class="secondary">Clear selection</button>
              </div>
              <div id="squadNudgeNote" class="panel-note" style="margin-top:10px;"></div>
              <h3 style="margin:16px 0 8px;">Members</h3>
              <div class="table-wrap" style="max-height:220px;">
                <table><thead><tr><th>Name</th><th>Phone</th><th>Subscription</th><th>Paid nudge</th><th></th></tr></thead><tbody id="squadMembersBody"><tr><td colspan="5">No squad selected.</td></tr></tbody></table>
              </div>
              <h3 style="margin:16px 0 8px;">Recent squad audit</h3>
              <div class="table-wrap" style="max-height:180px;">
                <table><thead><tr><th>Event</th><th>Severity</th><th>User</th><th>Created</th></tr></thead><tbody id="squadAuditBody"><tr><td colspan="4">No squad selected.</td></tr></tbody></table>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Security posture</h2>
                <div class="panel-note">Live hardening summary for deployment posture.</div>
              </div>
              <button id="reloadSecurityButton" class="secondary small">Reload security</button>
            </div>
            <div id="securityPostureContent" class="stats-grid"></div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Sessions, reports, and audit</h2>
                <div class="panel-note">Recent operational state across checkout, reports, and audit trails.</div>
              </div>
              <div class="actions">
                <button id="evaluateAlertsButton" class="warning small">Evaluate alerts now</button>
                <button id="reloadOpsButton" class="secondary small">Reload ops</button>
              </div>
            </div>
            <h3 style="margin:8px 0;">Operational alerts</h3>
            <div class="table-wrap" style="max-height:180px;">
              <table><thead><tr><th>Alert</th><th>Severity</th><th>Status</th><th>Value</th><th>Details</th></tr></thead><tbody id="alertsTableBody"><tr><td colspan="5">No data loaded yet.</td></tr></tbody></table>
            </div>
            <h3 style="margin:8px 0;">Payment sessions</h3>
            <div class="table-wrap" style="max-height:180px;">
              <table><thead><tr><th>Provider</th><th>Status</th><th>User</th><th>Amount</th><th>Created</th></tr></thead><tbody id="sessionsTableBody"><tr><td colspan="5">No data loaded yet.</td></tr></tbody></table>
            </div>
            <h3 style="margin:18px 0 8px;">Weekly reports</h3>
            <div class="table-wrap" style="max-height:180px;">
              <table><thead><tr><th>User</th><th>Status</th><th>Week start</th><th>Created</th></tr></thead><tbody id="reportsTableBody"><tr><td colspan="4">No data loaded yet.</td></tr></tbody></table>
            </div>
            <h3 style="margin:18px 0 8px;">Audit events</h3>
            <div class="filters">
              <input id="auditUserIdFilter" placeholder="Filter by user UUID" />
              <input id="auditEventTypeFilter" placeholder="Filter by event type" />
              <select id="auditSeverityFilter">
                <option value="">All severities</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
              <input id="auditRequestIdFilter" placeholder="Filter by request ID" />
              <button id="applyAuditFiltersButton" class="secondary">Apply audit filters</button>
            </div>
            <div class="table-wrap" style="max-height:220px;">
              <table><thead><tr><th>Event</th><th>Severity</th><th>User</th><th>Created</th></tr></thead><tbody id="auditTableBody"><tr><td colspan="4">No data loaded yet.</td></tr></tbody></table>
            </div>
          </div>
        </div>
      </div>

      <script>
        const state = {
          adminKey: localStorage.getItem('mauri-admin-key') || '',
          selectedUserId: null,
          selectedSquadId: null
        };

        const el = {
          adminKey: document.getElementById('adminKey'),
          globalStatus: document.getElementById('globalStatus'),
          overviewCards: document.getElementById('overviewCards'),
          metricsCards: document.getElementById('metricsCards'),
          usersTableBody: document.getElementById('usersTableBody'),
          squadsTableBody: document.getElementById('squadsTableBody'),
          outboundTableBody: document.getElementById('outboundTableBody'),
          deadLettersTableBody: document.getElementById('deadLettersTableBody'),
          sessionsTableBody: document.getElementById('sessionsTableBody'),
          reportsTableBody: document.getElementById('reportsTableBody'),
          auditTableBody: document.getElementById('auditTableBody'),
          alertsTableBody: document.getElementById('alertsTableBody'),
          securityPostureContent: document.getElementById('securityPostureContent'),
          userDetailEmpty: document.getElementById('userDetailEmpty'),
          userDetailContent: document.getElementById('userDetailContent'),
          userDetailStats: document.getElementById('userDetailStats'),
          userSquadSummary: document.getElementById('userSquadSummary'),
          userSquadSummaryText: document.getElementById('userSquadSummaryText'),
          userProfileMeta: document.getElementById('userProfileMeta'),
          editFirstName: document.getElementById('editFirstName'),
          editArchetype: document.getElementById('editArchetype'),
          editOnboardingState: document.getElementById('editOnboardingState'),
          editSubscriptionStatus: document.getElementById('editSubscriptionStatus'),
          editTrialEndsAt: document.getElementById('editTrialEndsAt'),
          editSubscriptionEndsAt: document.getElementById('editSubscriptionEndsAt'),
          userSearch: document.getElementById('userSearch'),
          userSubscriptionFilter: document.getElementById('userSubscriptionFilter'),
          userOnboardingFilter: document.getElementById('userOnboardingFilter'),
          userLimit: document.getElementById('userLimit'),
          squadSearch: document.getElementById('squadSearch'),
          squadMemberUserIdFilter: document.getElementById('squadMemberUserIdFilter'),
          squadLimit: document.getElementById('squadLimit'),
          squadDetailEmpty: document.getElementById('squadDetailEmpty'),
          squadDetailContent: document.getElementById('squadDetailContent'),
          squadDetailStats: document.getElementById('squadDetailStats'),
          editSquadName: document.getElementById('editSquadName'),
          editSquadCode: document.getElementById('editSquadCode'),
          squadNudgeNote: document.getElementById('squadNudgeNote'),
          squadMembersBody: document.getElementById('squadMembersBody'),
          squadAuditBody: document.getElementById('squadAuditBody'),
          outboundUserIdFilter: document.getElementById('outboundUserIdFilter'),
          outboundStatusFilter: document.getElementById('outboundStatusFilter'),
          outboundLimit: document.getElementById('outboundLimit'),
          deadLetterUserIdFilter: document.getElementById('deadLetterUserIdFilter'),
          deadLetterStatusFilter: document.getElementById('deadLetterStatusFilter'),
          deadLetterCategoryFilter: document.getElementById('deadLetterCategoryFilter'),
          deadLetterLimit: document.getElementById('deadLetterLimit'),
          auditUserIdFilter: document.getElementById('auditUserIdFilter'),
          auditEventTypeFilter: document.getElementById('auditEventTypeFilter'),
          auditSeverityFilter: document.getElementById('auditSeverityFilter'),
          auditRequestIdFilter: document.getElementById('auditRequestIdFilter'),
          userRecentPaymentsBody: document.getElementById('userRecentPaymentsBody'),
          userRecentSessionsBody: document.getElementById('userRecentSessionsBody'),
          userRecentReportsBody: document.getElementById('userRecentReportsBody'),
          userRecentVoiceNotesBody: document.getElementById('userRecentVoiceNotesBody'),
          userRecentMemoriesBody: document.getElementById('userRecentMemoriesBody'),
          opsPaymentProvider: document.getElementById('opsPaymentProvider'),
          opsPaymentAmount: document.getElementById('opsPaymentAmount'),
          opsPaymentDurationDays: document.getElementById('opsPaymentDurationDays'),
          opsReportSendMessage: document.getElementById('opsReportSendMessage'),
          opsReportForceRegenerate: document.getElementById('opsReportForceRegenerate'),
          userOpsResult: document.getElementById('userOpsResult')
        };

        el.adminKey.value = state.adminKey;

        function escapeHtml(value) {
          return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function setStatus(message, kind = '') {
          el.globalStatus.textContent = message;
          el.globalStatus.className = 'status' + (kind ? ' ' + kind : '');
        }

        function headers() {
          return state.adminKey ? { 'x-mauri-admin-key': state.adminKey } : {};
        }

        async function api(path, options = {}) {
          const response = await fetch(path, {
            ...options,
            headers: {
              ...(options.body ? { 'content-type': 'application/json' } : {}),
              ...headers(),
              ...(options.headers || {})
            }
          });
          const contentType = response.headers.get('content-type') || '';
          const payload = contentType.includes('application/json') ? await response.json() : await response.text();
          if (!response.ok) {
            throw new Error(typeof payload === 'string' ? payload : (payload.error || 'Request failed'));
          }
          return payload;
        }

        function renderTable(target, rows, colspan, renderer) {
          if (!rows.length) {
            target.innerHTML = '<tr><td colspan="' + colspan + '">No records found.</td></tr>';
            return;
          }
          target.innerHTML = rows.map(renderer).join('');
        }

        function renderOverview(overview) {
          const cards = [
            ['Users', overview.users.total],
            ['Paid Active', overview.users.paidActive],
            ['Open Dead Letters', overview.operations.openDeadLetters],
            ['Outbound Pending', overview.operations.outboundPending],
            ['Reports This Week', overview.operations.reportsThisWeek],
            ['Outbound Failed', overview.operations.outboundFailed],
            ['Payment Events', overview.operations.paymentEvents],
            ['Voice Notes', overview.operations.voiceNotes]
          ];
          el.overviewCards.innerHTML = cards.slice(0, 5).map(([label, value]) =>
            '<div class="card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value) + '</div></div>'
          ).join('');
          el.metricsCards.innerHTML = cards.slice(5).map(([label, value]) =>
            '<div class="card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value) + '</div></div>'
          ).join('');
        }

        async function loadMetrics() {
          const data = await api('/internal/admin/metrics');
          const metrics = data.metrics;
          const cards = [
            ['Outbound Failed', metrics.outbound_failed + metrics.outbound_permanent_failed],
            ['Payment Events (24h)', metrics.payments_24h],
            ['Voice Notes (24h)', metrics.voice_notes_24h],
            ['Audit Errors (24h)', metrics.audit_errors_24h],
            ['Duplicate Inbound (24h)', metrics.inbound_duplicate_deliveries_24h]
          ];
          el.metricsCards.innerHTML = cards.map(([label, value]) =>
            '<div class="card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value) + '</div></div>'
          ).join('');
        }

        async function loadOverview() {
          const data = await api('/internal/admin/overview');
          renderOverview(data.overview);
        }

        async function loadUsers() {
          const params = new URLSearchParams();
          if (el.userSearch.value.trim()) params.set('search', el.userSearch.value.trim());
          if (el.userSubscriptionFilter.value) params.set('subscriptionStatus', el.userSubscriptionFilter.value);
          if (el.userOnboardingFilter.value) params.set('onboardingState', el.userOnboardingFilter.value);
          if (el.userLimit.value.trim()) params.set('limit', el.userLimit.value.trim());
          const data = await api('/internal/admin/users?' + params.toString());
          renderTable(el.usersTableBody, data.users, 6, (user) =>
            '<tr>' +
              '<td>' + escapeHtml(user.first_name || '-') + '</td>' +
              '<td class="mono">' + escapeHtml(user.phone_number) + '</td>' +
              '<td><span class="pill">' + escapeHtml(user.subscription_status) + '</span></td>' +
              '<td><span class="pill">' + escapeHtml(user.onboarding_state) + '</span></td>' +
              '<td>' + escapeHtml(user.updated_at) + '</td>' +
              '<td><button class="small secondary" data-user-id="' + escapeHtml(user.id) + '">Inspect</button></td>' +
            '</tr>'
          );
          el.usersTableBody.querySelectorAll('button[data-user-id]').forEach((button) => {
            button.addEventListener('click', () => {
              state.selectedUserId = button.getAttribute('data-user-id');
              loadUserProfile();
            });
          });
        }

        async function loadSquads() {
          const params = new URLSearchParams();
          if (el.squadSearch.value.trim()) params.set('search', el.squadSearch.value.trim());
          if (el.squadMemberUserIdFilter.value.trim()) params.set('memberUserId', el.squadMemberUserIdFilter.value.trim());
          if (el.squadLimit.value.trim()) params.set('limit', el.squadLimit.value.trim());
          const data = await api('/internal/admin/squads?' + params.toString());
          renderTable(el.squadsTableBody, data.squads, 6, (squad) =>
            '<tr>' +
              '<td>' + escapeHtml(squad.squad_name) + '</td>' +
              '<td class="mono">' + escapeHtml(squad.squad_code) + '</td>' +
              '<td>' + escapeHtml(squad.memberCount) + '</td>' +
              '<td>' + escapeHtml(squad.paidMemberCount) + '</td>' +
              '<td>' + escapeHtml(squad.created_at) + '</td>' +
              '<td><button class="small secondary" data-squad-id="' + escapeHtml(squad.id) + '">Inspect</button></td>' +
            '</tr>'
          );
          el.squadsTableBody.querySelectorAll('button[data-squad-id]').forEach((button) => {
            button.addEventListener('click', () => {
              state.selectedSquadId = button.getAttribute('data-squad-id');
              loadSquadProfile();
            });
          });
        }

        async function loadSquadProfile() {
          if (!state.selectedSquadId) return;
          const data = await api('/internal/admin/squads/' + state.selectedSquadId);
          const profile = data.profile;
          const squad = profile.squad;

          if (!squad) {
            setStatus('Squad not found.', 'error');
            state.selectedSquadId = null;
            el.squadDetailEmpty.classList.remove('hidden');
            el.squadDetailContent.classList.add('hidden');
            return;
          }

          el.squadDetailEmpty.classList.add('hidden');
          el.squadDetailContent.classList.remove('hidden');
          el.editSquadName.value = squad.squad_name || '';
          el.editSquadCode.value = squad.squad_code || '';

          const stats = [
            ['Squad ID', squad.id],
            ['Members', profile.stats.memberCount],
            ['Paid members', profile.stats.paidMemberCount],
            ['Nudge eligible', profile.stats.nudgeEligible ? 'yes' : 'no'],
            ['Created', squad.created_at]
          ];
          el.squadDetailStats.innerHTML = stats.map(([label, value]) =>
            '<div class="kv"><div class="label">' + escapeHtml(label) + '</div><div>' + escapeHtml(value) + '</div></div>'
          ).join('');

          el.squadNudgeNote.textContent = profile.stats.nudgeEligible
            ? 'This squad has enough paid members for cross-private nudges and Sunday showdowns.'
            : 'Nudges need at least 2 paid active members. This squad currently does not qualify.';

          renderTable(el.squadMembersBody, profile.members, 5, (item) =>
            '<tr>' +
              '<td>' + escapeHtml(item.user.first_name || '-') + '</td>' +
              '<td class="mono">' + escapeHtml(item.user.phone_number) + '</td>' +
              '<td><span class="pill">' + escapeHtml(item.user.subscription_status) + '</span></td>' +
              '<td>' + escapeHtml(item.isPaidActive ? 'yes' : 'no') + '</td>' +
              '<td class="actions">' +
                '<button class="small warning" data-action="remove-member" data-user-id="' + escapeHtml(item.user.id) + '">Remove</button>' +
                '<button class="small secondary" data-action="inspect-user" data-user-id="' + escapeHtml(item.user.id) + '">Inspect user</button>' +
              '</td>' +
            '</tr>'
          );

          el.squadMembersBody.querySelectorAll('button[data-action="remove-member"]').forEach((button) => {
            button.addEventListener('click', async () => {
              const userId = button.getAttribute('data-user-id');
              if (!userId || !window.confirm('Remove this member from the squad?')) return;
              try {
                await api('/internal/admin/squads/' + state.selectedSquadId + '/members/' + userId, { method: 'DELETE' });
                setStatus('Squad member removed.', 'success');
                await Promise.all([loadSquads(), loadSquadProfile(), loadAuditEvents()]);
              } catch (error) {
                setStatus(error.message || 'Failed to remove squad member.', 'error');
              }
            });
          });

          el.squadMembersBody.querySelectorAll('button[data-action="inspect-user"]').forEach((button) => {
            button.addEventListener('click', () => {
              state.selectedUserId = button.getAttribute('data-user-id');
              loadUserProfile();
            });
          });

          renderTable(el.squadAuditBody, profile.recentAuditEvents, 4, (item) =>
            '<tr><td>' + escapeHtml(item.event_type) + '</td><td><span class="pill">' + escapeHtml(item.severity) + '</span></td><td class="mono">' + escapeHtml(item.user_id || '-') + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
        }

        async function saveSquadChanges() {
          if (!state.selectedSquadId) return;
          const squadName = el.editSquadName.value.trim();
          if (!squadName) {
            setStatus('Squad name is required.', 'error');
            return;
          }
          await api('/internal/admin/squads/' + state.selectedSquadId, {
            method: 'PATCH',
            body: JSON.stringify({ squad_name: squadName })
          });
          setStatus('Squad name saved.', 'success');
          await Promise.all([loadSquads(), loadSquadProfile(), loadAuditEvents()]);
        }

        async function dissolveSelectedSquad() {
          if (!state.selectedSquadId) return;
          if (!window.confirm('Dissolve this squad for all members?')) return;
          await api('/internal/admin/squads/' + state.selectedSquadId, { method: 'DELETE' });
          state.selectedSquadId = null;
          el.squadDetailEmpty.classList.remove('hidden');
          el.squadDetailContent.classList.add('hidden');
          setStatus('Squad dissolved.', 'success');
          await Promise.all([loadSquads(), loadAuditEvents(), state.selectedUserId ? loadUserProfile() : Promise.resolve()]);
        }

        async function loadUserProfile() {
          if (!state.selectedUserId) return;
          const data = await api('/internal/admin/users/' + state.selectedUserId);
          const profile = data.profile;
          const user = profile.user;

          el.userDetailEmpty.classList.add('hidden');
          el.userDetailContent.classList.remove('hidden');
          el.editFirstName.value = user.first_name || '';
          el.editArchetype.value = user.archetype || '';
          el.editOnboardingState.value = '';
          el.editSubscriptionStatus.value = '';
          el.editTrialEndsAt.value = user.trial_ends_at || '';
          el.editSubscriptionEndsAt.value = user.subscription_ends_at || '';

          const stats = [
            ['User ID', user.id],
            ['Phone', user.phone_number],
            ['Pending todos', profile.stats.pendingTodos],
            ['Payment events', profile.stats.totalPaymentEvents],
            ['Weekly reports', profile.stats.totalReports],
            ['Voice notes', profile.stats.totalVoiceNotes],
            ['Memories', profile.stats.totalMemories],
            ['Latest report', profile.stats.latestWeeklyReportAt || '-']
          ];
          el.userDetailStats.innerHTML = stats.map(([label, value]) =>
            '<div class="kv"><div class="label">' + escapeHtml(label) + '</div><div>' + escapeHtml(value) + '</div></div>'
          ).join('');

          if (profile.squad) {
            el.userSquadSummary.classList.remove('hidden');
            el.userSquadSummaryText.textContent =
              profile.squad.squad_name + ' (' + profile.squad.squad_code + ') · ' + profile.squad.member_ids.length + ' members';
          } else {
            el.userSquadSummary.classList.add('hidden');
            el.userSquadSummaryText.textContent = '';
          }

          el.userProfileMeta.innerHTML =
            '<strong>Recent:</strong> payments ' + escapeHtml(profile.recentPaymentEvents.length) +
            ', sessions ' + escapeHtml(profile.recentCheckoutSessions.length) +
            ', reports ' + escapeHtml(profile.recentReports.length) +
            ', voice notes ' + escapeHtml(profile.recentVoiceNotes.length) +
            ', memories ' + escapeHtml(profile.recentMemories.length) + '.';

          renderTable(el.userRecentPaymentsBody, profile.recentPaymentEvents, 4, (item) =>
            '<tr><td>' + escapeHtml(item.provider) + '</td><td>' + escapeHtml(item.amount) + ' ' + escapeHtml(item.currency) + '</td><td class="mono">' + escapeHtml(item.transaction_reference) + '</td><td>' + escapeHtml(item.paid_at) + '</td></tr>'
          );
          renderTable(el.userRecentSessionsBody, profile.recentCheckoutSessions, 4, (item) =>
            '<tr><td>' + escapeHtml(item.provider) + '</td><td><span class="pill">' + escapeHtml(item.status) + '</span></td><td class="mono">' + escapeHtml(item.provider_reference) + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
          renderTable(el.userRecentReportsBody, profile.recentReports, 3, (item) =>
            '<tr><td><span class="pill">' + escapeHtml(item.delivery_status) + '</span></td><td>' + escapeHtml(item.week_start) + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
          renderTable(el.userRecentVoiceNotesBody, profile.recentVoiceNotes, 2, (item) =>
            '<tr><td>' + escapeHtml((item.transcript_text || '').slice(0, 120)) + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
          renderTable(el.userRecentMemoriesBody, profile.recentMemories, 3, (item) =>
            '<tr><td>' + escapeHtml(item.memory_type) + '</td><td>' + escapeHtml((item.content_text || '').slice(0, 120)) + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
        }

        async function saveUserChanges() {
          if (!state.selectedUserId) return;
          const payload = {};
          if (el.editFirstName.value.trim()) payload.first_name = el.editFirstName.value.trim();
          if (el.editArchetype.value.trim()) payload.archetype = el.editArchetype.value.trim();
          if (el.editOnboardingState.value) payload.onboarding_state = el.editOnboardingState.value;
          if (el.editSubscriptionStatus.value) payload.subscription_status = el.editSubscriptionStatus.value;
          if (el.editTrialEndsAt.value.trim()) payload.trial_ends_at = el.editTrialEndsAt.value.trim();
          if (el.editSubscriptionEndsAt.value.trim()) payload.subscription_ends_at = el.editSubscriptionEndsAt.value.trim();
          await api('/internal/admin/users/' + state.selectedUserId, { method: 'PATCH', body: JSON.stringify(payload) });
          setStatus('User changes saved.', 'success');
          await Promise.all([loadOverview(), loadUsers(), loadUserProfile()]);
        }

        function renderUserOpsResult(lines) {
          el.userOpsResult.textContent = lines.filter(Boolean).join('\\n');
        }

        async function generatePaymentLinkForSelectedUser() {
          if (!state.selectedUserId) {
            setStatus('Select a user first.', 'error');
            return;
          }

          setStatus('Generating payment link...');
          const data = await api('/internal/payments/links', {
            method: 'POST',
            body: JSON.stringify({
              userId: state.selectedUserId,
              provider: el.opsPaymentProvider.value,
              amount: Number(el.opsPaymentAmount.value || 200),
              durationDays: Number(el.opsPaymentDurationDays.value || 30)
            })
          });

          renderUserOpsResult([
            'Payment link created.',
            'Provider: ' + data.provider,
            'Session: ' + data.sessionId,
            'Reference: ' + data.providerReference,
            'Checkout: ' + (data.checkoutUrl || 'not available yet'),
            'Notes: ' + (data.notes || '-')
          ]);

          await Promise.all([loadUserProfile(), loadSessions(), loadAuditEvents()]);
          setStatus('Payment link generated for selected user.', 'success');
        }

        async function generateWeeklyReportForSelectedUser() {
          if (!state.selectedUserId) {
            setStatus('Select a user first.', 'error');
            return;
          }

          setStatus('Generating weekly report...');
          const data = await api('/internal/reports/weekly', {
            method: 'POST',
            body: JSON.stringify({
              userId: state.selectedUserId,
              sendMessage: el.opsReportSendMessage.checked,
              forceRegenerate: el.opsReportForceRegenerate.checked
            })
          });

          const preview = typeof data.reportText === 'string' ? data.reportText.slice(0, 240) : '';
          renderUserOpsResult([
            'Weekly report generated.',
            'Report: ' + data.reportId,
            'Week start: ' + data.weekStart,
            'Delivery: ' + data.deliveryStatus,
            preview ? 'Preview: ' + preview : ''
          ]);

          await Promise.all([loadUserProfile(), loadReports(), loadAuditEvents()]);
          setStatus('Weekly report generated for selected user.', 'success');
        }

        async function loadOutboundMessages() {
          const params = new URLSearchParams();
          if (el.outboundUserIdFilter.value.trim()) params.set('userId', el.outboundUserIdFilter.value.trim());
          if (el.outboundStatusFilter.value.trim()) params.set('status', el.outboundStatusFilter.value.trim());
          if (el.outboundLimit.value.trim()) params.set('limit', el.outboundLimit.value.trim());
          const data = await api('/internal/admin/outbound-messages?' + params.toString());
          renderTable(el.outboundTableBody, data.messages, 5, (item) =>
            '<tr>' +
              '<td><span class="pill">' + escapeHtml(item.status) + '</span></td>' +
              '<td class="mono">' + escapeHtml(item.phone_number) + '</td>' +
              '<td>' + escapeHtml(item.attempt_count) + '</td>' +
              '<td>' + escapeHtml(item.last_error || '-') + '</td>' +
              '<td class="actions">' +
                '<button class="small secondary" data-action="retry" data-id="' + escapeHtml(item.id) + '">Retry</button>' +
                '<button class="small warning" data-action="requeue" data-id="' + escapeHtml(item.id) + '">Requeue</button>' +
                '<button class="small danger" data-action="discard" data-id="' + escapeHtml(item.id) + '">Discard</button>' +
              '</td>' +
            '</tr>'
          );
          el.outboundTableBody.querySelectorAll('button[data-action]').forEach((button) => {
            button.addEventListener('click', async () => {
              const id = button.getAttribute('data-id');
              const action = button.getAttribute('data-action');
              const path = action === 'retry'
                ? '/internal/admin/outbound-messages/' + id + '/retry'
                : action === 'requeue'
                  ? '/internal/admin/outbound-messages/' + id + '/requeue'
                  : '/internal/admin/outbound-messages/' + id + '/discard';
              await api(path, { method: 'POST' });
              setStatus('Outbound action completed: ' + action + '.', 'success');
              await Promise.all([loadOverview(), loadOutboundMessages(), loadDeadLetters(), loadAuditEvents()]);
            });
          });
        }

        async function loadDeadLetters() {
          const params = new URLSearchParams();
          if (el.deadLetterUserIdFilter.value.trim()) params.set('userId', el.deadLetterUserIdFilter.value.trim());
          if (el.deadLetterStatusFilter.value.trim()) params.set('status', el.deadLetterStatusFilter.value.trim());
          if (el.deadLetterCategoryFilter.value.trim()) params.set('category', el.deadLetterCategoryFilter.value.trim());
          if (el.deadLetterLimit.value.trim()) params.set('limit', el.deadLetterLimit.value.trim());
          const data = await api('/internal/admin/dead-letters?' + params.toString());
          renderTable(el.deadLettersTableBody, data.deadLetters, 6, (item) =>
            '<tr>' +
              '<td>' + escapeHtml(item.category) + '</td>' +
              '<td><span class="pill">' + escapeHtml(item.status) + '</span></td>' +
              '<td class="mono">' + escapeHtml(item.source_id) + '</td>' +
              '<td>' + escapeHtml(item.last_error || '-') + '</td>' +
              '<td>' + escapeHtml(item.created_at) + '</td>' +
              '<td class="actions">' +
                (item.source_table === 'outbound_messages'
                  ? '<button class="small warning" data-action="requeue" data-id="' + escapeHtml(item.id) + '">Requeue source</button>'
                  : '') +
                '<button class="small danger" data-action="discard" data-id="' + escapeHtml(item.id) + '">Discard</button>' +
              '</td>' +
            '</tr>'
          );
          el.deadLettersTableBody.querySelectorAll('button[data-action]').forEach((button) => {
            button.addEventListener('click', async () => {
              const id = button.getAttribute('data-id');
              const action = button.getAttribute('data-action');
              const path = action === 'requeue'
                ? '/internal/admin/dead-letters/' + id + '/requeue'
                : '/internal/admin/dead-letters/' + id + '/discard';
              await api(path, { method: 'POST' });
              setStatus('Dead-letter action completed: ' + action + '.', 'success');
              await Promise.all([loadOverview(), loadMetrics(), loadOutboundMessages(), loadDeadLetters(), loadAuditEvents()]);
            });
          });
        }

        async function loadSecurityPosture() {
          const data = await api('/internal/admin/security-posture');
          const posture = data.securityPosture;
          const rows = [
            ['Trust proxy configured', posture.trustProxyConfigured],
            ['Security headers enabled', posture.securityHeadersEnabled],
            ['Admin allowlist configured', posture.adminAllowlistConfigured],
            ['Payment webhook allowlist configured', posture.paymentWebhookAllowlistConfigured],
            ['WhatsApp allowlist configured', posture.whatsappWebhookAllowlistConfigured],
            ['Metrics allowlist configured', posture.metricsAllowlistConfigured],
            ['Peach signature enabled', posture.peachSignatureEnabled],
            ['Outbound retry enabled', posture.outboundRetryEnabled],
            ['Warnings', posture.warnings.length ? posture.warnings.join(' | ') : 'None']
          ];
          document.getElementById('securityPostureContent').innerHTML = rows.map(([label, value]) =>
            '<div class="kv"><div class="label">' + escapeHtml(label) + '</div><div>' + escapeHtml(value) + '</div></div>'
          ).join('');
        }

        async function loadSessions() {
          const data = await api('/internal/admin/payment-sessions');
          renderTable(el.sessionsTableBody, data.sessions, 5, (item) =>
            '<tr><td>' + escapeHtml(item.provider) + '</td><td><span class="pill">' + escapeHtml(item.status) + '</span></td><td class="mono">' + escapeHtml(item.user_id) + '</td><td>' + escapeHtml(item.amount) + ' ' + escapeHtml(item.currency) + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
        }

        async function loadAlerts() {
          const data = await api('/internal/admin/alerts');
          renderTable(el.alertsTableBody, data.alerts, 5, (item) => {
            const metadata = item.metadata && item.metadata.warnings
              ? ' | ' + item.metadata.warnings.join(' | ')
              : '';
            return '<tr><td>' + escapeHtml(item.alert_key) + '</td><td><span class="pill">' + escapeHtml(item.severity) + '</span></td><td><span class="pill">' + escapeHtml(item.status) + '</span></td><td>' + escapeHtml((item.current_value ?? '-') + ' / ' + (item.threshold_value ?? '-')) + '</td><td>' + escapeHtml(metadata || '-') + '</td></tr>';
          });
        }

        async function loadReports() {
          const data = await api('/internal/admin/reports');
          renderTable(el.reportsTableBody, data.reports, 4, (item) =>
            '<tr><td class="mono">' + escapeHtml(item.user_id) + '</td><td><span class="pill">' + escapeHtml(item.delivery_status) + '</span></td><td>' + escapeHtml(item.week_start) + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
        }

        async function loadAuditEvents() {
          const params = new URLSearchParams();
          if (el.auditUserIdFilter.value.trim()) params.set('userId', el.auditUserIdFilter.value.trim());
          if (el.auditEventTypeFilter.value.trim()) params.set('eventType', el.auditEventTypeFilter.value.trim());
          if (el.auditSeverityFilter.value) params.set('severity', el.auditSeverityFilter.value);
          if (el.auditRequestIdFilter.value.trim()) params.set('requestId', el.auditRequestIdFilter.value.trim());
          const data = await api('/internal/admin/audit-events?' + params.toString());
          renderTable(el.auditTableBody, data.events, 4, (item) =>
            '<tr><td>' + escapeHtml(item.event_type) + '</td><td><span class="pill">' + escapeHtml(item.severity) + '</span></td><td class="mono">' + escapeHtml(item.user_id || '-') + '</td><td>' + escapeHtml(item.created_at) + '</td></tr>'
          );
        }

        async function refreshAll() {
          if (!state.adminKey) {
            setStatus('Paste and save the admin key first.', 'error');
            return;
          }
          setStatus('Refreshing panel data...');
          try {
            await Promise.all([
              loadOverview(),
              loadMetrics(),
              loadUsers(),
              loadSquads(),
              loadOutboundMessages(),
              loadDeadLetters(),
              loadSecurityPosture(),
              loadAlerts(),
              loadSessions(),
              loadReports(),
              loadAuditEvents(),
              state.selectedUserId ? loadUserProfile() : Promise.resolve(),
              state.selectedSquadId ? loadSquadProfile() : Promise.resolve()
            ]);
            setStatus('Panel refreshed successfully.', 'success');
          } catch (error) {
            setStatus(error.message || 'Refresh failed.', 'error');
          }
        }

        document.getElementById('saveKeyButton').addEventListener('click', () => {
          state.adminKey = el.adminKey.value.trim();
          localStorage.setItem('mauri-admin-key', state.adminKey);
          setStatus('Admin key saved locally in this browser.', 'success');
        });
        document.getElementById('refreshAllButton').addEventListener('click', refreshAll);
        document.getElementById('reloadUsersButton').addEventListener('click', loadUsers);
        document.getElementById('applyUserFiltersButton').addEventListener('click', loadUsers);
        document.getElementById('reloadSquadsButton').addEventListener('click', loadSquads);
        document.getElementById('applySquadFiltersButton').addEventListener('click', loadSquads);
        document.getElementById('reloadOutboundButton').addEventListener('click', loadOutboundMessages);
        document.getElementById('reloadDeadLettersButton').addEventListener('click', loadDeadLetters);
        document.getElementById('reloadSecurityButton').addEventListener('click', loadSecurityPosture);
        document.getElementById('reloadOpsButton').addEventListener('click', () => Promise.all([loadAlerts(), loadSessions(), loadReports(), loadAuditEvents()]));
        document.getElementById('applyAuditFiltersButton').addEventListener('click', loadAuditEvents);
        document.getElementById('evaluateAlertsButton').addEventListener('click', async () => {
          await api('/internal/admin/alerts/evaluate', { method: 'POST' });
          await Promise.all([loadOverview(), loadMetrics(), loadAlerts(), loadAuditEvents()]);
          setStatus('Operational alerts evaluated.', 'success');
        });
        document.getElementById('reloadUserProfileButton').addEventListener('click', loadUserProfile);
        document.getElementById('viewUserSquadButton').addEventListener('click', async () => {
          if (!state.selectedUserId) return;
          const data = await api('/internal/admin/users/' + state.selectedUserId);
          if (!data.profile.squad) {
            setStatus('This user is not in a squad.', 'error');
            return;
          }
          state.selectedSquadId = data.profile.squad.id;
          await loadSquadProfile();
          setStatus('Loaded squad for selected user.', 'success');
        });
        document.getElementById('saveUserButton').addEventListener('click', saveUserChanges);
        document.getElementById('focusOutboundForUserButton').addEventListener('click', async () => {
          if (!state.selectedUserId) return;
          el.outboundUserIdFilter.value = state.selectedUserId;
          await loadOutboundMessages();
          setStatus('Outbound queue filtered to selected user.', 'success');
        });
        document.getElementById('focusDeadLettersForUserButton').addEventListener('click', async () => {
          if (!state.selectedUserId) return;
          el.deadLetterUserIdFilter.value = state.selectedUserId;
          await loadDeadLetters();
          setStatus('Dead letters filtered to selected user.', 'success');
        });
        document.getElementById('clearSelectedUserButton').addEventListener('click', () => {
          state.selectedUserId = null;
          el.userDetailEmpty.classList.remove('hidden');
          el.userDetailContent.classList.add('hidden');
          el.userSquadSummary.classList.add('hidden');
          renderUserOpsResult(['Run an ops action for the selected user.']);
          setStatus('Selected user cleared.', 'success');
        });
        document.getElementById('saveSquadButton').addEventListener('click', async () => {
          try {
            await saveSquadChanges();
          } catch (error) {
            setStatus(error.message || 'Failed to save squad.', 'error');
          }
        });
        document.getElementById('reloadSquadProfileButton').addEventListener('click', loadSquadProfile);
        document.getElementById('dissolveSquadButton').addEventListener('click', async () => {
          try {
            await dissolveSelectedSquad();
          } catch (error) {
            setStatus(error.message || 'Failed to dissolve squad.', 'error');
          }
        });
        document.getElementById('clearSelectedSquadButton').addEventListener('click', () => {
          state.selectedSquadId = null;
          el.squadDetailEmpty.classList.remove('hidden');
          el.squadDetailContent.classList.add('hidden');
          setStatus('Selected squad cleared.', 'success');
        });
        document.getElementById('generatePaymentLinkButton').addEventListener('click', async () => {
          try {
            await generatePaymentLinkForSelectedUser();
          } catch (error) {
            setStatus(error.message || 'Payment link generation failed.', 'error');
          }
        });
        document.getElementById('generateWeeklyReportButton').addEventListener('click', async () => {
          try {
            await generateWeeklyReportForSelectedUser();
          } catch (error) {
            setStatus(error.message || 'Weekly report generation failed.', 'error');
          }
        });

        el.adminKey.value = state.adminKey;
        if (state.adminKey) refreshAll();
      </script>
    </div>
  </body>
</html>`;
}

export const adminRouter = Router();

adminRouter.get("/panel", (_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.status(200).send(renderAdminPanelHtml());
});

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

adminRouter.get("/metrics", async (_request, response, next) => {
  try {
    const snapshot = await getMetricsSnapshot();
    response.status(200).json({
      ok: true,
      metrics: snapshot
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/alerts", async (request, response, next) => {
  try {
    const status =
      typeof request.query.status === "string" && request.query.status.trim()
        ? request.query.status.trim()
        : undefined;
    const alerts = await listOperationalAlerts(status);
    response.status(200).json({
      ok: true,
      alerts
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/alerts/evaluate", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const alerts = await evaluateAndPersistOperationalAlerts({ requestId });
    response.status(200).json({
      ok: true,
      alerts
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

adminRouter.get("/squads", async (request, response, next) => {
  try {
    const query = listSquadsQuerySchema.parse(request.query);
    const result = await listAdminSquads(query);

    response.status(200).json({
      ok: true,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      squads: result.squads
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/squads/:squadId", async (request, response, next) => {
  try {
    const params = squadParamsSchema.parse(request.params);
    const profile = await getAdminSquadProfile(params.squadId);

    if (!profile.squad) {
      response.status(404).json({
        ok: false,
        error: "Squad not found."
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

adminRouter.patch("/squads/:squadId", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const params = squadParamsSchema.parse(request.params);
    const body = updateSquadBodySchema.parse(request.body);
    const squad = await adminUpdateSquad({
      squadId: params.squadId,
      squadName: body.squad_name,
      requestId
    });

    response.status(200).json({
      ok: true,
      squad
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/squads/:squadId", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const params = squadParamsSchema.parse(request.params);
    await adminDissolveSquad({
      squadId: params.squadId,
      requestId
    });

    response.status(200).json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/squads/:squadId/members/:userId", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const params = squadMemberParamsSchema.parse(request.params);
    const squad = await adminRemoveSquadMember({
      squadId: params.squadId,
      userId: params.userId,
      requestId
    });

    response.status(200).json({
      ok: true,
      squad
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

adminRouter.post("/dead-letters/:deadLetterId/requeue", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const deadLetterId = z.string().uuid().parse(request.params.deadLetterId);
    const deadLetter = await getDeadLetterById(deadLetterId);

    if (!deadLetter) {
      response.status(404).json({
        ok: false,
        error: "Dead letter not found."
      });
      return;
    }

    if (deadLetter.source_table === "outbound_messages") {
      const message = await getOutboundMessageById(deadLetter.source_id);

      if (!message) {
        response.status(404).json({
          ok: false,
          error: "Source outbound message not found."
        });
        return;
      }

      const result = await requeueOutboundMessage(deadLetter.source_id);

      await updateDeadLetterStatus({
        sourceTable: deadLetter.source_table,
        sourceId: deadLetter.source_id,
        status: "requeued",
        requestId,
        message: "Admin requeued dead letter via outbound source."
      });

      await recordAuditEventBestEffort({
        requestId,
        eventType: "admin_dead_letter_requeued",
        actorType: "admin_api",
        entityType: "dead_letter",
        entityId: deadLetter.id,
        message: "Admin requeued dead letter from outbound source.",
        metadata: {
          outboundMessageId: result.id,
          status: result.status
        }
      });

      response.status(200).json({
        ok: true,
        result
      });
      return;
    }

    const result = await updateDeadLetterStatus({
      sourceTable: deadLetter.source_table,
      sourceId: deadLetter.source_id,
      status: "resolved",
      requestId,
      message: "Admin resolved dead letter without outbound source."
    });

    await recordAuditEventBestEffort({
      requestId,
      eventType: "admin_dead_letter_resolved",
      actorType: "admin_api",
      entityType: "dead_letter",
      entityId: deadLetter.id,
      message: "Admin resolved dead letter without outbound source."
    });

    response.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/dead-letters/:deadLetterId/discard", async (request, response, next) => {
  try {
    const requestId = getRequestId(response);
    const deadLetterId = z.string().uuid().parse(request.params.deadLetterId);
    const deadLetter = await getDeadLetterById(deadLetterId);

    if (!deadLetter) {
      response.status(404).json({
        ok: false,
        error: "Dead letter not found."
      });
      return;
    }

    if (deadLetter.source_table === "outbound_messages") {
      const message = await getOutboundMessageById(deadLetter.source_id);

      if (message) {
        await discardOutboundMessage(deadLetter.source_id);
      }
    }

    const result = await updateDeadLetterStatus({
      sourceTable: deadLetter.source_table,
      sourceId: deadLetter.source_id,
      status: "discarded",
      requestId,
      message: "Admin discarded dead letter."
    });

    await recordAuditEventBestEffort({
      requestId,
      eventType: "admin_dead_letter_discarded",
      actorType: "admin_api",
      entityType: "dead_letter",
      entityId: deadLetter.id,
      message: "Admin discarded dead letter."
    });

    response.status(200).json({
      ok: true,
      result
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
