import { parseClockTime, parseWeekdayTokens } from "./reminder-time.service.js";

export type ReminderRepeatKind = "once" | "daily" | "weekdays" | "weekly";

export type ReminderParseResult =
  | {
      type: "create";
      label: string;
      repeatKind: ReminderRepeatKind;
      hour: number;
      minute: number;
      weekdays?: number[] | undefined;
    }
  | { type: "list" }
  | { type: "cancel"; index: number }
  | { type: "done" }
  | { type: "skip" }
  | { type: "snooze"; minutes: number };

const REMIND_PREFIX = /^remind(?:\s+me)?\s+to\s+(.+)$/i;
const SET_REMINDER_PREFIX = /^set\s+reminder\s+(?:to\s+)?(.+)$/i;

function normalize(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function parseSnoozeMinutes(text: string): number | null {
  const match = text.match(/^snooze(?:\s+(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?)?$/i);
  if (!match) {
    return null;
  }

  if (!match[1]) {
    return 60;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = (match[2] ?? "h").toLowerCase();
  if (unit.startsWith("m")) {
    return amount;
  }

  return amount * 60;
}

function parseCreateBody(body: string): Extract<ReminderParseResult, { type: "create" }> | null {
  const atMatch = body.match(/^(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i);
  const labelCapture = atMatch?.[1];
  const timeCapture = atMatch?.[2];
  if (!labelCapture || !timeCapture) {
    return null;
  }

  const time = parseClockTime(timeCapture);
  if (!time) {
    return null;
  }

  let labelPart = labelCapture.trim();
  let repeatKind: ReminderRepeatKind = "once";
  let weekdays: number[] | undefined;

  const dailyMatch = labelPart.match(/^(.+?)\s+(every day|daily)$/i);
  if (dailyMatch?.[1]) {
    labelPart = dailyMatch[1].trim();
    repeatKind = "daily";
  }

  const weekdaysMatch = labelPart.match(/^(.+?)\s+(every weekday|every weekdays|on weekdays|weekdays)$/i);
  if (weekdaysMatch?.[1]) {
    labelPart = weekdaysMatch[1].trim();
    repeatKind = "weekdays";
  }

  const everyMatch = labelPart.match(/^(.+?)\s+every\s+(.+)$/i);
  const everyLabel = everyMatch?.[1];
  const everyDays = everyMatch?.[2];
  if (everyLabel && everyDays) {
    const parsedWeekdays = parseWeekdayTokens(everyDays);
    if (parsedWeekdays.length === 0) {
      return null;
    }

    labelPart = everyLabel.trim();
    repeatKind = "weekly";
    weekdays = parsedWeekdays;
  }

  if (!labelPart) {
    return null;
  }

  return {
    type: "create",
    label: labelPart,
    repeatKind,
    hour: time.hour,
    minute: time.minute,
    weekdays
  };
}

export function parseReminderCommand(message: string): ReminderParseResult | null {
  const trimmed = normalize(message);
  const lowered = trimmed.toLowerCase();

  if (
    lowered === "my reminders" ||
    lowered === "list reminders" ||
    lowered === "show reminders" ||
    lowered === "reminders"
  ) {
    return { type: "list" };
  }

  const cancelMatch = lowered.match(/^cancel reminder\s+(\d+)$/);
  if (cancelMatch) {
    return { type: "cancel", index: Number(cancelMatch[1]) };
  }

  if (lowered === "done" || lowered === "reminder done") {
    return { type: "done" };
  }

  if (lowered === "skip" || lowered === "reminder skip") {
    return { type: "skip" };
  }

  const snoozeMinutes = parseSnoozeMinutes(lowered);
  if (snoozeMinutes) {
    return { type: "snooze", minutes: snoozeMinutes };
  }

  const remindMatch = trimmed.match(REMIND_PREFIX);
  const remindBody = remindMatch?.[1];
  if (remindBody) {
    return parseCreateBody(remindBody);
  }

  const setReminderMatch = trimmed.match(SET_REMINDER_PREFIX);
  const setReminderBody = setReminderMatch?.[1];
  if (setReminderBody) {
    return parseCreateBody(setReminderBody);
  }

  return null;
}
