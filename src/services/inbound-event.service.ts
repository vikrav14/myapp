import { supabase } from "../lib/supabase.js";
import { recordAuditEventBestEffort } from "./audit.service.js";

export interface InboundEventRegistration {
  duplicate: boolean;
  reclaim: boolean;
}

/** Only reclaim stuck processing rows — fresh duplicates are concurrent webhook retries. */
export const PROCESSING_RECLAIM_STALE_MS = 3 * 60 * 1000;

function isStaleProcessingEvent(record: {
  updated_at?: string | null;
  last_seen_at?: string | null;
}): boolean {
  const timestamp = record.updated_at ?? record.last_seen_at;
  if (!timestamp) {
    return true;
  }

  const updatedAt = new Date(timestamp).getTime();
  if (Number.isNaN(updatedAt)) {
    return true;
  }

  return Date.now() - updatedAt >= PROCESSING_RECLAIM_STALE_MS;
}

export async function registerInboundEvent(input: {
  provider: string;
  eventId: string;
  eventKind?: string | undefined;
  rawPayload?: unknown;
  requestId?: string | undefined;
}): Promise<InboundEventRegistration> {
  const trimmedEventId = input.eventId.trim();
  if (!trimmedEventId) {
    return { duplicate: false, reclaim: false };
  }

  const { data: existing, error: existingError } = await supabase
    .from("processed_inbound_events")
    .select("id, duplicate_count, status, updated_at, last_seen_at")
    .eq("provider", input.provider)
    .eq("event_id", trimmedEventId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to inspect processed inbound event: ${existingError.message}`);
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("processed_inbound_events")
      .update({
        duplicate_count: Number(existing.duplicate_count ?? 0) + 1,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update duplicate inbound event: ${updateError.message}`);
    }

    if (existing.status === "processed" || !isStaleProcessingEvent(existing)) {
      await recordAuditEventBestEffort({
        requestId: input.requestId,
        eventType: "inbound_event_duplicate_ignored",
        severity: "warning",
        actorType: input.provider,
        entityType: "inbound_event",
        entityId: trimmedEventId,
        message:
          existing.status === "processed"
            ? "Duplicate inbound event was ignored."
            : "Concurrent duplicate inbound event was ignored while processing.",
        metadata: {
          provider: input.provider,
          eventKind: input.eventKind,
          priorStatus: existing.status
        }
      });

      return { duplicate: true, reclaim: false };
    }

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "inbound_event_retry_reclaimed",
      severity: "info",
      actorType: input.provider,
      entityType: "inbound_event",
      entityId: trimmedEventId,
      message: "Reclaimed inbound event retry after incomplete processing.",
      metadata: {
        provider: input.provider,
        eventKind: input.eventKind,
        priorStatus: existing.status
      }
    });

    return { duplicate: true, reclaim: true };
  }

  const { error: insertError } = await supabase.from("processed_inbound_events").insert({
    provider: input.provider,
    event_id: trimmedEventId,
    event_kind: input.eventKind ?? null,
    status: "processing",
    raw_payload: input.rawPayload ?? null
  });

  if (insertError) {
    throw new Error(`Failed to register inbound event: ${insertError.message}`);
  }

  return { duplicate: false, reclaim: false };
}

export async function completeInboundEvent(input: {
  provider: string;
  eventId: string;
  requestId?: string | undefined;
}): Promise<void> {
  const trimmedEventId = input.eventId.trim();
  if (!trimmedEventId) {
    return;
  }

  const { error } = await supabase
    .from("processed_inbound_events")
    .update({
      status: "processed",
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    })
    .eq("provider", input.provider)
    .eq("event_id", trimmedEventId);

  if (error) {
    throw new Error(`Failed to complete inbound event: ${error.message}`);
  }
}
