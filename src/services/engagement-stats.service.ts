import { supabase } from "../lib/supabase.js";
import type { MauriUser, WeeklyDiagnosticSummary } from "../types.js";
import { getWeeklyReportWindow } from "./report.service.js";

export interface RecentActivitySnapshot {
  financeEntries: number;
  totalSpent: number;
  habitLogs: number;
  successfulHabits: number;
  completedTodos: number;
  openTodos: number;
  averageAnxiety: number | null;
}

export interface ActivityWindow {
  weekStart: string;
  weekEnd: string;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summaryToActivitySnapshot(summary: WeeklyDiagnosticSummary): RecentActivitySnapshot {
  return {
    financeEntries: summary.finance.entry_count,
    totalSpent: summary.finance.total_spent,
    habitLogs: summary.habits.total_logs,
    successfulHabits: summary.habits.successful_logs,
    completedTodos: summary.todos.completed_count,
    openTodos: summary.todos.open_count,
    averageAnxiety: summary.emotions.average_anxiety
  };
}

export async function buildWeeklyActivitySnapshot(
  userId: string,
  window: ActivityWindow
): Promise<RecentActivitySnapshot> {
  const [financeResult, habitsResult, completedTodosResult, openTodosResult, emotionsResult] = await Promise.all([
    supabase
      .from("finance_logs")
      .select("amount")
      .eq("user_id", userId)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd),
    supabase
      .from("habit_logs")
      .select("is_success")
      .eq("user_id", userId)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd),
    supabase
      .from("todo_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("is_completed", true)
      .gte("completed_at", window.weekStart)
      .lte("completed_at", window.weekEnd),
    supabase.from("todo_logs").select("id").eq("user_id", userId).eq("is_completed", false),
    supabase
      .from("insights_vault")
      .select("anxiety_score")
      .eq("user_id", userId)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd)
  ]);

  const errors = [
    financeResult.error,
    habitsResult.error,
    completedTodosResult.error,
    openTodosResult.error,
    emotionsResult.error
  ].filter(Boolean);

  if (errors.length) {
    throw new Error(errors.map((error) => error?.message).join("; "));
  }

  const financeRows = financeResult.data ?? [];
  const habitRows = habitsResult.data ?? [];
  const anxietyValues = (emotionsResult.data ?? [])
    .map((row) => (row.anxiety_score === null ? null : Number(row.anxiety_score)))
    .filter((value): value is number => value !== null);

  return {
    financeEntries: financeRows.length,
    totalSpent: round(financeRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)),
    habitLogs: habitRows.length,
    successfulHabits: habitRows.filter((row) => Boolean(row.is_success)).length,
    completedTodos: (completedTodosResult.data ?? []).length,
    openTodos: (openTodosResult.data ?? []).length,
    averageAnxiety:
      anxietyValues.length > 0
        ? round(anxietyValues.reduce((sum, value) => sum + value, 0) / anxietyValues.length)
        : null
  };
}

export async function buildEngagementActivitySnapshot(
  userId: string,
  referenceDate: Date = new Date()
): Promise<RecentActivitySnapshot> {
  const window = getWeeklyReportWindow(referenceDate);

  const { data, error } = await supabase
    .from("weekly_reports")
    .select("summary_json")
    .eq("user_id", userId)
    .eq("week_start", window.weekStart)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load weekly report snapshot: ${error.message}`);
  }

  if (data?.summary_json && typeof data.summary_json === "object") {
    return summaryToActivitySnapshot(data.summary_json as WeeklyDiagnosticSummary);
  }

  return buildWeeklyActivitySnapshot(userId, {
    weekStart: window.weekStart,
    weekEnd: window.weekEnd
  });
}

export async function buildRecentActivitySnapshot(
  userId: string,
  daysBack = 7
): Promise<RecentActivitySnapshot> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - daysBack);

  const [financeResult, habitsResult, completedTodosResult, openTodosResult, emotionsResult] = await Promise.all([
    supabase.from("finance_logs").select("amount").eq("user_id", userId).gte("logged_at", since.toISOString()),
    supabase
      .from("habit_logs")
      .select("is_success")
      .eq("user_id", userId)
      .gte("logged_at", since.toISOString()),
    supabase
      .from("todo_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("is_completed", true)
      .gte("completed_at", since.toISOString()),
    supabase.from("todo_logs").select("id").eq("user_id", userId).eq("is_completed", false),
    supabase
      .from("insights_vault")
      .select("anxiety_score")
      .eq("user_id", userId)
      .gte("logged_at", since.toISOString())
  ]);

  const errors = [
    financeResult.error,
    habitsResult.error,
    completedTodosResult.error,
    openTodosResult.error,
    emotionsResult.error
  ].filter(Boolean);

  if (errors.length) {
    throw new Error(errors.map((error) => error?.message).join("; "));
  }

  const financeRows = financeResult.data ?? [];
  const habitRows = habitsResult.data ?? [];
  const anxietyValues = (emotionsResult.data ?? [])
    .map((row) => (row.anxiety_score === null ? null : Number(row.anxiety_score)))
    .filter((value): value is number => value !== null);

  return {
    financeEntries: financeRows.length,
    totalSpent: round(financeRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)),
    habitLogs: habitRows.length,
    successfulHabits: habitRows.filter((row) => Boolean(row.is_success)).length,
    completedTodos: (completedTodosResult.data ?? []).length,
    openTodos: (openTodosResult.data ?? []).length,
    averageAnxiety:
      anxietyValues.length > 0
        ? round(anxietyValues.reduce((sum, value) => sum + value, 0) / anxietyValues.length)
        : null
  };
}

export function buildTrialProgressPing(user: MauriUser, snapshot: RecentActivitySnapshot): string {
  const name = user.first_name?.trim() || "there";
  const parts: string[] = [];

  if (snapshot.financeEntries > 0) {
    parts.push(`${snapshot.financeEntries} spend log${snapshot.financeEntries === 1 ? "" : "s"} (Rs ${snapshot.totalSpent})`);
  }

  if (snapshot.successfulHabits > 0) {
    parts.push(`${snapshot.successfulHabits} habit win${snapshot.successfulHabits === 1 ? "" : "s"}`);
  }

  if (snapshot.completedTodos > 0) {
    parts.push(`${snapshot.completedTodos} task${snapshot.completedTodos === 1 ? "" : "s"} closed`);
  }

  if (snapshot.averageAnxiety !== null) {
    parts.push(`mood avg ${snapshot.averageAnxiety}/5`);
  }

  const signal = parts.length > 0 ? parts.join(", ") : "still quiet — one brain dump changes that";

  return `Mid-trial check-in, ${name}.

So far: ${signal}.

Your Sunday diagnostic will connect the dots. Try roast me or hype me before then.

Reply help to see what else I can do.`;
}

export function buildTrialSquadInvite(user: MauriUser): string {
  const name = user.first_name?.trim() || "there";

  return `${name}, squads are already on your trial.

Reply create squad Study Crew (or any name), then share squad to invite mates on WhatsApp.

No group chat — Mauri nudges each of you privately and runs Sunday showdown.

Try it before day 7 so your crew is in the game.`;
}

/** @deprecated Use buildTrialSquadInvite */
export function buildTrialSquadTease(user: MauriUser): string {
  return buildTrialSquadInvite(user);
}
