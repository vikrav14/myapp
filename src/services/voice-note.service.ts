import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { InboundMessage, VoiceNoteTranscriptionRecord } from "../types.js";
import { transcribeVoiceNote } from "./ai.service.js";
import { downloadInboundAudio } from "./whatsapp.service.js";

function mapVoiceNoteTranscriptionRecord(record: Record<string, unknown>): VoiceNoteTranscriptionRecord {
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

export async function transcribeInboundVoiceNote(input: {
  userId: string;
  message: InboundMessage;
}): Promise<VoiceNoteTranscriptionRecord> {
  if (input.message.kind !== "audio") {
    throw new Error("Inbound message is not an audio message.");
  }

  const { audioBuffer, mimeType, mediaId } = await downloadInboundAudio(input.message);
  const transcriptText = await transcribeVoiceNote({
    audioBuffer,
    mimeType
  });

  const { data, error } = await supabase
    .from("voice_note_transcriptions")
    .insert({
      user_id: input.userId,
      provider: "whatsapp",
      source_message_id: input.message.messageId ?? null,
      media_id: mediaId,
      mime_type: mimeType,
      transcript_text: transcriptText,
      raw_payload: input.message.rawPayload
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to store voice note transcript: ${error.message}`);
  }

  return mapVoiceNoteTranscriptionRecord(data);
}

export async function resolveInboundMessageText(input: {
  userId: string;
  message: InboundMessage;
}): Promise<{
  messageText: string;
  transcriptRecord?: VoiceNoteTranscriptionRecord | undefined;
}> {
  if (input.message.kind === "text") {
    return {
      messageText: input.message.text ?? ""
    };
  }

  const transcriptRecord = await transcribeInboundVoiceNote(input);
  logger.info(
    {
      userId: input.userId,
      sourceMessageId: input.message.messageId,
      transcriptLength: transcriptRecord.transcript_text.length
    },
    "Transcribed inbound voice note."
  );

  return {
    messageText: transcriptRecord.transcript_text,
    transcriptRecord
  };
}
