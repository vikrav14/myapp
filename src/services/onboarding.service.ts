import type { MauriArchetype, MauriUser } from "../types.js";

import { env } from "../lib/env.js";
import { updateUserState } from "./user.service.js";

const archetypeCatalog: Array<{
  archetype: MauriArchetype;
  aliases: string[];
}> = [
  {
    archetype: "Student Grind",
    aliases: ["student", "student grind", "uom", "utm", "uni", "university", "study", "exams", "1"]
  },
  {
    archetype: "Corporate / Career",
    aliases: ["corporate", "career", "job", "office", "work", "professional", "2"]
  },
  {
    archetype: "Entrepreneur Mode",
    aliases: ["entrepreneur", "business", "startup", "founder", "side hustle", "3"]
  },
  {
    archetype: "Life & Habit Tracking",
    aliases: ["habit", "life", "wellness", "balance", "routine", "tracking", "4"]
  }
];

export interface OnboardingResult {
  handled: boolean;
  reply?: string | undefined;
  user: MauriUser;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function inferArchetype(message: string): MauriArchetype | null {
  const normalized = normalize(message);

  for (const entry of archetypeCatalog) {
    if (
      entry.aliases.some((alias) => {
        if (/^\d+$/.test(alias)) {
          return normalized === alias;
        }

        return normalized.includes(alias);
      })
    ) {
      return entry.archetype;
    }
  }

  return null;
}

function buildOnboardingPrompt(user: MauriUser, isNewUser: boolean): string {
  const name = user.first_name?.trim() || "there";
  const opener = isNewUser
    ? `Hey ${name}. I’m Mauri. I’ll help you clear the noise, track the real stuff, and keep you moving.`
    : `We’re almost in, ${name}. I just need your lane first.`;

  return `${opener}

Pick the vibe that fits you best.

Student Grind.
Corporate / Career.
Entrepreneur Mode.
Life & Habit Tracking.

Reply with the exact one. Or just send 1, 2, 3, or 4.`;
}

function buildActivationReply(archetype: MauriArchetype): string {
  return `Perfect. You’re in on ${archetype}.

Your 7-day trial starts now.

Send me your messy brain dump exactly as it is. Spending. Tasks. Wins. Stress. Random thoughts. I’ll sort the signal from the chaos.`;
}

function buildLockedReply(user: MauriUser): string {
  const name = user.first_name?.trim() || "Hey";
  const paymentTail =
    env.MCB_JUICE_PAYMENT_LINK || env.BLINK_PAYMENT_LINK
      ? `Unlock it here. Juice: ${env.MCB_JUICE_PAYMENT_LINK ?? "not set yet"}. Blink: ${
          env.BLINK_PAYMENT_LINK ?? "not set yet"
        }.`
      : "Payment links are not wired yet, so flip this user to Paid_Active in Supabase after payment for now.";

  return `${name}, your Mauri vault is locked right now.

Your trial window ended, so I’m holding the deeper memory and tracking layer until premium is active.

Premium is Rs ${env.SUBSCRIPTION_MONTHLY_PRICE_RS} per month.

${paymentTail}`;
}

export async function handleOnboardingMessage(input: {
  user: MauriUser;
  isNewUser: boolean;
  message: string;
}): Promise<OnboardingResult> {
  const { user, isNewUser, message } = input;

  if (user.onboarding_state === "active") {
    return {
      handled: false,
      user
    };
  }

  const archetype = inferArchetype(message);
  if (!archetype) {
    return {
      handled: true,
      user,
      reply: buildOnboardingPrompt(user, isNewUser)
    };
  }

  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 7);

  const updatedUser = await updateUserState(user.id, {
    onboarding_state: "active",
    onboarding_completed_at: trialStartedAt.toISOString(),
    archetype,
    trial_started_at: trialStartedAt.toISOString(),
    trial_ends_at: trialEndsAt.toISOString(),
    locked_at: null
  });

  return {
    handled: true,
    user: updatedUser,
    reply: buildActivationReply(archetype)
  };
}

export async function enforceAccessPolicy(user: MauriUser): Promise<OnboardingResult> {
  if (user.subscription_status === "Paid_Active") {
    return {
      handled: false,
      user
    };
  }

  if (user.subscription_status === "Locked") {
    return {
      handled: true,
      user,
      reply: buildLockedReply(user)
    };
  }

  if (!user.trial_ends_at) {
    return {
      handled: false,
      user
    };
  }

  const expired = new Date(user.trial_ends_at).getTime() <= Date.now();
  if (!expired) {
    return {
      handled: false,
      user
    };
  }

  const updatedUser = await updateUserState(user.id, {
    subscription_status: "Locked",
    locked_at: new Date().toISOString()
  });

  return {
    handled: true,
    user: updatedUser,
    reply: buildLockedReply(updatedUser)
  };
}
