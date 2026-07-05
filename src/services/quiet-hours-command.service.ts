import type { MauriUser } from "../types.js";
import { updateUserState } from "./user.service.js";
import {
  buildProactiveBudgetStatusReply,
  countProactivePingsToday,
  formatQuietHoursWindow
} from "./outbound-pace.service.js";

export interface QuietHoursCommandResult {
  handled: boolean;
  reply?: string | undefined;
}

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseQuietHoursCommand(
  message: string
): { type: "status" } | { type: "enable" } | { type: "disable" } | null {
  const normalized = normalize(message);

  if (normalized === "quiet hours" || normalized === "my quiet hours" || normalized === "quiet hours status") {
    return { type: "status" };
  }

  if (normalized === "quiet hours on" || normalized === "enable quiet hours") {
    return { type: "enable" };
  }

  if (normalized === "quiet hours off" || normalized === "disable quiet hours") {
    return { type: "disable" };
  }

  return null;
}

export async function handleQuietHoursCommandMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<QuietHoursCommandResult> {
  const command = parseQuietHoursCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      reply: "Finish onboarding first — then you can tune quiet hours and proactive pings."
    };
  }

  if (command.type === "status") {
    const sentToday = await countProactivePingsToday(input.user.id);
    return {
      handled: true,
      reply: buildProactiveBudgetStatusReply(input.user, sentToday)
    };
  }

  const enabled = command.type === "enable";
  const updatedUser = await updateUserState(input.user.id, {
    quiet_hours_enabled: enabled
  });

  return {
    handled: true,
    reply: enabled
      ? `Quiet hours on. I won't send unprompted pings between ${formatQuietHoursWindow(updatedUser)}. Reminders and replies to you still come through.`
      : "Quiet hours off. Unprompted pings can arrive anytime (still capped per day)."
  };
}
