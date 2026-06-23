import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { parseCalendarCommand } from "./calendar-parse.service.js";
import { formatCalendarEventWhen, parseCalendarSchedule } from "./calendar-time.service.js";
import { fetchIcalEvents } from "./ical-sync.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import { updateUserState } from "./user.service.js";

export interface CalendarConnectionRecord {
  id: string;
  user_id: string;
  ical_url: string;
  label: string;
  last_synced_at: string | null;
  sync_error: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventRecord {
  id: string;
  user_id: string;
  connection_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  source: "manual" | "ical" | "todo";
  external_uid: string | null;
  location: string | null;
  reminder_lead_minutes: number;
  pre_reminder_sent_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

const MAX_UPCOMING_EVENTS = 20;

function mapConnection(row: Record<string, unknown>): CalendarConnectionRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    ical_url: String(row.ical_url),
    label: String(row.label ?? "Calendar"),
    last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
    sync_error: row.sync_error ? String(row.sync_error) : null,
    status: String(row.status),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

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

function startOfMauritiusDay(date: Date): Date {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  return new Date(`${local}T00:00:00+04:00`);
}

function endOfMauritiusWeek(date: Date): Date {
  const start = startOfMauritiusDay(date);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function buildCalendarListReply(events: CalendarEventRecord[], scope: "all" | "today" | "week"): string {
  if (events.length === 0) {
    if (scope === "today") {
      return "Nothing on your calendar today.\n\nAdd one: calendar add team sync on friday at 3pm";
    }

    if (scope === "week") {
      return "Nothing on your calendar this week.\n\nAdd one: calendar add dentist on tue at 10am";
    }

    return `No upcoming calendar events.

Try: calendar add meeting with boss on friday at 3pm
Or connect Google/Apple via: connect calendar <ical-url>`;
  }

  const heading =
    scope === "today" ? "Today" : scope === "week" ? "This week" : "Upcoming";
  const lines = events.map((event, index) => {
    const when = formatCalendarEventWhen(new Date(event.starts_at));
    const sourceTag = event.source === "ical" ? " [synced]" : event.source === "todo" ? " [todo]" : "";
    return `${index + 1}. ${event.title}${sourceTag}\n   ${when}`;
  });

  return `${heading}

${lines.join("\n\n")}

Cancel with: cancel event 1`;
}

export async function listUpcomingEvents(
  userId: string,
  scope: "all" | "today" | "week" = "all"
): Promise<CalendarEventRecord[]> {
  const now = new Date();
  let upperBound: Date | null = null;
  let lowerBound = now;

  if (scope === "today") {
    lowerBound = startOfMauritiusDay(now);
    upperBound = new Date(lowerBound.getTime() + 24 * 60 * 60 * 1000);
  } else if (scope === "week") {
    lowerBound = startOfMauritiusDay(now);
    upperBound = endOfMauritiusWeek(now);
  }

  let query = supabase
    .from("calendar_events")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .gte("starts_at", lowerBound.toISOString())
    .order("starts_at", { ascending: true })
    .limit(MAX_UPCOMING_EVENTS);

  if (upperBound) {
    query = query.lt("starts_at", upperBound.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list calendar events: ${error.message}`);
  }

  return (data ?? []).map((row) => mapEvent(row as Record<string, unknown>));
}

async function createManualEvent(input: {
  userId: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
}): Promise<CalendarEventRecord> {
  const { data, error } = await supabase
    .from("calendar_events")
    .insert({
      user_id: input.userId,
      title: input.title,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt?.toISOString() ?? null,
      source: "manual",
      status: "active"
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create calendar event: ${error.message}`);
  }

  return mapEvent(data as Record<string, unknown>);
}

async function cancelEventByIndex(userId: string, index: number): Promise<CalendarEventRecord | null> {
  const events = await listUpcomingEvents(userId, "all");
  const target = events[index - 1];
  if (!target) {
    return null;
  }

  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString()
    })
    .eq("id", target.id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to cancel calendar event: ${error.message}`);
  }

  return mapEvent(data as Record<string, unknown>);
}

async function upsertConnection(input: {
  userId: string;
  icalUrl: string;
}): Promise<CalendarConnectionRecord> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .upsert(
      {
        user_id: input.userId,
        ical_url: input.icalUrl,
        label: "Calendar",
        status: "active",
        sync_error: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,ical_url" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save calendar connection: ${error.message}`);
  }

