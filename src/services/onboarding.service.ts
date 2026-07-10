import type { MauriModuleKey, MauriUser, WhatsAppImageOutbound, WhatsAppInteractiveOutbound } from "../types.js";

import { logger } from "../lib/logger.js";
import { buildPaywallReplyForUser } from "./paywall.service.js";
import { buildExpressStartInteractive } from "./whatsapp-interactive.service.js";
import {
  buildExpressActivationReply,
  buildExpressStartSummary,
  inferExpressSetup,
  isExpressCardEchoMessage,
  isExpressSetupQuestion,
  isExpressStartConfirmation,
  resolveExpressSetupQuestionReply,
  shouldSuppressPostActivationNoise,
  type ExpressOnboardingSetup
} from "./express-onboarding.service.js";
import {
  buildKnowYouAcknowledgement,
  buildKnowYouPrompt,
  extractBasicKnowYouFactsFromMessage,
  ingestUserMindMessage,
  isKnowYouSkipMessage,
  isKnowYouTooShort,
  loadUserMindFacts,
  preferredNameFromFacts,
  resetProfileForKnowYouOnboarding,
  upsertUserMindFacts
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
import { assignHelpFocusFromFacts } from "./help-focus.service.js";
import { buildHelpFocusActivationExplanation } from "./help-focus-inference.service.js";
import { buildHelpFocusActivationInteractive } from "./whatsapp-interactive.service.js";
import { assignWeeklyFocusForUser } from "./weekly-focus.service.js";
import { buildChaosOrganizerMap, isChaosProfile } from "./chaos-organizer.service.js";
import { buildWelcomeImagePayload } from "./rich-media.service.js";
import { updateUserState } from "./user.service.js";

export interface OnboardingResult {
  handled: boolean;
  reply?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
  secondaryInteractive?: WhatsAppInteractiveOutbound | undefined;
  image?: WhatsAppImageOutbound | undefined;
  sendTextBeforeInteractive?: boolean | undefined;
  outboundFlow?: string | undefined;
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

  const facts = await loadUserMindFacts(user.id);
  const updatedUser = await assignWeeklyFocusForUser(activatedUser, facts);
  const focusedUser = await assignHelpFocusFromFacts(updatedUser);
  const pendingFollowUps = (await listPendingFollowUpsForUser(focusedUser.id)).filter(
    (followUp) => followUp.source === "onboarding"
  );
  const threadNote = buildLifeThreadActivationNote(pendingFollowUps);
  const adviceLine = buildHelpFocusActivationExplanation({
    primary: focusedUser.help_focus_primary,
    secondary: focusedUser.help_focus_secondary,
    facts
  });
  const replyParts = [
    buildExpressActivationReply({
      firstName: focusedUser.first_name,
      setup,
      weeklyFocus: focusedUser.weekly_focus_habit ?? "one small win each day",
      facts
    })
  ];

  if (adviceLine) {
    replyParts.push("", adviceLine);
  }

  if (threadNote) {
    replyParts.push("", threadNote);
  }

  return {
    handled: true,
    user: focusedUser,
    reply: replyParts.join("\n"),
    outboundFlow: "express_activation",
    interactive: buildHelpFocusActivationInteractive({
      firstName: focusedUser.first_name
    }),
    sendTextBeforeInteractive: true
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

async function handleExpressSetupMessage(user: MauriUser, message: string): Promise<OnboardingResult> {
  if (isExpressStartConfirmation(message)) {
    return completeExpressStart(user);
  }

  if (isExpressCardEchoMessage(message)) {
    return {
      handled: true,
      user
    };
  }

  const facts = await loadUserMindFacts(user.id);
  const setup = inferExpressSetup(facts);

  if (isExpressSetupQuestion(message)) {
    const explanation = await resolveExpressSetupQuestionReply({
      userId: user.id,
      firstName: user.first_name,
      message,
      facts,
      setup
    });

    return {
      handled: true,
      user,
      reply: explanation,
      interactive: buildExpressStartInteractive(),
      sendTextBeforeInteractive: true
    };
  }

  if (user.onboarding_state === "awaiting_express_start") {
    return {
      handled: true,
      user,
      reply: "Still here — tap Start my trial when you're ready, or ask how I chose this setup.",
      interactive: buildExpressStartInteractive()
    };
  }

  return beginExpressStartStep(user);
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

    const paywallReply = await buildPaywallReplyForUser(updatedPaidUser, requestId, "locked");

    return {
      handled: true,
      user: updatedPaidUser,
      reply: paywallReply.text,
      interactive: paywallReply.interactive,
      secondaryInteractive: paywallReply.secondaryInteractive,
      sendTextBeforeInteractive: paywallReply.sendTextBeforeInteractive
    };
  }

  if (user.subscription_status === "Locked") {
    const paywallReply = await buildPaywallReplyForUser(user, requestId, "locked");

    return {
      handled: true,
      user,
      reply: paywallReply.text,
      interactive: paywallReply.interactive,
      secondaryInteractive: paywallReply.secondaryInteractive,
      sendTextBeforeInteractive: paywallReply.sendTextBeforeInteractive
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

  const paywallReply = await buildPaywallReplyForUser(updatedUser, requestId, "locked");

  return {
    handled: true,
    user: updatedUser,
    reply: paywallReply.text,
    interactive: paywallReply.interactive,
    secondaryInteractive: paywallReply.secondaryInteractive,
    sendTextBeforeInteractive: paywallReply.sendTextBeforeInteractive
  };
}

export async function handleOnboardingMessage(input: {
  user: MauriUser;
  isNewUser: boolean;
  message: string;
}): Promise<OnboardingResult> {
  const { user, message } = input;

  if (user.onboarding_state === "active") {
    if (shouldSuppressPostActivationNoise(user, message)) {
      return {
        handled: true,
        user
      };
    }

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
        reply: buildKnowYouPrompt(user),
        image: input.isNewUser ? buildWelcomeImagePayload(user) ?? undefined : undefined,
        outboundFlow: "know_you_welcome"
      };
    }

    try {
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
      const ack = buildKnowYouAcknowledgement({
        user: updatedUser,
        facts,
        skipped: false,
        compact: true
      });
      const setup = inferExpressSetup(facts);
      const summary = buildExpressStartSummary({ firstName: updatedUser.first_name, setup });

      if (heavyShare && isChaosProfile(facts, message)) {
        const chaosMap = buildChaosOrganizerMap({
          firstName: updatedUser.first_name,
          facts
        });
        const bridge = buildHeavyShareTrustBridge(updatedUser.first_name);
        return {
          handled: true,
          user: updatedUser,
          reply: `${chaosMap}\n\n${bridge}`,
          interactive: buildExpressStartInteractive(),
          sendTextBeforeInteractive: true
        };
      }

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
    } catch (error) {
      logger.error(
        {
          error,
          userId: user.id,
          errorMessage: error instanceof Error ? error.message : "unknown"
        },
        "Know-you submission failed."
      );

      try {
        const rows = extractBasicKnowYouFactsFromMessage(message, "onboarding");
        const facts =
          rows.length > 0
            ? await upsertUserMindFacts({ userId: user.id, rows })
            : [];
        const preferredName = preferredNameFromFacts(facts);
        const updatedUser = await updateUserState(user.id, {
          onboarding_state: "awaiting_express_start",
          ...(preferredName ? { first_name: preferredName } : {})
        });

        return beginExpressStartStep(
          updatedUser,
          buildKnowYouAcknowledgement({
            user: updatedUser,
            facts,
            skipped: facts.length === 0,
            compact: true
          })
        );
      } catch (recoveryError) {
        logger.error({ error: recoveryError, userId: user.id }, "Know-you recovery failed.");
        const name = user.first_name?.trim() || "there";

        return {
          handled: true,
          user,
          reply: `${name} — got your message. I hit a brief snag on my side.\n\nReply skip to jump in, or send a shorter note and I'll tune as we go.`,
          outboundFlow: "know_you_error"
        };
      }
    }
  }

  if (EXPRESS_SETUP_STATES.has(user.onboarding_state)) {
    return handleExpressSetupMessage(user, message);
  }

  return {
    handled: true,
    user,
    reply: buildKnowYouPrompt(user),
    image: input.isNewUser ? buildWelcomeImagePayload(user) ?? undefined : undefined,
    outboundFlow: "know_you_welcome"
  };
}
