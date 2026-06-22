import { supabase } from "../lib/supabase.js";
import { renderHttpPrometheusMetrics } from "../lib/http-metrics.js";
import type { MetricsSnapshot } from "../types.js";

function startOfWindow(hoursBack: number): string {
  const now = new Date();
  now.setUTCHours(now.getUTCHours() - hoursBack);
  return now.toISOString();
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const result = await query;
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.count ?? 0;
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const since24h = startOfWindow(24);

  const [
    usersTotal,
    usersTrialActive,
    usersPaidActive,
    usersLocked,
    usersAwaitingArchetype,
    outboundPending,
    outboundFailed,
    outboundPermanentFailed,
    deadLettersOpen,
    alertsOpen,
    payments24h,
    reports24h,
    voiceNotes24h,
    auditErrors24h,
    inboundDuplicateRows
  ] = await Promise.all([
    countRows(supabase.from("users").select("*", { count: "exact", head: true })),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("subscription_status", "Trial_Active")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("subscription_status", "Paid_Active")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("subscription_status", "Locked")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("onboarding_state", "awaiting_archetype")),
    countRows(supabase.from("outbound_messages").select("*", { count: "exact", head: true }).eq("status", "pending")),
    countRows(supabase.from("outbound_messages").select("*", { count: "exact", head: true }).eq("status", "failed")),
    countRows(supabase.from("outbound_messages").select("*", { count: "exact", head: true }).eq("status", "permanent_failed")),
    countRows(supabase.from("dead_letter_events").select("*", { count: "exact", head: true }).eq("status", "open")),
    countRows(supabase.from("operational_alert_states").select("*", { count: "exact", head: true }).eq("status", "open")),
    countRows(supabase.from("payment_events").select("*", { count: "exact", head: true }).gte("created_at", since24h)),
    countRows(supabase.from("weekly_reports").select("*", { count: "exact", head: true }).gte("created_at", since24h)),
    countRows(supabase.from("voice_note_transcriptions").select("*", { count: "exact", head: true }).gte("created_at", since24h)),
    countRows(supabase.from("audit_events").select("*", { count: "exact", head: true }).eq("severity", "error").gte("created_at", since24h)),
    supabase
      .from("processed_inbound_events")
      .select("duplicate_count")
      .gte("last_seen_at", since24h)
  ]);

  if (inboundDuplicateRows.error) {
    throw new Error(inboundDuplicateRows.error.message);
  }

  const inboundDuplicateDeliveries24h = (inboundDuplicateRows.data ?? []).reduce(
    (sum, row) => sum + Number(row.duplicate_count ?? 0),
    0
  );

  return {
    generated_at: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    process_resident_memory_bytes: process.memoryUsage().rss,
    users_total: usersTotal,
    users_trial_active: usersTrialActive,
    users_paid_active: usersPaidActive,
    users_locked: usersLocked,
    users_awaiting_archetype: usersAwaitingArchetype,
    outbound_pending: outboundPending,
    outbound_failed: outboundFailed,
    outbound_permanent_failed: outboundPermanentFailed,
    dead_letters_open: deadLettersOpen,
    alerts_open: alertsOpen,
    payments_24h: payments24h,
    reports_24h: reports24h,
    voice_notes_24h: voiceNotes24h,
    audit_errors_24h: auditErrors24h,
    inbound_duplicate_deliveries_24h: inboundDuplicateDeliveries24h
  };
}

export function renderPrometheusMetrics(snapshot: MetricsSnapshot): string {
  const lines = [
    "# HELP mauri_uptime_seconds Process uptime in seconds",
    "# TYPE mauri_uptime_seconds gauge",
    `mauri_uptime_seconds ${snapshot.uptime_seconds}`,
    "# HELP mauri_process_resident_memory_bytes Resident memory usage in bytes",
    "# TYPE mauri_process_resident_memory_bytes gauge",
    `mauri_process_resident_memory_bytes ${snapshot.process_resident_memory_bytes}`,
    "# HELP mauri_users_total Total users",
    "# TYPE mauri_users_total gauge",
    `mauri_users_total ${snapshot.users_total}`,
    "# HELP mauri_users_trial_active Trial-active users",
    "# TYPE mauri_users_trial_active gauge",
    `mauri_users_trial_active ${snapshot.users_trial_active}`,
    "# HELP mauri_users_paid_active Paid-active users",
    "# TYPE mauri_users_paid_active gauge",
    `mauri_users_paid_active ${snapshot.users_paid_active}`,
    "# HELP mauri_users_locked Locked users",
    "# TYPE mauri_users_locked gauge",
    `mauri_users_locked ${snapshot.users_locked}`,
    "# HELP mauri_users_awaiting_archetype Users waiting for onboarding choice",
    "# TYPE mauri_users_awaiting_archetype gauge",
    `mauri_users_awaiting_archetype ${snapshot.users_awaiting_archetype}`,
    "# HELP mauri_outbound_pending Pending outbound messages",
    "# TYPE mauri_outbound_pending gauge",
    `mauri_outbound_pending ${snapshot.outbound_pending}`,
    "# HELP mauri_outbound_failed Failed outbound messages awaiting retry",
    "# TYPE mauri_outbound_failed gauge",
    `mauri_outbound_failed ${snapshot.outbound_failed}`,
    "# HELP mauri_outbound_permanent_failed Permanently failed outbound messages",
    "# TYPE mauri_outbound_permanent_failed gauge",
    `mauri_outbound_permanent_failed ${snapshot.outbound_permanent_failed}`,
    "# HELP mauri_dead_letters_open Open dead-letter events",
    "# TYPE mauri_dead_letters_open gauge",
    `mauri_dead_letters_open ${snapshot.dead_letters_open}`,
    "# HELP mauri_alerts_open Open operational alerts",
    "# TYPE mauri_alerts_open gauge",
    `mauri_alerts_open ${snapshot.alerts_open}`,
    "# HELP mauri_payments_24h Payment events in last 24 hours",
    "# TYPE mauri_payments_24h gauge",
    `mauri_payments_24h ${snapshot.payments_24h}`,
    "# HELP mauri_reports_24h Weekly reports generated in last 24 hours",
    "# TYPE mauri_reports_24h gauge",
    `mauri_reports_24h ${snapshot.reports_24h}`,
    "# HELP mauri_voice_notes_24h Voice note transcriptions in last 24 hours",
    "# TYPE mauri_voice_notes_24h gauge",
    `mauri_voice_notes_24h ${snapshot.voice_notes_24h}`,
    "# HELP mauri_audit_errors_24h Error-severity audit events in last 24 hours",
    "# TYPE mauri_audit_errors_24h gauge",
    `mauri_audit_errors_24h ${snapshot.audit_errors_24h}`,
    "# HELP mauri_inbound_duplicate_deliveries_24h Duplicate inbound webhook deliveries seen in last 24 hours",
    "# TYPE mauri_inbound_duplicate_deliveries_24h gauge",
    `mauri_inbound_duplicate_deliveries_24h ${snapshot.inbound_duplicate_deliveries_24h}`
  ];

  const businessMetrics = lines.join("\n") + "\n";
  const httpMetrics = renderHttpPrometheusMetrics();
  return httpMetrics ? `${businessMetrics}${httpMetrics}` : businessMetrics;
}
