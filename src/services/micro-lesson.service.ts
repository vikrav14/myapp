import { env } from "../lib/env.js";
import { generateMicroLesson } from "./ai.service.js";
import type { MauriUser } from "../types.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";

const FALLBACK_LESSONS: Record<string, string> = {
  "Student Grind":
    "Exam pressure shrinks when you shrink the target. One focused block beats a vague 'study more' guilt loop.",
  "Corporate / Career":
    "Your salary is a pipeline, not a score. One honest spending log today beats a perfect budget you never open.",
  "Entrepreneur Mode":
    "Founder chaos calms when cashflow gets a daily glance. Five minutes on money saves five hours of anxiety.",
  "Life & Habit Tracking":
    "Balance isn't equal hours in every lane. It's noticing which lane is leaking energy before the week ends.",
  "My Own Mix":
    "Your lane doesn't need a label. One honest log today beats a perfect system you never start."
};

function lessonDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export async function buildDailyMicroLesson(user: MauriUser): Promise<string> {
  try {
    const lesson = await generateMicroLesson({
      user,
      weeklyFocus: user.weekly_focus_habit
    });
    return lesson.trim();
  } catch {
    return FALLBACK_LESSONS[user.archetype] ?? FALLBACK_LESSONS["Life & Habit Tracking"]!;
  }
}

export async function buildDailyMicroLessonSection(user: MauriUser): Promise<string | null> {
  const deliveryKey = `micro_lesson_${lessonDateKey()}`;
  if (await hasEngagementDelivery(user.id, deliveryKey)) {
    return null;
  }

  const lesson = await buildDailyMicroLesson(user);
  await recordEngagementDelivery(user.id, deliveryKey);
  return `Today's insight: ${lesson}`;
}

export function buildOnDemandLessonReply(lesson: string): string {
  return `Today's insight:

${lesson}

Reply lesson anytime. It refreshes once per day in your morning flow.`;
}
