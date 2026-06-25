import { createHash } from "node:crypto";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { UserMindSnapshotPayload } from "../schemas/user-mind.js";
import type { MauriUser } from "../types.js";
import { generateProactiveCheckInMessage } from "./ai.service.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { hasEngagementDelivery, recordEngagementDelivery } from "./engagement-delivery.service.js";
import { buildPaydayRunwaySnippet, loadPayCycleSpend } from "./payday-runway.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import {
  PROACTIVE_CHECKIN_CARE_SILENCE_MAX_HOURS,
  PROACTIVE_CHECKIN_CURIOUS_COOLDOWN_DAYS,
  PROACTIVE_CHECKIN_MAX_PER_WEEK,
  PROACTIVE_CHECKIN_MIN_SILENCE_HOURS,
  PROACTIVE_CHECKIN_PAUSE_DAYS,
  PROACTIVE_CHECKIN_RECENT_ACTIVITY_HOURS,
  PROACTIVE_MODE_PRIORITY
} from "./proactive-checkin.constants.js";
import { getUserMindSnapshot } from "./user-mind.service.js";
import { findUserById, mapUser, updateUserState } from "./user.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

export type ProactiveCheckInMode = "care" | "useful" | "curious";

export interface ProactiveCheckInCandidate {
  mode: ProactiveCheckInMode;
  hookSummary: string;
  deliveryKey: string;
}

export interface ProactiveCheckInCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

function proactiveDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function buildDailyDeliveryKey(dateKey = proactiveDateKey()): string {
  return `proactive_checkin_day_${dateKey}`;
}

function buildHookDeliveryKey(userId: string, mode: ProactiveCheckInMode, hookSummary: string): string {
  const hash = createHash("sha256").update(hookSummary.toLowerCase().trim()).digest("hex").slice(0, 16);
  return `proactive_checkin:${userId}:${mode}:${hash}`;
}

function buildFallbackMessage(user: MauriUser, candidate: ProactiveCheckInCandidate): string {
  const name = user.first_name?.trim() || "there";

  if (candidate.mode === "care") {
    return `Hey ${name}, been a minute. ${candidate.hookSummary}

No pressure to reply — just checking you're alright. Reply not now if you'd rather I hold off for a bit.`;
  }

  if (candidate.mode === "useful") {
    return `Hey ${name}, quick thought while you've been quiet:

${candidate.hookSummary}

Want help with one small next step, or reply not now to pause these pings.`;
  }

  return `Hey ${name}, random one while we're chatting less lately:

${candidate.hookSummary}

Reply not now anytime if proactive check-ins aren't your vibe.`;
}

export function parseNotNowCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "not now" ||
    normalized === "not now please" ||
    normalized === "pause checkins" ||
    normalized === "pause check ins" ||
    normalized === "stop checking in"
  );
}

export function parseMyCheckinsCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "my checkins" || normalized === "my check ins";
}

export function pickProactiveCandidate(
  candidates: ProactiveCheckInCandidate[]
): ProactiveCheckInCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort(
    (left, right) => PROACTIVE_MODE_PRIORITY[right.mode] - PROACTIVE_MODE_PRIORITY[left.mode]
  )[0] ?? null;
}

async function getLastUserMessageAt(userId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from("conversation_memories")
    .select("created_at")
    .eq("user_id", userId)
    .eq("memory_type", "user_message")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last user message: ${error.message}`);
  }

  if (!data?.created_at) {
    return null;
  }

  return new Date(String(data.created_at));
}

function hoursSince(date: Date | null, reference = new Date()): number | null {
  if (!date) {
    return null;
  }

  return (reference.getTime() - date.getTime()) / (60 * 60 * 1000);
}

function isUserPaused(user: MauriUser, reference = new Date()): boolean {
  if (!user.proactive_checkins_paused_until) {
    return false;
  }

  return new Date(user.proactive_checkins_paused_until).getTime() > reference.getTime();
}

async function countProactiveCheckinsThisWeek(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("proactive_checkins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("sent_at", cutoff);

  if (error) {
    throw new Error(`Failed to count proactive check-ins: ${error.message}`);
  }

  return count ?? 0;
}

async function getLastProactiveCheckinByMode(
  userId: string,
  mode: ProactiveCheckInMode
): Promise<Date | null> {
  const { data, error } = await supabase
    .from("proactive_checkins")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("mode", mode)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load proactive check-in history: ${error.message}`);
  }

  if (!data?.sent_at) {
    return null;
  }

  return new Date(String(data.sent_at));
}

