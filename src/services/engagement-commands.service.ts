import { env } from "../lib/env.js";
import type { MauriUser, WhatsAppInteractiveOutbound } from "../types.js";
import { generatePersonalityFeedback } from "./ai.service.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { buildEngagementActivitySnapshot } from "./engagement-stats.service.js";
import { buildHelpMenu, parseHelpCommand } from "./help-menu.service.js";
import { buildHabitStreakReply, loadHabitStreakSnapshot } from "./habit-streak.service.js";
import { buildDailyMicroLesson, buildOnDemandLessonReply } from "./micro-lesson.service.js";
import { hasEngagementDelivery } from "./engagement-delivery.service.js";
import { buildWeeklyFocusReply } from "./weekly-focus.service.js";
import { buildHelpMenuInteractive } from "./whatsapp-interactive.service.js";

export interface EngagementCommandResult {
  handled: boolean;
  reply?: string | undefined;
  interactive?: WhatsAppInteractiveOutbound | undefined;
}

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseEngagementCommand(
  message: string
): { type: "roast" } | { type: "hype" } | { type: "streaks" } | { type: "focus" } | { type: "lesson" } | null {
  const normalized = normalize(message);

  if (normalized === "roast me" || normalized === "roast my week" || normalized === "roast") {
    return { type: "roast" };
  }

  if (normalized === "hype me" || normalized === "hype my week" || normalized === "hype") {
    return { type: "hype" };
  }

  if (normalized === "my streaks" || normalized === "streaks" || normalized === "habit streaks") {
    return { type: "streaks" };
  }

  if (normalized === "my focus" || normalized === "weekly focus" || normalized === "focus") {
    return { type: "focus" };
  }

  if (normalized === "lesson" || normalized === "daily lesson" || normalized === "micro lesson") {
    return { type: "lesson" };
  }

  return null;
}

function lessonDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export async function handleEngagementCommandMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<EngagementCommandResult> {
  if (normalize(input.message) === "show full menu") {
    return {
      handled: true,
      reply: buildHelpMenu(input.user)
    };
  }

  if (parseHelpCommand(input.message)) {
    return {
      handled: true,
      interactive: buildHelpMenuInteractive()
    };
  }

  const command = parseEngagementCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      reply: "Finish onboarding first. Reply help after that to see everything Mauri can do."
    };
  }

  if (command.type === "focus") {
    return {
      handled: true,
      reply: buildWeeklyFocusReply(input.user)
    };
  }

  if (command.type === "streaks") {
    const snapshot = await loadHabitStreakSnapshot({
      userId: input.user.id,
      timezone: env.MORNING_BRIEF_TIMEZONE
    });
    return {
      handled: true,
      reply: buildHabitStreakReply(snapshot)
    };
  }

  if (command.type === "lesson") {
    const alreadySent = await hasEngagementDelivery(input.user.id, `micro_lesson_${lessonDateKey()}`);
    const lesson = await buildDailyMicroLesson(input.user);
    const reply = buildOnDemandLessonReply(lesson);
    return {
      handled: true,
      reply: alreadySent
        ? `${reply}\n\n(You already got today's insight in your morning flow.)`
        : reply
    };
  }

  const snapshot = await buildEngagementActivitySnapshot(input.user.id);
  const reply = await generatePersonalityFeedback({
    user: input.user,
    mode: command.type,
    snapshot,
    weeklyFocus: input.user.weekly_focus_habit
  });

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: command.type === "roast" ? "personality_roast_requested" : "personality_hype_requested",
    userId: input.user.id,
    entityType: "user",
    entityId: input.user.id,
    message: `User requested ${command.type} feedback.`,
    metadata: { snapshot }
  });

  return {
    handled: true,
    reply
  };
}
