import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { formatCalendarEventWhen } from "./calendar-time.service.js";
import type { CalendarEventRecord } from "./calendar.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { mapUser } from "./user.service.js";
import { sendWhatsAppMessage } from "./whatsapp.service.js";

function mapEvent(row: Record<string, unknown>): CalendarEventRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    connection_id: row.connection_id ? String(row.connection_id) : null,
    title: String(row.title),
    starts_at: String(row.starts_at),
    ends_at: row.ends_at ? String(row.ends_at) : null,
    source: row.source as CalendarEventRecord["source"],
    external_uid: row.external_uid ? String(row.external_uid) : null,
    location: row.location ? String(row.location) : null,
    reminder_lead_minutes: Number(row.reminder_lead_minutes ?? 30),
    pre_reminder_sent_at: row.pre_reminder_sent_at ? String(row.pre_reminder_sent_at) : null,
    status: String(row.status),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export function buildCalendarPreEventMessage(event: CalendarEventRecord): string {
  const when = formatCalendarEventWhen(new Date(event.starts_at));
  const locationLine = event.location ? `\nWhere: ${event.location}` : "";
  return `📅 Coming up: ${event.title}
${when}${locationLine}

Reply my calendar to see the rest of your week.`;
}

export function buildTodoDueMessage(taskDescription: string, dueAt: Date): string {
  return `📌 Due soon: ${taskDescription}
When: ${formatCalendarEventWhen(dueAt)}

Reply done when it's handled, or tell me if you need to push it.`;
}

export async function listDueCalendarPreReminders(now: Date = new Date()): Promise<
  Array<{
    event: CalendarEventRecord;
    user: MauriUser;
  }>
> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select("*, users(*)")
    .eq("status", "active")
    .is("pre_reminder_sent_at", null)
    .order("starts_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(`Failed to load calendar pre-reminders: ${error.message}`);
  }

  const due: Array<{ event: CalendarEventRecord; user: MauriUser }> = [];

  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    const event = mapEvent(record);
    const leadMs = event.reminder_lead_minutes * 60 * 1000;
    const fireAt = new Date(new Date(event.starts_at).getTime() - leadMs);
    if (fireAt.getTime() > now.getTime()) {
      continue;
    }

    if (new Date(event.starts_at).getTime() < now.getTime() - 5 * 60 * 1000) {
      continue;
    }

    const userRecord = record.users as Record<string, unknown> | null;
    if (!userRecord || userRecord.calendar_sync_enabled === false) {
      continue;
    }

    const user = mapUser(userRecord);
    if (!isReminderEligible(user)) {
      continue;
    }

    due.push({ event, user });
  }

  return due;
}

export async function listDueTodoReminders(now: Date = new Date()): Promise<
  Array<{
    todoId: string;
    user: MauriUser;
    taskDescription: string;
    dueAt: Date;
  }>
> {
  const horizon = new Date(now.getTime() + env.CALENDAR_TODO_LOOKAHEAD_MINUTES * 60 * 1000);
  const { data, error } = await supabase
    .from("todo_logs")
    .select("id, task_description, due_date, user_id, users(*)")
    .eq("is_completed", false)
    .not("due_date", "is", null)
    .gte("due_date", now.toISOString())
    .lte("due_date", horizon.toISOString())
    .limit(100);

  if (error) {
    throw new Error(`Failed to load due todos: ${error.message}`);
  }

  const due: Array<{
    todoId: string;
    user: MauriUser;
    taskDescription: string;
    dueAt: Date;
  }> = [];

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

    const todoId = String(record.id);
    const { data: existingPing } = await supabase
      .from("engagement_deliveries")
      .select("id")
      .eq("user_id", user.id)
      .eq("delivery_key", `todo_due_${todoId}`)
      .maybeSingle();

    if (existingPing) {
      continue;
    }

    due.push({
      todoId,
      user,
      taskDescription: String(record.task_description),
      dueAt: new Date(String(record.due_date))
    });
  }

  return due;
}

export async function deliverCalendarPreReminders(requestId?: string): Promise<{
  due: number;
  sent: number;
  failed: number;
}> {
  const dueItems = await listDueCalendarPreReminders();
  let sent = 0;
  let failed = 0;

  for (const item of dueItems) {
    const message = buildCalendarPreEventMessage(item.event);

    try {
      await sendWhatsAppMessage(item.user.phone_number, message, {
        userId: item.user.id,
        requestId,
        metadata: {
          flow: "calendar_pre_event",
          eventId: item.event.id
        }
      });

      await supabase
        .from("calendar_events")
        .update({
          pre_reminder_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", item.event.id);

      sent += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        {
          error,
          eventId: item.event.id,
          userId: item.user.id
        },
        "Failed to deliver calendar pre-event reminder."
      );
    }
  }

  return { due: dueItems.length, sent, failed };
}

export async function deliverTodoDueReminders(requestId?: string): Promise<{
  due: number;
  sent: number;
  failed: number;
}> {
  const dueItems = await listDueTodoReminders();
  let sent = 0;
  let failed = 0;

  for (const item of dueItems) {
    const message = buildTodoDueMessage(item.taskDescription, item.dueAt);

    try {
      await sendWhatsAppMessage(item.user.phone_number, message, {
        userId: item.user.id,
        requestId,
        metadata: {
          flow: "todo_due_reminder",
          todoId: item.todoId
        }
      });

      await supabase.from("engagement_deliveries").insert({
        user_id: item.user.id,
        delivery_key: `todo_due_${item.todoId}`
      });

      sent += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        {
          error,
          todoId: item.todoId,
          userId: item.user.id
        },
        "Failed to deliver todo due reminder."
      );
    }
  }

  return { due: dueItems.length, sent, failed };
}

export async function deliverCalendarNotifications(requestId?: string): Promise<{
  calendar: { due: number; sent: number; failed: number };
  todos: { due: number; sent: number; failed: number };
}> {
  const [calendar, todos] = await Promise.all([
    deliverCalendarPreReminders(requestId),
    deliverTodoDueReminders(requestId)
  ]);

  if (calendar.due > 0 || todos.due > 0) {
    logger.info({ calendar, todos }, "Calendar notification delivery completed.");
  }

  return { calendar, todos };
}