async function hasBlockingEngagementToday(userId: string, dateKey = proactiveDateKey()): Promise<boolean> {
  const dailyKeys = [
    buildDailyDeliveryKey(dateKey),
    `memory_resurface_day_${dateKey}`
  ];

  for (const deliveryKey of dailyKeys) {
    if (await hasEngagementDelivery(userId, deliveryKey)) {
      return true;
    }
  }

  const dayStart = `${dateKey}T00:00:00.000Z`;
  const dayEnd = `${dateKey}T23:59:59.999Z`;

  const [{ data: briefRows, error: briefError }, { data: followUpRows, error: followUpError }] =
    await Promise.all([
      supabase
        .from("daily_brief_deliveries")
        .select("id")
        .eq("user_id", userId)
        .eq("delivery_status", "sent")
        .gte("sent_at", dayStart)
        .lte("sent_at", dayEnd)
        .limit(1),
      supabase
        .from("open_loop_follow_ups")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "sent")
        .gte("sent_at", dayStart)
        .lte("sent_at", dayEnd)
        .limit(1)
    ]);

  if (briefError) {
    throw new Error(`Failed to check morning brief deliveries: ${briefError.message}`);
  }

  if (followUpError) {
    throw new Error(`Failed to check open-loop follow-ups: ${followUpError.message}`);
  }

  return (briefRows ?? []).length > 0 || (followUpRows ?? []).length > 0;
}

async function hasPendingOpenLoopFollowUp(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("open_loop_follow_ups")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(1);

  if (error) {
    throw new Error(`Failed to check pending open-loop follow-ups: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

function hasEmotionalSignal(mind: UserMindSnapshotPayload | null): boolean {
  if (!mind) {
    return false;
  }

  const emotional = mind.emotional_pattern.trim().toLowerCase();
  if (emotional.length < 24) {
    return false;
  }

  return !/insufficient|not enough|thin signal|unknown|unclear/.test(emotional);
}

function isThinMind(mind: UserMindSnapshotPayload | null): boolean {
  if (!mind) {
    return true;
  }

  return mind.personality_notes.trim().length < 80 || mind.active_goals.length === 0;
}

export async function buildCareCandidate(input: {
  user: MauriUser;
  mind: UserMindSnapshotPayload | null;
  silenceHours: number | null;
}): Promise<ProactiveCheckInCandidate | null> {
  if (input.silenceHours === null) {
    return null;
  }

  if (
    input.silenceHours < PROACTIVE_CHECKIN_MIN_SILENCE_HOURS ||
    input.silenceHours > PROACTIVE_CHECKIN_CARE_SILENCE_MAX_HOURS
  ) {
    return null;
  }

  if (!hasEmotionalSignal(input.mind)) {
    return null;
  }

  if (await hasPendingOpenLoopFollowUp(input.user.id)) {
    return null;
  }

  const hookSummary =
    input.mind?.emotional_pattern.trim() ||
    "You've had a lot on your plate lately and I haven't heard from you in a bit.";

  return {
    mode: "care",
    hookSummary,
    deliveryKey: buildHookDeliveryKey(input.user.id, "care", hookSummary)
  };
}

export async function buildUsefulCandidate(input: {
  user: MauriUser;
  mind: UserMindSnapshotPayload | null;
  silenceHours: number | null;
}): Promise<ProactiveCheckInCandidate | null> {
  if (input.silenceHours === null || input.silenceHours < PROACTIVE_CHECKIN_MIN_SILENCE_HOURS) {
    return null;
  }

  if (input.user.payday_day_of_month) {
    const cycleSpend = await loadPayCycleSpend(input.user);
    const runwaySnippet = buildPaydayRunwaySnippet(input.user, cycleSpend);
    if (runwaySnippet && /tight|watch|burn|low|stretch|careful/i.test(runwaySnippet)) {
      return {
        mode: "useful",
        hookSummary: runwaySnippet,
        deliveryKey: buildHookDeliveryKey(input.user.id, "useful", runwaySnippet)
      };
    }
  }

  const { data: todoRows, error: todoError } = await supabase
    .from("todo_logs")
    .select("task_description")
    .eq("user_id", input.user.id)
    .eq("is_completed", false)
    .order("created_at", { ascending: true })
    .limit(1);

  if (todoError) {
    throw new Error(`Failed to load todo candidates: ${todoError.message}`);
  }

  const todoText = String(todoRows?.[0]?.task_description ?? "").trim();
  if (todoText) {
    const hookSummary = `You still have "${todoText}" open. Want a nudge to knock one thing off?`;
    return {
      mode: "useful",
      hookSummary,
      deliveryKey: buildHookDeliveryKey(input.user.id, "useful", hookSummary)
    };
  }

  if (input.user.weekly_focus_habit) {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("habit_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.user.id)
      .eq("habit_name", input.user.weekly_focus_habit)
      .gte("logged_at", cutoff);

    if (error) {
      throw new Error(`Failed to load habit logs: ${error.message}`);
    }

    if ((count ?? 0) === 0) {
      const hookSummary = `Your focus this week is ${input.user.weekly_focus_habit}, and I haven't seen a log in a few days.`;
      return {
        mode: "useful",
        hookSummary,
        deliveryKey: buildHookDeliveryKey(input.user.id, "useful", hookSummary)
      };
    }
  }

  const goal = input.mind?.active_goals[0]?.trim();
  if (goal) {
    const hookSummary = `Still thinking about your goal: ${goal}. Want to pick one tiny move for today?`;
    return {
      mode: "useful",
      hookSummary,
      deliveryKey: buildHookDeliveryKey(input.user.id, "useful", hookSummary)
    };
  }

  return null;
}

