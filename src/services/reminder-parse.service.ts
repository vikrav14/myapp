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

function normalizeReminderAction(message: string): string {
  const firstLine = message.trim().split(/\n/)[0]?.trim().toLowerCase() ?? "";
  if (firstLine === "done" || firstLine.startsWith("done ")) {
    return "done";
  }
  if (firstLine === "skip" || firstLine.startsWith("skip ")) {
    return "skip";
  }

  return message.trim().toLowerCase();
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

function isBareTrailingTimeUsable(timeToken: string): boolean {
  const normalized = normalizeTimeToken(timeToken).trim();
  if (/(?:am|pm)/i.test(normalized)) {
    return true;
  }

  return /^\d{1,2}:\d{2}$/i.test(normalized);
}

function extractRemindBody(message: string): string | null {
  const normalized = normalize(message)
    .replace(/\n+/g, " ")
    .replace(/[?.!,]+$/g, "")
    .trim();

  const remindMatch = normalized.match(/remind(?:\s+me)?(?:\s+to)?\s+(.+)/i);
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

  const reminderBareMatch = normalized.match(/^reminder\s+(.+)/i);
  if (reminderBareMatch?.[1]) {
    return reminderBareMatch[1].trim();
  }

  return null;
}

function parseRelativeDelayToken(token: string): number | null {
  const trimmed = token.trim();
  const match = trimmed.match(/^(\d+)(?:\s+(\S+))?$/i);
  if (!match?.[1]) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = (match[2] ?? "min").toLowerCase();
  if (/^m/.test(unit)) {
    return amount;
  }

  if (/^h/.test(unit)) {
    return amount * 60;
  }

  return null;
}

function parseCreateBody(
  body: string
): Extract<ReminderParseResult, { type: "create" } | { type: "create_relative" }> | null {
  const cleanedBody = body
    .replace(/\s+today$/i, "")
    .replace(/\s+tonight$/i, "")
    .replace(/[?.!,]+$/g, "")
    .trim();

  const relativeMatch = cleanedBody.match(/^(.+?)\s+in\s+(\d+)(?:\s+(\S+))?\s*$/i);
  const relativeLabel = relativeMatch?.[1];
  const relativeAmount = relativeMatch?.[2];
  const relativeUnit = relativeMatch?.[3];
  if (relativeLabel && relativeAmount) {
    const delayMinutes = parseRelativeDelayToken(
      relativeUnit ? `${relativeAmount} ${relativeUnit}` : relativeAmount
    );
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
  const bareTimeToken = bareTimeMatch?.[2];
  const match =
    atMatch ??
    (bareTimeToken && isBareTrailingTimeUsable(bareTimeToken) ? bareTimeMatch : null);

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

  if (/\bin\s+\d+(?:\s*(?:m|min|mins|minute|minutes|mina|h|hr|hrs|hour|hours))?\b/i.test(normalized)) {
    return true;
  }

  return new RegExp(String.raw`\b(?:at\s+)?${TIME_TOKEN_PATTERN}\b`, "i").test(normalized);
}

export function buildReminderParseFailureReply(): string {
  return [
    "I didn't save that reminder — I couldn't read the time clearly from your message.",
    "",
    "Try: remind me to <anything> in 15 minutes",
    "Or: remind me to <anything> at 11:55pm",
    "Reply my reminders to check what's scheduled."
  ].join("\n");
}

export function parseReminderCommand(message: string): ReminderParseResult | null {
  const trimmed = normalize(message);
  const lowered = normalizeReminderAction(trimmed);

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
