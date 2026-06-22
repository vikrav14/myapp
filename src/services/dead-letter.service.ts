import { supabase } from "../lib/supabase.js";
import type { DeadLetterEventRecord } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapDeadLetter(record: Record<string, unknown>): DeadLetterEventRecord {
  return {
    id: String(record.id),
    source_table: String(record.source_table),
    source_id: String(record.source_id),
    category: String(record.category),
    status: String(record.status),
    user_id: record.user_id ? String(record.user_id) : null,
    request_id: record.request_id ? String(record.request_id) : null,
    last_error: record.last_error ? String(record.last_error) : null,
    payload: isRecord(record.payload) ? record.payload : null,
    resolved_at: record.resolved_at ? String(record.resolved_at) : null,
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export async function upsertDeadLetter(input: {
  sourceTable: string;
  sourceId: string;
  category: string;
  userId?: string | null | undefined;
  requestId?: string | undefined;
  lastError?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}): Promise<DeadLetterEventRecord> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dead_letter_events")
    .upsert(
      {
        source_table: input.sourceTable,
        source_id: input.sourceId,
        category: input.category,
        status: "open",
        user_id: input.userId ?? null,
        request_id: input.requestId ?? null,
        last_error: input.lastError ?? null,
        payload: input.payload ?? null,
        resolved_at: null,
        updated_at: now
      },
      {
        onConflict: "source_table,source_id"
      }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert dead letter event: ${error.message}`);
  }

  const record = mapDeadLetter(data as Record<string, unknown>);

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "dead_letter_opened",
    severity: "warning",
    userId: input.userId ?? null,
    entityType: "dead_letter",
    entityId: record.id,
    message: "Dead-letter event opened.",
    metadata: {
      sourceTable: input.sourceTable,
      sourceId: input.sourceId,
      category: input.category
    }
  });

  return record;
}

export async function updateDeadLetterStatus(input: {
  sourceTable: string;
  sourceId: string;
  status: "requeued" | "discarded" | "resolved";
  requestId?: string | undefined;
  message?: string | undefined;
}): Promise<DeadLetterEventRecord | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dead_letter_events")
    .update({
      status: input.status,
      resolved_at: now,
      updated_at: now
    })
    .eq("source_table", input.sourceTable)
    .eq("source_id", input.sourceId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update dead letter status: ${error.message}`);
  }

  const record = data ? mapDeadLetter(data as Record<string, unknown>) : null;
  if (record) {
    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: `dead_letter_${input.status}`,
      severity: "info",
      userId: record.user_id,
      entityType: "dead_letter",
      entityId: record.id,
      message: input.message ?? `Dead-letter marked as ${input.status}.`,
      metadata: {
        sourceTable: input.sourceTable,
        sourceId: input.sourceId
      }
    });
  }

  return record;
}

export async function getDeadLetterById(deadLetterId: string): Promise<DeadLetterEventRecord | null> {
  const { data, error } = await supabase.from("dead_letter_events").select("*").eq("id", deadLetterId).maybeSingle();

  if (error) {
    throw new Error(`Failed to load dead letter event: ${error.message}`);
  }

  return data ? mapDeadLetter(data as Record<string, unknown>) : null;
}

export async function listDeadLetters(input: {
  limit: number;
  offset: number;
  status?: string | undefined;
  category?: string | undefined;
  userId?: string | undefined;
}): Promise<{
  deadLetters: DeadLetterEventRecord[];
  total: number;
}> {
  let query = supabase.from("dead_letter_events").select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (input.status) {
    query = query.eq("status", input.status);
  }

  if (input.category) {
    query = query.eq("category", input.category);
  }

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  const { data, error, count } = await query.range(input.offset, input.offset + input.limit - 1);

  if (error) {
    throw new Error(`Failed to list dead letters: ${error.message}`);
  }

  return {
    deadLetters: (data ?? []).map((row) => mapDeadLetter(row as Record<string, unknown>)),
    total: count ?? 0
  };
}
