import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { InboundMessage } from "../types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseInboundMessage(payload: unknown): InboundMessage | null {
  if (!isObject(payload)) {
    return null;
  }

  const directFrom = payload.from;
  const directText = payload.text;

  if (typeof directFrom === "string" && typeof directText === "string") {
    const inboundMessage: InboundMessage = {
      from: directFrom,
      text: directText,
      rawPayload: payload
    };

    if (typeof payload.profileName === "string") {
      inboundMessage.profileName = payload.profileName;
    }

    return inboundMessage;
  }

  const entry = Array.isArray(payload.entry) ? payload.entry[0] : undefined;
  if (!isObject(entry)) {
    return null;
  }

  const changes = Array.isArray(entry.changes) ? entry.changes[0] : undefined;
  if (!isObject(changes) || !isObject(changes.value)) {
    return null;
  }

  const contacts = Array.isArray(changes.value.contacts) ? changes.value.contacts : [];
  const messages = Array.isArray(changes.value.messages) ? changes.value.messages : [];
  const firstMessage = messages[0];

  if (!isObject(firstMessage) || typeof firstMessage.from !== "string") {
    return null;
  }

  const body =
    isObject(firstMessage.text) && typeof firstMessage.text.body === "string"
      ? firstMessage.text.body
      : typeof firstMessage.body === "string"
        ? firstMessage.body
        : null;

  if (!body) {
    return null;
  }

  const profileName =
    contacts.length > 0 && isObject(contacts[0]) && isObject(contacts[0].profile) && typeof contacts[0].profile.name === "string"
      ? contacts[0].profile.name
      : undefined;

  const inboundMessage: InboundMessage = {
    from: firstMessage.from,
    text: body,
    rawPayload: payload
  };

  if (profileName) {
    inboundMessage.profileName = profileName;
  }

  return inboundMessage;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    logger.info({ to, body }, "WhatsApp credentials missing. Reply logged instead of sent.");
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send WhatsApp message: ${errorText}`);
  }
}
