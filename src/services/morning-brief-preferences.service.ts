import type { MauriUser, MorningBriefTopicKey } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
  buildDigestDensityReply,
  buildDigestToggleReply,
  buildTopicStatusReply,
  buildTopicUpdatePrompt,
  formatTopicList,
  isValidTopicSelection,
  parseTopicPreferenceCommand,
  parseTopicSelection
} from "./morning-brief-topics.service.js";
import { updateUserState } from "./user.service.js";

export interface TopicPreferenceCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user: MauriUser;
}

export async function handleTopicPreferenceMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<TopicPreferenceCommandResult> {
  const command = parseTopicPreferenceCommand(input.message);
  if (!command) {
    return { handled: false, user: input.user };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      user: input.user,
      reply: "Finish onboarding first, then you can manage your morning brief topics here."
    };
  }

  if (command.type === "show" || command.type === "brief_status") {
    return {
      handled: true,
      user: input.user,
      reply: buildTopicStatusReply(
        input.user.topic_preferences as MorningBriefTopicKey[],
        input.user.morning_digest_enabled,
        input.user.morning_brief_density
      )
    };
  }

  if (command.type === "density") {
    if (command.density === input.user.morning_brief_density) {
      return {
        handled: true,
        user: input.user,
        reply: buildDigestDensityReply({ density: input.user.morning_brief_density })
      };
    }

    const updatedUser = await updateUserState(input.user.id, {
      morning_brief_density: command.density
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "morning_brief_density_updated",
      userId: updatedUser.id,
      entityType: "user",
      entityId: updatedUser.id,
      message: `User set morning brief density to ${command.density}.`,
      metadata: {
        morning_brief_density: command.density
      }
    });

    return {
      handled: true,
      user: updatedUser,
      reply: buildDigestDensityReply({ density: command.density })
    };
  }

  if (command.type === "digest") {
    if (command.enabled === input.user.morning_digest_enabled) {
      return {
        handled: true,
        user: input.user,
        reply: buildDigestToggleReply({
          enabled: input.user.morning_digest_enabled,
          topics: input.user.topic_preferences as MorningBriefTopicKey[]
        })
      };
    }

    const updatedUser = await updateUserState(input.user.id, {
      morning_digest_enabled: command.enabled
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "morning_brief_digest_toggled",
      userId: updatedUser.id,
      entityType: "user",
      entityId: updatedUser.id,
      message: command.enabled ? "User enabled morning digest." : "User disabled morning digest.",
      metadata: {
        morning_digest_enabled: command.enabled,
        topic_preferences: updatedUser.topic_preferences
      }
    });

    return {
      handled: true,
      user: updatedUser,
      reply: buildDigestToggleReply({
        enabled: command.enabled,
        topics: updatedUser.topic_preferences as MorningBriefTopicKey[]
      })
    };
  }

  if (!command.selection.trim()) {
    return {
      handled: true,
      user: input.user,
      reply: buildTopicUpdatePrompt()
    };
  }

  const topics = parseTopicSelection(command.selection);
  if (!isValidTopicSelection(topics)) {
    return {
      handled: true,
      user: input.user,
      reply: `${buildTopicUpdatePrompt()}

You need at least 3 and at most 5 tags.`
    };
  }

  const updatedUser = await updateUserState(input.user.id, {
    topic_preferences: topics,
    morning_digest_enabled: true
  });

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "morning_brief_topics_updated",
    userId: updatedUser.id,
    entityType: "user",
    entityId: updatedUser.id,
    message: "User updated morning brief topic preferences.",
    metadata: {
      topics
    }
  });

  return {
    handled: true,
    user: updatedUser,
    reply: `Morning brief tags updated: ${formatTopicList(topics)}

Your next 7:00 vibe check will use these tags.`
  };
}
