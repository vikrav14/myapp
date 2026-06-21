import { supabase } from "../lib/supabase.js";
import type {
  AuditEventRecord,
  MauriUser,
  OutboundMessageRecord,
  PaymentCheckoutSessionRecord,
  PaymentEvent,
  WeeklyReportRecord,
  VoiceNoteTranscriptionRecord
} from "../types.js";
import { mapUser, updateUserState } from "./user.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function mapCheckoutSession(record: Record<string, unknown>): PaymentCheckoutSessionRecord {
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

function mapWeeklyReport(record: Record<string, unknown>): WeeklyReportRecord {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    week_start: String(record.week_start),
    week_end: String(record.week_end),
    report_text: String(record.report_text),
    summary_json: isRecord(record.summary_json)
      ? (record.summary_json as unknown as WeeklyReportRecord["summary_json"])
      : ({} as WeeklyReportRecord["summary_json"]),
    delivery_status: String(record.delivery_status),
    sent_at: record.sent_at ? String(record.sent_at) : null,
    created_at: String(record.created_at)
  };
}

function mapVoiceNote(record: Record<string, unknown>): VoiceNoteTranscriptionRecord {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    provider: String(record.provider),
    source_message_id: record.source_message_id ? String(record.source_message_id) : null,
    media_id: record.media_id ? String(record.media_id) : null,
    mime_type: record.mime_type ? String(record.mime_type) : null,
    transcript_text: String(record.transcript_text),
    raw_payload: record.raw_payload ?? null,
    transcribed_at: String(record.transcribed_at),
    created_at: String(record.created_at)
  };
}

function mapOutboundMessage(record: Record<string, unknown>): OutboundMessageRecord {
  return {
    id: String(record.id),
    provider: String(record.provider),
    channel: String(record.channel),
    user_id: record.user_id ? String(record.user_id) : null,
    phone_number: String(record.phone_number),
    body: String(record.body),
    status: String(record.status),
    request_id: record.request_id ? String(record.request_id) : null,
    metadata: isRecord(record.metadata) ? record.metadata : null,
    attempt_count: Number(record.attempt_count ?? 0),
    last_error: record.last_error ? String(record.last_error) : null,
    next_attempt_at: String(record.next_attempt_at),
    sent_at: record.sent_at ? String(record.sent_at) : null,
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

function mapAuditEvent(record: Record<string, unknown>): AuditEventRecord {
  return {
    id: String(record.id),
    request_id: record.request_id ? String(record.request_id) : null,
    event_type: String(record.event_type),
    severity: String(record.severity),
    actor_type: record.actor_type ? String(record.actor_type) : null,
    actor_id: record.actor_id ? String(record.actor_id) : null,
    user_id: record.user_id ? String(record.user_id) : null,
    entity_type: record.entity_type ? String(record.entity_type) : null,
    entity_id: record.entity_id ? String(record.entity_id) : null,
    message: record.message ? String(record.message) : null,
    metadata: isRecord(record.metadata) ? record.metadata : null,
    created_at: String(record.created_at)
  };
}

function startOfWeekIso(): string {
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayOffsetFromMonday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - dayOffsetFromMonday);
  return anchor.toISOString();
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const result = await query;
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.count ?? 0;
}

export async function getAdminOverview(): Promise<{
  users: {
    total: number;
    trialActive: number;
    paidActive: number;
    locked: number;
    awaitingArchetype: number;
  };
  operations: {
    activeThisWeek: number;
    reportsThisWeek: number;
    preparedSessions: number;
    activatedSessions: number;
    paymentEvents: number;
    voiceNotes: number;
    outboundPending: number;
    outboundFailed: number;
  };
}> {
  const weekStart = startOfWeekIso();

  const [
    totalUsers,
    trialActive,
    paidActive,
    locked,
    awaitingArchetype,
    activeThisWeek,
    reportsThisWeek,
    preparedSessions,
    activatedSessions,
    paymentEvents,
    voiceNotes,
    outboundPending,
    outboundFailed
  ] = await Promise.all([
    countRows(supabase.from("users").select("*", { count: "exact", head: true })),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("subscription_status", "Trial_Active")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("subscription_status", "Paid_Active")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("subscription_status", "Locked")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).eq("onboarding_state", "awaiting_archetype")),
    countRows(supabase.from("users").select("*", { count: "exact", head: true }).gte("updated_at", weekStart)),
    countRows(supabase.from("weekly_reports").select("*", { count: "exact", head: true }).gte("created_at", weekStart)),
    countRows(supabase.from("payment_checkout_sessions").select("*", { count: "exact", head: true }).eq("status", "prepared")),
    countRows(supabase.from("payment_checkout_sessions").select("*", { count: "exact", head: true }).eq("status", "activated")),
    countRows(supabase.from("payment_events").select("*", { count: "exact", head: true }).gte("created_at", weekStart)),
    countRows(supabase.from("voice_note_transcriptions").select("*", { count: "exact", head: true }).gte("created_at", weekStart)),
    countRows(supabase.from("outbound_messages").select("*", { count: "exact", head: true }).eq("status", "pending")),
    countRows(supabase.from("outbound_messages").select("*", { count: "exact", head: true }).in("status", ["failed", "permanent_failed"]))
  ]);

  return {
    users: {
      total: totalUsers,
      trialActive,
      paidActive,
      locked,
      awaitingArchetype
    },
    operations: {
      activeThisWeek,
      reportsThisWeek,
      preparedSessions,
      activatedSessions,
      paymentEvents,
      voiceNotes,
      outboundPending,
      outboundFailed
    }
  };
}

