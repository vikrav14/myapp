import { logger } from "../lib/logger.js";

export interface ParsedIcalEvent {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
}

function unfoldIcalLines(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function parseIcalDateValue(value: string): Date | null {
  const normalized = value.trim();
  const dateTimeMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second] = dateTimeMatch;
    if (normalized.endsWith("Z")) {
      return new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second)
        )
      );
    }

    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour) - 4,
        Number(minute),
        Number(second)
      )
    );
  }

  const dateOnlyMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), -4, 0, 0));
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIcalProperty(line: string): { name: string; value: string } | null {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const left = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const name = left.split(";")[0]?.trim();
  if (!name) {
    return null;
  }

  return { name: name.toUpperCase(), value };
}

export function parseIcalEvents(icalText: string): ParsedIcalEvent[] {
  const lines = unfoldIcalLines(icalText);
  const events: ParsedIcalEvent[] = [];
  let inEvent = false;
  let current: Partial<ParsedIcalEvent> = {};

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (inEvent && current.uid && current.title && current.startsAt) {
        events.push({
          uid: current.uid,
          title: current.title,
          startsAt: current.startsAt,
          endsAt: current.endsAt ?? null,
          location: current.location ?? null
        });
      }

      inEvent = false;
      current = {};
      continue;
    }

    if (!inEvent) {
      continue;
    }

    const property = parseIcalProperty(line);
    if (!property) {
      continue;
    }

    if (property.name === "UID") {
      current.uid = property.value;
    } else if (property.name === "SUMMARY") {
      current.title = property.value;
    } else if (property.name === "LOCATION") {
      current.location = property.value;
    } else if (property.name === "DTSTART") {
      const startsAt = parseIcalDateValue(property.value);
      if (startsAt) {
        current.startsAt = startsAt;
      }
    } else if (property.name === "DTEND") {
      const endsAt = parseIcalDateValue(property.value);
      if (endsAt) {
        current.endsAt = endsAt;
      }
    }
  }

  return events;
}

export async function fetchIcalEvents(url: string): Promise<ParsedIcalEvent[]> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MauriCalendarSync/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`iCal fetch failed (${response.status}).`);
  }

  const text = await response.text();
  const events = parseIcalEvents(text);
  logger.info({ url, eventCount: events.length }, "Fetched iCal feed.");
  return events;
}
