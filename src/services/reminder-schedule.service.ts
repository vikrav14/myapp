import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import {
  buildReminderParseFailureReply,
  looksLikeReminderAttempt,
  parseReminderCommand
} from "./reminder-parse.service.js";
import type { ReminderRepeatKind } from "./reminder-parse.service.js";
import {
  computeNextDailyFireAt,
  computeNextOnceFireAt,
  computeNextWeeklyFireAt,
  formatClockTime,
  formatMauritiusDateTime,
  MAURITIUS_TIMEZONE
} from "./reminder-time.service.js";

export interface ScheduledReminderRecord {
  id: string;
  user_id: string;
  label: string;
  next_fire_at: string;
  repeat_kind: ReminderRepeatKind;
  repeat_hour: number | null;
  repeat_minute: number | null;
  repeat_weekdays: number[] | null;
  timezone: string;
  status: string;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderCommandResult {
  handled: boolean;
  reply?: string | undefined;
}

const MAX_ACTIVE_REMINDERS = 20;
const RECENT_ACTION_WINDOW_MS = 48 * 60 * 60 * 1000;
const ONCE_REMINDER_ACK_HOLD_UNTIL = "2099-01-01T00:00:00.000Z";

function mapReminder(row: Record<string, unknown>): ScheduledReminderRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    label: String(row.label),
    next_fire_at: String(row.next_fire_at),
    repeat_kind: row.repeat_kind as ReminderRepeatKind,
    repeat_hour: row.repeat_hour === null || row.repeat_hour === undefined ? null : Number(row.repeat_hour),
    repeat_minute:
      row.repeat_minute === null || row.repeat_minute === undefined ? null : Number(row.repeat_minute),
    repeat_weekdays: Array.isArray(row.repeat_weekdays)
      ? row.repeat_weekdays.map((value) => Number(value))
      : null,
    timezone: String(row.timezone ?? MAURITIUS_TIMEZONE),
    status: String(row.status),
    last_fired_at: row.last_fired_at ? String(row.last_fired_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export function isReminderEligible(user: MauriUser): boolean {
  if (user.onboarding_state !== "active") {
    return false;
  }

  if (user.subscription_status === "Locked") {
    return false;
  }

  if (user.subscription_status === "Trial_Active") {
    return Boolean(user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now());
  }

  if (user.subscription_status === "Paid_Active") {
    return !user.subscription_ends_at || new Date(user.subscription_ends_at).getTime() > Date.now();
  }

  return false;
}

function repeatSummary(reminder: ScheduledReminderRecord): string {
  if (reminder.repeat_kind === "once") {
    return "once";
  }

  if (reminder.repeat_kind === "daily") {
    return "daily";
  }

  if (reminder.repeat_kind === "weekdays") {
    return "weekdays";
  }

  const days = (reminder.repeat_weekdays ?? []).map((index) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index]);
  return `weekly (${days.join(", ")})`;
}

function computeNextFireAt(input: {
  repeatKind: ReminderRepeatKind;
  hour: number;
  minute: number;
  weekdays?: number[] | undefined;
  after: Date;
}): Date {
  if (input.repeatKind === "once") {
    return computeNextOnceFireAt({
      hour: input.hour,
      minute: input.minute,
      after: input.after
    });
  }

  if (input.repeatKind === "daily") {
    return computeNextDailyFireAt({
      hour: input.hour,
      minute: input.minute,
      after: input.after
    });
  }

  if (input.repeatKind === "weekdays") {
    return computeNextDailyFireAt({
      hour: input.hour,
      minute: input.minute,
      after: input.after,
      weekdaysOnly: true
    });
  }

  return computeNextWeeklyFireAt({
    hour: input.hour,
    minute: input.minute,
    weekdays: input.weekdays ?? [],
    after: input.after
  });
}

export function buildReminderListReply(reminders: ScheduledReminderRecord[]): string {
  const visible = reminders.filter(
    (reminder) => !(reminder.repeat_kind === "once" && reminder.last_fired_at)
  );

  if (visible.length === 0) {
    return `No active reminders yet.

Try: remind me to call mum at 6pm
Or: remind me to drink water in 15 minutes`;
  }

  const lines = visible.map((reminder, index) => {
    const clock =
      reminder.repeat_hour !== null && reminder.repeat_minute !== null
        ? formatClockTime(reminder.repeat_hour, reminder.repeat_minute)
        : formatMauritiusDateTime(new Date(reminder.next_fire_at));

    return `${index + 1}. ${reminder.label} — ${repeatSummary(reminder)} at ${clock}
   Next: ${formatMauritiusDateTime(new Date(reminder.next_fire_at))}`;
  });

  return `Your reminders

${lines.join("\n\n")}

Cancel with: cancel reminder 1`;
}

export function buildReminderCreatedReply(reminder: ScheduledReminderRecord): string {
  const clock =
    reminder.repeat_hour !== null && reminder.repeat_minute !== null
      ? formatClockTime(reminder.repeat_hour, reminder.repeat_minute)
      : formatMauritiusDateTime(new Date(reminder.next_fire_at));

  return `Reminder set: ${reminder.label}
Schedule: ${repeatSummary(reminder)} at ${clock}
Next ping: ${formatMauritiusDateTime(new Date(reminder.next_fire_at))}

Reply my reminders anytime to see your list.`;
}

export async function listActiveReminders(userId: string): Promise<ScheduledReminderRecord[]> {
  const { data, error } = await supabase
    .from("scheduled_reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list reminders: ${error.message}`);
  }

  return (data ?? []).map((row) => mapReminder(row as Record<string, unknown>));
}

async function countActiveReminders(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("scheduled_reminders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to count reminders: ${error.message}`);
  }

  return count ?? 0;
}

async function createReminder(input: {
  userId: string;
  label: string;
  repeatKind: ReminderRepeatKind;
  hour: number;
  minute: number;
  weekdays?: number[] | undefined;
}): Promise<ScheduledReminderRecord> {
  const now = new Date();
  const nextFireAt = computeNextFireAt({
    repeatKind: input.repeatKind,
    hour: input.hour,
    minute: input.minute,
    weekdays: input.weekdays,
    after: now
  });

  const { data, error } = await supabase
    .from("scheduled_reminders")
    .insert({
      user_id: input.userId,
      label: input.label,
      next_fire_at: nextFireAt.toISOString(),
      repeat_kind: input.repeatKind,
      repeat_hour: input.hour,
      repeat_minute: input.minute,
      repeat_weekdays: input.weekdays ?? null,
      timezone: MAURITIUS_TIMEZONE,
      status: "active"
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create reminder: ${error.message}`);
  }

  return mapReminder(data as Record<string, unknown>);
}

async function createRelativeReminder(input: {
  userId: string;
  label: string;
  delayMinutes: number;
}): Promise<ScheduledReminderRecord> {
  const nextFireAt = new Date(Date.now() + input.delayMinutes * 60 * 1000);

  const { data, error } = await supabase
    .from("scheduled_reminders")
    .insert({
      user_id: input.userId,
      label: input.label,
      next_fire_at: nextFireAt.toISOString(),
      repeat_kind: "once",
      repeat_hour: null,
      repeat_minute: null,
      repeat_weekdays: null,
      timezone: MAURITIUS_TIMEZONE,
      status: "active"
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create reminder: ${error.message}`);
  }

  return mapReminder(data as Record<string, unknown>);
}

async function cancelReminderByIndex(userId: string, index: number): Promise<ScheduledReminderRecord | null> {
  const reminders = await listActiveReminders(userId);
  const target = reminders[index - 1];
  if (!target) {
    return null;
  }

  const { data, error } = await supabase
    .from("scheduled_reminders")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString()
    })
    .eq("id", target.id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to cancel reminder: ${error.message}`);
  }

  return mapReminder(data as Record<string, unknown>);
}

async function loadRecentActionReminder(userId: string): Promise<ScheduledReminderRecord | null> {
  const cutoff = new Date(Date.now() - RECENT_ACTION_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("scheduled_reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("last_fired_at", "is", null)
    .gte("last_fired_at", cutoff)
    .order("last_fired_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load recent reminder: ${error.message}`);
  }

  return data ? mapReminder(data as Record<string, unknown>) : null;
}

