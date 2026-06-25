import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { InboundMessage, WhatsAppInteractiveOutbound } from "../types.js";
import {
  createOutboundMessage,
  markOutboundMessageFailed,
  markOutboundMessageSending,
  markOutboundMessageLoggedOnly,
  markOutboundMessageSent
} from "./outbound-message.service.js";
import { resolveInteractiveReplyId } from "./whatsapp-interactive.service.js";

function summarizeInteractiveForLog(interactive: WhatsAppInteractiveOutbound): string {
  if (interactive.buttons?.length) {
    return `[interactive:buttons] ${interactive.body}`;
  }

  return `[interactive:list] ${interactive.body}`;
}

function buildInteractivePayload(interactive: WhatsAppInteractiveOutbound): Record<string, unknown> {
  if (interactive.buttons?.length) {
    return {
      type: "interactive",
      interactive: {
        type: "button",
        header: interactive.header ? { type: "text", text: interactive.header } : undefined,
        body: { type: "text", text: interactive.body },
        footer: interactive.footer ? { type: "text", text: interactive.footer } : undefined,
        action: {
          buttons: interactive.buttons.slice(0, 3).map((button) => ({
            type: "reply",
            reply: {
              id: button.id,
              title: button.title.slice(0, 20)
            }
          }))
        }
      }
    };
  }

  if (!interactive.sections?.length) {
    throw new Error("Interactive message requires buttons or list sections.");
  }

  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: interactive.header ? { type: "text", text: interactive.header } : undefined,
      body: { type: "text", text: interactive.body },
      footer: interactive.footer ? { type: "text", text: interactive.footer } : undefined,
      action: {
        button: (interactive.listButtonLabel ?? "Choose").slice(0, 20),
        sections: interactive.sections.map((section) => ({
          title: section.title?.slice(0, 24),
          rows: section.rows.slice(0, 10).map((row) => ({
            id: row.id,
            title: row.title.slice(0, 24),
            description: row.description?.slice(0, 72)
          }))
        }))
      }
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseInboundMessage(payload: unknown): InboundMessage | null {
  if (!isObject(payload)) {
    return null;
  }

  const directFrom = payload.from;
  const directText = payload.text;
  const directAudioUrl = payload.audioUrl;
  const directMimeType = payload.mimeType;

  if (typeof directFrom === "string" && typeof directText === "string") {
    const inboundMessage: InboundMessage = {
      from: directFrom,
      kind: "text",
      text: directText,
      rawPayload: payload
    };

    if (typeof payload.profileName === "string") {
      inboundMessage.profileName = payload.profileName;
    }

    if (typeof payload.messageId === "string") {
      inboundMessage.messageId = payload.messageId;
    }

    return inboundMessage;
  }

  if (typeof directFrom === "string" && typeof directAudioUrl === "string") {
    const inboundMessage: InboundMessage = {
      from: directFrom,
      kind: "audio",
      rawPayload: payload,
      audio: {
        url: directAudioUrl,
        mimeType: typeof directMimeType === "string" ? directMimeType : "audio/ogg"
      }
    };

    if (typeof payload.profileName === "string") {
      inboundMessage.profileName = payload.profileName;
    }

    if (typeof payload.messageId === "string") {
      inboundMessage.messageId = payload.messageId;
    }

    return inboundMessage;
  }

  const directImageUrl = payload.imageUrl;
  if (typeof directFrom === "string" && typeof directImageUrl === "string") {
    const inboundMessage: InboundMessage = {
      from: directFrom,
      kind: "image",
      rawPayload: payload,
      image: {
        url: directImageUrl,
        mimeType: typeof directMimeType === "string" ? directMimeType : "image/jpeg",
        caption: typeof payload.caption === "string" ? payload.caption : undefined
      }
    };

    if (typeof payload.profileName === "string") {
      inboundMessage.profileName = payload.profileName;
    }

    if (typeof payload.messageId === "string") {
      inboundMessage.messageId = payload.messageId;
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

  const messageId = typeof firstMessage.id === "string" ? firstMessage.id : undefined;
  const messageType = typeof firstMessage.type === "string" ? firstMessage.type : undefined;

  const profileName =
    contacts.length > 0 && isObject(contacts[0]) && isObject(contacts[0].profile) && typeof contacts[0].profile.name === "string"
      ? contacts[0].profile.name
      : undefined;

  if (messageType === "reaction") {
    return null;
  }

  if (messageType === "interactive" && isObject(firstMessage.interactive)) {
    const interactive = firstMessage.interactive;
    const interactiveType = typeof interactive.type === "string" ? interactive.type : undefined;
    let replyId: string | undefined;
    let displayTitle: string | undefined;

    if (interactiveType === "button_reply" && isObject(interactive.button_reply)) {
      replyId = typeof interactive.button_reply.id === "string" ? interactive.button_reply.id : undefined;
      displayTitle =
        typeof interactive.button_reply.title === "string" ? interactive.button_reply.title : undefined;
    }

    if (interactiveType === "list_reply" && isObject(interactive.list_reply)) {
      replyId = typeof interactive.list_reply.id === "string" ? interactive.list_reply.id : undefined;
      displayTitle =
        typeof interactive.list_reply.title === "string" ? interactive.list_reply.title : undefined;
    }

    if (replyId) {
      const mappedText = resolveInteractiveReplyId(replyId) ?? displayTitle ?? replyId;
      const inboundMessage: InboundMessage = {
        from: firstMessage.from,
        kind: "interactive",
        text: mappedText,
        interactiveReplyId: replyId,
        rawPayload: payload
      };

      if (profileName) {
        inboundMessage.profileName = profileName;
      }

      if (messageId) {
        inboundMessage.messageId = messageId;
      }

      return inboundMessage;
    }
  }

  const body =
    isObject(firstMessage.text) && typeof firstMessage.text.body === "string"
      ? firstMessage.text.body
      : typeof firstMessage.body === "string"
        ? firstMessage.body
        : null;

  if (body) {
    const inboundMessage: InboundMessage = {
      from: firstMessage.from,
      kind: "text",
      text: body,
      rawPayload: payload
    };

    if (profileName) {
      inboundMessage.profileName = profileName;
    }

    if (messageId) {
      inboundMessage.messageId = messageId;
    }

    return inboundMessage;
  }

  if (messageType === "audio" && isObject(firstMessage.audio)) {
    const inboundMessage: InboundMessage = {
      from: firstMessage.from,
      kind: "audio",
      rawPayload: payload,
      audio: {
        mediaId: typeof firstMessage.audio.id === "string" ? firstMessage.audio.id : undefined,
        mimeType: typeof firstMessage.audio.mime_type === "string" ? firstMessage.audio.mime_type : "audio/ogg"
      }
    };

    if (profileName) {
      inboundMessage.profileName = profileName;
    }

    if (messageId) {
      inboundMessage.messageId = messageId;
    }

    return inboundMessage;
  }

  if (messageType === "image" && isObject(firstMessage.image)) {
    const inboundMessage: InboundMessage = {
      from: firstMessage.from,
      kind: "image",
      rawPayload: payload,
      image: {
        mediaId: typeof firstMessage.image.id === "string" ? firstMessage.image.id : undefined,
        mimeType: typeof firstMessage.image.mime_type === "string" ? firstMessage.image.mime_type : "image/jpeg",
        caption: typeof firstMessage.image.caption === "string" ? firstMessage.image.caption : undefined
      }
    };

    if (profileName) {
      inboundMessage.profileName = profileName;
    }

    if (messageId) {
      inboundMessage.messageId = messageId;
    }

    return inboundMessage;
  }

  return null;
}

export async function deliverWhatsAppText(to: string, body: string): Promise<void> {
  await postWhatsAppMessage({
    to,
    payload: {
      type: "text",
      text: {
        body
      }
    }
  });
}

async function postWhatsAppMessage(input: {
  to: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp credentials are not configured for delivery.");
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
        to: input.to,
        ...input.payload
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send WhatsApp message: ${errorText}`);
  }
}

export async function markWhatsAppMessageRead(messageId: string): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp credentials are not configured for delivery.");
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
        status: "read",
        message_id: messageId
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to mark WhatsApp message read: ${errorText}`);
  }
}

export async function deliverWhatsAppReaction(input: {
  to: string;
  messageId: string;
  emoji: string;
}): Promise<void> {
  await postWhatsAppMessage({
    to: input.to,
    payload: {
      type: "reaction",
      reaction: {
        message_id: input.messageId,
        emoji: input.emoji
      }
    }
  });
}

export async function deliverWhatsAppInteractive(to: string, interactive: WhatsAppInteractiveOutbound): Promise<void> {
  await postWhatsAppMessage({
    to,
    payload: buildInteractivePayload(interactive)
  });
}

export async function sendWhatsAppInteractive(
  to: string,
  interactive: WhatsAppInteractiveOutbound,
  options?: {
    userId?: string | null | undefined;
    requestId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }
): Promise<void> {
  const body = summarizeInteractiveForLog(interactive);
  const outbound = await createOutboundMessage({
    phoneNumber: to,
    body,
    userId: options?.userId ?? null,
    requestId: options?.requestId,
    metadata: {
      ...options?.metadata,
      interactive: true
    }
  });

  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    logger.info({ to, body }, "WhatsApp credentials missing. Interactive reply logged instead of sent.");
    await markOutboundMessageLoggedOnly(outbound.id);
    return;
  }

  if (!env.WHATSAPP_INTERACTIVE_ENABLED) {
    logger.info({ to, body }, "WhatsApp interactive messages disabled. Logged instead of sent.");
    await markOutboundMessageLoggedOnly(outbound.id);
    return;
  }

  let delivered = false;
  try {
    await markOutboundMessageSending(outbound.id);
    await deliverWhatsAppInteractive(to, interactive);
    delivered = true;
    await markOutboundMessageSent(outbound.id);
  } catch (error) {
    if (delivered) {
      logger.error(
        { error, outboundMessageId: outbound.id },
        "WhatsApp interactive delivery succeeded but outbound finalization failed."
      );
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown interactive send error";
    await markOutboundMessageFailed({
      messageId: outbound.id,
      errorMessage
    });
    throw error;
  }
}

export async function sendMauriReply(
  to: string,
  payload: { text?: string | undefined; interactive?: WhatsAppInteractiveOutbound | undefined },
  options?: {
    userId?: string | null | undefined;
    requestId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }
): Promise<void> {
  if (payload.interactive && env.WHATSAPP_INTERACTIVE_ENABLED) {
    await sendWhatsAppInteractive(to, payload.interactive, options);
    return;
  }

  if (payload.text) {
    await sendWhatsAppMessage(to, payload.text, options);
    return;
  }

  throw new Error("Mauri reply requires text or interactive content.");
}

export async function sendWhatsAppMessage(
  to: string,
  body: string,
  options?: {
    userId?: string | null | undefined;
    requestId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }
): Promise<void> {
  const outbound = await createOutboundMessage({
    phoneNumber: to,
    body,
    userId: options?.userId ?? null,
    requestId: options?.requestId,
    metadata: options?.metadata
  });

  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    logger.info({ to, body }, "WhatsApp credentials missing. Reply logged instead of sent.");
    await markOutboundMessageLoggedOnly(outbound.id);
    return;
  }

  let delivered = false;
  try {
    await markOutboundMessageSending(outbound.id);
    await deliverWhatsAppText(to, body);
    delivered = true;
    await markOutboundMessageSent(outbound.id);
  } catch (error) {
    if (delivered) {
      logger.error(
        { error, outboundMessageId: outbound.id },
        "WhatsApp delivery succeeded but outbound finalization failed. Leaving message in sending state to avoid duplicate retries."
      );
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown outbound send error";
    await markOutboundMessageFailed({
      messageId: outbound.id,
      errorMessage
    });
    throw error;
  }
}

async function authorizedFetch(url: string): Promise<Response> {
  if (!env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WhatsApp access token is required to fetch media.");
  }

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`
    }
  });
}

export async function downloadInboundAudio(message: InboundMessage): Promise<{
  audioBuffer: Buffer;
  mimeType: string;
  mediaId: string | null;
}> {
  if (message.kind !== "audio" || !message.audio) {
    throw new Error("Inbound message does not contain audio.");
  }

  if (message.audio.url) {
    const response = await fetch(message.audio.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch direct audio URL: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      mimeType: message.audio.mimeType ?? response.headers.get("content-type") ?? "audio/ogg",
      mediaId: message.audio.mediaId ?? null
    };
  }

  if (!message.audio.mediaId) {
    throw new Error("Audio media ID is missing.");
  }

  const metadataResponse = await authorizedFetch(`https://graph.facebook.com/v22.0/${message.audio.mediaId}`);
  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    throw new Error(`Failed to fetch WhatsApp media metadata: ${errorText}`);
  }

  const metadata = (await metadataResponse.json()) as { url?: string; mime_type?: string };
  if (!metadata.url) {
    throw new Error("WhatsApp media metadata did not return a download URL.");
  }

  const mediaResponse = await authorizedFetch(metadata.url);
  if (!mediaResponse.ok) {
    const errorText = await mediaResponse.text();
    throw new Error(`Failed to download WhatsApp audio media: ${errorText}`);
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    mimeType: message.audio.mimeType ?? metadata.mime_type ?? mediaResponse.headers.get("content-type") ?? "audio/ogg",
    mediaId: message.audio.mediaId
  };
}

export async function downloadInboundImage(message: InboundMessage): Promise<{
  imageBuffer: Buffer;
  mimeType: string;
  mediaId: string | null;
}> {
  if (message.kind !== "image" || !message.image) {
    throw new Error("Inbound message does not contain an image.");
  }

  if (message.image.url) {
    const response = await fetch(message.image.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch direct image URL: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      imageBuffer: Buffer.from(arrayBuffer),
      mimeType: message.image.mimeType ?? response.headers.get("content-type") ?? "image/jpeg",
      mediaId: message.image.mediaId ?? null
    };
  }

  if (!message.image.mediaId) {
    throw new Error("Image media ID is missing.");
  }

  const metadataResponse = await authorizedFetch(`https://graph.facebook.com/v22.0/${message.image.mediaId}`);
  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    throw new Error(`Failed to fetch WhatsApp image metadata: ${errorText}`);
  }

  const metadata = (await metadataResponse.json()) as { url?: string; mime_type?: string };
  if (!metadata.url) {
    throw new Error("WhatsApp image metadata did not return a download URL.");
  }

  const mediaResponse = await authorizedFetch(metadata.url);
  if (!mediaResponse.ok) {
    const errorText = await mediaResponse.text();
    throw new Error(`Failed to download WhatsApp image media: ${errorText}`);
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  return {
    imageBuffer: Buffer.from(arrayBuffer),
    mimeType: message.image.mimeType ?? metadata.mime_type ?? mediaResponse.headers.get("content-type") ?? "image/jpeg",
    mediaId: message.image.mediaId
  };
}
