import { supabase } from "../lib/supabase.js";
import type { MauriUser, UserContextSnapshot } from "../types.js";
import { isEmotionalMessage } from "./message-intent.service.js";
import { searchRelevantMemories } from "./memory.service.js";
import { buildPaydayRunwaySnippet, loadPayCycleSpend } from "./payday-runway.service.js";
import { getUserMindSnapshot } from "./user-mind.service.js";

export async function loadUserContext(
  userId: string,
  queryText?: string,
  user?: MauriUser
): Promise<UserContextSnapshot> {
  const emotionalBoost = queryText ? isEmotionalMessage(queryText) : false;

  const [todosResult, financeResult, habitsResult, emotionsResult, semanticMemories, mindRecord, payCycleSpend] =
    await Promise.all([
      supabase
        .from("todo_logs")
        .select("id, task_description, priority, due_date")
        .eq("user_id", userId)
        .eq("is_completed", false)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("finance_logs")
        .select("amount, category, logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(5),
      supabase
        .from("habit_logs")
        .select("activity_type, is_success, duration_minutes, logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(5),
      supabase
        .from("insights_vault")
        .select("anxiety_score, core_emotional_driver, raw_unfiltered_vent, logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(3),
      queryText ? searchRelevantMemories(userId, queryText, { emotionalBoost }) : Promise.resolve([]),
      getUserMindSnapshot(userId).catch(() => null),
      user ? loadPayCycleSpend(user).catch(() => null) : Promise.resolve(null)
    ]);

  const failures = [todosResult, financeResult, habitsResult, emotionsResult]
    .map((result) => result.error)
    .filter(Boolean);

  if (failures.length > 0) {
    const errorMessage = failures.map((error) => error?.message).join("; ");
    throw new Error(`Failed to load user context: ${errorMessage}`);
  }

  const paydayRunwaySnippet =
    user && payCycleSpend ? buildPaydayRunwaySnippet(user, payCycleSpend) || null : null;

  return {
    pendingTodos: (todosResult.data ?? []).map((row) => ({
      id: String(row.id),
      task_description: String(row.task_description),
      priority: String(row.priority ?? "Medium"),
      due_date: row.due_date ? String(row.due_date) : null
    })),
    recentFinance: (financeResult.data ?? []).map((row) => ({
      amount: Number(row.amount),
      category: String(row.category),
      logged_at: String(row.logged_at)
    })),
    recentHabits: (habitsResult.data ?? []).map((row) => ({
      activity_type: String(row.activity_type),
      is_success: Boolean(row.is_success),
      duration_minutes: Number(row.duration_minutes ?? 0),
      logged_at: String(row.logged_at)
    })),
    recentEmotions: (emotionsResult.data ?? []).map((row) => ({
      anxiety_score: row.anxiety_score === null ? null : Number(row.anxiety_score),
      core_emotional_driver: row.core_emotional_driver ? String(row.core_emotional_driver) : null,
      raw_unfiltered_vent: String(row.raw_unfiltered_vent),
      logged_at: String(row.logged_at)
    })),
    semanticMemories,
    userMind: mindRecord?.snapshot ?? null,
    userMindGeneratedAt: mindRecord?.generated_at ?? null,
    paydayRunwaySnippet
  };
}
