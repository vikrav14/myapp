import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { finalizeMauriGeneratedReply, MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT } from "../lib/mauri-voice.js";
import { supabase } from "../lib/supabase.js";
import type {
  MauriUser,
  WeeklyDiagnosticSummary,
  WeeklyFeedbackPromptContext,
  WeeklyReportRecord
} from "../types.js";
import { generateWeeklyDiagnosticCopy, generateWeeklyFeedbackSection } from "./ai.service.js";
import { formatUserMindForPrompt, loadUserMindFacts } from "./user-mind.service.js";
import { getUserMindSnapshot } from "./user-mind-snapshot.service.js";
import { buildMauriMemoryViewFromData } from "./mauri-memory-view.service.js";
import {
  buildWeekOverWeekComparison,
  buildWeeklyDailySeries,
  hasWeeklyReportCharts
} from "./report-daily-series.service.js";
import { listPendingFollowUpsForUser } from "./open-loop-follow-up.service.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { OUTBOUND_PAIR_DELAY_MS, sleep } from "../lib/mauri-voice.js";
import {
  buildSundayImagePayload,
  buildReportWebUrl,
  shouldSendSundayReportImage
} from "./rich-media.service.js";
import { buildTrialCliffhangerPaymentReply } from "./paywall.service.js";
import { sendMauriReply, sendWhatsAppInteractive } from "./whatsapp.service.js";
import {
  buildSundayContextInteractive,
  buildSundayFeedbackInteractive,
  buildSundayRatingInteractive
} from "./whatsapp-interactive.service.js";
import { mapUser } from "./user.service.js";
import {
  buildFallbackFeedbackSection,
  buildWeeklyFeedbackPromptContext
} from "./weekly-report-feedback.service.js";

interface ReportWindow {
  weekStart: string;
  weekEnd: string;
}

export interface WeeklyReportNarrativeContext {
  userMindSnapshotPrompt: string | null;
  activeFocus: string | null;
  strategyTrack: string | null;
  openLoops: string[];
  weeklyFocusHabit: string | null;
  momentumDelta: number | null;
  priorMomentumScore: number | null;
  isQuietWeek: boolean;
}

export function isQuietReportWeek(summary: WeeklyDiagnosticSummary): boolean {
  return (
    summary.finance.entry_count === 0 &&
    summary.habits.total_logs === 0 &&
    summary.todos.completed_count === 0
  );
}

export function buildWeeklyReportNarrativePrompt(context: WeeklyReportNarrativeContext): string {
  const lines: string[] = [];

  if (context.activeFocus) {
    lines.push(`Mauri Memory — active focus: ${context.activeFocus}`);
  }

  if (context.strategyTrack) {
    lines.push(`Mauri Memory — strategy track: ${context.strategyTrack}`);
  }

  if (context.userMindSnapshotPrompt) {
    lines.push(`Reflection snapshot:\n${context.userMindSnapshotPrompt}`);
  }

  if (context.openLoops.length > 0) {
    lines.push(`Open loops still live: ${context.openLoops.join("; ")}`);
  }

  if (context.weeklyFocusHabit) {
    lines.push(`Weekly focus habit: ${context.weeklyFocusHabit}`);
  }

  if (context.priorMomentumScore !== null && context.momentumDelta !== null) {
    const direction = context.momentumDelta >= 0 ? "up" : "down";
    lines.push(
      `Momentum vs last week: ${context.priorMomentumScore} → ${context.priorMomentumScore + context.momentumDelta} (${direction} ${Math.abs(context.momentumDelta)})`
    );
  }

  if (context.isQuietWeek) {
    lines.push(
      "Measurable logs were quiet this week — still write a human report using Mauri Memory, snapshot, and open loops. Do not sound empty or robotic."
    );
  }

  return lines.length > 0 ? lines.join("\n\n") : "No Mauri Memory or reflection snapshot loaded.";
}

