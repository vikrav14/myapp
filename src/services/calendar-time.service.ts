import {
  addDaysToLocal,
  getMauritiusLocalParts,
  mauritiusLocalToUtc,
  parseClockTime,
  weekdayName
} from "./reminder-time.service.js";

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

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

function nextWeekdayOnOrAfter(local: ReturnType<typeof getMauritiusLocalParts>, weekday: number): ReturnType<typeof getMauritiusLocalParts> {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDaysToLocal(local, offset);
    if (candidate.weekday === weekday) {
      return candidate;
    }
  }

  return addDaysToLocal(local, 0);
}

function parseCalendarDatePhrase(phrase: string, after: Date): ReturnType<typeof getMauritiusLocalParts> | null {
  const normalized = phrase.trim().toLowerCase();
  const afterLocal = getMauritiusLocalParts(after);

  if (normalized === "today") {
    return afterLocal;
  }

  if (normalized === "tomorrow") {
    return addDaysToLocal(afterLocal, 1);
  }

  const weekday = WEEKDAY_INDEX[normalized];
  if (weekday !== undefined) {
    const sameDay = afterLocal.weekday === weekday;
    const base = nextWeekdayOnOrAfter(afterLocal, weekday);
    if (sameDay) {
      return base;
    }

    if (base.year === afterLocal.year && base.month === afterLocal.month && base.day === afterLocal.day) {
      return base;
    }

    return base;
  }

  const dmyMatch = normalized.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const monthToken = dmyMatch[2]?.toLowerCase();
    const month = monthToken ? MONTH_INDEX[monthToken] : undefined;
    const year = dmyMatch[3] ? Number(dmyMatch[3]) : afterLocal.year;
    if (!month || day < 1 || day > 31) {
      return null;
    }

    return { ...afterLocal, year, month, day, hour: afterLocal.hour, minute: afterLocal.minute };
  }

  const mdyMatch = normalized.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (mdyMatch) {
    const monthToken = mdyMatch[1]?.toLowerCase();
    const month = monthToken ? MONTH_INDEX[monthToken] : undefined;
    const day = Number(mdyMatch[2]);
    const year = mdyMatch[3] ? Number(mdyMatch[3]) : afterLocal.year;
    if (!month || day < 1 || day > 31) {
      return null;
    }

    return { ...afterLocal, year, month, day, hour: afterLocal.hour, minute: afterLocal.minute };
  }

  return null;
}

export function parseCalendarSchedule(
  scheduleText: string,
  after: Date = new Date()
): { startsAt: Date; endsAt: Date | null; consumedText: string } | null {
  const trimmed = scheduleText.trim();

  const onAtMatch = trimmed.match(/^(.+?)\s+on\s+(.+?)\s+at\s+(.+)$/i);
  if (onAtMatch?.[1] && onAtMatch[2] && onAtMatch[3]) {
    return buildCalendarSchedule({
      title: onAtMatch[1].trim(),
      datePhrase: onAtMatch[2].trim(),
      timePhrase: onAtMatch[3].trim(),
      after
    });
  }

  const relativeAtMatch = trimmed.match(
    /^(.+?)\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\s+[a-z]+|[a-z]+\s+\d{1,2})\s+at\s+(.+)$/i
  );
  if (relativeAtMatch?.[1] && relativeAtMatch[2] && relativeAtMatch[3]) {
    return buildCalendarSchedule({
      title: relativeAtMatch[1].trim(),
      datePhrase: relativeAtMatch[2].trim(),
      timePhrase: relativeAtMatch[3].trim(),
      after
    });
  }

  const plainAtMatch = trimmed.match(/^(.+?)\s+at\s+(.+)$/i);
  if (plainAtMatch?.[1] && plainAtMatch[2]) {
    return buildCalendarSchedule({
      title: plainAtMatch[1].trim(),
      datePhrase: "today",
      timePhrase: plainAtMatch[2].trim(),
      after
    });
  }

  return null;
}

function buildCalendarSchedule(input: {
  title: string;
  datePhrase: string;
  timePhrase: string;
  after: Date;
}): { startsAt: Date; endsAt: Date | null; consumedText: string } | null {
  if (!input.title) {
    return null;
  }

  const clock = parseClockTime(input.timePhrase);
  if (!clock) {
    return null;
  }

  const dateLocal = parseCalendarDatePhrase(input.datePhrase, input.after);
  if (!dateLocal) {
    return null;
  }

  let startsAt = mauritiusLocalToUtc({
    year: dateLocal.year,
    month: dateLocal.month,
    day: dateLocal.day,
    hour: clock.hour,
    minute: clock.minute
  });

  if (startsAt.getTime() <= input.after.getTime() && input.datePhrase.toLowerCase() === "today") {
    const tomorrow = addDaysToLocal(dateLocal, 1);
    startsAt = mauritiusLocalToUtc({
      year: tomorrow.year,
      month: tomorrow.month,
      day: tomorrow.day,
      hour: clock.hour,
      minute: clock.minute
    });
  }

  if (
    startsAt.getTime() <= input.after.getTime() &&
    WEEKDAY_INDEX[input.datePhrase.toLowerCase()] !== undefined &&
    dateLocal.year === getMauritiusLocalParts(input.after).year &&
    dateLocal.month === getMauritiusLocalParts(input.after).month &&
    dateLocal.day === getMauritiusLocalParts(input.after).day
  ) {
    const nextWeek = addDaysToLocal(dateLocal, 7);
    startsAt = mauritiusLocalToUtc({
      year: nextWeek.year,
      month: nextWeek.month,
      day: nextWeek.day,
      hour: clock.hour,
      minute: clock.minute
    });
  }

  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  return {
    startsAt,
    endsAt,
    consumedText: input.title
  };
}

export function formatCalendarEventWhen(startsAt: Date): string {
  const local = getMauritiusLocalParts(startsAt);
  return `${weekdayName(local.weekday)} ${local.day}/${local.month} at ${startsAt.toLocaleTimeString("en-GB", {
    timeZone: "Indian/Mauritius",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })}`;
}
