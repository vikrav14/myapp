import { createHash } from "node:crypto";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser, UserMindRecord } from "../types.js";
import { generateOpenLoopFollowUpMessage } from "./ai.service.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
  addDaysToLocal,
  getMauritiusLocalParts,
  mauritiusLocalToUtc
} from "./reminder-time.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { findUserById, mapUser, updateUserState } from "./user.service.js";
import { canSendProactiveOutbound, recordProactivePing } from "./outbound-pace.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";
import type { LifeThreadCandidate } from "./life-thread.service.js";
import { buildLifeThreadCandidatesFromFacts } from "./life-thread.service.js";
import {
  OPEN_LOOP_FOLLOWUP_COOLDOWN_DAYS,
  OPEN_LOOP_MAX_PER_REFLECTION
} from "./open-loop-follow-up.constants.js";

export interface OpenLoopFollowUpRecord {
  id: string;
  user_id: string;
  mind_snapshot_id: string | null;
  loop_text: string;
  loop_fingerprint: string;
  source: "user_mind" | "user_requested" | "onboarding";
  status: "pending" | "sent" | "cancelled" | "skipped";
  scheduled_for: string;
  sent_at: string | null;
  message_text: string | null;
  delivery_key: string;
  created_at: string;
  updated_at: string;
}

export interface OpenLoopFollowUpCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

function mapFollowUpRecord(record: Record<string, unknown>): OpenLoopFollowUpRecord {
  return {
    id: String(record.id),
    user_id: String(record.user_id),
    mind_snapshot_id: record.mind_snapshot_id ? String(record.mind_snapshot_id) : null,
    loop_text: String(record.loop_text),
    loop_fingerprint: String(record.loop_fingerprint),
    source: String(record.source) as OpenLoopFollowUpRecord["source"],
    status: String(record.status) as OpenLoopFollowUpRecord["status"],
    scheduled_for: String(record.scheduled_for),
    sent_at: record.sent_at ? String(record.sent_at) : null,
    message_text: record.message_text ? String(record.message_text) : null,
    delivery_key: String(record.delivery_key),
    created_at: String(record.created_at),
    updated_at: String(record.updated_at)
  };
}

export function normalizeLoopText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

export function buildLoopFingerprint(loopText: string): string {
  return createHash("sha256").update(normalizeLoopText(loopText)).digest("hex");
}

export function buildFollowUpDeliveryKey(userId: string, fingerprint: string, scheduledFor: string): string {
  const dayKey = scheduledFor.slice(0, 10);
  return `open_loop_followup:${userId}:${fingerprint.slice(0, 16)}:${dayKey}`;
}

export function openLoopFollowUpTimeAfterDays(days: number, reference: Date = new Date()): string {
  const local = getMauritiusLocalParts(reference);
  const hour = env.OPEN_LOOP_FOLLOWUP_HOUR;
  const minute = env.OPEN_LOOP_FOLLOWUP_MINUTE;
  const targetLocal = addDaysToLocal(local, days);

  return mauritiusLocalToUtc({
    year: targetLocal.year,
    month: targetLocal.month,
    day: targetLocal.day,
    hour,
    minute
  }).toISOString();
}

export function nextOpenLoopFollowUpTime(reference: Date = new Date()): string {
  const local = getMauritiusLocalParts(reference);
  const hour = env.OPEN_LOOP_FOLLOWUP_HOUR;
  const minute = env.OPEN_LOOP_FOLLOWUP_MINUTE;

  const isPastSlot =
    local.hour > hour || (local.hour === hour && local.minute >= minute);
  const targetLocal = isPastSlot ? addDaysToLocal(local, 1) : local;

  return mauritiusLocalToUtc({
    year: targetLocal.year,
    month: targetLocal.month,
    day: targetLocal.day,
    hour,
    minute
  }).toISOString();
}

async function insertOpenLoopFollowUp(input: {
  userId: string;
  loopText: string;
  scheduledFor: string;
  source: OpenLoopFollowUpRecord["source"];
  mindSnapshotId?: string | null;
}): Promise<boolean> {
  const fingerprint = buildLoopFingerprint(input.loopText);
  if (await hasRecentFollowUpForLoop(input.userId, fingerprint)) {
    return false;
  }

  const deliveryKey = buildFollowUpDeliveryKey(input.userId, fingerprint, input.scheduledFor);
  const { error } = await supabase.from("open_loop_follow_ups").insert({
    user_id: input.userId,
    mind_snapshot_id: input.mindSnapshotId ?? null,
    loop_text: input.loopText,
    loop_fingerprint: fingerprint,
    source: input.source,
    status: "pending",
    scheduled_for: input.scheduledFor,
    delivery_key: deliveryKey
  });

  if (error) {
    if (error.message.includes("duplicate")) {
      return false;
    }

    throw new Error(`Failed to schedule open-loop follow-up: ${error.message}`);
  }

  return true;
}

