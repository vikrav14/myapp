import { env } from "../lib/env.js";
import { supabase } from "../lib/supabase.js";
import type { MauriUser } from "../types.js";
import { recordAuditEventBestEffort } from "./audit.service.js";
import { isReminderEligible } from "./reminder-schedule.service.js";
import {
  getMauritiusLocalParts,
  mauritiusLocalToUtc
} from "./reminder-time.service.js";
import { updateUserState } from "./user.service.js";

export interface PayCycleBounds {
  cycleStart: Date;
  nextPayday: Date;
  daysUntilPayday: number;
  daysElapsed: number;
}

export interface PayCycleSpend {
  totalSpent: number;
  entryCount: number;
  topCategory: string | null;
}

export interface FinanceCommandResult {
  handled: boolean;
  reply?: string | undefined;
  user?: MauriUser | undefined;
}

function roundRs(value: number): number {
  return Math.round(value);
}

function clampPaydayDay(day: number): number {
  return Math.min(31, Math.max(1, Math.floor(day)));
}

function buildLocalDate(local: ReturnType<typeof getMauritiusLocalParts>, day: number) {
  return mauritiusLocalToUtc({
    year: local.year,
    month: local.month,
    day,
    hour: 0,
    minute: 0
  });
}

export function getPayCycleBounds(paydayDay: number, now: Date = new Date()): PayCycleBounds {
  const day = clampPaydayDay(paydayDay);
  const local = getMauritiusLocalParts(now);
  const daysInMonth = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
  const effectivePayday = Math.min(day, daysInMonth);

  let cycleMonth = local.month;
  let cycleYear = local.year;
  if (local.day < effectivePayday) {
    cycleMonth -= 1;
    if (cycleMonth < 1) {
      cycleMonth = 12;
      cycleYear -= 1;
    }
  }

  const cycleMonthDays = new Date(Date.UTC(cycleYear, cycleMonth, 0)).getUTCDate();
  const cycleStart = buildLocalDate(
    { ...local, year: cycleYear, month: cycleMonth, day: effectivePayday },
    Math.min(day, cycleMonthDays)
  );

  let nextMonth = cycleMonth + 1;
  let nextYear = cycleYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const nextMonthDays = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const nextPayday = buildLocalDate(
    { ...local, year: nextYear, month: nextMonth, day: Math.min(day, nextMonthDays) },
    Math.min(day, nextMonthDays)
  );

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilPayday = Math.max(0, Math.ceil((nextPayday.getTime() - now.getTime()) / msPerDay));
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - cycleStart.getTime()) / msPerDay));

  return {
    cycleStart,
    nextPayday,
    daysUntilPayday,
    daysElapsed
  };
}

export async function loadPayCycleSpend(user: MauriUser, now: Date = new Date()): Promise<PayCycleSpend> {
  const since = user.payday_day_of_month
    ? getPayCycleBounds(user.payday_day_of_month, now).cycleStart.toISOString()
    : (() => {
        const local = getMauritiusLocalParts(now);
        return buildLocalDate({ ...local, day: 1 }, 1).toISOString();
      })();

  const { data, error } = await supabase
    .from("finance_logs")
    .select("amount, category")
    .eq("user_id", user.id)
    .gte("logged_at", since);

  if (error) {
    throw new Error(`Failed to load pay cycle spend: ${error.message}`);
  }

  const rows = data ?? [];
  const totalsByCategory = new Map<string, number>();

  for (const row of rows) {
    const category = String(row.category ?? "Other");
    totalsByCategory.set(category, (totalsByCategory.get(category) ?? 0) + Number(row.amount ?? 0));
  }

  const topCategory =
    [...totalsByCategory.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    totalSpent: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    entryCount: rows.length,
    topCategory
  };
}

export function buildPaydayRunwayReply(user: MauriUser, spend: PayCycleSpend, now: Date = new Date()): string {
  const name = user.first_name?.trim() || "there";

  if (!user.payday_day_of_month) {
    return `${name}, set your payday first.

Example: payday 25
Optional: salary 25000

Then reply my runway.`;
  }

  const bounds = getPayCycleBounds(user.payday_day_of_month, now);
  const dailyBurn = spend.totalSpent / bounds.daysElapsed;
  const projectedSpend = dailyBurn * (bounds.daysElapsed + bounds.daysUntilPayday);
  const income = user.monthly_income_rs;

  let body = `Payday runway

Payday in ${bounds.daysUntilPayday} day${bounds.daysUntilPayday === 1 ? "" : "s"}.
This cycle: Rs ${roundRs(spend.totalSpent)} spent across ${spend.entryCount} log${spend.entryCount === 1 ? "" : "s"}.`;

  if (spend.topCategory) {
    body += `\nTop category: ${spend.topCategory}.`;
  }

  body += `\nDaily pace: ~Rs ${roundRs(dailyBurn)}/day.`;

  if (income && income > 0) {
    const breathingRoom = income - projectedSpend;
    if (breathingRoom >= 0) {
      body += `\n\nAt this pace you'll have about Rs ${roundRs(breathingRoom)} breathing room before payday.`;
    } else {
      body += `\n\nAt this pace you're tracking ~Rs ${roundRs(Math.abs(breathingRoom))} over your Rs ${roundRs(income)} income before payday. Slow down or move something.`;
    }
  } else {
    body += `\n\nSet salary 25000 (or your real take-home) to see breathing-room Rs.`;
  }

  body += "\n\nSnap receipts or brain-dump spending — I'll keep the runway live.";
  return body;
}

