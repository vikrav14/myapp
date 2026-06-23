import { supabase } from "../lib/supabase.js";

function dateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export interface HabitStreakSnapshot {
  currentStreak: number;
  bestStreak: number;
  activeDaysLast7: number;
  topActivity: string | null;
}

export async function loadHabitStreakSnapshot(input: {
  userId: string;
  timezone: string;
}): Promise<HabitStreakSnapshot> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 60);

  const { data, error } = await supabase
    .from("habit_logs")
    .select("activity_type, is_success, logged_at")
    .eq("user_id", input.userId)
    .eq("is_success", true)
    .gte("logged_at", since.toISOString())
    .order("logged_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load habit streaks: ${error.message}`);
  }

  const successDays = new Set<string>();
  const activityCounts = new Map<string, number>();

  for (const row of data ?? []) {
    const loggedAt = new Date(String(row.logged_at));
    successDays.add(dateKeyInTimezone(loggedAt, input.timezone));
    const activity = String(row.activity_type ?? "").trim();
    if (activity) {
      activityCounts.set(activity, (activityCounts.get(activity) ?? 0) + 1);
    }
  }

  let topActivity: string | null = null;
  let topCount = 0;
  for (const [activity, count] of activityCounts.entries()) {
    if (count > topCount) {
      topActivity = activity;
      topCount = count;
    }
  }

  const today = new Date();
  let currentStreak = 0;
  for (let offset = 0; offset < 60; offset += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    const key = dateKeyInTimezone(day, input.timezone);
    if (successDays.has(key)) {
      currentStreak += 1;
    } else if (offset === 0) {
      continue;
    } else {
      break;
    }
  }

  let bestStreak = 0;
  let running = 0;
  for (let offset = 59; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    const key = dateKeyInTimezone(day, input.timezone);
    if (successDays.has(key)) {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
  }

  const last7Keys = new Set<string>();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    last7Keys.add(dateKeyInTimezone(day, input.timezone));
  }

  let activeDaysLast7 = 0;
  for (const key of last7Keys) {
    if (successDays.has(key)) {
      activeDaysLast7 += 1;
    }
  }

  return {
    currentStreak,
    bestStreak,
    activeDaysLast7,
    topActivity
  };
}

export function buildHabitStreakReply(snapshot: HabitStreakSnapshot): string {
  if (snapshot.currentStreak === 0 && snapshot.activeDaysLast7 === 0) {
    return `No habit streak yet — and that's fine.

Log a win when it happens: "studied 45 minutes" or "gym done".
I'll track consistency without guilt if you miss a day.

Reply my focus for this week's one habit.`;
  }

  const activityLine = snapshot.topActivity ? `\nMost logged: ${snapshot.topActivity}.` : "";

  return `Habit streaks (gentle mode):
Current streak: ${snapshot.currentStreak} day${snapshot.currentStreak === 1 ? "" : "s"}
Best streak: ${snapshot.bestStreak} day${snapshot.bestStreak === 1 ? "" : "s"}
Active days (last 7): ${snapshot.activeDaysLast7}${activityLine}

Missed a day? Streak pauses — no lecture. Just pick up when you're ready.`;
}
