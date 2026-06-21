import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser, WeeklyDiagnosticSummary, WeeklyReportRecord } from "../types.js";
import { generateWeeklyDiagnosticCopy } from "./ai.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

interface ReportWindow {
  weekStart: string;
  weekEnd: string;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getWeeklyReportWindow(referenceDate: Date = new Date()): ReportWindow {
  const anchor = utcMidnight(referenceDate);
  const dayOffsetFromMonday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - dayOffsetFromMonday);

  const weekStart = anchor;
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString()
  };
}

function tallyTopKey(values: string[]): string | null {
  const counts = new Map<string, number>();

  for (const value of values) {
    const key = value.trim();
    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let topKey: string | null = null;
  let topCount = -1;

  for (const [key, count] of counts.entries()) {
    if (count > topCount) {
      topKey = key;
      topCount = count;
    }
  }

  return topKey;
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMomentumScore(summary: Omit<WeeklyDiagnosticSummary, "momentum_score">): number {
  const financeSignal = Math.min(summary.finance.entry_count * 4, 20);
  const habitSignal = Math.min(summary.habits.successful_logs * 8, 32);
  const todoSignal = Math.min(summary.todos.completed_count * 10, 30);
  const emotionalSignal =
    summary.emotions.average_anxiety === null ? 10 : Math.max(0, 18 - summary.emotions.average_anxiety * 3);

  return Math.max(0, Math.min(100, Math.round(financeSignal + habitSignal + todoSignal + emotionalSignal)));
}

function buildFallbackReport(user: MauriUser, summary: WeeklyDiagnosticSummary): string {
  const name = user.first_name?.trim() || "You";
  const financeLine =
    summary.finance.entry_count > 0
      ? `You logged Rs ${summary.finance.total_spent} across ${summary.finance.entry_count} money moves. ${
          summary.finance.top_category ? `Most of it leaned toward ${summary.finance.top_category}.` : ""
        }`
      : "Money tracking stayed quiet this week. That usually means the real leaks stayed blurry too.";

  const habitLine =
    summary.habits.total_logs > 0
      ? `You showed up ${summary.habits.successful_logs} times on habits out of ${summary.habits.total_logs} logged attempts. ${
          summary.habits.top_activity ? `${summary.habits.top_activity} kept surfacing.` : ""
        }`
      : "Habit momentum barely showed itself this week. The pattern feels more reactive than intentional right now.";

  const todoLine = `Tasks tell a clean story. ${summary.todos.completed_count} got finished. ${summary.todos.open_count} are still hanging open.`;

  const emotionLine =
    summary.emotions.average_anxiety !== null
      ? `Your emotional baseline sat around ${summary.emotions.average_anxiety}/5 on anxiety. ${
          summary.emotions.dominant_driver ? `${summary.emotions.dominant_driver} kept showing up underneath it.` : ""
        }`
      : "You did not log much emotional signal this week, which can mean either steadiness or suppression. Mauri still clocks the difference.";

  const cliffhanger = summary.trial_cliffhanger
    ? "One more thing. The pattern under this week is getting clearer than the surface mess. That deeper layer is exactly what gets locked when trial ends."
    : "The next win is not a dramatic reset. It is one clean decision repeated faster next week.";

  return `${name}, your Sunday diagnostic is in.

${financeLine}

${habitLine}

${todoLine}

${emotionLine}

Momentum this week sat around ${summary.momentum_score}/100.

${cliffhanger}`;
}

function mapWeeklyReportRecord(record: Record<string, unknown>): WeeklyReportRecord {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    week_start: String(record.week_start),
    week_end: String(record.week_end),
    report_text: String(record.report_text),
    summary_json: record.summary_json as WeeklyDiagnosticSummary,
    delivery_status: String(record.delivery_status),
    sent_at: record.sent_at ? String(record.sent_at) : null,
    created_at: String(record.created_at)
  };
}

async function buildWeeklyDiagnosticSummary(user: MauriUser, window: ReportWindow): Promise<WeeklyDiagnosticSummary> {
  const [financeResult, habitsResult, createdTodosResult, completedTodosResult, openTodosResult, emotionsResult] =
    await Promise.all([
    supabase
      .from("finance_logs")
      .select("amount, category")
      .eq("user_id", user.id)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd),
    supabase
      .from("habit_logs")
      .select("activity_type, duration_minutes, is_success")
      .eq("user_id", user.id)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd),
    supabase
      .from("todo_logs")
      .select("id")
      .eq("user_id", user.id)
      .gte("created_at", window.weekStart)
      .lte("created_at", window.weekEnd),
    supabase
      .from("todo_logs")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_completed", true)
      .gte("completed_at", window.weekStart)
      .lte("completed_at", window.weekEnd),
    supabase.from("todo_logs").select("id").eq("user_id", user.id).eq("is_completed", false),
    supabase
      .from("insights_vault")
      .select("anxiety_score, core_emotional_driver")
      .eq("user_id", user.id)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd)
  ]);

  const errors = [
    financeResult.error,
    habitsResult.error,
    createdTodosResult.error,
    completedTodosResult.error,
    openTodosResult.error,
    emotionsResult.error
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error?.message).join("; "));
  }

  const financeRows = financeResult.data ?? [];
  const habitRows = habitsResult.data ?? [];
  const createdTodoRows = createdTodosResult.data ?? [];
  const completedTodoRows = completedTodosResult.data ?? [];
  const openTodoRows = openTodosResult.data ?? [];
  const emotionRows = emotionsResult.data ?? [];

  const totalSpent = roundToSingleDecimal(
    financeRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  );
  const successfulLogs = habitRows.filter((row) => Boolean(row.is_success)).length;
  const totalMinutes = habitRows.reduce((sum, row) => sum + Number(row.duration_minutes ?? 0), 0);
  const completedCount = completedTodoRows.length;
  const anxietyValues = emotionRows
    .map((row) => (row.anxiety_score === null ? null : Number(row.anxiety_score)))
    .filter((value): value is number => value !== null);
  const averageAnxiety =
    anxietyValues.length > 0
      ? roundToSingleDecimal(anxietyValues.reduce((sum, value) => sum + value, 0) / anxietyValues.length)
      : null;

  const summaryWithoutScore = {
    window: {
      week_start: window.weekStart,
      week_end: window.weekEnd
    },
    finance: {
      total_spent: totalSpent,
      entry_count: financeRows.length,
      top_category: tallyTopKey(financeRows.map((row) => String(row.category ?? "")))
    },
    habits: {
      total_logs: habitRows.length,
      successful_logs: successfulLogs,
      success_rate: habitRows.length === 0 ? 0 : Math.round((successfulLogs / habitRows.length) * 100),
      total_minutes: totalMinutes,
      top_activity: tallyTopKey(habitRows.map((row) => String(row.activity_type ?? "")))
    },
    todos: {
      created_count: createdTodoRows.length,
      completed_count: completedCount,
      open_count: openTodoRows.length
    },
    emotions: {
      average_anxiety: averageAnxiety,
      latest_anxiety: anxietyValues.length > 0 ? anxietyValues[anxietyValues.length - 1] : null,
      dominant_driver: tallyTopKey(emotionRows.map((row) => String(row.core_emotional_driver ?? "")))
    },
    trial_cliffhanger: Boolean(
      user.subscription_status === "Trial_Active" &&
        user.trial_ends_at &&
        new Date(user.trial_ends_at).getTime() - new Date(window.weekEnd).getTime() <= 36 * 60 * 60 * 1000
    )
  };

  return {
    ...summaryWithoutScore,
    momentum_score: computeMomentumScore(summaryWithoutScore)
  };
}

