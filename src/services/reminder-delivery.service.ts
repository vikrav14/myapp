import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { mapUser } from "./user.service.js";
import {
  isReminderEligible,
  markReminderDelivered,
  type ScheduledReminderRecord
} from "./reminder-schedule.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

function mapReminder(row: Record<string, unknown>): ScheduledReminderRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    label: String(row.label),
    next_fire_at: String(row.next_fire_at),
    repeat_kind: row.repeat_kind as ScheduledReminderRecord["repeat_kind"],
    repeat_hour: row.repeat_hour === null || row.repeat_hour === undefined ? null : Number(row.repeat_hour),
    repeat_minute:
      row.repeat_minute === null || row.repeat_minute === undefined ? null : Number(row.repeat_minute),
    repeat_weekdays: Array.isArray(row.repeat_weekdays)
      ? row.repeat_weekdays.map((value) => Number(value))
      : null,
    timezone: String(row.timezone ?? env.MORNING_BRIEF_TIMEZONE),
    status: String(row.status),
    last_fired_at: row.last_fired_at ? String(row.last_fired_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export function buildReminderDeliveryMessage(reminder: ScheduledReminderRecord): string {
  return `⏰ Reminder: ${reminder.label}

Reply done · skip · snooze 1h`;
}

export async function listDueReminders(now: Date = new Date()): Promise<
  Array<{
    reminder: ScheduledReminderRecord;
    user: MauriUser;
  }>
> {
  const { data, error } = await supabase
    .from("scheduled_reminders")
    .select("*, users(*)")
    .eq("status", "active")
    .lte("next_fire_at", now.toISOString())
    .order("next_fire_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(`Failed to load due reminders: ${error.message}`);
  }

  const due: Array<{ reminder: ScheduledReminderRecord; user: MauriUser }> = [];

  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    const userRecord = record.users as Record<string, unknown> | null;
    if (!userRecord) {
      continue;
    }

    const user = mapUser(userRecord);
    if (!isReminderEligible(user)) {
      continue;
    }

    due.push({
      reminder: mapReminder(record),
      user
    });
  }

  return due;
}

export async function deliverDueReminders(requestId?: string): Promise<{
  due: number;
  sent: number;
  failed: number;
}> {
  const dueItems = await listDueReminders();
  let sent = 0;
  let failed = 0;

  for (const item of dueItems) {
    const message = buildReminderDeliveryMessage(item.reminder);

    try {
      await sendWhatsAppMessage(item.user.phone_number, message, {
        userId: item.user.id,
        requestId,
        metadata: {
          flow: "scheduled_reminder",
          reminderId: item.reminder.id,
          repeatKind: item.reminder.repeat_kind
        }
      });

      await markReminderDelivered(item.reminder);
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        {
          error,
          reminderId: item.reminder.id,
          userId: item.user.id
        },
        "Failed to deliver scheduled reminder."
      );
    }
  }

  if (dueItems.length > 0) {
    logger.info({ due: dueItems.length, sent, failed }, "Scheduled reminder delivery run completed.");
  }

  return {
    due: dueItems.length,
    sent,
    failed
  };
}
