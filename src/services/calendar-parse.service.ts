import { parseCalendarSchedule } from "./calendar-time.service.js";

export type CalendarParseResult =
  | { type: "add"; title: string; scheduleText: string }
  | { type: "list"; scope: "all" | "today" | "week" }
  | { type: "cancel"; index: number }
  | { type: "connect"; url: string }
  | { type: "disconnect" }
  | { type: "sync" }
  | { type: "toggle"; enabled: boolean };

function normalize(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function parseAddBody(body: string): Extract<CalendarParseResult, { type: "add" }> | null {
  const schedule = parseCalendarSchedule(body);
  if (!schedule) {
    return null;
  }

  return {
    type: "add",
    title: schedule.consumedText,
    scheduleText: body
  };
}

export function parseCalendarCommand(message: string): CalendarParseResult | null {
  const trimmed = normalize(message);
  const lowered = trimmed.toLowerCase();

  if (lowered === "my calendar" || lowered === "calendar") {
    return { type: "list", scope: "all" };
  }

  if (lowered === "calendar today" || lowered === "today calendar") {
    return { type: "list", scope: "today" };
  }

  if (lowered === "calendar week" || lowered === "calendar this week" || lowered === "this week calendar") {
    return { type: "list", scope: "week" };
  }

  if (lowered === "disconnect calendar" || lowered === "calendar disconnect") {
    return { type: "disconnect" };
  }

  if (lowered === "sync calendar" || lowered === "calendar sync") {
    return { type: "sync" };
  }

  if (lowered === "calendar on" || lowered === "calendar sync on") {
    return { type: "toggle", enabled: true };
  }

  if (lowered === "calendar off" || lowered === "calendar sync off") {
    return { type: "toggle", enabled: false };
  }

  const cancelMatch = lowered.match(/^cancel event\s+(\d+)$/);
  if (cancelMatch?.[1]) {
    return { type: "cancel", index: Number(cancelMatch[1]) };
  }

  const connectMatch = trimmed.match(/^connect calendar\s+(\S+)$/i);
  if (connectMatch?.[1]) {
    return { type: "connect", url: connectMatch[1] };
  }

  const addPrefixes = [
    /^calendar add\s+(.+)$/i,
    /^add to calendar\s+(.+)$/i,
    /^add event\s+(.+)$/i
  ];

  for (const pattern of addPrefixes) {
    const match = trimmed.match(pattern);
    const body = match?.[1];
    if (body) {
      const parsed = parseAddBody(body);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

export function parseMemoryResurfaceToggle(message: string): { enabled: boolean } | null {
  const lowered = message.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    lowered === "resurface on" ||
    lowered === "memory resurface on" ||
    lowered === "resurfacing on" ||
    lowered === "memory resurfacing on"
  ) {
    return { enabled: true };
  }

  if (
    lowered === "resurface off" ||
    lowered === "memory resurface off" ||
    lowered === "resurfacing off" ||
    lowered === "memory resurfacing off"
  ) {
    return { enabled: false };
  }

  return null;
}
