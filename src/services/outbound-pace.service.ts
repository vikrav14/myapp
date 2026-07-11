import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { getMauritiusLocalParts } from "./reminder-time.service.js";
import { recordEngagementDelivery } from "./engagement-delivery.service.js";
import { resolveNotificationConfig } from "./notification-pace.service.js";

export type ProactiveOutboundFlow = "proactive_checkin" | "memory_resurface" | "open_loop_followup";

export type ProactiveOutboundBlockReason = "paused" | "quiet_hours" | "daily_budget" | "min_interval" | "pace_silent";

export interface ProactiveOutboundGateResult {
  allowed: boolean;
  reason?: ProactiveOutboundBlockReason | undefined;
}

export function proactiveBudgetDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.MORNING_BRIEF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function isWithinQuietHours(user: MauriUser, reference = new Date()): boolean {
  if (!user.quiet_hours_enabled) {
    return false;
  }

  const { hour } = getMauritiusLocalParts(reference);
  const start = user.quiet_hours_start_hour;
  const end = user.quiet_hours_end_hour;

  if (start === end) {
    return false;
  }

  if (start < end) {
    return hour >= start && hour < end;
  }

  return hour >= start || hour < end;
}

export function isProactiveOutboundPaused(user: MauriUser, reference = new Date()): boolean {
  if (!user.proactive_checkins_paused_until) {
    return false;
  }

  return new Date(user.proactive_checkins_paused_until).getTime() > reference.getTime();
}

export function formatQuietHoursWindow(user: MauriUser): string {
  const formatHour = (hour: number) => {
    const suffix = hour >= 12 ? "pm" : "am";
    const normalized = hour % 12 === 0 ? 12 : hour % 12;
    return `${normalized}${suffix}`;
  };

  return `${formatHour(user.quiet_hours_start_hour)}–${formatHour(user.quiet_hours_end_hour)} Mauritius time`;
}

export async function countProactivePingsToday(
  userId: string,
  dateKey = proactiveBudgetDateKey()
): Promise<number> {
  const { count, error } = await supabase
    .from("engagement_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .like("delivery_key", `proactive_ping_${dateKey}_%`);

  if (error) {
    throw new Error(`Failed to count proactive pings: ${error.message}`);
  }

  return count ?? 0;
}

export async function getLastProactivePingAt(userId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from("engagement_deliveries")
    .select("created_at")
    .eq("user_id", userId)
    .like("delivery_key", "proactive_ping_%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last proactive ping: ${error.message}`);
  }

  if (!data?.created_at) {
    return null;
  }

  const parsed = new Date(String(data.created_at));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function canSendProactiveOutbound(
  user: MauriUser,
  _flow: ProactiveOutboundFlow
): Promise<ProactiveOutboundGateResult> {
  if (isProactiveOutboundPaused(user)) {
    return { allowed: false, reason: "paused" };
  }

  if (isWithinQuietHours(user)) {
    return { allowed: false, reason: "quiet_hours" };
  }

  const pace = resolveNotificationConfig(user);
  if (pace.proactive_max_per_day <= 0) {
    return { allowed: false, reason: "pace_silent" };
  }

  const sentToday = await countProactivePingsToday(user.id);
  const dailyCap = pace.proactive_max_per_day;
  if (sentToday >= dailyCap) {
    return { allowed: false, reason: "daily_budget" };
  }

  if (pace.proactive_min_interval_minutes > 0) {
    const lastPing = await getLastProactivePingAt(user.id);
    if (lastPing) {
      const elapsedMinutes = (Date.now() - lastPing.getTime()) / (60 * 1000);
      if (elapsedMinutes < pace.proactive_min_interval_minutes) {
        return { allowed: false, reason: "min_interval" };
      }
    }
  }

  return { allowed: true };
}

export async function recordProactivePing(
  userId: string,
  flow: ProactiveOutboundFlow,
  dateKey = proactiveBudgetDateKey()
): Promise<void> {
  await recordEngagementDelivery(userId, `proactive_ping_${dateKey}_${flow}_${Date.now()}`);
}

export function buildProactiveBudgetStatusReply(user: MauriUser, sentToday: number): string {
  const paused = isProactiveOutboundPaused(user);
  const quiet = user.quiet_hours_enabled;
  const pace = resolveNotificationConfig(user);

  return [
    "Proactive ping settings",
    "",
    `Pace: ${pace.proactive_preset} — ${pace.proactive_max_per_day} mate pings/day max`,
    `Quiet hours: ${quiet ? "on" : "off"}${quiet ? ` (${formatQuietHoursWindow(user)})` : ""}`,
    `Paused: ${paused ? `yes until ${user.proactive_checkins_paused_until?.slice(0, 16).replace("T", " ")}` : "no"}`,
    `Today's mate pings: ${sentToday}/${pace.proactive_max_per_day}`,
    "",
    "7am brief does not count toward pace.",
    "Commands: my pace · quiet hours on/off · not now (pause 7 days)"
  ].join("\n");
}