export async function buildCuriousCandidate(input: {
  user: MauriUser;
  mind: UserMindSnapshotPayload | null;
  silenceHours: number | null;
}): Promise<ProactiveCheckInCandidate | null> {
  if (input.silenceHours === null || input.silenceHours < PROACTIVE_CHECKIN_MIN_SILENCE_HOURS) {
    return null;
  }

  if (!isThinMind(input.mind)) {
    return null;
  }

  const lastCurious = await getLastProactiveCheckinByMode(input.user.id, "curious");
  if (lastCurious) {
    const daysSince = (Date.now() - lastCurious.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince < PROACTIVE_CHECKIN_CURIOUS_COOLDOWN_DAYS) {
      return null;
    }
  }

  const hookSummary =
    "I'm still getting to know what actually helps you — routines, stress triggers, what a good week looks like.";
  return {
    mode: "curious",
    hookSummary,
    deliveryKey: buildHookDeliveryKey(input.user.id, "curious", hookSummary)
  };
}

export async function buildProactiveCheckInCandidates(input: {
  user: MauriUser;
  mind: UserMindSnapshotPayload | null;
  silenceHours: number | null;
}): Promise<ProactiveCheckInCandidate[]> {
  const candidates = await Promise.all([
    buildCareCandidate(input),
    buildUsefulCandidate(input),
    buildCuriousCandidate(input)
  ]);

  return candidates.filter((candidate): candidate is ProactiveCheckInCandidate => candidate !== null);
}

export async function canSendProactiveCheckIn(input: {
  user: MauriUser;
  silenceHours: number | null;
  weeklyCount: number;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!env.PROACTIVE_CHECKINS_ENABLED) {
    return { ok: false, reason: "disabled" };
  }

  if (!input.user.open_loop_followups_enabled) {
    return { ok: false, reason: "toggle_off" };
  }

  if (!isReminderEligible(input.user)) {
    return { ok: false, reason: "ineligible" };
  }

  if (isUserPaused(input.user)) {
    return { ok: false, reason: "paused" };
  }

  if (input.silenceHours === null) {
    return { ok: false, reason: "no_history" };
  }

  if (input.silenceHours < PROACTIVE_CHECKIN_MIN_SILENCE_HOURS) {
    return { ok: false, reason: "too_soon" };
  }

  if (input.silenceHours < PROACTIVE_CHECKIN_RECENT_ACTIVITY_HOURS) {
    return { ok: false, reason: "recent_activity" };
  }

  if (input.weeklyCount >= PROACTIVE_CHECKIN_MAX_PER_WEEK) {
    return { ok: false, reason: "weekly_cap" };
  }

  if (await hasBlockingEngagementToday(input.user.id)) {
    return { ok: false, reason: "other_engagement_today" };
  }

  if (await hasEngagementDelivery(input.user.id, buildDailyDeliveryKey())) {
    return { ok: false, reason: "already_sent_today" };
  }

  return { ok: true };
}