  return mapConnection(data as Record<string, unknown>);
}

async function disconnectCalendar(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .update({
      status: "disconnected",
      updated_at: new Date().toISOString()
    })
    .eq("user_id", userId)
    .eq("status", "active")
    .select("id");

  if (error) {
    throw new Error(`Failed to disconnect calendar: ${error.message}`);
  }

  return data?.length ?? 0;
}

export async function syncUserCalendarConnection(connection: CalendarConnectionRecord): Promise<{
  imported: number;
  updated: number;
}> {
  const events = await fetchIcalEvents(connection.ical_url);
  const now = new Date();
  let imported = 0;
  let updated = 0;

  for (const event of events) {
    if (event.startsAt.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from("calendar_events")
      .select("id")
      .eq("user_id", connection.user_id)
      .eq("external_uid", event.uid)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to look up synced event: ${existingError.message}`);
    }

    const payload = {
      user_id: connection.user_id,
      connection_id: connection.id,
      title: event.title,
      starts_at: event.startsAt.toISOString(),
      ends_at: event.endsAt?.toISOString() ?? null,
      source: "ical" as const,
      external_uid: event.uid,
      location: event.location,
      status: "active",
      updated_at: new Date().toISOString()
    };

    if (existing) {
      const { error } = await supabase.from("calendar_events").update(payload).eq("id", existing.id);
      if (error) {
        throw new Error(`Failed to update synced event: ${error.message}`);
      }
      updated += 1;
    } else {
      const { error } = await supabase.from("calendar_events").insert(payload);
      if (error) {
        throw new Error(`Failed to import synced event: ${error.message}`);
      }
      imported += 1;
    }
  }

  const { error: connectionError } = await supabase
    .from("calendar_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      sync_error: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", connection.id);

  if (connectionError) {
    throw new Error(`Failed to update calendar connection: ${connectionError.message}`);
  }

  return { imported, updated };
}

export async function syncUserCalendars(userId: string): Promise<{ connections: number; imported: number; updated: number }> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to load calendar connections: ${error.message}`);
  }

  const connections = (data ?? []).map((row) => mapConnection(row as Record<string, unknown>));
  let imported = 0;
  let updated = 0;

  for (const connection of connections) {
    try {
      const result = await syncUserCalendarConnection(connection);
      imported += result.imported;
      updated += result.updated;
    } catch (syncError) {
      await supabase
        .from("calendar_connections")
        .update({
          sync_error: syncError instanceof Error ? syncError.message : "sync failed",
          updated_at: new Date().toISOString()
        })
        .eq("id", connection.id);
      throw syncError;
    }
  }

  return { connections: connections.length, imported, updated };
}

