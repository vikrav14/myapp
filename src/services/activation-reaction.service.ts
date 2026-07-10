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
import { sendWhatsAppMessage } from "./whatsapp.service.js";

export const ACTIVATION_REACTION_ACK_KEY = "express_activation_reaction_ack";
export const HELP_FOCUS_REACTION_ACK_KEY = "help_focus_reaction_ack";
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

export function buildHelpFocusReactionAck(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";
  const labels =
    user.help_focus_primary && user.help_focus_secondary
      ? `${formatHelpFocusLabel(user.help_focus_primary)} + ${formatHelpFocusLabel(user.help_focus_secondary)}`
      : user.help_focus_primary
        ? formatHelpFocusLabel(user.help_focus_primary)
        : "your lane";

  return `Locked in, ${name} ✌️ — ${labels} for advice. First pulse tomorrow at 7.`;
}

export function buildHelpFocusReactionRepeatAck(firstName?: string | null): string {
  const name = firstName?.trim() || "there";
  return `All set, ${name} ✌️ — lane locked. Brain dump or remind me anytime.`;
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
}): Promise<{ handled: boolean; reply?: string | undefined }> {
  if (await hasEngagementDelivery(input.user.id, HELP_FOCUS_REACTION_ACK_KEY)) {
    return {
      handled: true,
      reply: buildHelpFocusReactionRepeatAck(input.user.first_name)
    };
  }

  await recordEngagementDelivery(input.user.id, HELP_FOCUS_REACTION_ACK_KEY);

  if (isWithinHelpFocusActivationWindow(input.user)) {
    return {
      handled: true,
      reply: buildHelpFocusReactionAck(input.user)
    };
  }

  return {
    handled: true,
    reply: `Got your 👍, ${input.user.first_name?.trim() || "there"} ✌️ — reply help focus anytime to switch lanes.`
  };
}

async function handleActivationReaction(input: {
  user: MauriUser;
}): Promise<{ handled: boolean; reply?: string | undefined }> {
  if (await hasEngagementDelivery(input.user.id, ACTIVATION_REACTION_ACK_KEY)) {
    return {
      handled: true,
      reply: buildHelpFocusReactionRepeatAck(input.user.first_name)
    };
  }

  await recordEngagementDelivery(input.user.id, ACTIVATION_REACTION_ACK_KEY);

  return {
    handled: true,
    reply: buildActivationReactionAck(input.user.first_name)
  };
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