async function updateReminder(
  reminderId: string,
  patch: Partial<{
    next_fire_at: string;
    status: string;
    last_fired_at: string | null;
  }>
): Promise<ScheduledReminderRecord> {
  const { data, error } = await supabase
    .from("scheduled_reminders")
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq("id", reminderId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update reminder: ${error.message}`);
  }

  return mapReminder(data as Record<string, unknown>);
}

async function advanceReminderAfterAction(reminder: ScheduledReminderRecord): Promise<ScheduledReminderRecord> {
  if (reminder.repeat_kind === "once") {
    return updateReminder(reminder.id, {
      status: "completed"
    });
  }

  const hour = reminder.repeat_hour ?? 0;
  const minute = reminder.repeat_minute ?? 0;
  const nextFireAt = computeNextFireAt({
    repeatKind: reminder.repeat_kind,
    hour,
    minute,
    weekdays: reminder.repeat_weekdays ?? undefined,
    after: new Date()
  });

  return updateReminder(reminder.id, {
    next_fire_at: nextFireAt.toISOString()
  });
}

export async function handleReminderMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<ReminderCommandResult> {
  if (!env.REMINDERS_ENABLED) {
    return { handled: false };
  }

  const command = parseReminderCommand(input.message);
  if (!command) {
    if (looksLikeReminderAttempt(input.message)) {
      return {
        handled: true,
        reply: buildReminderParseFailureReply()
      };
    }

    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      reply: "Finish onboarding first, then you can set reminders here."
    };
  }

  if (!isReminderEligible(input.user)) {
    return {
      handled: true,
      reply: "Reminders are part of your Mauri trial or subscription. Reply pay to unlock access."
    };
  }

  if (command.type === "list") {
    const reminders = await listActiveReminders(input.user.id);
    return {
      handled: true,
      reply: buildReminderListReply(reminders)
    };
  }

  if (command.type === "cancel") {
    const cancelled = await cancelReminderByIndex(input.user.id, command.index);
    if (!cancelled) {
      const reminders = await listActiveReminders(input.user.id);
      return {
        handled: true,
        reply:
          reminders.length === 0
            ? "You have no active reminders to cancel."
            : `No reminder #${command.index}. Reply my reminders to see your list.`
      };
    }

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "reminder_cancelled",
      userId: input.user.id,
      entityType: "scheduled_reminder",
      entityId: cancelled.id,
      message: "User cancelled a scheduled reminder.",
      metadata: { label: cancelled.label }
    });

    return {
      handled: true,
      reply: `Cancelled reminder: ${cancelled.label}`
    };
  }

  if (command.type === "done" || command.type === "skip") {
    const reminder = await loadRecentActionReminder(input.user.id);
    if (!reminder) {
      return {
        handled: true,
        reply: "I don't see a recent reminder to act on. Reply my reminders to check what's scheduled."
      };
    }

    const updated = await advanceReminderAfterAction(reminder);

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: command.type === "done" ? "reminder_done" : "reminder_skipped",
      userId: input.user.id,
      entityType: "scheduled_reminder",
      entityId: reminder.id,
      message: command.type === "done" ? "User marked reminder done." : "User skipped reminder.",
      metadata: { label: reminder.label }
    });

    if (command.type === "skip") {
      return {
        handled: true,
        reply:
          updated.status === "completed"
            ? `Skipped. "${reminder.label}" is cleared.`
            : `Skipped. Next ping: ${formatMauritiusDateTime(new Date(updated.next_fire_at))}`
      };
    }

    return {
      handled: true,
      reply:
        updated.status === "completed"
          ? `Done. "${reminder.label}" is cleared.`
          : `Done. Next ping: ${formatMauritiusDateTime(new Date(updated.next_fire_at))}`
    };
  }

  if (command.type === "snooze") {
    const reminder = await loadRecentActionReminder(input.user.id);
    if (!reminder) {
      return {
        handled: true,
        reply: "I don't see a recent reminder to snooze. Reply my reminders to check what's scheduled."
      };
    }

    const snoozeUntil = new Date(Date.now() + command.minutes * 60 * 1000);
    const updated = await updateReminder(reminder.id, {
      next_fire_at: snoozeUntil.toISOString()
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "reminder_snoozed",
      userId: input.user.id,
      entityType: "scheduled_reminder",
      entityId: reminder.id,
      message: "User snoozed a reminder.",
      metadata: { label: reminder.label, minutes: command.minutes }
    });

    return {
      handled: true,
      reply: `Snoozed "${reminder.label}" until ${formatMauritiusDateTime(new Date(updated.next_fire_at))}.`
    };
  }

  const activeCount = await countActiveReminders(input.user.id);
  if (activeCount >= MAX_ACTIVE_REMINDERS) {
    return {
      handled: true,
      reply: `You already have ${MAX_ACTIVE_REMINDERS} active reminders. Cancel one first with: cancel reminder 1`
    };
  }

  if (command.type === "create_relative") {
    const reminder = await createRelativeReminder({
      userId: input.user.id,
      label: command.label,
      delayMinutes: command.delayMinutes
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "reminder_created",
      userId: input.user.id,
      entityType: "scheduled_reminder",
      entityId: reminder.id,
      message: "User created a relative scheduled reminder.",
      metadata: {
        label: reminder.label,
        repeat_kind: reminder.repeat_kind,
        delay_minutes: command.delayMinutes,
        next_fire_at: reminder.next_fire_at
      }
    });

    return {
      handled: true,
      reply: buildReminderCreatedReply(reminder)
    };
  }

  const reminder = await createReminder({
    userId: input.user.id,
    label: command.label,
    repeatKind: command.repeatKind,
    hour: command.hour,
    minute: command.minute,
    weekdays: command.weekdays
  });

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "reminder_created",
    userId: input.user.id,
    entityType: "scheduled_reminder",
    entityId: reminder.id,
    message: "User created a scheduled reminder.",
    metadata: {
      label: reminder.label,
      repeat_kind: reminder.repeat_kind,
      next_fire_at: reminder.next_fire_at
    }
  });

  return {
    handled: true,
    reply: buildReminderCreatedReply(reminder)
  };
}

export async function markReminderDelivered(reminder: ScheduledReminderRecord): Promise<ScheduledReminderRecord> {
  const now = new Date();

  if (reminder.repeat_kind === "once") {
    return updateReminder(reminder.id, {
      last_fired_at: now.toISOString(),
      next_fire_at: ONCE_REMINDER_ACK_HOLD_UNTIL
    });
  }

  const hour = reminder.repeat_hour ?? 0;
  const minute = reminder.repeat_minute ?? 0;
  const nextFireAt = computeNextFireAt({
    repeatKind: reminder.repeat_kind,
    hour,
    minute,
    weekdays: reminder.repeat_weekdays ?? undefined,
    after: now
  });

  return updateReminder(reminder.id, {
    last_fired_at: now.toISOString(),
    next_fire_at: nextFireAt.toISOString()
  });
}
