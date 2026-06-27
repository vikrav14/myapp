import type { MauriArchetype, MauriUser, MorningBriefTopicKey } from "../types.js";

import { buildLockedReplyForUser } from "./paywall.service.js";
import { buildOnboardingPreviewBrief } from "./morning-brief-preview.service.js";
import { buildQuickStartMenu } from "./help-menu.service.js";
import {
  buildSuggestedTopicsPrompt,
  defaultTopicsForArchetype,
  formatTopicList,
  isTopicConfirmation,
  isValidTopicSelection,
  parseTopicSelection
} from "./morning-brief-topics.service.js";
import {
  buildKnowYouAcknowledgement,
  buildKnowYouPrompt,
  ingestUserMindMessage,
  isKnowYouSkipMessage,
  isKnowYouTooShort,
  loadUserMindFacts,
  preferredNameFromFacts
} from "./user-mind.service.js";
import { assignWeeklyFocusForUser } from "./weekly-focus.service.js";
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
  followUpReply?: string | undefined;
  discoveryReply?: string | undefined;
  user: MauriUser;
}

const archetypeActivationHooks: Record<MauriArchetype, string> = {
  "Student Grind": "I'll track exam pressure, commute chaos, and student spending with you.",
  "Corporate / Career": "I'll watch work wins, commute grind, and where your salary actually goes.",
  "Entrepreneur Mode": "I'll keep an eye on cashflow, focus blocks, and the messy founder week.",
  "Life & Habit Tracking": "I'll help you spot patterns in habits, mood, and daily balance."
};

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

function buildArchetypePrompt(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";

  return `Pick a starting lane for your 7 AM pulse — closest fit is fine, ${name}.

Student Grind.
Corporate / Career.
Entrepreneur Mode.
Life & Habit Tracking.

Reply with the exact one. Or send 1, 2, 3, or 4.
None fit perfectly? Pick closest — your tags define the rest on the next step.`;
}

function buildActivationReply(archetype: MauriArchetype, topics: MorningBriefTopicKey[]): string {
  const hook = archetypeActivationHooks[archetype] ?? archetypeActivationHooks["Life & Habit Tracking"];

  return `Perfect. You're in on ${archetype}.

${hook}

Your 7-day trial starts now.
Morning vibe check tags: ${formatTopicList(topics)}.
I'll send your Mauritian brief at 7:00 with weather, traffic, and stories matched to those tags.

Send me your messy brain dump exactly as it is. Spending. Tasks. Wins. Stress. Random thoughts. I'll sort the signal from the chaos.

Squads are live on your trial — reply create squad Study Crew and invite mates before Sunday showdown.

Reply help anytime for the full command menu.`;
}

async function activateUserWithTopics(
  user: MauriUser,
  topics: MorningBriefTopicKey[]
): Promise<OnboardingResult> {
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 7);

  const activatedUser = await updateUserState(user.id, {
    onboarding_state: "active",
    onboarding_completed_at: trialStartedAt.toISOString(),
    trial_started_at: trialStartedAt.toISOString(),
    trial_ends_at: trialEndsAt.toISOString(),
    topic_preferences: topics,
    morning_digest_enabled: true,
    locked_at: null
  });

  const updatedUser = await assignWeeklyFocusForUser(activatedUser);
  const archetype = updatedUser.archetype as MauriArchetype;
  const preview = await buildOnboardingPreviewBrief({
    firstName: updatedUser.first_name,
    archetype,
    topics
  });

  return {
    handled: true,
    user: updatedUser,
    reply: `${buildActivationReply(archetype, topics)}

This week's one habit: ${updatedUser.weekly_focus_habit}`,
    followUpReply: preview,
    discoveryReply: buildQuickStartMenu()
  };
}

export async function enforceAccessPolicy(
  user: MauriUser,
  requestId?: string | undefined
): Promise<OnboardingResult> {
  if (user.subscription_status === "Paid_Active") {
    if (!user.subscription_ends_at) {
      return {
        handled: false,
        user
      };
    }

    const subscriptionExpired = new Date(user.subscription_ends_at).getTime() <= Date.now();
    if (!subscriptionExpired) {
      return {
        handled: false,
        user
      };
    }

    const updatedPaidUser = await updateUserState(user.id, {
      subscription_status: "Locked",
      locked_at: new Date().toISOString()
    });

    return {
      handled: true,
      user: updatedPaidUser,
      reply: await buildLockedReplyForUser(updatedPaidUser, requestId)
    };
  }

  if (user.subscription_status === "Locked") {
    return {
      handled: true,
      user,
      reply: await buildLockedReplyForUser(user, requestId)
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
    reply: await buildLockedReplyForUser(updatedUser, requestId)
  };
}

export async function handleOnboardingMessage(input: {
  user: MauriUser;
  isNewUser: boolean;
  message: string;
}): Promise<OnboardingResult> {
  const { user, message } = input;

  if (user.onboarding_state === "active") {
    return {
      handled: false,
      user
    };
  }

  if (user.onboarding_state === "awaiting_know_you") {
    if (isKnowYouSkipMessage(message)) {
      const updatedUser = await updateUserState(user.id, {
        onboarding_state: "awaiting_archetype"
      });

      return {
        handled: true,
        user: updatedUser,
        reply: buildKnowYouAcknowledgement({
          user: updatedUser,
          facts: [],
          skipped: true
        })
      };
    }

    if (isKnowYouTooShort(message)) {
      return {
        handled: true,
        user,
        reply: buildKnowYouPrompt(user)
      };
    }

    await ingestUserMindMessage({
      userId: user.id,
      message,
      source: "onboarding"
    });
    const facts = await loadUserMindFacts(user.id);
    const preferredName = preferredNameFromFacts(facts);
    const updatedUser = await updateUserState(user.id, {
      onboarding_state: "awaiting_archetype",
      ...(preferredName ? { first_name: preferredName } : {})
    });

    return {
      handled: true,
      user: updatedUser,
      reply: buildKnowYouAcknowledgement({
        user: updatedUser,
        facts,
        skipped: false
      })
    };
  }

  if (user.onboarding_state === "awaiting_topics") {
    const parsedTopics = parseTopicSelection(message);
    const topics = isValidTopicSelection(parsedTopics)
      ? parsedTopics
      : isTopicConfirmation(message)
        ? defaultTopicsForArchetype(user.archetype)
        : null;

    if (!topics || !isValidTopicSelection(topics)) {
      return {
        handled: true,
        user,
        reply: `${buildSuggestedTopicsPrompt(user.archetype)}

Pick at least 3 and at most 5, or reply OK to keep the suggested tags.`
      };
    }

    return activateUserWithTopics(user, topics);
  }

  if (user.onboarding_state !== "awaiting_archetype") {
    return {
      handled: true,
      user,
      reply: buildKnowYouPrompt(user)
    };
  }

  const archetype = inferArchetype(message);
  if (!archetype) {
    return {
      handled: true,
      user,
      reply: buildArchetypePrompt(user)
    };
  }

  const updatedUser = await updateUserState(user.id, {
    onboarding_state: "awaiting_topics",
    archetype
  });

  return {
    handled: true,
    user: updatedUser,
    reply: buildSuggestedTopicsPrompt(archetype)
  };
}
