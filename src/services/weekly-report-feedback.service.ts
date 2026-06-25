import { supabase } from "../lib/supabase.js";
import type { MauriUser, WeeklyDiagnosticSummary, WeeklyFeedbackPromptContext, WeeklyReportRecord } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
  WEEKLY_FEEDBACK_COOLDOWN_DAYS,
  WEEKLY_FEEDBACK_MIN_MESSAGES_FOR_CONTEXT,
  WEEKLY_FEEDBACK_MOMENTUM_DROP,
  WEEKLY_FEEDBACK_PERIODIC_WEEKS,
  WEEKLY_FEEDBACK_RESPONSE_WINDOW_DAYS
} from "./weekly-report-feedback.constants.js";

export interface WeeklyFeedbackSignals {
  priorReportCount: number;
  weeksSinceFeedback: number | null;
  messageCountThisWeek: number;
  momentumDelta: number | null;
  accountAgeDays: number;
}

export interface ServiceFeedbackCommandResult {
  handled: boolean;
  reply?: string | undefined;
}

function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000);
}

function weeksSince(date: Date, reference = new Date()): number {
  return daysBetween(date, reference) / 7;
}

function weekActivityScore(summary: WeeklyDiagnosticSummary): number {
  return (
    summary.finance.entry_count +
    summary.habits.total_logs +
    summary.todos.completed_count +
    (summary.emotions.average_anxiety !== null ? 1 : 0)
  );
}

export function decideWeeklyFeedbackPrompt(input: {
  summary: WeeklyDiagnosticSummary;
  signals: WeeklyFeedbackSignals;
}): WeeklyFeedbackPromptContext {
  const skip = (reason: WeeklyFeedbackPromptContext["skip_reason"]): WeeklyFeedbackPromptContext => ({
    include: false,
    reason: null,
    variant: "open",
    skip_reason: reason,
    prior_report_count: input.signals.priorReportCount,
    weeks_since_feedback: input.signals.weeksSinceFeedback,
    message_count_this_week: input.signals.messageCountThisWeek,
    momentum_delta: input.signals.momentumDelta
  });

  if (input.summary.trial_cliffhanger) {
    return skip("trial_cliffhanger");
  }

  if (
    input.signals.weeksSinceFeedback !== null &&
    input.signals.weeksSinceFeedback * 7 < WEEKLY_FEEDBACK_COOLDOWN_DAYS
  ) {
    return skip("recent_feedback");
  }

  const activity = weekActivityScore(input.summary);
  if (activity === 0 && input.signals.messageCountThisWeek < 2) {
    return skip("ghost_week");
  }

  const include = (
    reason: NonNullable<WeeklyFeedbackPromptContext["reason"]>,
    variant: WeeklyFeedbackPromptContext["variant"]
  ): WeeklyFeedbackPromptContext => ({
    include: true,
    reason,
    variant,
    skip_reason: null,
    prior_report_count: input.signals.priorReportCount,
    weeks_since_feedback: input.signals.weeksSinceFeedback,
    message_count_this_week: input.signals.messageCountThisWeek,
    momentum_delta: input.signals.momentumDelta
  });

  if (input.signals.priorReportCount <= 2) {
    return include("early_calibration", "open");
  }

  if (
    input.signals.momentumDelta !== null &&
    input.signals.momentumDelta <= -WEEKLY_FEEDBACK_MOMENTUM_DROP
  ) {
    return include("momentum_drop", "context");
  }

  if (
    input.signals.messageCountThisWeek < 5 &&
    activity >= 3 &&
    input.signals.messageCountThisWeek >= WEEKLY_FEEDBACK_MIN_MESSAGES_FOR_CONTEXT
  ) {
    return include("low_signal", "context");
  }

  if (
    input.signals.accountAgeDays >= 30 &&
    input.signals.messageCountThisWeek < 8 &&
    activity >= 1
  ) {
    return include("quiet_power_user", "rating");
  }

  if (
    input.signals.priorReportCount >= 4 &&
    (input.signals.weeksSinceFeedback === null ||
      input.signals.weeksSinceFeedback >= WEEKLY_FEEDBACK_PERIODIC_WEEKS)
  ) {
    return include("periodic_pulse", "rating");
  }

  return skip("no_trigger");
}

