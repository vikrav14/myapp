import type { MauriUser, MorningBriefTopicKey } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
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

  if (command.type === "show") {
    return {
      handled: true,
      user: input.user,
      reply: buildTopicStatusReply(
        input.user.topic_preferences as MorningBriefTopicKey[],
        input.user.morning_digest_enabled
      )
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
