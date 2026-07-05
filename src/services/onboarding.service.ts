import type { MauriArchetype, MauriUser, MorningBriefTopicKey, WhatsAppInteractiveOutbound } from "../types.js";
import { CUSTOM_LANE_ARCHETYPE } from "../types.js";

import { buildLockedReplyForUser } from "./paywall.service.js";
import {
  buildArchetypePickerInteractive,
  buildTopicsPickerInteractive
} from "./whatsapp-interactive.service.js";
import {
  buildSuggestedTopicsPrompt,
  defaultTopicsForArchetype,
  formatTopicList,
  isCustomLaneArchetype,
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

function isCustomLaneSelection(normalized: string): boolean {
  if (["5", "mix", "custom"].includes(normalized)) {
    return true;
  }

  return [
    "my own mix",
    "custom lane",
    "something else",
    "none of these",
    "none fit",
    "own mix",
    "my lane",
    "my own lane"
  ].some((alias) => normalized === alias);
}

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
  interactive?: WhatsAppInteractiveOutbound | undefined;
  user: MauriUser;
}

const archetypeActivationHooks: Record<MauriArchetype, string> = {
  "Student Grind": "I'll track exam pressure, commute chaos, and student spending with you.",
  "Corporate / Career": "I'll watch work wins, commute grind, and where your salary actually goes.",
  "Entrepreneur Mode": "I'll keep an eye on cashflow, focus blocks, and the messy founder week.",
  "Life & Habit Tracking": "I'll help you spot patterns in habits, mood, and daily balance.",
  [CUSTOM_LANE_ARCHETYPE]:
    "No preset box — I'll follow your know-you profile, your tags, and how you actually talk."
};

function buildArchetypeLaneList(): string {
  return `Student Grind.
Corporate / Career.
Entrepreneur Mode.
Life & Habit Tracking.
My Own Mix — your tags, your mix, no preset box.

Reply with the exact one. Or send 1, 2, 3, 4, or 5.
Pick My Own Mix (or 5) if none of the presets fit.`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function inferArchetype(message: string): MauriArchetype | null {
  const normalized = normalize(message);

  if (isCustomLaneSelection(normalized)) {
    return CUSTOM_LANE_ARCHETYPE;
  }

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

  return `Pick what's closest for your 7 AM pulse — shortcuts, not boxes, ${name}.

${buildArchetypeLaneList()}

None fit perfectly? Pick closest, or My Own Mix (5) — your tags and how you talk define the rest.`;
}

function buildActivationReply(
  archetype: MauriArchetype,
  topics: MorningBriefTopicKey[],
  weeklyFocus: string
): string {
  const hook = archetypeActivationHooks[archetype] ?? archetypeActivationHooks["Life & Habit Tracking"];
  const laneLine = isCustomLaneArchetype(archetype)
    ? `You're in on ${CUSTOM_LANE_ARCHETYPE}.`
    : `You're in on ${archetype}.`;

  return [
    laneLine,
    hook,
    "",
    "Your 7-day trial starts now.",
    `Morning brief tags: ${formatTopicList(topics)} — first brief tomorrow at 7:00.`,
    `This week's habit: ${weeklyFocus}`,
    "",
    "Try: \"remind me to drink water at 3pm\" or send a brain dump anytime.",
    "Reply help for all commands."
  ].join("\n");
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

  return {
    handled: true,
    user: updatedUser,
    reply: buildActivationReply(archetype, topics, updatedUser.weekly_focus_habit ?? "one small win each day")
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
  const { user, message, isNewUser } = input;

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
          skipped: true,
          compact: true
        }),
        interactive: buildArchetypePickerInteractive({
          firstName: updatedUser.first_name,
          isNewUser
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
        skipped: false,
        compact: true
      }),
      interactive: buildArchetypePickerInteractive({
        firstName: updatedUser.first_name,
        isNewUser: false
      })
    };
  }

  if (user.onboarding_state === "awaiting_topics") {
    const parsedTopics = parseTopicSelection(message);
    const customLane = isCustomLaneArchetype(user.archetype);

    if (customLane && isTopicConfirmation(message)) {
      return {
        handled: true,
        user,
        reply: `${buildSuggestedTopicsPrompt(user.archetype)}

For My Own Mix, send your tags — OK won't apply here.`
      };
    }

    const topics = isValidTopicSelection(parsedTopics)
      ? parsedTopics
      : !customLane && isTopicConfirmation(message)
        ? defaultTopicsForArchetype(user.archetype)
        : null;

    if (!topics || !isValidTopicSelection(topics)) {
      return {
        handled: true,
        user,
        reply: customLane
          ? `${buildSuggestedTopicsPrompt(user.archetype)}

Pick tags below or type your own (3–5 tags).

Example: Traffic Money Tech`
          : "",
        interactive: buildTopicsPickerInteractive(user.archetype)
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
      interactive: buildArchetypePickerInteractive({
        firstName: user.first_name,
        isNewUser
      })
    };
  }

  const updatedUser = await updateUserState(user.id, {
    onboarding_state: "awaiting_topics",
    archetype
  });

  return {
    handled: true,
    user: updatedUser,
    interactive: buildTopicsPickerInteractive(archetype)
  };
}