export async function loadWeeklyFeedbackSignals(input: {
  user: MauriUser;
  window: { weekStart: string; weekEnd: string };
  currentMomentum: number;
}): Promise<WeeklyFeedbackSignals> {
  const [reportCountResult, feedbackResult, messageResult, priorReportResult] = await Promise.all([
    supabase
      .from("weekly_reports")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.user.id),
    supabase
      .from("service_feedback")
      .select("created_at")
      .eq("user_id", input.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation_memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.user.id)
      .eq("memory_type", "user_message")
      .gte("created_at", input.window.weekStart)
      .lte("created_at", input.window.weekEnd),
    supabase
      .from("weekly_reports")
      .select("summary_json")
      .eq("user_id", input.user.id)
      .lt("week_end", input.window.weekStart)
      .order("week_end", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (reportCountResult.error) {
    throw new Error(`Failed to count weekly reports: ${reportCountResult.error.message}`);
  }

  if (feedbackResult.error) {
    throw new Error(`Failed to load service feedback: ${feedbackResult.error.message}`);
  }

  if (messageResult.error) {
    throw new Error(`Failed to count weekly messages: ${messageResult.error.message}`);
  }

  if (priorReportResult.error) {
    throw new Error(`Failed to load prior weekly report: ${priorReportResult.error.message}`);
  }

  const priorSummary = priorReportResult.data?.summary_json as WeeklyDiagnosticSummary | undefined;
  const priorMomentum =
    priorSummary && typeof priorSummary.momentum_score === "number" ? priorSummary.momentum_score : null;
  const accountAnchor = input.user.onboarding_completed_at ?? input.user.created_at;

  return {
    priorReportCount: reportCountResult.count ?? 0,
    weeksSinceFeedback: feedbackResult.data?.created_at
      ? weeksSince(new Date(String(feedbackResult.data.created_at)))
      : null,
    messageCountThisWeek: messageResult.count ?? 0,
    momentumDelta: priorMomentum === null ? null : input.currentMomentum - priorMomentum,
    accountAgeDays: daysBetween(new Date(accountAnchor), new Date())
  };
}

export function buildFallbackFeedbackSection(
  user: MauriUser,
  prompt: WeeklyFeedbackPromptContext
): string {
  const name = user.first_name?.trim() || "you";

  if (prompt.variant === "rating") {
    return `From Mauri — quick one for ${name}: how useful was I this week? Reply rate 1 (not really) to rate 5 (nailed it). Totally optional.`;
  }

  if (prompt.variant === "context") {
    return `From Mauri — I might be missing something about how ${name} works. If any reply this week felt off, tell me what I should understand better. Reply mauri feedback and what's landing wrong. Optional — helps me tune in.`;
  }

  return `From Mauri — still calibrating to ${name}. Rate me rate 1–5 if you want, or reply mauri feedback with what I should get right about you. Optional, but it sharpens everything after.`;
}

export function parseServiceFeedbackMessage(
  message: string
): { kind: "rating"; rating: number } | { kind: "text"; text: string } | null {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");

  const ratingMatch = normalized.match(/^(?:rate|mauri|rating)\s*([1-5])(?:\s*\/\s*5)?$/);
  if (ratingMatch?.[1]) {
    return { kind: "rating", rating: Number(ratingMatch[1]) };
  }

  const feedbackMatch = trimmed.match(/^mauri feedback[:\s—-]+(.+)$/i);
  if (feedbackMatch?.[1]?.trim()) {
    return { kind: "text", text: feedbackMatch[1].trim() };
  }

  const sundayMatch = trimmed.match(/^sunday feedback[:\s—-]+(.+)$/i);
  if (sundayMatch?.[1]?.trim()) {
    return { kind: "text", text: sundayMatch[1].trim() };
  }

  return null;
}

async function getPendingFeedbackReport(userId: string): Promise<WeeklyReportRecord | null> {
  const cutoff = new Date(
    Date.now() - WEEKLY_FEEDBACK_RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .eq("user_id", userId)
    .is("feedback_responded_at", null)
    .not("feedback_prompt_json", "is", null)
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(`Failed to load pending feedback reports: ${error.message}`);
  }

  for (const row of data ?? []) {
    const prompt = row.feedback_prompt_json as WeeklyFeedbackPromptContext | null;
    if (prompt?.include) {
      return {
        id: String(row.id),
        user_id: String(row.user_id),
        week_start: String(row.week_start),
        week_end: String(row.week_end),
        report_text: String(row.report_text),
        summary_json: row.summary_json as WeeklyDiagnosticSummary,
        delivery_status: String(row.delivery_status),
        sent_at: row.sent_at ? String(row.sent_at) : null,
        created_at: String(row.created_at),
        feedback_prompt_json: prompt,
        feedback_responded_at: null
      };
    }
  }

  return null;
}

async function recordServiceFeedback(input: {
  userId: string;
  weeklyReportId: string | null;
  rating: number | null;
  feedbackText: string | null;
  promptReason: string | null;
  requestId?: string | undefined;
}): Promise<void> {
  const { error } = await supabase.from("service_feedback").insert({
    user_id: input.userId,
    weekly_report_id: input.weeklyReportId,
    rating: input.rating,
    feedback_text: input.feedbackText,
    prompt_reason: input.promptReason,
    source: "sunday_report"
  });

  if (error) {
    throw new Error(`Failed to record service feedback: ${error.message}`);
  }

  if (input.weeklyReportId) {
    const { error: updateError } = await supabase
      .from("weekly_reports")
      .update({ feedback_responded_at: new Date().toISOString() })
      .eq("id", input.weeklyReportId);

    if (updateError) {
      throw new Error(`Failed to mark weekly report feedback responded: ${updateError.message}`);
    }
  }

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "service_feedback_received",
    actorType: "user",
    userId: input.userId,
    entityType: "service_feedback",
    entityId: input.weeklyReportId ?? undefined,
    message: "User submitted Mauri service feedback.",
    metadata: {
      rating: input.rating,
      hasText: Boolean(input.feedbackText),
      promptReason: input.promptReason
    }
  });
}

