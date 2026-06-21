import { supabase } from "../lib/supabase.js";
import { recordAuditEventBestEffort } from "./audit.service.js";

export async function registerInboundEvent(input: {
  provider: string;
  eventId: string;
  eventKind?: string | undefined;
  rawPayload?: unknown;
  requestId?: string | undefined;
}): Promise<{ duplicate: boolean }> {
  const trimmedEventId = input.eventId.trim();
  if (!trimmedEventId) {
    return { duplicate: false };
  }

  const { data: existing, error: existingError } = await supabase
    .from("processed_inbound_events")
    .select("id, duplicate_count")
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

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "inbound_event_duplicate_ignored",
      severity: "warning",
      actorType: input.provider,
      entityType: "inbound_event",
      entityId: trimmedEventId,
      message: "Duplicate inbound event was ignored.",
      metadata: {
        provider: input.provider,
        eventKind: input.eventKind
      }
    });

    return { duplicate: true };
  }

  const { error: insertError } = await supabase.from("processed_inbound_events").insert({
    provider: input.provider,
    event_id: trimmedEventId,
    event_kind: input.eventKind ?? null,
    status: "processed",
    raw_payload: input.rawPayload ?? null
  });

  if (insertError) {
    throw new Error(`Failed to register inbound event: ${insertError.message}`);
  }

  return { duplicate: false };
}
