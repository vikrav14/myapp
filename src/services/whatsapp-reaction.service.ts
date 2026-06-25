import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { InboundMessage, MauriUser } from "../types.js";
import { parseHelpCommand } from "./help-menu.service.js";
import { deliverWhatsAppReaction, markWhatsAppMessageRead } from "./whatsapp.service.js";
import { WHATSAPP_REACTION_MIN_TEXT_LENGTH } from "./whatsapp-reaction.constants.js";

const COMMAND_PREFIXES = [
  "remind me",
  "my reminders",
  "cancel reminder",
  "calendar add",
  "my calendar",
  "calendar today",
  "connect calendar",
  "calendar on",
  "calendar off",
  "digest on",
  "digest off",
  "my topics",
  "update topics",
  "resurface on",
  "resurface off",
  "followups on",
  "followups off",
  "my followups",
  "my checkins",
  "not now",
  "alerts on",
  "alerts off",
  "school alerts",
  "my alerts",
  "payday ",
  "salary ",
  "my runway",
  "create squad",
  "join ",
  "share squad",
  "squad ",
  "my squad",
  "leave squad",
  "quantum pick",
  "lucky pick",
  "pick for me",
  "mauri pick",
  "rate ",
  "mauri feedback",
  "sunday feedback",
  "roast me",
  "hype me",
  "my streaks",
  "my focus",
  "lesson"
];

const SHORT_GREETINGS = new Set(["hi", "hey", "hello", "yo", "ok", "okay", "cool", "yes", "no", "yep", "nah", "k"]);

export function isLikelyCommandMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (!normalized) {
    return false;
  }

  if (parseHelpCommand(normalized)) {
    return true;
  }

  return COMMAND_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function pickInboundReactionEmoji(input: {
  kind: InboundMessage["kind"];
  messageText?: string | undefined;
  isCommand: boolean;
  onboardingActive: boolean;
}): string | null {
  if (input.onboardingActive || input.isCommand) {
    return null;
  }

  if (input.kind === "image") {
    return "👀";
  }

  if (input.kind === "audio") {
    return "👂";
  }

  const text = (input.messageText ?? "").trim();
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase().replace(/\s+/g, " ");

  if (SHORT_GREETINGS.has(normalized)) {
    return null;
  }

  if (/^(thanks|thank you|thx|cheers|appreciate it|much appreciated)\b/.test(normalized)) {
    return "🙏";
  }

  if (/\b(done|finished|completed|crushed|nailed|smashed|passed|got the job|cleared|paid off)\b/.test(normalized)) {
    return "🔥";
  }

  if (
    /\b(stress|stressed|anxious|anxiety|overwhelmed|overwhelming|vent|venting|sad|depressed|crying|exhausted|burnout|can't cope|cannot cope|rough day|bad day)\b/.test(
      normalized
    )
  ) {
    return "❤️";
  }

  if (text.length < WHATSAPP_REACTION_MIN_TEXT_LENGTH) {
    return null;
  }

  if (/\b(spent|bought|paid|rs\s?\d|remind|todo|studied|gym|workout|habit|logged|salary|payday)\b/i.test(text)) {
    return "👍";
  }

  if (text.length >= 40) {
    return "👍";
  }

  return null;
}

export async function reactToInboundMessageBestEffort(input: {
  to: string;
  inboundMessage: InboundMessage;
  messageText?: string | undefined;
  user: MauriUser;
  requestId?: string | undefined;
}): Promise<{ reacted: boolean; emoji?: string | undefined }> {
  if (!env.WHATSAPP_REACTIONS_ENABLED) {
    return { reacted: false };
  }

  const messageId = input.inboundMessage.messageId;
  if (!messageId) {
    return { reacted: false };
  }

  const emoji = pickInboundReactionEmoji({
    kind: input.inboundMessage.kind,
    messageText: input.messageText,
    isCommand: input.messageText ? isLikelyCommandMessage(input.messageText) : false,
    onboardingActive: input.user.onboarding_state !== "active"
  });

  if (!emoji) {
    return { reacted: false };
  }

  try {
    if (env.WHATSAPP_MARK_READ_ENABLED) {
      await markWhatsAppMessageRead(messageId);
    }

    await deliverWhatsAppReaction({
      to: input.to,
      messageId,
      emoji
    });

    return { reacted: true, emoji };
  } catch (error) {
    logger.warn(
      { error, userId: input.user.id, messageId, emoji, requestId: input.requestId },
      "Failed to send WhatsApp reaction."
    );
    return { reacted: false };
  }
}
