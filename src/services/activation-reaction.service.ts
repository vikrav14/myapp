import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { MauriUser } from "../types.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import { formatHelpFocusLabel } from "./help-focus-inference.service.js";
import { isWithinHelpFocusActivationWindow } from "./help-focus.service.js";
import {
  findRecentActivationOutboundForUser,
  isActivationOutboundMessage,
  isHelpFocusOutboundMessage,
  findOutboundByProviderMessageId
} from "./outbound-message.service.js";
import { deliverWhatsAppReaction, sendWhatsAppMessage } from "./whatsapp.service.js";

export const ACTIVATION_REACTION_ACK_KEY = "express_activation_reaction_ack";
export const HELP_FOCUS_REACTION_ACK_KEY = "help_focus_reaction_ack";
const ACTIVATION_REACTION_WINDOW_HOURS = 72;
export const MAURI_REACTION_ACK_EMOJI = "🦤";

/** @deprecated Use MAURI_REACTION_ACK_EMOJI */
export const MAURI_POSITIVE_REACTION_EMOJI = MAURI_REACTION_ACK_EMOJI;

const POSITIVE_REACTION_EMOJIS = new Set(["👍", "✅", "❤️", "🙏", "✌️", "🦤", "😊", "🎉", "💯", "❤"]);

export type InboundReactionAckMode = "repeat" | "reaction" | "text";

export interface InboundReactionResult {
  handled: boolean;
  mode?: InboundReactionAckMode | undefined;
  reply?: string | undefined;
}

export function isPositiveActivationReaction(emoji: string): boolean {
  return POSITIVE_REACTION_EMOJIS.has(emoji.trim());
}

export function buildActivationReactionAck(firstName?: string | null): string {
  const name = firstName?.trim() || "there";

  return `Perfect, ${name} — you're all set 🦤

First pulse lands tomorrow at 7. Brain dump or remind me anytime before then.`;
}

export function buildHelpFocusReactionAck(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";
  const labels =
    user.help_focus_primary && user.help_focus_secondary
      ? `${formatHelpFocusLabel(user.help_focus_primary)} + ${formatHelpFocusLabel(user.help_focus_secondary)}`
      : user.help_focus_primary
        ? formatHelpFocusLabel(user.help_focus_primary)
        : "your lane";

  return `Locked in, ${name} 🦤 — ${labels} for advice. First pulse tomorrow at 7.`;
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

async function hasRecentActivationMessage(user: MauriUser): Promise<boolean> {
  if (!isWithinActivationWindow(user)) {
    return false;
  }

  const recent = await findRecentActivationOutboundForUser(user.id);
  return recent !== null;
}

async function handleHelpFocusReaction(input: {
  user: MauriUser;
}): Promise<InboundReactionResult> {
  if (await hasEngagementDelivery(input.user.id, HELP_FOCUS_REACTION_ACK_KEY)) {
    return { handled: true, mode: "repeat" };
  }

  await recordEngagementDelivery(input.user.id, HELP_FOCUS_REACTION_ACK_KEY);

  if (isWithinHelpFocusActivationWindow(input.user)) {
    return {
      handled: true,
      mode: "reaction",
      reply: buildHelpFocusReactionAck(input.user)
    };
  }

  return {
    handled: true,
    mode: "text",
    reply: `Got your 👍, ${input.user.first_name?.trim() || "there"} 🦤 — reply help focus anytime to switch lanes.`
  };
}

async function handleActivationReaction(input: {
  user: MauriUser;
}): Promise<InboundReactionResult> {
  if (await hasEngagementDelivery(input.user.id, ACTIVATION_REACTION_ACK_KEY)) {
    return { handled: true, mode: "repeat" };
  }

  await recordEngagementDelivery(input.user.id, ACTIVATION_REACTION_ACK_KEY);

  return {
    handled: true,
    mode: "reaction",
    reply: buildActivationReactionAck(input.user.first_name)
  };
}

export async function handleActivationReactionMessage(input: {
  user: MauriUser;
  emoji: string;
  targetMessageId: string;
  requestId?: string | undefined;
}): Promise<InboundReactionResult> {
  if (input.user.onboarding_state !== "active") {
    return { handled: false };
  }

  if (!isPositiveActivationReaction(input.emoji)) {
    return { handled: false };
  }

  const outbound = await findOutboundByProviderMessageId(input.user.id, input.targetMessageId);

  if (outbound && isHelpFocusOutboundMessage(outbound)) {
    return handleHelpFocusReaction({ user: input.user });
  }

  if (outbound && isActivationOutboundMessage(outbound)) {
    return handleActivationReaction({ user: input.user });
  }

  if (await hasRecentActivationMessage(input.user)) {
    return handleActivationReaction({ user: input.user });
  }

  return { handled: false };
}

export async function deliverInboundReactionAck(input: {
  user: MauriUser;
  phoneNumber: string;
  targetMessageId: string;
  result: InboundReactionResult;
  requestId?: string | undefined;
}): Promise<void> {
  if (!input.result.handled) {
    return;
  }

  let reacted = false;
  if (env.WHATSAPP_REACTIONS_ENABLED && input.targetMessageId.trim()) {
    try {
      await deliverWhatsAppReaction({
        to: input.phoneNumber,
        messageId: input.targetMessageId,
        emoji: MAURI_REACTION_ACK_EMOJI
      });
      reacted = true;
    } catch (error) {
      logger.warn(
        { error, userId: input.user.id, targetMessageId: input.targetMessageId },
        "Failed to react on inbound advice-focus reaction."
      );
    }
  }

  if (reacted && input.result.mode !== "text") {
    return;
  }

  if (input.result.reply?.trim()) {
    await sendWhatsAppMessage(input.phoneNumber, input.result.reply.trim(), {
      userId: input.user.id,
      requestId: input.requestId,
      metadata: {
        flow: "activation_reaction_ack"
      }
    });
  }
}

/** @deprecated Use deliverInboundReactionAck */
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