export function buildQuietWeekFallbackSignal(
  narrative: WeeklyReportNarrativeContext | undefined
): string | null {
  if (!narrative?.isQuietWeek) {
    return null;
  }

  if (narrative.openLoops.length > 0) {
    return `A quiet week on the logs — ${narrative.openLoops[0]} is still live.`;
  }

  if (narrative.activeFocus) {
    return `A quiet week on the logs — ${narrative.activeFocus.charAt(0).toLowerCase()}${narrative.activeFocus.slice(1)} still counts.`;
  }

  if (narrative.userMindSnapshotPrompt) {
    const lifeLine = narrative.userMindSnapshotPrompt
      .split("\n")
      .find((line) => line.startsWith("Life summary:"))
      ?.replace(/^Life summary:\s*/i, "")
      .trim();

    if (lifeLine) {
      return `A quiet week on the logs — ${lifeLine.charAt(0).toLowerCase()}${lifeLine.slice(1)} still counts.`;
    }
  }

  if (narrative.weeklyFocusHabit) {
    return `A quiet week on the logs — your focus (${narrative.weeklyFocusHabit}) still matters.`;
  }

  return "A quiet week on the logs — the pattern still matters.";
}

async function buildWeeklyReportNarrativeContext(input: {
  user: MauriUser;
  window: ReportWindow;
  summary: WeeklyDiagnosticSummary;
}): Promise<WeeklyReportNarrativeContext> {
  const [pendingFollowUps, priorReportResult] = await Promise.all([
    listPendingFollowUpsForUser(input.user.id).catch(() => []),
    supabase
      .from("weekly_reports")
      .select("summary_json")
      .eq("user_id", input.user.id)
      .lt("week_end", input.window.weekStart)
      .order("week_end", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (priorReportResult.error) {
    throw new Error(`Failed to load prior weekly report: ${priorReportResult.error.message}`);
  }

  const priorSummary = priorReportResult.data?.summary_json as WeeklyDiagnosticSummary | undefined;
  const priorMomentumScore =
    priorSummary && typeof priorSummary.momentum_score === "number" ? priorSummary.momentum_score : null;
  const momentumDelta =
    input.summary.week_over_week?.momentum_delta ??
    (priorMomentumScore !== null ? input.summary.momentum_score - priorMomentumScore : null);

  const memory = input.summary.memory;
  const followUpLoops = pendingFollowUps.map((followUp) => followUp.loop_text);
  const openLoops = [
    ...new Set([...(memory?.open_loops ?? []), ...followUpLoops])
  ].slice(0, 8);

  return {
    userMindSnapshotPrompt: memory?.active_focus
      ? `Life summary: ${memory.active_focus}`
      : null,
    activeFocus: memory?.active_focus ?? null,
    strategyTrack: memory?.strategy_track ?? null,
    openLoops,
    weeklyFocusHabit: input.user.weekly_focus_habit,
    momentumDelta,
    priorMomentumScore,
    isQuietWeek: isQuietReportWeek(input.summary)
  };
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

function buildFallbackReport(
  user: MauriUser,
  summary: WeeklyDiagnosticSummary,
  narrative?: WeeklyReportNarrativeContext
): string {
  const name = user.first_name?.trim() || "You";
  const highlights: string[] = [];

  if (summary.finance.entry_count > 0) {
    highlights.push(
      `Rs ${summary.finance.total_spent} logged across ${summary.finance.entry_count} money moves`
    );
  }

  if (summary.habits.total_logs > 0) {
    highlights.push(`${summary.habits.successful_logs}/${summary.habits.total_logs} habit wins`);
  }

  if (summary.todos.completed_count > 0 || summary.todos.open_count > 0) {
    highlights.push(`${summary.todos.completed_count} tasks done, ${summary.todos.open_count} still open`);
  }

  const quietSignal = buildQuietWeekFallbackSignal(narrative);
  const signal =
    highlights.length > 0
      ? highlights.join(" · ")
      : quietSignal ?? "A quiet week on the logs — the pattern still matters.";

  const closer = summary.trial_cliffhanger
    ? "The deeper pattern is getting clearer. That layer locks when trial ends."
    : "One clean repeat next week beats a dramatic reset.";

  return finalizeMauriGeneratedReply({
    reply: `Sunday check-in, ${name}.

${signal}

Momentum: ${summary.momentum_score}/100.

${closer}`,
    maxWords: MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT
  });
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
    created_at: String(record.created_at),
    feedback_prompt_json: (record.feedback_prompt_json as WeeklyFeedbackPromptContext | null) ?? null,
    feedback_responded_at: record.feedback_responded_at ? String(record.feedback_responded_at) : null
  };
}

async function buildWeeklyDiagnosticSummary(user: MauriUser, window: ReportWindow): Promise<WeeklyDiagnosticSummary> {
  const [
    financeResult,
    habitsResult,
    createdTodosResult,
    completedTodosResult,
    openTodosResult,
    emotionsResult,
    facts,
    mindRecord,
    priorReportResult
  ] = await Promise.all([
    supabase
      .from("finance_logs")
      .select("amount, category, logged_at")
      .eq("user_id", user.id)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd),
    supabase
      .from("habit_logs")
      .select("activity_type, duration_minutes, is_success, logged_at")
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
      .select("anxiety_score, core_emotional_driver, logged_at")
      .eq("user_id", user.id)
      .gte("logged_at", window.weekStart)
      .lte("logged_at", window.weekEnd),
    loadUserMindFacts(user.id),
    getUserMindSnapshot(user.id).catch(() => null),
    supabase
      .from("weekly_reports")
      .select("summary_json")
      .eq("user_id", user.id)
      .lt("week_end", window.weekStart)
      .order("week_end", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const errors = [
    financeResult.error,
    habitsResult.error,
    createdTodosResult.error,
    completedTodosResult.error,
    openTodosResult.error,
    emotionsResult.error,
    priorReportResult.error
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
  const latestAnxiety = anxietyValues.length > 0 ? (anxietyValues[anxietyValues.length - 1] ?? null) : null;

  const summaryWithoutScore: Omit<WeeklyDiagnosticSummary, "momentum_score"> = {
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
      latest_anxiety: latestAnxiety,
      dominant_driver: tallyTopKey(emotionRows.map((row) => String(row.core_emotional_driver ?? "")))
    },
    trial_cliffhanger: Boolean(
      user.subscription_status === "Trial_Active" &&
        user.trial_ends_at &&
        new Date(user.trial_ends_at).getTime() - new Date(window.weekEnd).getTime() <= 36 * 60 * 60 * 1000
    )
  };

  const memoryView = buildMauriMemoryViewFromData({
    user,
    facts,
    snapshot: mindRecord?.snapshot ?? null,
    snapshotRefreshedAt: mindRecord?.generated_at ?? null
  });

  const summaryWithScore: WeeklyDiagnosticSummary = {
    ...summaryWithoutScore,
    momentum_score: computeMomentumScore(summaryWithoutScore),
    daily: buildWeeklyDailySeries({
      weekStart: window.weekStart,
      financeRows,
      habitRows,
      emotionRows
    }),
    memory: {
      active_focus: memoryView.activeFocus,
      open_loops: memoryView.openLoops,
      strategy_track: memoryView.strategyTrack?.laneLabels ?? null
    }
  };

  summaryWithScore.week_over_week = buildWeekOverWeekComparison({
    current: summaryWithScore,
    prior: priorReportResult.data?.summary_json as WeeklyDiagnosticSummary | undefined
  });

  return summaryWithScore;
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
  feedbackPrompt?: WeeklyFeedbackPromptContext | null;
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
        sent_at: input.sentAt ?? null,
        feedback_prompt_json: input.feedbackPrompt ?? null
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
  requestId?: string | undefined;
}): Promise<WeeklyReportRecord> {
  const { user, referenceDate = new Date(), sendMessage = true, forceRegenerate = false, requestId } = input;
  const window = getWeeklyReportWindow(referenceDate);

  if (!forceRegenerate) {
    const existing = await getExistingReport(user.id, window);
    if (existing) {
      return existing;
    }
  }

  const summary = await buildWeeklyDiagnosticSummary(user, window);
  const userMindFacts = await loadUserMindFacts(user.id);
  const userMindPrompt = formatUserMindForPrompt(userMindFacts);
  const narrative = await buildWeeklyReportNarrativeContext({ user, window, summary });
  const narrativePrompt = buildWeeklyReportNarrativePrompt(narrative);
  const feedbackPrompt = await buildWeeklyFeedbackPromptContext({
    user,
    window: { weekStart: window.weekStart, weekEnd: window.weekEnd },
    summary
  });

  let reportText: string;
  try {
    reportText = await generateWeeklyDiagnosticCopy({
      user,
      summary,
      userMindPrompt,
      narrativePrompt
    });
  } catch (error) {
    logger.warn({ error, userId: user.id }, "Falling back to deterministic weekly report copy.");
    reportText = buildFallbackReport(user, summary, narrative);
  }

  reportText = finalizeMauriGeneratedReply({
    reply: reportText,
    maxWords: MAURI_REPLY_MAX_WORDS_WEEKLY_REPORT
  });

  const useInteractiveFeedback =
    Boolean(feedbackPrompt.include && sendMessage && env.WHATSAPP_INTERACTIVE_ENABLED);

  if (feedbackPrompt.include && !useInteractiveFeedback) {
    try {
      const feedbackSection = await generateWeeklyFeedbackSection({
        user,
        summary,
        prompt: feedbackPrompt
      });
      reportText = `${reportText.trim()}\n\n${feedbackSection.trim()}`;
    } catch (error) {
      logger.warn({ error, userId: user.id }, "Falling back to template Sunday feedback section.");
      reportText = `${reportText.trim()}\n\n${buildFallbackFeedbackSection(user, feedbackPrompt)}`;
    }
  }

  const reportWebUrl = buildReportWebUrl({ userId: user.id, weekStart: window.weekStart });
  const deliveryText =
    reportWebUrl && hasWeeklyReportCharts(summary)
      ? `${reportText.trim()}\n\n📈 Your week in numbers: ${reportWebUrl}`
      : reportText;

  let deliveryStatus = sendMessage ? "queued" : "stored_only";
  let sentAt: string | undefined;

  if (sendMessage) {
    await upsertWeeklyReport({
      userId: user.id,
      window,
      reportText,
      summary,
      deliveryStatus,
      feedbackPrompt: feedbackPrompt.include ? feedbackPrompt : null
    });

    try {
      const sundayImage =
        shouldSendSundayReportImage({
          summary,
          priorReportCount: feedbackPrompt.prior_report_count,
          messageCountThisWeek: feedbackPrompt.message_count_this_week
        })
          ? buildSundayImagePayload({
              user,
              summary,
              weekStart: window.weekStart
            })
          : null;

      await sendMauriReply(
        user.phone_number,
        {
          image: sundayImage ?? undefined,
          text: deliveryText
        },
        {
          userId: user.id,
          requestId,
          metadata: {
            flow: "weekly_report",
            weekStart: window.weekStart,
            weekEnd: window.weekEnd
          }
        }
      );

      if (useInteractiveFeedback) {
        await sleep(OUTBOUND_PAIR_DELAY_MS);
        const ratingInteractive =
          feedbackPrompt.variant === "rating"
            ? buildSundayRatingInteractive()
            : feedbackPrompt.variant === "open"
              ? buildSundayFeedbackInteractive()
              : feedbackPrompt.variant === "context"
                ? buildSundayContextInteractive()
                : null;

        if (ratingInteractive) {
          await sendWhatsAppInteractive(user.phone_number, ratingInteractive, {
            userId: user.id,
            requestId,
            metadata: {
              flow: "weekly_report_feedback",
              variant: feedbackPrompt.variant
            }
          });
        }
      }

      if (summary.trial_cliffhanger) {
        const cliffhangerPayment = await buildTrialCliffhangerPaymentReply(user, requestId);
        if (cliffhangerPayment?.text || cliffhangerPayment?.interactive) {
          await sleep(OUTBOUND_PAIR_DELAY_MS);
          await sendMauriReply(
            user.phone_number,
            {
              text: cliffhangerPayment.text,
              interactive: cliffhangerPayment.interactive
            },
            {
              userId: user.id,
              requestId,
              sendTextBeforeInteractive: cliffhangerPayment.sendTextBeforeInteractive,
              secondaryInteractive: cliffhangerPayment.secondaryInteractive,
              metadata: {
                flow: "trial_cliffhanger_payment"
              }
            }
          );
        }
      }

      deliveryStatus = "sent";
      sentAt = new Date().toISOString();
    } catch (error) {
      logger.error({ error, userId: user.id }, "Weekly diagnostic delivery failed.");
      deliveryStatus = "send_failed";
    }
  }

  const report = await upsertWeeklyReport({
    userId: user.id,
    window,
    reportText,
    summary,
    deliveryStatus,
    sentAt,
    feedbackPrompt: feedbackPrompt.include ? feedbackPrompt : null
  });

  await recordAuditEventBestEffort({
    requestId,
    eventType: "weekly_report_generated",
    actorType: "system_job",
    userId: user.id,
    entityType: "weekly_report",
    entityId: report.id,
    message: "Weekly diagnostic report generated.",
    metadata: {
      deliveryStatus: report.delivery_status,
      sentAt: report.sent_at,
      weekStart: report.week_start,
      weekEnd: report.week_end
    }
  });

  return report;
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
      user: mapUser(user),
      referenceDate,
      sendMessage: true,
      forceRegenerate: false
    });

    processed += 1;
  }

  return processed;
}