export async function listProactiveCheckInEligibleUsers(): Promise<MauriUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("open_loop_followups_enabled", true)
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to list proactive check-in users: ${error.message}`);
  }

  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>)).filter(isReminderEligible);
}

export async function deliverProactiveCheckIn(input: {
  user: MauriUser;
  candidate: ProactiveCheckInCandidate;
  mind: UserMindSnapshotPayload | null;
  requestId?: string | undefined;
}): Promise<boolean> {
  const message =
    (await generateProactiveCheckInMessage({
      user: input.user,
      mode: input.candidate.mode,
      hookSummary: input.candidate.hookSummary,
      userMind: input.mind
    }).catch(() => null)) ?? buildFallbackMessage(input.user, input.candidate);

  await sendWhatsAppMessage(input.user.phone_number, message, {
    userId: input.user.id,
    requestId: input.requestId,
    metadata: {
      flow: "proactive_checkin",
      mode: input.candidate.mode,
      deliveryKey: input.candidate.deliveryKey
    }
  });

  const sentAt = new Date().toISOString();
  const { error } = await supabase.from("proactive_checkins").insert({
    user_id: input.user.id,
    mode: input.candidate.mode,
    hook_summary: input.candidate.hookSummary,
    message_text: message,
    delivery_key: input.candidate.deliveryKey,
    sent_at: sentAt
  });

  if (error && !error.message.includes("duplicate")) {
    throw new Error(`Failed to record proactive check-in: ${error.message}`);
  }

  await recordEngagementDelivery(input.user.id, buildDailyDeliveryKey());
  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "proactive_checkin_sent",
    actorType: "system",
    userId: input.user.id,
    entityType: "proactive_checkin",
    entityId: input.candidate.deliveryKey,
    message: "Proactive check-in delivered.",
    metadata: {
      mode: input.candidate.mode,
      hookSummary: input.candidate.hookSummary
    }
  });

  return true;
}

export async function runProactiveCheckInDeliveries(requestId?: string): Promise<{
  eligible: number;
  sent: number;
  skipped: number;
}> {
  if (!env.PROACTIVE_CHECKINS_ENABLED) {
    return { eligible: 0, sent: 0, skipped: 0 };
  }

  const users = await listProactiveCheckInEligibleUsers();
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    const lastMessageAt = await getLastUserMessageAt(user.id);
    let silenceHours = hoursSince(lastMessageAt);
    if (silenceHours === null && user.onboarding_completed_at) {
      silenceHours = hoursSince(new Date(user.onboarding_completed_at));
    }
    const weeklyCount = await countProactiveCheckinsThisWeek(user.id);
    const eligibility = await canSendProactiveCheckIn({ user, silenceHours, weeklyCount });

    if (!eligibility.ok) {
      skipped += 1;
      continue;
    }

    const mindRecord = await getUserMindSnapshot(user.id);
    const mind = mindRecord?.snapshot ?? null;
    const candidates = await buildProactiveCheckInCandidates({ user, mind, silenceHours });
    const candidate = pickProactiveCandidate(candidates);

    if (!candidate) {
      skipped += 1;
      continue;
    }

    if (await hasEngagementDelivery(user.id, candidate.deliveryKey)) {
      skipped += 1;
      continue;
    }

    try {
      await deliverProactiveCheckIn({ user, candidate, mind, requestId });
      sent += 1;
    } catch (error) {
      skipped += 1;
      logger.warn({ error, userId: user.id }, "Failed proactive check-in delivery for user.");
    }
  }

  if (sent > 0) {
    logger.info({ eligible: users.length, sent, skipped }, "Proactive check-in delivery completed.");
  }

  return { eligible: users.length, sent, skipped };
}

export async function handleProactiveCheckInMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<ProactiveCheckInCommandResult> {
  if (!env.PROACTIVE_CHECKINS_ENABLED) {
    return { handled: false };
  }

  if (parseNotNowCommand(input.message)) {
    if (input.user.onboarding_state !== "active") {
      return {
        handled: true,
        user: input.user,
        reply: "Finish onboarding first, then you can pause proactive check-ins."
      };
    }

    const pausedUntil = new Date(
      Date.now() + PROACTIVE_CHECKIN_PAUSE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const updatedUser = await updateUserState(input.user.id, {
      proactive_checkins_paused_until: pausedUntil
    });

    return {
      handled: true,
      user: updatedUser,
      reply: `Got it — I won't proactively check in for ${PROACTIVE_CHECKIN_PAUSE_DAYS} days. Message me anytime; followups on turns proactive pings back on when you're ready.`
    };
  }

  if (parseMyCheckinsCommand(input.message)) {
    if (input.user.onboarding_state !== "active") {
      return {
        handled: true,
        user: input.user,
        reply: "Finish onboarding first."
      };
    }

    const weeklyCount = await countProactiveCheckinsThisWeek(input.user.id);
    const paused = isUserPaused(input.user);
    const statusLine = input.user.open_loop_followups_enabled
      ? "Proactive check-ins are on (shared with followups on/off)."
      : "Proactive check-ins are off. Say followups on to re-enable.";

    const pauseLine = paused
      ? `Paused until ${input.user.proactive_checkins_paused_until?.slice(0, 16).replace("T", " ")}.`
      : "Not paused — reply not now anytime to take a break.";

    return {
      handled: true,
      user: input.user,
      reply: `${statusLine}\n${pauseLine}\nThis week: ${weeklyCount}/${PROACTIVE_CHECKIN_MAX_PER_WEEK} proactive pings sent.`
    };
  }

  return { handled: false, user: input.user };
}
