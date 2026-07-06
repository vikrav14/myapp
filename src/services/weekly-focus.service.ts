import type { MauriArchetype, MauriUser } from "../types.js";
import { CUSTOM_LANE_ARCHETYPE, canonicalArchetypeKey } from "../types.js";
import { updateUserState } from "./user.service.js";

const ARCHETYPE_WEEKLY_FOCUS: Record<string, string> = {
  "Student Grind": "45 minutes deep study before noon",
  "Corporate / Career": "One focused work block without scrolling",
  "Entrepreneur Mode": "Review cash in and out before lunch",
  "Life & Habit Tracking": "Morning check-in: mood plus one small win",
  [CUSTOM_LANE_ARCHETYPE]: "One small win you choose — log it when it happens"
};

export function defaultWeeklyFocusForArchetype(archetype: string): string {
  const key = canonicalArchetypeKey(archetype);
  return ARCHETYPE_WEEKLY_FOCUS[key] ?? ARCHETYPE_WEEKLY_FOCUS["Life & Habit Tracking"]!;
}

export async function assignWeeklyFocusForUser(user: MauriUser): Promise<MauriUser> {
  const focus = defaultWeeklyFocusForArchetype(user.archetype);
  return updateUserState(user.id, {
    weekly_focus_habit: focus,
    weekly_focus_set_at: new Date().toISOString()
  });
}

export function buildWeeklyFocusReply(user: MauriUser): string {
  const focus = user.weekly_focus_habit?.trim();
  if (!focus) {
    return `No weekly focus set yet. Finish onboarding and I'll pick one habit lane for you.

Reply help to see everything Mauri can do.`;
  }

  return `This week's one habit: ${focus}

One lane beats ten goals. Log it when you do it — I'll track the pattern.

Try roast me or hype me on Sunday to see how the week landed.`;
}
