import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { OutboundMessageRecord } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function nextAttemptIso(attemptCount: number): string {
  const delaySeconds = env.OUTBOUND_RETRY_BASE_DELAY_SECONDS * 2 ** Math.max(0, attemptCount - 1);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function createOutboundMessage(input: {
  phoneNumber: string;
  body: string;
  userId?: string | null | undefined;
  requestId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<OutboundMessageRecord> {
  const { data, error } = await supabase
    .from("outbound_messages")
    .insert({
      provider: "whatsapp",
      channel: "text",
      user_id: input.userId ?? null,
      phone_number: input.phoneNumber,
      body: input.body,
      status: "pending",
      request_id: input.requestId ?? null,
      metadata: input.metadata ?? null
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create outbound message: ${error.message}`);
  }

  return mapOutboundMessage(data as Record<string, unknown>);
}

export async function markOutboundMessageSent(messageId: string): Promise<OutboundMessageRecord> {
  const current = await getOutboundMessageById(messageId);
  const nextAttemptCount = (current?.attempt_count ?? 0) + 1;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("outbound_messages")
    .update({
      status: "sent",
      attempt_count: nextAttemptCount,
      sent_at: now,
      updated_at: now,
      last_error: null
    })
    .eq("id", messageId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to mark outbound message as sent: ${error.message}`);
  }

  const record = mapOutboundMessage(data as Record<string, unknown>);

  await recordAuditEventBestEffort({
    requestId: record.request_id ?? undefined,
    eventType: "outbound_message_sent",
    actorType: "system_message",
    userId: record.user_id,
    entityType: "outbound_message",
    entityId: record.id,
    message: "Outbound WhatsApp message sent.",
    metadata: {
      phoneNumber: record.phone_number,
      attemptCount: record.attempt_count
    }
  });

  return record;
}

export async function markOutboundMessageSending(messageId: string): Promise<void> {
  const { error } = await supabase
    .from("outbound_messages")
    .update({
      status: "sending",
      updated_at: new Date().toISOString()
    })
    .eq("id", messageId);

  if (error) {
    throw new Error(`Failed to mark outbound message as sending: ${error.message}`);
  }
}

export async function markOutboundMessageFailed(input: {
  messageId: string;
  errorMessage: string;
}): Promise<OutboundMessageRecord> {
  const { data: current, error: currentError } = await supabase
    .from("outbound_messages")
    .select("*")
    .eq("id", input.messageId)
    .single();

  if (currentError) {
    throw new Error(`Failed to load outbound message for failure update: ${currentError.message}`);
  }

  const currentRecord = mapOutboundMessage(current as Record<string, unknown>);
  const nextAttemptCount = currentRecord.attempt_count + 1;
  const permanentFailure = nextAttemptCount >= env.OUTBOUND_RETRY_MAX_ATTEMPTS;
  const status = permanentFailure ? "permanent_failed" : "failed";
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("outbound_messages")
    .update({
      status,
      attempt_count: nextAttemptCount,
      last_error: input.errorMessage,
      next_attempt_at: permanentFailure ? now : nextAttemptIso(nextAttemptCount),
      updated_at: now
    })
    .eq("id", input.messageId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to mark outbound message as failed: ${error.message}`);
  }

  const record = mapOutboundMessage(data as Record<string, unknown>);

  await recordAuditEventBestEffort({
    requestId: record.request_id ?? undefined,
    eventType: permanentFailure ? "outbound_message_permanent_failure" : "outbound_message_failed",
    severity: permanentFailure ? "error" : "warning",
    actorType: "system_message",
    userId: record.user_id,
    entityType: "outbound_message",
    entityId: record.id,
    message: permanentFailure
      ? "Outbound message exhausted retry attempts."
      : "Outbound message send failed and was scheduled for retry.",
    metadata: {
      phoneNumber: record.phone_number,
      attemptCount: record.attempt_count,
      nextAttemptAt: record.next_attempt_at,
      lastError: record.last_error
    }
  });

  return record;
}

export async function markOutboundMessageLoggedOnly(messageId: string): Promise<OutboundMessageRecord> {
  const current = await getOutboundMessageById(messageId);
  const nextAttemptCount = (current?.attempt_count ?? 0) + 1;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("outbound_messages")
    .update({
      status: "logged_only",
      attempt_count: nextAttemptCount,
      sent_at: now,
      updated_at: now
    })
    .eq("id", messageId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to mark outbound message as logged_only: ${error.message}`);
  }

  return mapOutboundMessage(data as Record<string, unknown>);
}

export async function listOutboundMessages(input: {
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

export async function getRetryableOutboundMessages(limit = 20): Promise<OutboundMessageRecord[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("outbound_messages")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load retryable outbound messages: ${error.message}`);
  }

  return (data ?? []).map((row) => mapOutboundMessage(row as Record<string, unknown>));
}

export async function markOutboundMessageRetrying(messageId: string): Promise<void> {
  const { error } = await supabase
    .from("outbound_messages")
    .update({
      status: "retrying",
      updated_at: new Date().toISOString()
    })
    .eq("id", messageId);

  if (error) {
    throw new Error(`Failed to mark outbound message as retrying: ${error.message}`);
  }
}

export async function getOutboundMessageById(messageId: string): Promise<OutboundMessageRecord | null> {
  const { data, error } = await supabase.from("outbound_messages").select("*").eq("id", messageId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load outbound message by id: ${error.message}`);
  }

  return data ? mapOutboundMessage(data as Record<string, unknown>) : null;
}

export function isRetryableStatus(status: string): boolean {
  return status === "failed" || status === "pending" || status === "retrying";
}

export async function noteRetryLoopFailure(error: unknown): Promise<void> {
  logger.error({ error }, "Outbound retry loop failed.");
}