async function scheduleThreadCandidates(input: {
  user: MauriUser;
  candidates: LifeThreadCandidate[];
  source: OpenLoopFollowUpRecord["source"];
  mindSnapshotId?: string | null;
}): Promise<number> {
  if (!env.OPEN_LOOP_FOLLOWUPS_ENABLED || !input.user.open_loop_followups_enabled) {
    return 0;
  }

  if (input.candidates.length === 0) {
    return 0;
  }

  let scheduled = 0;

  for (const candidate of input.candidates) {
    const scheduledFor = openLoopFollowUpTimeAfterDays(candidate.offsetDays);
    const inserted = await insertOpenLoopFollowUp({
      userId: input.user.id,
      loopText: candidate.loopText,
      scheduledFor,
      source: input.source,
      mindSnapshotId: input.mindSnapshotId ?? null
    });

    if (inserted) {
      scheduled += 1;
    }
  }

  if (scheduled > 0) {
    logger.info(
      { userId: input.user.id, scheduled, source: input.source },
      "Scheduled life-thread follow-ups."
    );
  }

  return scheduled;
}

export async function seedLifeThreadsFromOnboarding(input: {
  user: MauriUser;
  facts: import("../types.js").UserMindFact[];
}): Promise<number> {
  const candidates = buildLifeThreadCandidatesFromFacts(input.facts);
  return scheduleThreadCandidates({
    user: input.user,
    candidates,
    source: "onboarding"
  });
}

function buildFallbackFollowUpMessage(user: MauriUser, loopText: string): string {
  const name = user.first_name?.trim() || "there";
  return `Hey ${name}, checking in on something you mentioned:

${loopText}

How did it go? No pressure to debrief — just here if you want to talk it through.`;
}

export function parseOpenLoopFollowUpToggle(message: string): { enabled: boolean } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "followups on" ||
    normalized === "follow ups on" ||
    normalized === "follow-up on" ||
    normalized === "checkins on" ||
    normalized === "check ins on" ||
    normalized === "open loop followups on"
  ) {
    return { enabled: true };
  }

  if (
    normalized === "followups off" ||
    normalized === "follow ups off" ||
    normalized === "follow-up off" ||
    normalized === "checkins off" ||
    normalized === "check ins off" ||
    normalized === "open loop followups off"
  ) {
    return { enabled: false };
  }

  return null;
}

export function parseMyFollowUpsCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "my followups" || normalized === "my follow ups" || normalized === "pending followups";
}

async function hasRecentFollowUpForLoop(userId: string, fingerprint: string): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - OPEN_LOOP_FOLLOWUP_COOLDOWN_DAYS);

  const { data, error } = await supabase
    .from("open_loop_follow_ups")
    .select("id")
    .eq("user_id", userId)
    .eq("loop_fingerprint", fingerprint)
    .in("status", ["pending", "sent"])
    .gte("created_at", cutoff.toISOString())
    .limit(1);

  if (error) {
    throw new Error(`Failed to check open-loop follow-up history: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

export async function scheduleOpenLoopFollowUps(input: {
  user: MauriUser;
  mindRecord: UserMindRecord;
}): Promise<number> {
  if (!env.OPEN_LOOP_FOLLOWUPS_ENABLED || !input.user.open_loop_followups_enabled) {
    return 0;
  }

  const loops = input.mindRecord.snapshot.open_loops
    .map((loop) => loop.trim())
    .filter((loop) => loop.length >= 8)
    .slice(0, OPEN_LOOP_MAX_PER_REFLECTION);

  if (loops.length === 0) {
    return 0;
  }

  let scheduled = 0;

  for (const [index, loopText] of loops.entries()) {
    const scheduledFor = openLoopFollowUpTimeAfterDays(index === 0 ? 1 : 1 + index * 3);
    const inserted = await insertOpenLoopFollowUp({
      userId: input.user.id,
      loopText,
      scheduledFor,
      source: "user_mind",
      mindSnapshotId: input.mindRecord.id
    });

    if (inserted) {
      scheduled += 1;
    }
  }

  if (scheduled > 0) {
    logger.info({ userId: input.user.id, scheduled }, "Scheduled open-loop follow-up from mind snapshot.");
  }

  return scheduled;
}

export async function listDueOpenLoopFollowUps(limit: number = 50): Promise<OpenLoopFollowUpRecord[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("open_loop_follow_ups")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list due open-loop follow-ups: ${error.message}`);
  }

  return (data ?? []).map((row) => mapFollowUpRecord(row as Record<string, unknown>));
}

export async function listPendingFollowUpsForUser(userId: string): Promise<OpenLoopFollowUpRecord[]> {
  const { data, error } = await supabase
    .from("open_loop_follow_ups")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true })
    .limit(5);

  if (error) {
    throw new Error(`Failed to list pending follow-ups: ${error.message}`);
  }

  return (data ?? []).map((row) => mapFollowUpRecord(row as Record<string, unknown>));
}

async function markFollowUpSent(input: {
  followUpId: string;
  messageText: string;
}): Promise<void> {
  const sentAt = new Date().toISOString();
  const { error } = await supabase
    .from("open_loop_follow_ups")
    .update({
      status: "sent",
      sent_at: sentAt,
      message_text: input.messageText,
      updated_at: sentAt
    })
    .eq("id", input.followUpId)
    .eq("status", "pending");

  if (error) {
    throw new Error(`Failed to mark open-loop follow-up sent: ${error.message}`);
  }
}