export async function listAdminUsers(input: {
  limit: number;
  offset: number;
  subscriptionStatus?: string | undefined;
  onboardingState?: string | undefined;
  search?: string | undefined;
}): Promise<{
  users: MauriUser[];
  total: number;
}> {
  let query = supabase.from("users").select("*", { count: "exact" }).order("updated_at", { ascending: false });

  if (input.subscriptionStatus) {
    query = query.eq("subscription_status", input.subscriptionStatus);
  }

  if (input.onboardingState) {
    query = query.eq("onboarding_state", input.onboardingState);
  }

  if (input.search?.trim()) {
    const search = input.search.trim();
    query = query.or(`phone_number.ilike.%${search}%,first_name.ilike.%${search}%`);
  }

  const { data, error, count } = await query.range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throw new Error(`Failed to list admin users: ${error.message}`);
  }

  return {
    users: (data ?? []).map((row) => mapUser(row as Record<string, unknown>)),
    total: count ?? 0
  };
}

export async function getAdminUserProfile(userId: string): Promise<{
  user: MauriUser | null;
  stats: {
    pendingTodos: number;
    totalPaymentEvents: number;
    totalReports: number;
    totalVoiceNotes: number;
    totalMemories: number;
    latestWeeklyReportAt: string | null;
  };
  recentPaymentEvents: PaymentEvent[];
  recentCheckoutSessions: PaymentCheckoutSessionRecord[];
  recentReports: WeeklyReportRecord[];
  recentVoiceNotes: VoiceNoteTranscriptionRecord[];
  recentMemories: Array<{
    id: string;
    memory_type: string;
    content_text: string;
    created_at: string;
  }>;
}> {
  const [
    userResult,
    pendingTodoCount,
    paymentEventCount,
    reportCount,
    voiceNoteCount,
    memoryCount,
    paymentEventsResult,
    checkoutSessionsResult,
    reportsResult,
    voiceNotesResult,
    memoriesResult
  ] = await Promise.all([
    supabase.from("users").select("*").eq("id", userId).maybeSingle(),
    countRows(supabase.from("todo_logs").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("is_completed", false)),
    countRows(supabase.from("payment_events").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    countRows(supabase.from("weekly_reports").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    countRows(supabase.from("voice_note_transcriptions").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    countRows(supabase.from("conversation_memories").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    supabase.from("payment_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("payment_checkout_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("weekly_reports").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("voice_note_transcriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("conversation_memories").select("id, memory_type, content_text, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10)
  ]);

  const queryErrors = [
    userResult.error,
    paymentEventsResult.error,
    checkoutSessionsResult.error,
    reportsResult.error,
    voiceNotesResult.error,
    memoriesResult.error
  ].filter(Boolean);

  if (queryErrors.length > 0) {
    throw new Error(queryErrors.map((error) => error?.message).join("; "));
  }

  const latestReport = (reportsResult.data ?? [])[0];

  return {
    user: userResult.data ? mapUser(userResult.data as Record<string, unknown>) : null,
    stats: {
      pendingTodos: pendingTodoCount,
      totalPaymentEvents: paymentEventCount,
      totalReports: reportCount,
      totalVoiceNotes: voiceNoteCount,
      totalMemories: memoryCount,
      latestWeeklyReportAt: latestReport?.created_at ? String(latestReport.created_at) : null
    },
    recentPaymentEvents: (paymentEventsResult.data ?? []).map((row) => mapPaymentEvent(row as Record<string, unknown>)),
    recentCheckoutSessions: (checkoutSessionsResult.data ?? []).map((row) => mapCheckoutSession(row as Record<string, unknown>)),
    recentReports: (reportsResult.data ?? []).map((row) => mapWeeklyReport(row as Record<string, unknown>)),
    recentVoiceNotes: (voiceNotesResult.data ?? []).map((row) => mapVoiceNote(row as Record<string, unknown>)),
    recentMemories: (memoriesResult.data ?? []).map((row) => ({
      id: String(row.id),
      memory_type: String(row.memory_type),
      content_text: String(row.content_text),
      created_at: String(row.created_at)
    }))
  };
}

export async function listAdminPaymentSessions(input: {
  limit: number;
  offset: number;
  userId?: string | undefined;
  provider?: string | undefined;
  status?: string | undefined;
}): Promise<{
  sessions: PaymentCheckoutSessionRecord[];
  total: number;
}> {
  let query = supabase
    .from("payment_checkout_sessions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  if (input.provider) {
    query = query.eq("provider", input.provider);
  }

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error, count } = await query.range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throw new Error(`Failed to list payment checkout sessions: ${error.message}`);
  }

  return {
    sessions: (data ?? []).map((row) => mapCheckoutSession(row as Record<string, unknown>)),
    total: count ?? 0
  };
}

export async function listAdminReports(input: {
  limit: number;
  offset: number;
  userId?: string | undefined;
  deliveryStatus?: string | undefined;
}): Promise<{
  reports: WeeklyReportRecord[];
  total: number;
}> {
  let query = supabase.from("weekly_reports").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  if (input.deliveryStatus) {
    query = query.eq("delivery_status", input.deliveryStatus);
  }

  const { data, error, count } = await query.range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throw new Error(`Failed to list weekly reports: ${error.message}`);
  }

  return {
    reports: (data ?? []).map((row) => mapWeeklyReport(row as Record<string, unknown>)),
    total: count ?? 0
  };
}

export async function listAdminAuditEvents(input: {
  limit: number;
  offset: number;
  userId?: string | undefined;
  eventType?: string | undefined;
  severity?: string | undefined;
  requestId?: string | undefined;
}): Promise<{
  events: AuditEventRecord[];
  total: number;
}> {
  let query = supabase.from("audit_events").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  if (input.eventType) {
    query = query.eq("event_type", input.eventType);
  }

  if (input.severity) {
    query = query.eq("severity", input.severity);
  }

  if (input.requestId) {
    query = query.eq("request_id", input.requestId);
  }

  const { data, error, count } = await query.range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throw new Error(`Failed to list audit events: ${error.message}`);
  }

  return {
    events: (data ?? []).map((row) => mapAuditEvent(row as Record<string, unknown>)),
    total: count ?? 0
  };
}

export async function listAdminOutboundMessages(input: {
  limit: number;
  offset: number;
  userId?: string | undefined;
  status?: string | undefined;
}): Promise<{
  messages: OutboundMessageRecord[];
  total: number;
}> {
  let query = supabase.from("outbound_messages").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error, count } = await query.range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throw new Error(`Failed to list outbound messages: ${error.message}`);
  }

  return {
    messages: (data ?? []).map((row) => mapOutboundMessage(row as Record<string, unknown>)),
    total: count ?? 0
  };
}