export function buildPaydayRunwaySnippet(user: MauriUser, spend: PayCycleSpend, now: Date = new Date()): string {
  if (!user.payday_day_of_month || !env.PAYDAY_RUNWAY_ENABLED) {
    return "";
  }

  const bounds = getPayCycleBounds(user.payday_day_of_month, now);
  const dailyBurn = spend.totalSpent / bounds.daysElapsed;

  if (user.monthly_income_rs && user.monthly_income_rs > 0) {
    const projectedSpend = dailyBurn * (bounds.daysElapsed + bounds.daysUntilPayday);
    const breathingRoom = user.monthly_income_rs - projectedSpend;
    if (breathingRoom >= 0) {
      return `Payday in ${bounds.daysUntilPayday}d — ~Rs ${roundRs(breathingRoom)} breathing room at this pace.`;
    }

    return `Payday in ${bounds.daysUntilPayday}d — pace is ~Rs ${roundRs(Math.abs(breathingRoom))} over income.`;
  }

  return `Payday in ${bounds.daysUntilPayday} day${bounds.daysUntilPayday === 1 ? "" : "s"}.`;
}

export function parseFinanceCommand(
  message: string
):
  | { type: "runway" }
  | { type: "setPayday"; day: number }
  | { type: "setSalary"; amount: number }
  | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "my runway" ||
    normalized === "payday runway" ||
    normalized === "runway" ||
    normalized === "till payday"
  ) {
    return { type: "runway" };
  }

  const paydayMatch = normalized.match(/^(?:set payday|payday)\s+(\d{1,2})$/);
  if (paydayMatch?.[1]) {
    const day = Number(paydayMatch[1]);
    if (day >= 1 && day <= 31) {
      return { type: "setPayday", day };
    }
  }

  const salaryMatch = normalized.match(/^(?:salary|income|set salary)\s+(\d+(?:\.\d+)?)$/);
  if (salaryMatch?.[1]) {
    return { type: "setSalary", amount: Number(salaryMatch[1]) };
  }

  return null;
}

export async function handleFinanceCommandMessage(input: {
  user: MauriUser;
  message: string;
  requestId?: string | undefined;
}): Promise<FinanceCommandResult> {
  if (!env.PAYDAY_RUNWAY_ENABLED) {
    return { handled: false };
  }

  const command = parseFinanceCommand(input.message);
  if (!command) {
    return { handled: false };
  }

  if (input.user.onboarding_state !== "active") {
    return {
      handled: true,
      user: input.user,
      reply: "Finish onboarding first, then you can track your payday runway here."
    };
  }

  if (!isReminderEligible(input.user)) {
    return {
      handled: true,
      user: input.user,
      reply: "Payday runway is part of your Mauri trial or subscription. Reply pay to unlock access."
    };
  }

  if (command.type === "setPayday") {
    const updatedUser = await updateUserState(input.user.id, {
      payday_day_of_month: command.day
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "payday_day_updated",
      userId: updatedUser.id,
      entityType: "user",
      entityId: updatedUser.id,
      message: "User updated payday day.",
      metadata: { payday_day_of_month: command.day }
    });

    return {
      handled: true,
      user: updatedUser,
      reply: `Payday set to the ${command.day}${command.day === 1 ? "st" : command.day === 2 ? "nd" : command.day === 3 ? "rd" : "th"} of each month.

Optional: salary 25000
Then: my runway`
    };
  }

  if (command.type === "setSalary") {
    const updatedUser = await updateUserState(input.user.id, {
      monthly_income_rs: command.amount
    });

    await recordAuditEventBestEffort({
      requestId: input.requestId,
      eventType: "monthly_income_updated",
      userId: updatedUser.id,
      entityType: "user",
      entityId: updatedUser.id,
      message: "User updated monthly income.",
      metadata: { monthly_income_rs: command.amount }
    });

    const spend = await loadPayCycleSpend(updatedUser);
    const runway = buildPaydayRunwayReply(updatedUser, spend);

    return {
      handled: true,
      user: updatedUser,
      reply: `Monthly income set to Rs ${roundRs(command.amount)}.\n\n${runway}`
    };
  }

  const spend = await loadPayCycleSpend(input.user);
  return {
    handled: true,
    user: input.user,
    reply: buildPaydayRunwayReply(input.user, spend)
  };
}
