import { supabase } from "../lib/supabase.js";
import type { MauriUser, UserMindFact } from "../types.js";
import { DEFAULT_USER_MIND_CONVERSATION_SAMPLE, DEFAULT_USER_MIND_LOOKBACK_DAYS } from "./user-mind.constants.js";
import { loadUserMindFacts } from "./user-mind.service.js";

export interface UserMindReflectionWindow {
  start: string;
  end: string;
}

export interface UserMindReflectionInput {
  user: MauriUser;
  window: UserMindReflectionWindow;
  financeLogs: Array<{
    amount: number;
    category: string;
    raw_source_text: string;
    logged_at: string;
  }>;
  habitLogs: Array<{
    activity_type: string;
    is_success: boolean;
    duration_minutes: number;
    context_note: string | null;
    logged_at: string;
  }>;
  todos: Array<{
    task_description: string;
    priority: string;
    due_date: string | null;
    is_completed: boolean;
    created_at: string;
  }>;
  emotionLogs: Array<{
    anxiety_score: number | null;
    core_emotional_driver: string | null;
    raw_unfiltered_vent: string;
    logged_at: string;
  }>;
  conversationSamples: Array<{
    memory_type: string;
    content_text: string;
    created_at: string;
  }>;
  activeReminders: Array<{
    label: string;
    next_fire_at: string;
    repeat_kind: string;
  }>;
  upcomingCalendarEvents: Array<{
    title: string;
    starts_at: string;
    location: string | null;
  }>;
  userMindFacts: Array<{
    category: string;
    fact_key: string;
    fact_value: string;
  }>;
  previousMindSnapshot: Record<string, unknown> | null;
}

export function buildReflectionWindow(
  referenceDate: Date = new Date(),
  lookbackDays: number = DEFAULT_USER_MIND_LOOKBACK_DAYS
): UserMindReflectionWindow {
  const end = new Date(referenceDate);
  const start = new Date(referenceDate);
  start.setUTCDate(start.getUTCDate() - lookbackDays);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

export async function loadUserMindReflectionInput(input: {
  user: MauriUser;
  window: UserMindReflectionWindow;
  conversationSampleLimit?: number;
  previousMindSnapshot?: Record<string, unknown> | null;
}): Promise<UserMindReflectionInput> {
  const conversationSampleLimit = input.conversationSampleLimit ?? DEFAULT_USER_MIND_CONVERSATION_SAMPLE;
  const nowIso = new Date().toISOString();
  const upcomingCutoff = new Date();
  upcomingCutoff.setUTCDate(upcomingCutoff.getUTCDate() + 7);

  const [
    financeResult,
    habitResult,
    todoResult,
    emotionResult,
    conversationResult,
    reminderResult,
    calendarResult,
    userMindFacts
  ] = await Promise.all([
    supabase
      .from("finance_logs")
      .select("amount, category, raw_source_text, logged_at")
      .eq("user_id", input.user.id)
      .gte("logged_at", input.window.start)
      .lte("logged_at", input.window.end)
      .order("logged_at", { ascending: false })
      .limit(40),
    supabase
      .from("habit_logs")
      .select("activity_type, is_success, duration_minutes, context_note, logged_at")
      .eq("user_id", input.user.id)
      .gte("logged_at", input.window.start)
      .lte("logged_at", input.window.end)
      .order("logged_at", { ascending: false })
      .limit(40),
    supabase
      .from("todo_logs")
      .select("task_description, priority, due_date, is_completed, created_at")
      .eq("user_id", input.user.id)
      .gte("created_at", input.window.start)
      .lte("created_at", input.window.end)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("insights_vault")
      .select("anxiety_score, core_emotional_driver, raw_unfiltered_vent, logged_at")
      .eq("user_id", input.user.id)
      .gte("logged_at", input.window.start)
      .lte("logged_at", input.window.end)
      .order("logged_at", { ascending: false })
      .limit(20),
    supabase
      .from("conversation_memories")
      .select("memory_type, content_text, created_at")
      .eq("user_id", input.user.id)
      .gte("created_at", input.window.start)
      .lte("created_at", input.window.end)
      .order("created_at", { ascending: false })
      .limit(conversationSampleLimit),
    supabase
      .from("scheduled_reminders")
      .select("label, next_fire_at, repeat_kind")
      .eq("user_id", input.user.id)
      .eq("status", "active")
      .order("next_fire_at", { ascending: true })
      .limit(8),
    supabase
      .from("calendar_events")
      .select("title, starts_at, location")
      .eq("user_id", input.user.id)
      .eq("status", "active")
      .gte("starts_at", nowIso)
      .lte("starts_at", upcomingCutoff.toISOString())
      .order("starts_at", { ascending: true })
      .limit(8),
    loadUserMindFacts(input.user.id)
  ]);

  const failures = [
    financeResult.error,
    habitResult.error,
    todoResult.error,
    emotionResult.error,
    conversationResult.error,
    reminderResult.error,
    calendarResult.error
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Failed to load user mind reflection input: ${failures.map((error) => error?.message).join("; ")}`);
  }

  return {
    user: input.user,
    window: input.window,
    financeLogs: (financeResult.data ?? []).map((row) => ({
      amount: Number(row.amount),
      category: String(row.category),
      raw_source_text: String(row.raw_source_text),
      logged_at: String(row.logged_at)
    })),
    habitLogs: (habitResult.data ?? []).map((row) => ({
      activity_type: String(row.activity_type),
      is_success: Boolean(row.is_success),
      duration_minutes: Number(row.duration_minutes ?? 0),
      context_note: row.context_note ? String(row.context_note) : null,
      logged_at: String(row.logged_at)
    })),
    todos: (todoResult.data ?? []).map((row) => ({
      task_description: String(row.task_description),
      priority: String(row.priority ?? "Medium"),
      due_date: row.due_date ? String(row.due_date) : null,
      is_completed: Boolean(row.is_completed),
      created_at: String(row.created_at)
    })),
    emotionLogs: (emotionResult.data ?? []).map((row) => ({
      anxiety_score: row.anxiety_score === null ? null : Number(row.anxiety_score),
      core_emotional_driver: row.core_emotional_driver ? String(row.core_emotional_driver) : null,
      raw_unfiltered_vent: String(row.raw_unfiltered_vent),
      logged_at: String(row.logged_at)
    })),
    conversationSamples: (conversationResult.data ?? []).map((row) => ({
      memory_type: String(row.memory_type),
      content_text: String(row.content_text),
      created_at: String(row.created_at)
    })),
    activeReminders: (reminderResult.data ?? []).map((row) => ({
      label: String(row.label),
      next_fire_at: String(row.next_fire_at),
      repeat_kind: String(row.repeat_kind)
    })),
    upcomingCalendarEvents: (calendarResult.data ?? []).map((row) => ({
      title: String(row.title),
      starts_at: String(row.starts_at),
      location: row.location ? String(row.location) : null
    })),
    userMindFacts: userMindFacts.map((fact: UserMindFact) => ({
      category: fact.category,
      fact_key: fact.fact_key,
      fact_value: fact.fact_value
    })),
    previousMindSnapshot: input.previousMindSnapshot ?? null
  };
}

export function hasReflectionSignal(input: UserMindReflectionInput): boolean {
  return (
    input.financeLogs.length > 0 ||
    input.habitLogs.length > 0 ||
    input.todos.length > 0 ||
    input.emotionLogs.length > 0 ||
    input.conversationSamples.length > 0 ||
    input.userMindFacts.length > 0
  );
}