export async function syncAllActiveCalendars(): Promise<{ users: number; imported: number; updated: number; failed: number }> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select("*, users!inner(*)")
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to load active calendar connections: ${error.message}`);
  }

  let users = 0;
  let imported = 0;
  let updated = 0;
  let failed = 0;
  const seenUsers = new Set<string>();

  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    const connection = mapConnection(record);
    const userRecord = record.users as Record<string, unknown> | undefined;
    if (!userRecord || userRecord.calendar_sync_enabled === false) {
      continue;
    }

    seenUsers.add(connection.user_id);
    try {
      const result = await syncUserCalendarConnection(connection);
      imported += result.imported;
      updated += result.updated;
    } catch {
      failed += 1;
    }
  }

  users = seenUsers.size;
  return { users, imported, updated, failed };
}

export async function handleCalendarMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<CalendarCommandResult> {
  if (!env.CALENDAR_SYNC_ENABLED) {
    return { handled: false };
  }

  const command = parseCalendarCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      user: input.user,
      reply: "Finish onboarding first, then you can manage your calendar here."
    };
  }

  if (!isReminderEligible(input.user)) {
    return {
      handled: true,
      user: input.user,
      reply: "Calendar sync is part of your Mauri trial or subscription. Reply pay to unlock access."
    };
  }

  if (command.type === "toggle") {
    const updatedUser = await updateUserState(input.user.id, {
      calendar_sync_enabled: command.enabled
    });

    return {
      handled: true,
      user: updatedUser,
      reply: command.enabled
        ? "Calendar sync is on. I'll ping you before events and can import iCal feeds."
        : "Calendar sync is off. Your events stay saved, but I won't import or ping."
    };
  }

  if (command.type === "list") {
    const events = await listUpcomingEvents(input.user.id, command.scope);
    return {
      handled: true,
      user: input.user,
      reply: buildCalendarListReply(events, command.scope)
    };
  }

  if (command.type === "cancel") {
    const cancelled = await cancelEventByIndex(input.user.id, command.index);
    if (!cancelled) {
      return {
        handled: true,
        user: input.user,
        reply: `No event #${command.index}. Reply my calendar to see what's coming up.`
      };
    }

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "calendar_event_cancelled",
      userId: input.user.id,
      entityType: "calendar_event",
      entityId: cancelled.id,
      message: "User cancelled a calendar event.",
      metadata: { title: cancelled.title }
    });

    return {
      handled: true,
      user: input.user,
      reply: `Cancelled event: ${cancelled.title}`
    };
  }

  if (command.type === "connect") {
    if (!/^https?:\/\//i.test(command.url)) {
      return {
        handled: true,
        user: input.user,
        reply: "Send a full iCal URL starting with https://\n\nExample: connect calendar https://calendar.google.com/calendar/ical/.../basic.ics"
      };
    }

    const connection = await upsertConnection({
      userId: input.user.id,
      icalUrl: command.url
    });

    const syncResult = await syncUserCalendarConnection(connection);
    await updateUserState(input.user.id, { calendar_sync_enabled: true });

    return {
      handled: true,
      user: input.user,
      reply: `Calendar connected. Imported ${syncResult.imported} event(s), updated ${syncResult.updated}.

Reply my calendar to see what's coming up.`
    };
  }

  if (command.type === "disconnect") {
    const count = await disconnectCalendar(input.user.id);
    return {
      handled: true,
      user: input.user,
      reply:
        count > 0
          ? "Calendar feed disconnected. Your manual events are still saved."
          : "No active calendar feed to disconnect."
    };
  }

  if (command.type === "sync") {
    const result = await syncUserCalendars(input.user.id);
    return {
      handled: true,
      user: input.user,
      reply:
        result.connections === 0
          ? "No calendar feed connected yet.\n\nUse: connect calendar <ical-url>"
          : `Calendar synced. Imported ${result.imported}, updated ${result.updated}.`
    };
  }

  const schedule = parseCalendarSchedule(command.scheduleText);
  if (!schedule) {
    return {
      handled: true,
      user: input.user,
      reply: `Couldn't read that time.

Try: calendar add team sync on friday at 3pm
Or: calendar add dentist tomorrow at 10am`
    };
  }

  const event = await createManualEvent({
    userId: input.user.id,
    title: schedule.consumedText,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt
  });

  await recordAuditEventBestEffort({
    requestId: input.requestId,
    eventType: "calendar_event_created",
    userId: input.user.id,
    entityType: "calendar_event",
    entityId: event.id,
    message: "User created a calendar event.",
    metadata: {
      title: event.title,
      starts_at: event.starts_at
    }
  });

  return {
    handled: true,
    user: input.user,
    reply: `Event added: ${event.title}
When: ${formatCalendarEventWhen(new Date(event.starts_at))}
I'll ping you 30 minutes before.`
  };
}