export async function adminUpdateUser(input: {
  userId: string;
  updates: {
    first_name?: string | null | undefined;
    archetype?: string | undefined;
    onboarding_state?: MauriUser["onboarding_state"] | undefined;
    subscription_status?: MauriUser["subscription_status"] | undefined;
    trial_ends_at?: string | null | undefined;
    subscription_ends_at?: string | null | undefined;
  };
}): Promise<MauriUser> {
  const patch: Record<string, unknown> = {};

  if (input.updates.first_name !== undefined) {
    patch.first_name = input.updates.first_name;
  }

  if (input.updates.archetype !== undefined) {
    patch.archetype = input.updates.archetype;
  }

  if (input.updates.onboarding_state !== undefined) {
    patch.onboarding_state = input.updates.onboarding_state;
  }

  if (input.updates.subscription_status !== undefined) {
    patch.subscription_status = input.updates.subscription_status;

    if (input.updates.subscription_status === "Locked") {
      patch.locked_at = new Date().toISOString();
    }

    if (input.updates.subscription_status === "Paid_Active") {
      patch.locked_at = null;
    }
  }

  if (input.updates.trial_ends_at !== undefined) {
    patch.trial_ends_at = input.updates.trial_ends_at;
  }

  if (input.updates.subscription_ends_at !== undefined) {
    patch.subscription_ends_at = input.updates.subscription_ends_at;
  }

  return updateUserState(input.userId, patch);
}
