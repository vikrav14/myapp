import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { AuditEventRecord, AuditSeverity } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export async function recordAuditEvent(input: {
  requestId?: string | undefined;
  eventType: string;
  severity?: AuditSeverity | undefined;
  actorType?: string | undefined;
  actorId?: string | undefined;
  userId?: string | null | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  message?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<AuditEventRecord> {
  const { data, error } = await supabase
    .from("audit_events")
    .insert({
      request_id: input.requestId ?? null,
      event_type: input.eventType,
      severity: input.severity ?? "info",
      actor_type: input.actorType ?? null,
      actor_id: input.actorId ?? null,
      user_id: input.userId ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? null
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to record audit event: ${error.message}`);
  }

  return mapAuditEvent(data as Record<string, unknown>);
}

export async function recordAuditEventBestEffort(
  input: Parameters<typeof recordAuditEvent>[0]
): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    logger.warn({ error, eventType: input.eventType }, "Failed to persist audit event.");
  }
}

export async function listAuditEvents(input: {
  limit: number;
  offset: number;
  userId?: string | undefined;
  eventType?: string | undefined;
  severity?: string | undefined;
  requestId?: string | undefined;
  entityType?: string | undefined;
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

  if (input.entityType) {
    query = query.eq("entity_type", input.entityType);
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
