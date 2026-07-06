import type { MauriUser } from "../types.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import {
  findRecentActivationOutboundForUser,
  isActivationOutboundMessage,
  findOutboundByProviderMessageId
} from "./outbound-message.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

export const ACTIVATION_REACTION_ACK_KEY = "express_activation_reaction_ack";
const ACTIVATION_REACTION_WINDOW_HOURS = 72;

const POSITIVE_REACTION_EMOJIS = new Set(["👍", "✅", "❤️", "🙏", "✌️", "😊", "🎉", "💯", "❤"]);

export function isPositiveActivationReaction(emoji: string): boolean {
  return POSITIVE_REACTION_EMOJIS.has(emoji.trim());
}

export function buildActivationReactionAck(firstName?: string | null): string {
  const name = firstName?.trim() || "there";

  return `Perfect, ${name} — you're all set ✌️

First pulse lands tomorrow at 7. Brain dump or remind me anytime before then.`;
}

function hoursSince(date: Date): number {
  return (Date.now() - date.getTime()) / (60 * 60 * 1000);
}

function isWithinActivationWindow(user: MauriUser): boolean {
  if (!user.onboarding_completed_at) {
    return false;
  }

  return hoursSince(new Date(user.onboarding_completed_at)) <= ACTIVATION_REACTION_WINDOW_HOURS;
}

async function reactionTargetsActivationMessage(input: {
  userId: string;
  targetMessageId: string;
}): Promise<boolean> {
  const outbound = await findOutboundByProviderMessageId(input.userId, input.targetMessageId);
  return Boolean(outbound && isActivationOutboundMessage(outbound));
}

async function hasRecentActivationMessage(user: MauriUser): Promise<boolean> {
  if (!isWithinActivationWindow(user)) {
    return false;
  }

  const recent = await findRecentActivationOutboundForUser(user.id);
  return recent !== null;
}

export async function handleActivationReactionMessage(input: {
  user: MauriUser;
  emoji: string;
  targetMessageId: string;
  requestId?: string | undefined;
}): Promise<{ handled: boolean; reply?: string | undefined }> {
  if (input.user.onboarding_state !== "active") {
    return { handled: false };
  }

  if (!isPositiveActivationReaction(input.emoji)) {
    return { handled: false };
  }

  if (await hasEngagementDelivery(input.user.id, ACTIVATION_REACTION_ACK_KEY)) {
    return { handled: true };
  }

  const targetsActivation = await reactionTargetsActivationMessage({
    userId: input.user.id,
    targetMessageId: input.targetMessageId
  });

  if (!targetsActivation && !(await hasRecentActivationMessage(input.user))) {
    return { handled: false };
  }

  await recordEngagementDelivery(input.user.id, ACTIVATION_REACTION_ACK_KEY);

  return {
    handled: true,
    reply: buildActivationReactionAck(input.user.first_name)
  };
}

export async function deliverActivationReactionAck(input: {
  user: MauriUser;
  phoneNumber: string;
  reply: string;
  requestId?: string | undefined;
}): Promise<void> {
  await sendWhatsAppMessage(input.phoneNumber, input.reply, {
    userId: input.user.id,
    requestId: input.requestId,
    metadata: {
      flow: "activation_reaction_ack"
    }
  });
}
