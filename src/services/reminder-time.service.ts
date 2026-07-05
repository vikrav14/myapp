import { env } from "../lib/env.js";

export const MAURITIUS_TIMEZONE = env.MORNING_BRIEF_TIMEZONE;

export interface MauritiusLocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

export function weekdayName(index: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index] ?? "Day";
}

export function getMauritiusLocalParts(date: Date): MauritiusLocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MAURITIUS_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short"
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    weekday: WEEKDAY_INDEX[String(lookup.weekday ?? "sun").toLowerCase()] ?? 0
  };
}

export function mauritiusLocalToUtc(local: Pick<MauritiusLocalParts, "year" | "month" | "day" | "hour" | "minute">): Date {
  return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour - 4, local.minute, 0));
}

export function addDaysToLocal(local: MauritiusLocalParts, days: number): MauritiusLocalParts {
  const utc = mauritiusLocalToUtc(local);
  utc.setUTCDate(utc.getUTCDate() + days);
  return getMauritiusLocalParts(utc);
}

export function parseClockTime(token: string): { hour: number; minute: number } | null {
  const normalized = token
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d{1,2})\.(\d{2})/g, "$1:$2");
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (minute > 59 || hour > 24) {
    return null;
  }

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }

  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  if (!meridiem && hour === 24) {
    hour = 0;
  }

  if (hour > 23) {
    return null;
  }

  return { hour, minute };
}

export function parseWeekdayTokens(text: string): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const weekdays = tokens
    .map((token) => WEEKDAY_INDEX[token])
    .filter((value): value is number => value !== undefined);

  return [...new Set(weekdays)].sort((left, right) => left - right);
}

export function formatMauritiusDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MAURITIUS_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

export function formatClockTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minuteText = minute.toString().padStart(2, "0");
  return `${hour12}:${minuteText}${suffix}`;
}

export function computeNextWeeklyFireAt(input: {
  hour: number;
  minute: number;
  weekdays: number[];
  after: Date;
}): Date {
  const afterLocal = getMauritiusLocalParts(input.after);
  for (let offset = 0; offset < 14; offset += 1) {
    const candidateLocal = addDaysToLocal(afterLocal, offset);
    if (!input.weekdays.includes(candidateLocal.weekday)) {
      continue;
    }

    const candidate = mauritiusLocalToUtc({
      year: candidateLocal.year,
      month: candidateLocal.month,
      day: candidateLocal.day,
      hour: input.hour,
      minute: input.minute
    });

    if (candidate.getTime() > input.after.getTime()) {
      return candidate;
    }
  }

  throw new Error("Could not compute next weekly reminder time.");
}

export function computeNextOnceFireAt(input: {
  hour: number;
  minute: number;
  after: Date;
}): Date {
  const afterLocal = getMauritiusLocalParts(input.after);

  for (let offset = 0; offset < 2; offset += 1) {
    const candidateLocal = addDaysToLocal(afterLocal, offset);
    const candidate = mauritiusLocalToUtc({
      year: candidateLocal.year,
      month: candidateLocal.month,
      day: candidateLocal.day,
      hour: input.hour,
      minute: input.minute
    });

    if (candidate.getTime() > input.after.getTime()) {
      return candidate;
    }
  }

  const tomorrowLocal = addDaysToLocal(afterLocal, 1);
  return mauritiusLocalToUtc({
    year: tomorrowLocal.year,
    month: tomorrowLocal.month,
    day: tomorrowLocal.day,
    hour: input.hour,
    minute: input.minute
  });
}

export function computeNextDailyFireAt(input: {
  hour: number;
  minute: number;
  after: Date;
  weekdaysOnly?: boolean;
}): Date {
  const afterLocal = getMauritiusLocalParts(input.after);

  for (let offset = 0; offset < 14; offset += 1) {
    const candidateLocal = addDaysToLocal(afterLocal, offset);
    if (input.weekdaysOnly && (candidateLocal.weekday === 0 || candidateLocal.weekday === 6)) {
      continue;
    }

    const candidate = mauritiusLocalToUtc({
      year: candidateLocal.year,
      month: candidateLocal.month,
      day: candidateLocal.day,
      hour: input.hour,
      minute: input.minute
    });

    if (candidate.getTime() > input.after.getTime()) {
      return candidate;
    }
  }

  throw new Error("Could not compute next daily reminder time.");
}