async function getExistingReport(userId: string, window: ReportWindow): Promise<WeeklyReportRecord | null> {
  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", window.weekStart)
    .eq("week_end", window.weekEnd)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing weekly report: ${error.message}`);
  }

  return data ? mapWeeklyReportRecord(data) : null;
}

async function upsertWeeklyReport(input: {
  userId: string;
  window: ReportWindow;
  reportText: string;
  summary: WeeklyDiagnosticSummary;
  deliveryStatus: string;
  sentAt?: string | undefined;
}): Promise<WeeklyReportRecord> {
  const { data, error } = await supabase
    .from("weekly_reports")
    .upsert(
      {
        user_id: input.userId,
        week_start: input.window.weekStart,
        week_end: input.window.weekEnd,
        report_text: input.reportText,
        summary_json: input.summary,
        delivery_status: input.deliveryStatus,
        sent_at: input.sentAt ?? null
      },
      {
        onConflict: "user_id,week_start,week_end"
      }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to store weekly report: ${error.message}`);
  }

  return mapWeeklyReportRecord(data);
}

export async function generateWeeklyDiagnosticReport(input: {
  user: MauriUser;
  referenceDate?: Date | undefined;
  sendMessage?: boolean | undefined;
  forceRegenerate?: boolean | undefined;
}): Promise<WeeklyReportRecord> {
  const { user, referenceDate = new Date(), sendMessage = true, forceRegenerate = false } = input;
  const window = getWeeklyReportWindow(referenceDate);

  if (!forceRegenerate) {
    const existing = await getExistingReport(user.id, window);
    if (existing) {
      return existing;
    }
  }

  const summary = await buildWeeklyDiagnosticSummary(user, window);

  let reportText: string;
  try {
    reportText = await generateWeeklyDiagnosticCopy({
      user,
      summary
    });
  } catch (error) {
    logger.warn({ error, userId: user.id }, "Falling back to deterministic weekly report copy.");
    reportText = buildFallbackReport(user, summary);
  }

  let deliveryStatus = sendMessage ? "generated" : "stored_only";
  let sentAt: string | undefined;

  if (sendMessage) {
    try {
      await sendWhatsAppMessage(user.phone_number, reportText);
      deliveryStatus = "sent";
      sentAt = new Date().toISOString();
    } catch (error) {
      logger.error({ error, userId: user.id }, "Weekly diagnostic delivery failed.");
      deliveryStatus = "send_failed";
    }
  }

  return upsertWeeklyReport({
    userId: user.id,
    window,
    reportText,
    summary,
    deliveryStatus,
    sentAt
  });
}

