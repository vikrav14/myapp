import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { getMauritiusLocalParts } from "./reminder-time.service.js";
import { recordEngagementDelivery } from "./engagement-delivery.service.js";

export type ProactiveOutboundFlow = "proactive_checkin" | "memory_resurface" | "open_loop_followup";

export type ProactiveOutboundBlockReason = "paused" | "quiet_hours" | "daily_budget";

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

  const sentToday = await countProactivePingsToday(user.id);
  if (sentToday >= env.PROACTIVE_DAILY_BUDGET) {
    return { allowed: false, reason: "daily_budget" };
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

  return [
    "Proactive ping settings",
    "",
    `Quiet hours: ${quiet ? "on" : "off"}${quiet ? ` (${formatQuietHoursWindow(user)})` : ""}`,
    `Paused: ${paused ? `yes until ${user.proactive_checkins_paused_until?.slice(0, 16).replace("T", " ")}` : "no"}`,
    `Today's unprompted pings: ${sentToday}/${env.PROACTIVE_DAILY_BUDGET}`,
    "",
    "Commands: quiet hours on/off · not now (pause 7 days)"
  ].join("\n");
}
