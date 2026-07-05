import { parseClockTime, parseWeekdayTokens, computeSnoozeMinutesUntilTomorrowMorning } from "./reminder-time.service.js";

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
  | {
      type: "create_relative";
      label: string;
      delayMinutes: number;
    }
  | { type: "list" }
  | { type: "cancel"; index: number }
  | { type: "done" }
  | { type: "skip" }
  | { type: "snooze"; minutes: number };

const TIME_TOKEN_PATTERN = String.raw`\d{1,2}(?:(?::|\.)\d{2}|\s+\d{2})?\s*(?:am|pm)?`;

function normalize(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function normalizeTimeToken(token: string): string {
  return token.trim().replace(/(\d{1,2})\s+(\d{2})\b/i, "$1:$2");
}

function parseSnoozeMinutes(text: string): number | null {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");

  if (normalized === "snooze tomorrow") {
    return computeSnoozeMinutesUntilTomorrowMorning();
  }

  const match = normalized.match(/^snooze(?:\s+(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?)?$/i);
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

function extractRemindBody(message: string): string | null {
  const normalized = normalize(message)
    .replace(/\n+/g, " ")
    .replace(/[?.!,]+$/g, "")
    .trim();

  const remindMatch = normalized.match(/remind(?:\s+me)?\s+to\s+(.+)/i);
  if (remindMatch?.[1]) {
    return remindMatch[1].trim();
  }

  const setMatch = normalized.match(/set\s+(?:a\s+)?reminder(?:\s+(?:for|to))?\s+(.+)/i);
  if (setMatch?.[1]) {
    return setMatch[1].trim();
  }

  const reminderForMatch = normalized.match(/reminder\s+(?:for|to)\s+(.+)/i);
  if (reminderForMatch?.[1]) {
    return reminderForMatch[1].trim();
  }

  return null;
}

function parseRelativeDelayToken(token: string): number | null {
  const match = token.trim().match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2].toLowerCase();
  if (unit.startsWith("m")) {
    return amount;
  }

  return amount * 60;
}

function parseCreateBody(
  body: string
): Extract<ReminderParseResult, { type: "create" } | { type: "create_relative" }> | null {
  const cleanedBody = body
    .replace(/\s+today$/i, "")
    .replace(/\s+tonight$/i, "")
    .replace(/[?.!,]+$/g, "")
    .trim();

  const relativeMatch = cleanedBody.match(
    /^(.+?)\s+in\s+(\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours))\s*$/i
  );
  const relativeLabel = relativeMatch?.[1];
  const relativeDelayToken = relativeMatch?.[2];
  if (relativeLabel && relativeDelayToken) {
    const delayMinutes = parseRelativeDelayToken(relativeDelayToken);
    const label = relativeLabel.trim();
    if (label && delayMinutes) {
      return {
        type: "create_relative",
        label,
        delayMinutes
      };
    }
  }

  const atMatch = cleanedBody.match(new RegExp(`^(.+?)\\s+at\\s+(${TIME_TOKEN_PATTERN})\\s*$`, "i"));
  const bareTimeMatch = cleanedBody.match(new RegExp(`^(.+?)\\s+(${TIME_TOKEN_PATTERN})\\s*$`, "i"));
  const match = atMatch ?? (bareTimeMatch?.[2]?.match(/(?:am|pm)/i) ? bareTimeMatch : null);

  const labelCapture = match?.[1];
  const timeCapture = match?.[2];
  if (!labelCapture || !timeCapture) {
    return null;
  }

  const time = parseClockTime(normalizeTimeToken(timeCapture));
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

export function looksLikeReminderAttempt(message: string): boolean {
  const normalized = normalize(message).toLowerCase();

  if (!/(?:\bremind(?:er)?\b|\bset\s+(?:a\s+)?reminder\b)/i.test(normalized)) {
    return false;
  }

  if (/\bin\s+\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i.test(normalized)) {
    return true;
  }

  return new RegExp(String.raw`\b(?:at\s+)?${TIME_TOKEN_PATTERN}\b`, "i").test(normalized);
}

export function buildReminderParseFailureReply(): string {
  return [
    "I didn't save that reminder — I couldn't read the time clearly from your message.",
    "",
    "Try: remind me to drink water at 11:55pm",
    "Or: remind me to drink water in 15 minutes",
    "Reply my reminders to check what's scheduled."
  ].join("\n");
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

  const remindBody = extractRemindBody(trimmed);
  if (remindBody) {
    return parseCreateBody(remindBody);
  }

  return null;
}
