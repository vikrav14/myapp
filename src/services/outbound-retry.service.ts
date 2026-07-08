import { logger } from "../lib/logger.js";
import type { OutboundMessageRecord } from "../types.js";
import {
  deliverWhatsAppInteractive,
  deliverWhatsAppText,
  humanTextFromInteractiveLogBody,
  parseStoredInteractivePayload
} from "./whatsapp.service.js";
import {
  discardOutboundMessage,
  getOutboundMessageById,
  getRetryableOutboundMessages,
  isRetryableStatus,
  markOutboundMessageFailed,
  markOutboundMessageRetrying,
  markOutboundMessageSent
} from "./outbound-message.service.js";

async function deliverRetryableOutbound(message: OutboundMessageRecord): Promise<void> {
  const interactivePayload = parseStoredInteractivePayload(message.metadata);

  if (interactivePayload) {
    await deliverWhatsAppInteractive(message.phone_number, interactivePayload);
    return;
  }

  if (message.body.startsWith("[interactive:")) {
    const human = humanTextFromInteractiveLogBody(message.body);
    await deliverWhatsAppText(
      message.phone_number,
      human
        ? `${human}\n\nReply help focus to pick your advice lane.`
        : "Reply help focus to pick your advice lane."
    );
    return;
  }

  await deliverWhatsAppText(message.phone_number, message.body);
}

export async function retryOutboundMessageById(messageId: string): Promise<{
  messageId: string;
  status: "sent" | "failed" | "skipped";
}> {
  const message = await getOutboundMessageById(messageId);
  if (!message || !isRetryableStatus(message.status)) {
    return {
      messageId,
      status: "skipped"
    };
  }

  if (message.metadata?.interactive === true && !parseStoredInteractivePayload(message.metadata)) {
    await discardOutboundMessage(messageId);
    return {
      messageId,
      status: "skipped"
    };
  }

  await markOutboundMessageRetrying(messageId);

  let delivered = false;
  try {
    await deliverRetryableOutbound(message);
    delivered = true;
    await markOutboundMessageSent(messageId);
    return {
      messageId,
      status: "sent"
    };
  } catch (error) {
    if (delivered) {
      logger.error(
        { error, messageId },
        "Outbound retry delivered to WhatsApp but failed during finalization. Leaving message in retrying state to avoid duplicate retries."
      );
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown retry error";
    logger.warn({ error, messageId }, "Outbound message retry failed.");
    await markOutboundMessageFailed({
      messageId,
      errorMessage
    });
    return {
      messageId,
      status: "failed"
    };
  }
}

export async function runOutboundMessageRetryLoop(limit = 20): Promise<{
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const messages = await getRetryableOutboundMessages(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const message of messages) {
    const result = await retryOutboundMessageById(message.id);
    if (result.status === "sent") {
      sent += 1;
    } else if (result.status === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    scanned: messages.length,
    sent,
    failed,
    skipped
  };
}