function buildFeedbackAcknowledgement(input: {
  user: MauriUser;
  rating: number | null;
  hasText: boolean;
}): string {
  const name = input.user.first_name?.trim() || "there";

  if (input.rating !== null && input.rating <= 2) {
    return `Thanks for the honesty, ${name}. That rating tells me I'm not landing yet — if you can, reply mauri feedback with one thing I keep getting wrong. I'll use it to tune how I show up for you.`;
  }

  if (input.rating !== null && input.rating >= 4) {
    return `Appreciate that, ${name}. I'll keep building on what's working — and you can always mauri feedback if something feels off later.`;
  }

  if (input.hasText) {
    return `Noted, ${name}. That context goes into how I read you going forward. If I miss again, call it out — that's how I get sharper for you.`;
  }

  return `Thanks, ${name}. Feedback logged — it helps me show up better for you.`;
}

export async function handleServiceFeedbackMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<ServiceFeedbackCommandResult> {
  const parsed = parseServiceFeedbackMessage(input.message);
  if (!parsed) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      reply: "Finish onboarding first — then you can rate or feedback Mauri anytime."
    };
  }

  const pendingReport = await getPendingFeedbackReport(input.user.id);
  const rating = parsed.kind === "rating" ? parsed.rating : null;
  const feedbackText = parsed.kind === "text" ? parsed.text : null;

  if (parsed.kind === "rating" && !pendingReport) {
    return {
      handled: true,
      reply:
        "I only use rate 1–5 when a Sunday report asked for it. Reply mauri feedback <what to improve> anytime, or wait for the next Sunday pulse."
    };
  }

  await recordServiceFeedback({
    userId: input.user.id,
    weeklyReportId: pendingReport?.id ?? null,
    rating,
    feedbackText,
    promptReason: pendingReport?.feedback_prompt_json?.reason ?? null,
    requestId: input.requestId
  });

  return {
    handled: true,
    reply: buildFeedbackAcknowledgement({
      user: input.user,
      rating,
      hasText: Boolean(feedbackText)
    })
  };
}

export async function buildWeeklyFeedbackPromptContext(input: {
  user: MauriUser;
  window: { weekStart: string; weekEnd: string };
  summary: WeeklyDiagnosticSummary;
}): Promise<WeeklyFeedbackPromptContext> {
  const signals = await loadWeeklyFeedbackSignals({
    user: input.user,
    window: input.window,
    currentMomentum: input.summary.momentum_score
  });

  return decideWeeklyFeedbackPrompt({
    summary: input.summary,
    signals
  });
}