export async function runSundayDiagnosticReports(referenceDate: Date = new Date()): Promise<number> {
  const { data: users, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to load users for Sunday diagnostics: ${error.message}`);
  }

  let processed = 0;

  for (const rawUser of users ?? []) {
    const user = rawUser as Record<string, unknown>;

    await generateWeeklyDiagnosticReport({
      user: {
        id: String(user.id),
        phone_number: String(user.phone_number),
        first_name: user.first_name ? String(user.first_name) : null,
        archetype: String(user.archetype ?? "Life & Habit Tracking"),
        onboarding_state: String(user.onboarding_state ?? "active") as MauriUser["onboarding_state"],
        subscription_status: String(user.subscription_status ?? "Trial_Active") as MauriUser["subscription_status"],
        onboarding_completed_at: user.onboarding_completed_at ? String(user.onboarding_completed_at) : null,
        trial_started_at: user.trial_started_at ? String(user.trial_started_at) : null,
        trial_ends_at: user.trial_ends_at ? String(user.trial_ends_at) : null,
        locked_at: user.locked_at ? String(user.locked_at) : null,
        subscription_started_at: user.subscription_started_at ? String(user.subscription_started_at) : null,
        subscription_ends_at: user.subscription_ends_at ? String(user.subscription_ends_at) : null,
        last_payment_at: user.last_payment_at ? String(user.last_payment_at) : null,
        created_at: String(user.created_at),
        updated_at: String(user.updated_at)
      },
      referenceDate,
      sendMessage: true,
      forceRegenerate: false
    });

    processed += 1;
  }

  return processed;
}
