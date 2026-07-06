import type { MauriModuleKey, MauriUser, WhatsAppInteractiveOutbound } from "../types.js";

import { buildLockedReplyForUser } from "./paywall.service.js";
import { buildExpressStartInteractive } from "./whatsapp-interactive.service.js";
import {
  buildExpressActivationReply,
  buildExpressStartSummary,
  inferExpressSetup,
  isExpressStartConfirmation,
  type ExpressOnboardingSetup
} from "./express-onboarding.service.js";
import {
  buildKnowYouAcknowledgement,
  buildKnowYouPrompt,
  ingestUserMindMessage,
  isKnowYouSkipMessage,
  isKnowYouTooShort,
  loadUserMindFacts,
  preferredNameFromFacts,
  resetProfileForKnowYouOnboarding,
  resolveKnowYouAcknowledgement
} from "./user-mind.service.js";
import {
  buildHeavyShareTrustBridge,
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

const EXPRESS_SETUP_STATES = new Set([
  "awaiting_express_start",
  "awaiting_archetype",
  "awaiting_brief_focus",
  "awaiting_modules",
  "awaiting_topics"
]);

async function activateUserExpress(
  user: MauriUser,
  setup: ExpressOnboardingSetup
): Promise<OnboardingResult> {
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt);
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 7);

  const activatedUser = await updateUserState(user.id, {
    onboarding_state: "active",
    archetype: setup.archetype,
    active_modules: setup.modules,
    topic_preferences: setup.topics,
    onboarding_completed_at: trialStartedAt.toISOString(),
    trial_started_at: trialStartedAt.toISOString(),
    trial_ends_at: trialEndsAt.toISOString(),
    morning_digest_enabled: true,
    locked_at: null
  });

  const updatedUser = await assignWeeklyFocusForUser(activatedUser);
  const pendingFollowUps = (await listPendingFollowUpsForUser(updatedUser.id)).filter(
    (followUp) => followUp.source === "onboarding"
  );
  const threadNote = buildLifeThreadActivationNote(pendingFollowUps);
  const replyParts = [
    buildExpressActivationReply({
      firstName: updatedUser.first_name,
      setup,
      weeklyFocus: updatedUser.weekly_focus_habit ?? "one small win each day"
    })
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

async function beginExpressStartStep(user: MauriUser, prefixReply?: string): Promise<OnboardingResult> {
  const facts = await loadUserMindFacts(user.id);
  const setup = inferExpressSetup(facts);
  const summary = buildExpressStartSummary({ firstName: user.first_name, setup });
  const replyParts = [prefixReply, summary].filter(Boolean);

  return {
    handled: true,
    user,
    reply: replyParts.join("\n\n"),
    interactive: buildExpressStartInteractive(),
    sendTextBeforeInteractive: Boolean(prefixReply)
  };
}

async function completeExpressStart(user: MauriUser): Promise<OnboardingResult> {
  const facts = await loadUserMindFacts(user.id);
  const setup = inferExpressSetup(facts);
  return activateUserExpress(user, setup);
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
        onboarding_state: "awaiting_express_start"
      });

      return beginExpressStartStep(
        updatedUser,
        buildKnowYouAcknowledgement({
          user: updatedUser,
          facts: [],
          skipped: true,
          compact: true
        })
      );
    }

    if (isKnowYouTooShort(message)) {
      return {
        handled: true,
        user,
        reply: buildKnowYouPrompt(user)
      };
    }

    await resetProfileForKnowYouOnboarding(user.id);
    const facts = await ingestUserMindMessage({
      userId: user.id,
      message,
      source: "onboarding"
    });
    const preferredName = preferredNameFromFacts(facts);
    const updatedUser = await updateUserState(user.id, {
      onboarding_state: "awaiting_express_start",
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
    const setup = inferExpressSetup(facts);
    const summary = buildExpressStartSummary({ firstName: updatedUser.first_name, setup });

    if (heavyShare) {
      const bridge = buildHeavyShareTrustBridge(updatedUser.first_name);
      return {
        handled: true,
        user: updatedUser,
        reply: `${ack}\n\n${bridge}\n\n${summary}`,
        interactive: buildExpressStartInteractive(),
        sendTextBeforeInteractive: true
      };
    }

    return {
      handled: true,
      user: updatedUser,
      reply: `${ack}\n\n${summary}`,
      interactive: buildExpressStartInteractive(),
      sendTextBeforeInteractive: true
    };
  }

  if (EXPRESS_SETUP_STATES.has(user.onboarding_state)) {
    if (!isExpressStartConfirmation(message)) {
      return beginExpressStartStep(user);
    }

    return completeExpressStart(user);
  }

  return {
    handled: true,
    user,
    reply: buildKnowYouPrompt(user)
  };
}
