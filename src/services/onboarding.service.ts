import type { MauriArchetype, MauriUser, MorningBriefTopicKey, WhatsAppInteractiveOutbound } from "../types.js";
import { CUSTOM_LANE_ARCHETYPE, isCustomLaneArchetype } from "../types.js";

import { buildLockedReplyForUser } from "./paywall.service.js";
import {
  buildArchetypeLaneList,
  inferArchetypeFromMessage
} from "./archetype-catalog.js";
import {
  buildArchetypePickerInteractive,
  buildHeavyShareArchetypePickerInteractive,
  buildTopicsPickerInteractive
} from "./whatsapp-interactive.service.js";
import {
  buildCustomTopicsPrompt,
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
  preferredNameFromFacts,
  resolveKnowYouAcknowledgement
} from "./user-mind.service.js";
import {
  buildLifeThreadActivationNote,
  isHeavyKnowYouShare
} from "./life-thread.service.js";
import {
  listPendingFollowUpsForUser,
  seedLifeThreadsFromOnboarding
} from "./open-loop-follow-up.service.js";
import { assignWeeklyFocusForUser } from "./weekly-focus.service.js";
import { updateUserState } from "./user.service.js";

export interface OnboardingResult {
  handled: boolean;
  reply?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
  sendTextBeforeInteractive?: boolean | undefined;
  user: MauriUser;
}

const archetypeActivationHooks: Record<MauriArchetype, string> = {
  "Student Grind": "I'll track exam pressure, commute chaos, and student spending with you.",
  "Corporate / Career": "I'll watch work wins, commute grind, and where your salary actually goes.",
  "Entrepreneur Mode": "I'll keep an eye on cashflow, focus blocks, and the messy founder week.",
  "Life & Habit Tracking": "I'll help you spot patterns in habits, mood, and daily balance.",
  [CUSTOM_LANE_ARCHETYPE]:
    "Your tags, your brief — type what you want in the 7am pulse."
};

function buildArchetypePrompt(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";

  return `Pick what's closest for your 7 AM pulse — shortcuts, not boxes, ${name}.

${buildArchetypeLaneList()}

None fit perfectly? Pick closest, or Custom (5) — then type your own brief tags.`;
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
  const pendingFollowUps = await listPendingFollowUpsForUser(updatedUser.id);
  const threadNote = buildLifeThreadActivationNote(pendingFollowUps);
  const replyParts = [
    buildActivationReply(archetype, topics, updatedUser.weekly_focus_habit ?? "one small win each day")
  ];

  if (threadNote) {
    replyParts.push("", threadNote);
  }

  return {
    handled: true,
    user: updatedUser,
    reply: replyParts.join("\n")
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
        }),
        sendTextBeforeInteractive: true
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

    try {
      await seedLifeThreadsFromOnboarding({ user: updatedUser, facts });
    } catch {
      // Best-effort — onboarding should not fail if follow-up scheduling fails.
    }

    const heavyShare = isHeavyKnowYouShare(message, facts);
    const ack = await resolveKnowYouAcknowledgement({
      user: updatedUser,
      message,
      facts,
      skipped: false,
      compact: true
    });

    if (heavyShare) {
      return {
        handled: true,
        user: updatedUser,
        reply: ack,
        interactive: buildHeavyShareArchetypePickerInteractive({
          firstName: updatedUser.first_name
        }),
        sendTextBeforeInteractive: true
      };
    }

    return {
      handled: true,
      user: updatedUser,
      reply: ack,
      interactive: buildArchetypePickerInteractive({
        firstName: updatedUser.first_name,
        isNewUser: false
      }),
      sendTextBeforeInteractive: true
    };
  }

  if (user.onboarding_state === "awaiting_topics") {
    const parsedTopics = parseTopicSelection(message);
    const customLane = isCustomLaneArchetype(user.archetype);

    if (customLane && isTopicConfirmation(message)) {
      return {
        handled: true,
        user,
        reply: buildCustomTopicsPrompt()
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
          ? `${buildCustomTopicsPrompt()}\n\nNeed 3–5 tags — try again.`
          : "",
        interactive: customLane ? undefined : buildTopicsPickerInteractive(user.archetype)
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

  const archetype = inferArchetypeFromMessage(message);
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

  const pendingFollowUps = await listPendingFollowUpsForUser(updatedUser.id);
  const laneConfirmation =
    pendingFollowUps.length > 0
      ? `Got it — ${archetype} for your 7am brief. The personal stuff you shared stays with me separately; I'll check in when it makes sense, not in the brief.`
      : undefined;

  if (isCustomLaneArchetype(archetype)) {
    const replyParts = [laneConfirmation, buildCustomTopicsPrompt()].filter(Boolean);

    return {
      handled: true,
      user: updatedUser,
      reply: replyParts.join("\n\n")
    };
  }

  return {
    handled: true,
    user: updatedUser,
    reply: laneConfirmation,
    interactive: buildTopicsPickerInteractive(archetype),
    sendTextBeforeInteractive: Boolean(laneConfirmation)
  };
}
