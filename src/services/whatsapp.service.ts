import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { InboundMessage } from "../types.js";
import {
  createOutboundMessage,
  markOutboundMessageFailed,
  markOutboundMessageSending,
  markOutboundMessageLoggedOnly,
  markOutboundMessageSent
} from "./outbound-message.service.js";

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

  if (messageType === "reaction") {
    return null;
  }

  const body =
    isObject(firstMessage.text) && typeof firstMessage.text.body === "string"
      ? firstMessage.text.body
      : typeof firstMessage.body === "string"
        ? firstMessage.body
        : null;

  const profileName =
    contacts.length > 0 && isObject(contacts[0]) && isObject(contacts[0].profile) && typeof contacts[0].profile.name === "string"
      ? contacts[0].profile.name
      : undefined;

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