export async function deliverOpenLoopFollowUp(input: {
  followUp: OpenLoopFollowUpRecord;
  requestId?: string | undefined;
}): Promise<boolean> {
  const user = await findUserById(input.followUp.user_id);
  if (!user || !isReminderEligible(user) || !user.open_loop_followups_enabled) {
    await supabase
      .from("open_loop_follow_ups")
      .update({ status: "skipped", updated_at: new Date().toISOString() })
      .eq("id", input.followUp.id)
      .eq("status", "pending");
    return false;
  }

  const gate = await canSendProactiveOutbound(user, "open_loop_followup");
  if (!gate.allowed) {
    return false;
  }

  const message =
    (await generateOpenLoopFollowUpMessage({
      user,
      loopText: input.followUp.loop_text
    }).catch(() => null)) ?? buildFallbackFollowUpMessage(user, input.followUp.loop_text);

  await sendWhatsAppMessage(user.phone_number, message, {
    userId: user.id,
    requestId: input.requestId,
    metadata: {
      flow: "open_loop_followup",
      followUpId: input.followUp.id
    }
  });

  await markFollowUpSent({
    followUpId: input.followUp.id,
    messageText: message
  });

  await recordProactivePing(user.id, "open_loop_followup");

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "open_loop_followup_sent",
    actorType: "system",
    userId: user.id,
    entityType: "open_loop_follow_up",
    entityId: input.followUp.id,
    message: "Open-loop follow-up delivered.",
    metadata: {
      loopText: input.followUp.loop_text
    }
  });

  return true;
}

export async function runOpenLoopFollowUpDeliveries(requestId?: string): Promise<{
  due: number;
  delivered: number;
  skipped: number;
}> {
  if (!env.OPEN_LOOP_FOLLOWUPS_ENABLED) {
    return { due: 0, delivered: 0, skipped: 0 };
  }

  const dueFollowUps = await listDueOpenLoopFollowUps(100);
  const seenUsers = new Set<string>();
  let delivered = 0;
  let skipped = 0;

  for (const followUp of dueFollowUps) {
    if (seenUsers.has(followUp.user_id)) {
      skipped += 1;
      continue;
    }

    seenUsers.add(followUp.user_id);
    const sent = await deliverOpenLoopFollowUp({ followUp, requestId });
    if (sent) {
      delivered += 1;
    } else {
      skipped += 1;
    }
  }

  logger.info({ due: dueFollowUps.length, delivered, skipped }, "Open-loop follow-up delivery run completed.");
  return { due: dueFollowUps.length, delivered, skipped };
}

export async function handleOpenLoopFollowUpMessage(input: {
  user: MauriUser;
  message: string;
}): Promise<OpenLoopFollowUpCommandResult> {
  const toggle = parseOpenLoopFollowUpToggle(input.message);
  if (toggle) {
    if (input.user.onboarding_state !== "active") {
      return {
        handled: true,
        user: input.user,
        reply: "Finish onboarding first, then you can manage follow-up check-ins."
      };
    }

    const updatedUser = await updateUserState(input.user.id, {
      open_loop_followups_enabled: toggle.enabled
    });

    if (toggle.enabled) {
      return {
        handled: true,
        user: updatedUser,
        reply:
          "Follow-up check-ins are on. When you mention something big — interview, exam, family thing — I'll gently check back if it's still open. I'll also reach out when you've been quiet (max ~3/week). Reply not now anytime to pause."
      };
    }

    return {
      handled: true,
      user: updatedUser,
      reply:
        "Follow-up check-ins are off. I won't ping you on open loops. Turn them back on anytime with followups on."
    };
  }

  if (parseMyFollowUpsCommand(input.message)) {
    if (input.user.onboarding_state !== "active") {
      return {
        handled: true,
        user: input.user,
        reply: "Finish onboarding first."
      };
    }

    const pending = await listPendingFollowUpsForUser(input.user.id);
    if (pending.length === 0) {
      return {
        handled: true,
        user: input.user,
        reply: "No pending follow-ups right now. I'll check in when something you mentioned is still open."
      };
    }

    const lines = pending.map(
      (item) => `- ${item.loop_text} (scheduled ${item.scheduled_for.slice(0, 16).replace("T", " ")})`
    );

    return {
      handled: true,
      user: input.user,
      reply: `Pending follow-ups:\n${lines.join("\n")}\n\nfollowups off — pause these check-ins`
    };
  }

  return { handled: false, user: input.user };
}

export async function listOpenLoopFollowUpUsers(): Promise<MauriUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("onboarding_state", "active")
    .eq("open_loop_followups_enabled", true)
    .in("subscription_status", ["Trial_Active", "Paid_Active"]);

  if (error) {
    throw new Error(`Failed to list follow-up users: ${error.message}`);
  }

  return (data ?? []).map((row) => mapUser(row as Record<string, unknown>)).filter(isReminderEligible);
}
